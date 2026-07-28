import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/create-runner — el DUEÑO da de alta a su encargado de compra.
 * body: { email, password, name }
 */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no_auth" }, { status: 401 });

  // El perfil del solicitante debe ser owner
  const { data: me } = await supabase
    .from("profiles")
    .select("business_id, role")
    .eq("id", user.id)
    .single();
  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "Solo el dueño puede crear cuentas." }, { status: 403 });
  }

  let body: { email?: string; password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const name = (body.name || "").trim();

  if (!email || !email.includes("@")) return NextResponse.json({ error: "Escribe un correo válido." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Escribe el nombre del encargado." }, { status: 400 });

  const admin = supabaseAdmin();

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created?.user) {
    const msg = userErr?.message?.includes("already")
      ? "Ese correo ya tiene cuenta."
      : "No se pudo crear la cuenta. Intenta de nuevo.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id,
    business_id: me.business_id,
    name,
    role: "runner",
  });

  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "No se pudo crear el perfil. Intenta de nuevo." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
