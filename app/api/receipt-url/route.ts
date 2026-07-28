import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/receipt-url?path=businessId/... [&bucket=receipts|cash-photos]
 * Devuelve una signed URL temporal de una foto (ticket o entrega de
 * efectivo). SOLO el dueño del negocio puede ver fotos.
 */
export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no_auth" }, { status: 401 });

  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "";
  const bucket = url.searchParams.get("bucket") || "receipts";
  if (!path || path.includes("..") || !["receipts", "cash-photos"].includes(bucket)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { data: me } = await supabase
    .from("profiles")
    .select("business_id, role")
    .eq("id", user.id)
    .single();
  if (!me || me.role !== "owner" || !path.startsWith(`${me.business_id}/`)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(path, 60 * 60); // 1 hora

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ url: data.signedUrl });
}
