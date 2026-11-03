import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/reset-collaborator-password — el DUEÑO le pone una contraseña
 * nueva a un colaborador de su negocio. Nada de correos ni links: la
 * escribe él mismo y se la dicta en persona, igual que al crear la cuenta.
 * body: { profileId, password }
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
    return NextResponse.json({ error: "Solo el dueño puede restablecer contraseñas." }, { status: 403 });
  }

  let body: { profileId?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const profileId = (body.profileId || "").trim();
  const password = body.password || "";
  if (!profileId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });

  const admin = supabaseAdmin();

  // El colaborador debe ser del mismo negocio y nunca el dueño.
  const { data: target } = await admin
    .from("profiles")
    .select("id, business_id, role")
    .eq("id", profileId)
    .single();
  if (!target || target.business_id !== me.business_id || target.role === "owner") {
    return NextResponse.json({ error: "No se encontró a ese colaborador." }, { status: 404 });
  }

  const { error } = await admin.auth.admin.updateUserById(profileId, { password });
  if (error) return NextResponse.json({ error: "No se pudo cambiar la contraseña. Intenta de nuevo." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
