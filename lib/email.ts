import nodemailer from "nodemailer";

/**
 * Correo de aviso de efectivo bajo — por SMTP.
 * Usa el MISMO servidor de correo que configuraste en Supabase
 * (Authentication → Emails → SMTP Settings), así todo vive en un solo lugar.
 * Si no hay SMTP configurado no se manda nada: el aviso dentro de la app
 * se muestra igual.
 */
export async function sendLowCashEmail(opts: {
  to: string[];
  businessName: string;
  balance: number;
  threshold: number;
}): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || opts.to.length === 0) return false;

  const port = Number(process.env.SMTP_PORT || 465);
  const from = process.env.EMAIL_FROM || `Vertify <${user}>`;
  const money = (n: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = SSL directo; 587 = STARTTLS
      auth: { user, pass },
    });

    await transport.sendMail({
      from,
      to: opts.to.join(", "),
      subject: `Vertify — queda poco efectivo en ${opts.businessName}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px">
          <h2 style="color:#14241C">Queda poco efectivo</h2>
          <p>El efectivo en mano de <b>${opts.businessName}</b> bajó a
          <b>${money(opts.balance)}</b> (el aviso salta en ${money(opts.threshold)}).</p>
          <p>El encargado de compra debe pedir más dinero y el dueño debe
          preparar la siguiente entrega de efectivo.</p>
          <p style="color:#777;font-size:13px">Este aviso se manda una sola vez
          hasta que se recargue el saldo.</p>
        </div>`,
    });
    return true;
  } catch (err) {
    console.error("sendLowCashEmail:", err);
    return false;
  }
}
