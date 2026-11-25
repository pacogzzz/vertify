import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/cortes-caja — SOLO Caja. Cierra el turno del día: guarda venta
 * en efectivo/tarjeta, las 3 fotos/archivo obligatorios, y los gastos que
 * se sacaron de caja (cada uno con monto, concepto y foto). Todo pasa por
 * el service role: Caja nunca tiene permiso de SELECT en estas tablas,
 * así que ni siquiera puede leer lo que acaba de guardar.
 */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no_auth" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("business_id, role")
    .eq("id", user.id)
    .single();
  if (!me || me.role !== "caja") {
    return NextResponse.json({ error: "Solo Caja puede cerrar turno." }, { status: 403 });
  }

  let body: {
    fecha?: string;
    venta_efectivo?: number;
    venta_tarjeta?: number;
    foto_sobre_path?: string;
    foto_excel_path?: string;
    excel_venta_path?: string;
    gastos?: { monto: number; concepto: string; foto_path: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const fecha = String(body.fecha || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  }
  const efectivo = Number(body.venta_efectivo);
  const tarjeta = Number(body.venta_tarjeta);
  if (!Number.isFinite(efectivo) || efectivo < 0 || !Number.isFinite(tarjeta) || tarjeta < 0) {
    return NextResponse.json({ error: "Pon la venta en efectivo y en tarjeta." }, { status: 400 });
  }
  if (!body.foto_sobre_path || !body.foto_excel_path || !body.excel_venta_path) {
    return NextResponse.json({ error: "Faltan archivos obligatorios." }, { status: 400 });
  }
  const gastos = body.gastos || [];
  for (const g of gastos) {
    if (!Number.isFinite(g.monto) || g.monto <= 0 || !g.concepto?.trim() || !g.foto_path) {
      return NextResponse.json({ error: "Cada gasto necesita monto, concepto y foto." }, { status: 400 });
    }
  }

  const admin = supabaseAdmin();

  const { data: existente } = await admin
    .from("cortes_caja")
    .select("id")
    .eq("business_id", me.business_id)
    .eq("fecha", fecha)
    .maybeSingle();
  if (existente) {
    return NextResponse.json({ error: "Ya se cerró el turno de hoy." }, { status: 409 });
  }

  const { data: corte, error: corteErr } = await admin
    .from("cortes_caja")
    .insert({
      business_id: me.business_id,
      fecha,
      caja_id: user.id,
      venta_efectivo: efectivo,
      venta_tarjeta: tarjeta,
      foto_sobre_path: body.foto_sobre_path,
      foto_excel_path: body.foto_excel_path,
      excel_venta_path: body.excel_venta_path,
    })
    .select()
    .single();

  if (corteErr || !corte) {
    if (corteErr?.code === "23505") {
      return NextResponse.json({ error: "Ya se cerró el turno de hoy." }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo guardar el corte." }, { status: 500 });
  }

  if (gastos.length > 0) {
    const rows = gastos.map((g) => ({
      business_id: me.business_id,
      corte_id: corte.id,
      monto: g.monto,
      concepto: g.concepto.trim(),
      foto_path: g.foto_path,
    }));
    const { error: gastosErr } = await admin.from("gastos_caja").insert(rows);
    if (gastosErr) {
      return NextResponse.json({ error: "Se guardó el corte, pero no los gastos. Avisa al dueño." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
