/**
 * Correo de alerta de efectivo bajo — vía Resend (https://resend.com).
 * Opcional: si no hay RESEND_API_KEY configurada, no se manda nada
 * (la app siempre muestra el aviso en pantalla de todos modos).
 */
export async function sendLowCashEmail(opts: {
  to: string[];
  businessName: string;
  balance: number;
  threshold: number;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || opts.to.length === 0) return false;

  const from = process.env.EMAIL_FROM || "Vertify <onboarding@resend.dev>";
  const money = (n: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: `Vertify — queda poco efectivo en ${opts.businessName}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px">
            <h2 style="color:#14241C">Queda poco efectivo</h2>
            <p>El efectivo en mano de <b>${opts.businessName}</b> bajó a
            <b>${money(opts.balance)}</b> (el aviso salta en ${money(opts.threshold)}).</p>
            <p>El encargado debe pedir más dinero y el dueño debe preparar la
            siguiente entrega de efectivo.</p>
            <p style="color:#777;font-size:13px">Este aviso se manda una sola vez
            hasta que se recargue el saldo.</p>
          </div>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
