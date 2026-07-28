import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/register — registro del DUEÑO.
 * Usa signUp (no admin) para que Supabase mande el correo de verificación
 * cuando "Confirm email" está activado en el proyecto. Crea negocio y
 * perfil owner de una vez; el login queda bloqueado hasta confirmar.
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

  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "";
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: signed, error: userErr } = await anon.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/login?confirmado=1` },
  });

  // Con verificación activada, un correo repetido regresa un usuario "fantasma" sin identities.
  if (userErr || !signed?.user || signed.user.identities?.length === 0) {
    if (userErr?.code === "over_email_send_rate_limit" || userErr?.status === 429) {
      return NextResponse.json(
        { error: "Se alcanzó el límite de correos por ahora. Espera unos minutos e intenta de nuevo." },
        { status: 429 }
      );
    }
    const msg =
      userErr?.message?.includes("already") || signed?.user?.identities?.length === 0
        ? "Ese correo ya tiene cuenta. Inicia sesión."
        : "No se pudo crear la cuenta. Intenta de nuevo.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  const admin = supabaseAdmin();

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .insert({ name: businessName })
    .select()
    .single();

  if (bizErr || !biz) {
    await admin.auth.admin.deleteUser(signed.user.id);
    return NextResponse.json({ error: "No se pudo crear el negocio. Intenta de nuevo." }, { status: 500 });
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: signed.user.id,
    business_id: biz.id,
    name: ownerName,
    role: "owner",
  });

  if (profErr) {
    await admin.from("businesses").delete().eq("id", biz.id);
    await admin.auth.admin.deleteUser(signed.user.id);
    return NextResponse.json({ error: "No se pudo crear el perfil. Intenta de nuevo." }, { status: 500 });
  }

  // needsConfirm: true cuando Supabase mandó correo de verificación (sin sesión inmediata)
  return NextResponse.json({ ok: true, needsConfirm: !signed.session });
}
