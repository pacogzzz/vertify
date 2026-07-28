"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Loader2, MailCheck, Store } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function RegistroPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [waitingConfirm, setWaitingConfirm] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessName.trim()) return setErr("Escribe el nombre del negocio.");
    if (!ownerName.trim()) return setErr("Escribe tu nombre.");
    if (!email.trim().includes("@")) return setErr("Escribe un correo válido.");
    if (password.length < 8) return setErr("La contraseña debe tener al menos 8 caracteres.");
    setErr(""); setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, ownerName: ownerName.trim(), businessName: businessName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "No se pudo crear la cuenta."); setLoading(false); return; }

      if (data.needsConfirm) {
        // Supabase mandó el correo de verificación: no hay sesión hasta confirmar
        setWaitingConfirm(true);
        setLoading(false);
        return;
      }

      const sb = supabaseBrowser();
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setErr("Cuenta creada; entra con tus datos."); setLoading(false); return; }
      router.replace("/");
      router.refresh();
    } catch {
      setErr("No se pudo crear la cuenta. Revisa tu conexión.");
      setLoading(false);
    }
  }

  return (
    <div className="cuadra" style={{ minHeight: "100vh" }}>
      <div className="auth-wrap">
        <div className="auth-brand">
          <div className="brand-mark">$</div>
          <div>
            <div className="brand-name">Vertify</div>
            <div className="brand-sub">Control de gastos del encargado de compra</div>
          </div>
        </div>
        <div className="auth-card">
          {waitingConfirm ? (
            <div style={{ textAlign: "center", padding: "10px 0" }}>
              <MailCheck size={38} style={{ color: "var(--good, #2e7d4f)", marginBottom: 10 }} />
              <h1 className="auth-title">Confirma tu correo</h1>
              <p className="auth-sub" style={{ marginBottom: 14 }}>
                Te mandamos un mensaje a <b>{email.trim()}</b>. Ábrelo y toca el botón de
                confirmación para activar tu cuenta. Revisa también la carpeta de spam.
              </p>
              <Link href="/login" className="btn btn-primary btn-block" style={{ textDecoration: "none" }}>Ir a entrar</Link>
            </div>
          ) : (
            <>
              <h1 className="auth-title">Crea tu negocio</h1>
              <p className="auth-sub">Esta es la cuenta del dueño. Después, desde Ajustes, creas el acceso de tu encargado de compra.</p>
              <form onSubmit={submit}>
                <div className="field"><label className="label">Nombre del negocio</label><input className="input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Mi Restaurante" /></div>
                <div className="field"><label className="label">Tu nombre</label><input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Francisco" /></div>
                <div className="field"><label className="label">Correo</label><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" /></div>
                <div className="field"><label className="label">Contraseña</label><input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" /></div>
                {err && <div className="err"><AlertTriangle size={14} />{err}</div>}
                <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} type="submit" disabled={loading}>
                  {loading ? <Loader2 className="spin" size={17} /> : <Store size={17} />}Crear negocio
                </button>
              </form>
            </>
          )}
        </div>
        <div className="auth-foot">¿Ya tienes cuenta? <Link href="/login">Entrar</Link></div>
      </div>
    </div>
  );
}
