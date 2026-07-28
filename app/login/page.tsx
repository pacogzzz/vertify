"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check, Loader2, LogIn } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(
    params.get("error") ? "Tu cuenta no está completa. Pide ayuda a quien te la creó." : ""
  );
  const [ok] = useState(params.get("confirmado") ? "¡Correo confirmado! Ya puedes entrar." : "");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) { setErr("Escribe tu correo y contraseña."); return; }
    setErr(""); setLoading(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setErr(
        error.message?.toLowerCase().includes("confirm")
          ? "Falta confirmar tu correo. Busca el mensaje que te mandamos (revisa spam)."
          : "Correo o contraseña incorrectos."
      );
      setLoading(false);
      return;
    }
    router.replace("/");
    router.refresh();
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
          <h1 className="auth-title">Entrar</h1>
          <p className="auth-sub">Usa el correo y la contraseña de tu cuenta.</p>
          {ok && <div className="banner-ok"><Check size={15} />{ok}</div>}
          <form onSubmit={submit}>
            <div className="field"><label className="label">Correo</label><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" /></div>
            <div className="field"><label className="label">Contraseña</label><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></div>
            {err && <div className="err"><AlertTriangle size={14} />{err}</div>}
            <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} type="submit" disabled={loading}>
              {loading ? <Loader2 className="spin" size={17} /> : <LogIn size={17} />}Entrar
            </button>
          </form>
        </div>
        <div className="auth-foot">¿Eres dueño y aún no tienes cuenta? <Link href="/registro">Crea tu negocio</Link></div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
