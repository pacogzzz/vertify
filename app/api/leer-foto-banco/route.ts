import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { readBankPhoto } from "@/lib/ocr";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/leer-foto-banco — SOLO el dueño. body: { image: base64 sin prefijo data: } */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no_auth" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "Solo el dueño puede subir fotos del banco." }, { status: 403 });
  }

  let image: unknown;
  try {
    ({ image } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof image !== "string" || image.length < 100) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (image.length > 8_000_000) {
    return NextResponse.json({ error: "imagen_muy_grande" }, { status: 413 });
  }

  try {
    const data = await readBankPhoto(image);
    if (data && data.error) {
      return NextResponse.json({ error: "ilegible" }, { status: 422 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("leer-foto-banco:", err);
    return NextResponse.json({ error: "ocr_fallo" }, { status: 502 });
  }
}
