import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/solicitudes/resolver — SOLO el dueño. body: { solicitud_id, aprobar }
 * Si aprueba:
 *  - tipo "precio": actualiza insumos.precio al precio propuesto.
 *  - tipo "compra": marca el item de la lista como "rechazado" (no se compra).
 * Si declina, no cambia nada más que el estado de la solicitud. Cualquiera
 * de los dos casos queda registrado (quién y cuándo) para el historial.
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
    return NextResponse.json({ error: "Solo el dueño puede resolver solicitudes." }, { status: 403 });
  }

  let body: { solicitud_id?: string; aprobar?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const solicitudId = (body.solicitud_id || "").trim();
  const aprobar = !!body.aprobar;
  if (!solicitudId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const admin = supabaseAdmin();

  const { data: sol } = await admin.from("solicitudes").select("*").eq("id", solicitudId).single();
  if (!sol || sol.business_id !== me.business_id) {
    return NextResponse.json({ error: "No se encontró esa solicitud." }, { status: 404 });
  }
  if (sol.status !== "pendiente") {
    return NextResponse.json({ error: "Esa solicitud ya se resolvió." }, { status: 409 });
  }

  if (aprobar) {
    if (sol.tipo === "precio") {
      const { error } = await admin.from("insumos").update({ precio: sol.precio_propuesto }).eq("id", sol.insumo_id);
      if (error) return NextResponse.json({ error: "No se pudo actualizar el precio." }, { status: 500 });
    } else {
      const { error } = await admin
        .from("lista_compra_items")
        .update({ status: "rechazado" })
        .eq("id", sol.lista_compra_item_id);
      if (error) return NextResponse.json({ error: "No se pudo actualizar la lista." }, { status: 500 });
    }
  }

  const { error: updErr } = await admin
    .from("solicitudes")
    .update({ status: aprobar ? "aprobada" : "declinada", resuelto_por: user.id, resuelto_at: new Date().toISOString() })
    .eq("id", solicitudId);
  if (updErr) return NextResponse.json({ error: "No se pudo guardar la resolución." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
