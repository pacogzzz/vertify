import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendLowCashEmail } from "@/lib/email";

export const runtime = "nodejs";

/**
 * POST /api/low-balance — revisa el efectivo del negocio del solicitante.
 * Si bajó del umbral ($700 por defecto) manda correo a dueño y encargado
 * UNA vez (flag low_cash_alerted); si se recargó por encima, resetea el flag.
 * Se llama después de guardar un gasto o una recarga.
 */
export async function POST() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no_auth" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("business_id")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = supabaseAdmin();
  const bizId = me.business_id;

  const [bizRes, fundRes, expRes] = await Promise.all([
    admin.from("businesses").select("name, low_cash_threshold, low_cash_alerted").eq("id", bizId).single(),
    admin.from("fundings").select("amount").eq("business_id", bizId),
    admin.from("expenses").select("total").eq("business_id", bizId).eq("payment_method", "efectivo"),
  ]);
  const biz = bizRes.data;
  if (!biz) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const funded = (fundRes.data || []).reduce((s, f) => s + Number(f.amount || 0), 0);
  const spent = (expRes.data || []).reduce((s, e) => s + Number(e.total || 0), 0);
  const balance = funded - spent;
  const threshold = Number(biz.low_cash_threshold || 700);

  if (balance <= threshold && !biz.low_cash_alerted) {
    await admin.from("businesses").update({ low_cash_alerted: true }).eq("id", bizId);

    // correos del dueño y del encargado (viven en auth.users)
    const { data: profs } = await admin.from("profiles").select("id").eq("business_id", bizId);
    const emails: string[] = [];
    for (const p of profs || []) {
      const { data: u } = await admin.auth.admin.getUserById(p.id);
      if (u?.user?.email) emails.push(u.user.email);
    }
    const sent = await sendLowCashEmail({ to: emails, businessName: biz.name, balance, threshold });
    return NextResponse.json({ alert: true, balance, emailed: sent });
  }

  if (balance > threshold && biz.low_cash_alerted) {
    await admin.from("businesses").update({ low_cash_alerted: false }).eq("id", bizId);
    return NextResponse.json({ alert: false, balance });
  }

  return NextResponse.json({ alert: balance <= threshold, balance });
}
