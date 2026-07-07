import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/receipt-url?path=businessId/expenseId.jpg
 * Devuelve una signed URL temporal del ticket, verificando que el
 * solicitante pertenezca al negocio dueño de la foto.
 */
export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no_auth" }, { status: 401 });

  const path = new URL(req.url).searchParams.get("path") || "";
  if (!path || path.includes("..")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { data: me } = await supabase
    .from("profiles")
    .select("business_id")
    .eq("id", user.id)
    .single();
  if (!me || !path.startsWith(`${me.business_id}/`)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin()
    .storage.from("receipts")
    .createSignedUrl(path, 60 * 60); // 1 hora

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ url: data.signedUrl });
}
