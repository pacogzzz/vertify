import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /ticket/:id — enlace permanente a la foto del ticket de un gasto.
 * Es el link que va en el Excel: pide sesión de DUEÑO del negocio y
 * redirige a una signed URL temporal de la foto.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_SITE_URL || _req.url));

  const { data: me } = await supabase
    .from("profiles")
    .select("business_id, role")
    .eq("id", user.id)
    .single();
  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "Solo el dueño puede ver las fotos." }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { data: exp } = await admin
    .from("expenses")
    .select("business_id, photo_path")
    .eq("id", id)
    .single();
  if (!exp || exp.business_id !== me.business_id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!exp.photo_path) {
    return NextResponse.json({ error: "Este gasto no tiene foto de ticket." }, { status: 404 });
  }

  const { data, error } = await admin.storage.from("receipts").createSignedUrl(exp.photo_path, 60 * 60);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl);
}
