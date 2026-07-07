import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { readReceipt } from "@/lib/ocr";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/read-receipt — body: { image: base64 sin prefijo data: } */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "no_auth" }, { status: 401 });
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
  // La imagen viene reducida a ~1100px desde el cliente; ~8MB de base64 como tope sano
  if (image.length > 8_000_000) {
    return NextResponse.json({ error: "imagen_muy_grande" }, { status: 413 });
  }

  try {
    const data = await readReceipt(image);
    if (data && data.error) {
      // el modelo respondió pero el ticket no se pudo leer
      return NextResponse.json({ error: "ilegible" }, { status: 422 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("read-receipt:", err);
    return NextResponse.json({ error: "ocr_fallo" }, { status: 502 });
  }
}
