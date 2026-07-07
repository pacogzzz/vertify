import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/register — registro del DUEÑO.
 * Crea usuario (email confirmado), negocio y perfil owner en un solo paso.
 * body: { email, password, ownerName, businessName }
 */
export async function POST(req: Request) {
  let body: { email?: string; password?: string; ownerName?: string; businessName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const ownerName = (body.ownerName || "").trim();
  const businessName = (body.businessName || "").trim();

  if (!email || !email.includes("@")) return NextResponse.json({ error: "Escribe un correo válido." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  if (!ownerName) return NextResponse.json({ error: "Escribe tu nombre." }, { status: 400 });
  if (!businessName) return NextResponse.json({ error: "Escribe el nombre del negocio." }, { status: 400 });

  const admin = supabaseAdmin();

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created?.user) {
    const msg = userErr?.message?.includes("already")
      ? "Ese correo ya tiene cuenta. Inicia sesión."
      : "No se pudo crear la cuenta. Intenta de nuevo.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .insert({ name: businessName })
    .select()
    .single();

  if (bizErr || !biz) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "No se pudo crear el negocio. Intenta de nuevo." }, { status: 500 });
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id,
    business_id: biz.id,
    name: ownerName,
    role: "owner",
  });

  if (profErr) {
    await admin.from("businesses").delete().eq("id", biz.id);
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "No se pudo crear el perfil. Intenta de nuevo." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
