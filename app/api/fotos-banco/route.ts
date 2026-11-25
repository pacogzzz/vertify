import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/fotos-banco — SOLO el dueño. body: { fecha, foto_path, monto, concepto }
 * Guarda la foto ya leída por OCR y calcula "coincide" comparando contra
 * lo que reportó Caja ese día (cortes_caja.venta_efectivo/venta_tarjeta).
 */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no_auth" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("business_id, role").eq("id", user.id).single();
  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "Solo el dueño puede subir fotos del banco." }, { status: 403 });
  }

  let body: { fecha?: string; foto_path?: string; monto?: number; concepto?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const fecha = String(body.fecha || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  }
  const monto = Number(body.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json({ error: "No se pudo leer un monto válido en la foto." }, { status: 400 });
  }
  const concepto = body.concepto === "efectivo" || body.concepto === "tarjeta" ? body.concepto : null;
  if (!concepto) {
    return NextResponse.json({ error: "No se pudo determinar el concepto de la foto." }, { status: 400 });
  }
  if (!body.foto_path) {
    return NextResponse.json({ error: "Falta la foto." }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: corte } = await admin
    .from("cortes_caja")
    .select("venta_efectivo, venta_tarjeta")
    .eq("business_id", me.business_id)
    .eq("fecha", fecha)
    .maybeSingle();

  const esperado = corte ? (concepto === "efectivo" ? corte.venta_efectivo : corte.venta_tarjeta) : null;
  const coincide = esperado != null && Math.abs(Number(esperado) - monto) < 0.5;

  const { data: row, error } = await admin
    .from("fotos_banco")
    .insert({
      business_id: me.business_id,
      fecha,
      subido_por: user.id,
      foto_path: body.foto_path,
      monto,
      concepto,
      coincide,
    })
    .select()
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  }
  return NextResponse.json({ row });
}
