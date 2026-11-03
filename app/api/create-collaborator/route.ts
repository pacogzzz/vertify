import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isCollabRole, roleLabel } from "@/lib/roles";
import { normalizeUsername, isValidUsername, usernameToEmail } from "@/lib/username";

export const runtime = "nodejs";

/**
 * POST /api/create-collaborator — el DUEÑO da de alta a un colaborador
 * (Encargado, Chef, Administrador o Caja). Usuario + contraseña, sin
 * correo real: por dentro se arma un correo sintético solo para que
 * Supabase Auth tenga un identificador; nunca se le manda nada ahí.
 * body: { role, username, password, name }
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
    return NextResponse.json({ error: "Solo el dueño puede crear cuentas." }, { status: 403 });
  }

  let body: { role?: string; username?: string; password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const role = (body.role || "").trim();
  const username = normalizeUsername(body.username || "");
  const password = body.password || "";
  const name = (body.name || "").trim();

  if (!isCollabRole(role)) return NextResponse.json({ error: "Elige un rol válido." }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Escribe el nombre del colaborador." }, { status: 400 });
  if (!isValidUsername(username)) {
    return NextResponse.json(
      { error: "El usuario debe tener de 3 a 20 letras, números, puntos o guiones, sin empezar ni terminar en símbolo." },
      { status: 400 }
    );
  }
  if (password.length < 8) return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });

  const admin = supabaseAdmin();
  const email = usernameToEmail(username);

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // nunca se manda correo: solo Auth necesita un identificador
  });
  if (userErr || !created?.user) {
    const msg = userErr?.message?.includes("already")
      ? "Ese usuario ya existe. Elige otro."
      : "No se pudo crear la cuenta. Intenta de nuevo.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id,
    business_id: me.business_id,
    name,
    role,
    username,
  });

  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    const msg = profErr.message?.includes("username")
      ? "Ese usuario ya existe. Elige otro."
      : "No se pudo crear el perfil. Intenta de nuevo.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  return NextResponse.json({ ok: true, role: roleLabel(role) });
}
