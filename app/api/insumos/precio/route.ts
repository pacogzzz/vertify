import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/insumos/precio — el dueño cambia el precio de un insumo
 * directo, sin pasar por una solicitud (es su propio catálogo). body:
 * { insumo_id, precio }
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
  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "Solo el dueño puede cambiar precios." }, { status: 403 });
  }

  let body: { insumo_id?: string; precio?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const insumoId = (body.insumo_id || "").trim();
  const precio = Number(body.precio);
  if (!insumoId || !precio || precio <= 0) {
    return NextResponse.json({ error: "Pon un precio válido." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: insumo } = await admin.from("insumos").select("id, business_id").eq("id", insumoId).single();
  if (!insumo || insumo.business_id !== me.business_id) {
    return NextResponse.json({ error: "No se encontró ese insumo." }, { status: 404 });
  }

  const { error } = await admin.from("insumos").update({ precio }).eq("id", insumoId);
  if (error) return NextResponse.json({ error: "No se pudo actualizar el precio." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
