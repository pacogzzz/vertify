import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/solicitudes — el Encargado (Rubén) propone un cambio que
 * necesita el visto bueno del dueño:
 *  - tipo "precio": { tipo, insumo_id, precio_propuesto, nota? }
 *  - tipo "compra": { tipo, insumo_id, lista_compra_item_id, nota? } — pide
 *    quitar ese insumo de la lista de hoy (no comprarlo) por exceso.
 * No cambia nada todavía: queda "pendiente" hasta que el dueño la resuelva
 * en /api/solicitudes/resolver.
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
  if (!me || me.role !== "runner") {
    return NextResponse.json({ error: "Solo el encargado de compra puede pedir esto." }, { status: 403 });
  }

  let body: { tipo?: string; insumo_id?: string; precio_propuesto?: number; lista_compra_item_id?: string; nota?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const tipo = body.tipo;
  const insumoId = (body.insumo_id || "").trim();
  const nota = (body.nota || "").trim() || null;
  if (tipo !== "precio" && tipo !== "compra") return NextResponse.json({ error: "Tipo de solicitud inválido." }, { status: 400 });
  if (!insumoId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const admin = supabaseAdmin();

  const { data: insumo } = await admin.from("insumos").select("id, business_id, nombre, precio").eq("id", insumoId).single();
  if (!insumo || insumo.business_id !== me.business_id) {
    return NextResponse.json({ error: "No se encontró ese insumo." }, { status: 404 });
  }

  const row: Record<string, unknown> = {
    business_id: me.business_id,
    tipo,
    insumo_id: insumoId,
    insumo_nombre: insumo.nombre,
    solicitado_por: user.id,
    nota,
  };

  if (tipo === "precio") {
    const precio = Number(body.precio_propuesto);
    if (!precio || precio <= 0) return NextResponse.json({ error: "Pon un precio válido." }, { status: 400 });
    row.precio_actual = insumo.precio;
    row.precio_propuesto = precio;
  } else {
    const itemId = (body.lista_compra_item_id || "").trim();
    if (!itemId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const { data: item } = await admin.from("lista_compra_items").select("id, business_id, insumo_id").eq("id", itemId).single();
    if (!item || item.business_id !== me.business_id || item.insumo_id !== insumoId) {
      return NextResponse.json({ error: "No se encontró ese producto en la lista." }, { status: 404 });
    }
    row.lista_compra_item_id = itemId;
  }

  const { error } = await admin.from("solicitudes").insert(row);
  if (error) return NextResponse.json({ error: "No se pudo mandar la solicitud. Intenta de nuevo." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
