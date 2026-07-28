"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, Wallet, Plus, Download, Settings, Check, X,
  ChevronDown, ChevronRight, ChevronLeft, Receipt, Store, AlertTriangle,
  Loader2, Image as ImageIcon, Banknote, LogOut, UserPlus, CreditCard,
  CalendarDays, PencilLine,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TIENDAS } from "@/lib/stores";
import type { Business, Profile, ExpenseRow, FundingRow, ExpenseItem, ReceiptData } from "@/lib/types";

/* ============================================================
   Vertify — v2 del port de producción (antes Cuadra).
   Efectivo + Tarjeta, calendario, ticket obligatorio con OCR,
   recarga con foto de entrega, alerta de efectivo bajo.
   ============================================================ */

/* ---------- helpers ---------- */
const num = (x: unknown) => { const n = typeof x === "number" ? x : parseFloat(String(x)); return isNaN(n) ? 0 : n; };
const money = (n: unknown) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(num(n));
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function isoToDate(iso: string) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function dateToISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function labelDate(iso: string) {
  try { return isoToDate(iso).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return iso; }
}
function labelDateLong(iso: string) {
  try { return isoToDate(iso).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
  catch { return iso; }
}
function labelTime(ts: number) {
  try { return new Date(ts).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

/* ---------- tipos de UI ---------- */
type PayMethod = "efectivo" | "tarjeta";

interface UIExpense {
  id: string; dateISO: string; store: string; payMethod: PayMethod;
  subtotal: number; iva: number; ieps: number; total: number;
  source: "ocr" | "manual"; createdAt: number; hasPhoto: boolean; photoPath: string | null;
  items: ExpenseItem[];
}
interface UIFunding { id: string; amount: number; dateISO: string; createdAt: number; note: string; photoPath: string | null }

/** Selección del calendario: un día (end === start), un rango, o null = todos */
interface DateSel { start: string; end: string | null }

function rowToUI(e: ExpenseRow): UIExpense {
  return {
    id: e.id, dateISO: e.spent_at, store: e.store,
    payMethod: (e.payment_method === "tarjeta" ? "tarjeta" : "efectivo"),
    subtotal: num(e.subtotal), iva: num(e.iva), ieps: num(e.ieps), total: num(e.total),
    source: e.source, createdAt: new Date(e.created_at).getTime(),
    hasPhoto: !!e.photo_path, photoPath: e.photo_path, items: e.items || [],
  };
}
function fundingToUI(f: FundingRow): UIFunding {
  return { id: f.id, amount: num(f.amount), dateISO: (f.created_at || "").slice(0, 10), createdAt: new Date(f.created_at).getTime(), note: f.note || "", photoPath: f.photo_path || null };
}

/* ---------- image scaling (idéntico al prototipo) ---------- */
function fileToScaled(file: File, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width >= height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const c = document.createElement("canvas"); c.width = width; c.height = height;
      c.getContext("2d")!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img")); };
    img.src = url;
  });
}

function b64ToBlob(b64: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: "image/jpeg" });
}

/* ---------- OCR via server route ---------- */
async function readReceipt(base64: string): Promise<ReceiptData> {
  const res = await fetch("/api/read-receipt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || "ocr");
  return data as ReceiptData;
}

/* ---------- CSV export (columnas v2) ---------- */
function csvCell(v: unknown) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function exportCSV(rows: UIExpense[], filename: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const header = ["Fecha", "Hora", "Tienda", "Subtotal", "IVA", "IEPS", "Total", "Pago", "Link de ticket"];
  const lines = [header.join(",")];
  rows.forEach((e) => {
    const link = e.hasPhoto ? `${origin}/ticket/${e.id}` : "";
    lines.push([e.dateISO, labelTime(e.createdAt), e.store, num(e.subtotal), num(e.iva), num(e.ieps), num(e.total), e.payMethod === "tarjeta" ? "Tarjeta" : "Efectivo", link].map(csvCell).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ---------- estado del ticket en el registro de compra ---------- */
interface TicketState {
  status: "none" | "checking" | "ok" | "bad";
  thumb: string | null;
  ocr: ReceiptData | null;
  error: string;
}
const TICKET_NONE: TicketState = { status: "none", thumb: null, ocr: null, error: "" };

/* ---------- montos que anota el encargado ----------
   Total: obligatorio. Subtotal / IVA / IEPS: se piden siempre, pero se puede
   registrar sin ellos porque a veces el ticket no los trae. El sistema
   compara lo anotado contra lo que leyó del ticket. */
interface Montos { total: string; subtotal: string; iva: string; ieps: string }
const MONTOS_VACIOS: Montos = { total: "", subtotal: "", iva: "", ieps: "" };

/** Tolerancia al comparar contra el ticket: un peso, por redondeos del OCR. */
const TOL = 1;

interface Dif { label: string; anotado: number; ticket: number }

/** Compara lo que anotó el encargado contra lo que dice el ticket. */
function revisarMontos(m: Montos, ocr: ReceiptData | null) {
  const campos: { label: string; typed: string; ticket: number }[] = [
    { label: "Total", typed: m.total, ticket: num(ocr?.total) },
    { label: "Subtotal", typed: m.subtotal, ticket: num(ocr?.subtotal) },
    { label: "IVA", typed: m.iva, ticket: num(ocr?.iva) },
    { label: "IEPS", typed: m.ieps, ticket: num(ocr?.ieps) },
  ];
  const anotado = (s: string) => s.trim() !== "";
  const difs: Dif[] = campos
    .filter((c) => anotado(c.typed) && c.ticket > 0 && Math.abs(c.ticket - num(c.typed)) > TOL)
    .map((c) => ({ label: c.label, anotado: num(c.typed), ticket: c.ticket }));

  // Falta por llenar y el ticket sí lo trae
  const faltantes = campos.filter((c) => !anotado(c.typed) && c.ticket > 0).map((c) => c.label);

  // Cuadre aritmético: subtotal + IVA + IEPS debe dar el total
  const sumaLista = num(m.subtotal) > 0 && num(m.iva) > 0 && num(m.total) > 0;
  const suma = num(m.subtotal) + num(m.iva) + num(m.ieps);
  const noCuadra = sumaLista && Math.abs(suma - num(m.total)) > TOL;

  const revisados = campos.filter((c) => anotado(c.typed) && c.ticket > 0).length;
  const todoBien = difs.length === 0 && !noCuadra && revisados > 0;
  return { difs, faltantes, noCuadra, suma, todoBien, revisados };
}

/* ============================================================
   App
   ============================================================ */
type ModalKind = "paymethod" | "compra" | "recarga" | "settings" | "runner" | "fotos" | null;

export default function CuadraApp({ profile, business }: { profile: Profile; business: Business }) {
  const sb = supabaseBrowser();
  const isOwner = profile.role === "owner";

  const [loaded, setLoaded] = useState(false);
  const [biz, setBiz] = useState<Business>(business);
  const [runner, setRunner] = useState<Profile | null>(null);
  const [fundings, setFundings] = useState<UIFunding[]>([]);
  const [expenses, setExpenses] = useState<UIExpense[]>([]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [fotosSel, setFotosSel] = useState<DateSel | null>(null);
  const [payMethod, setPayMethod] = useState<PayMethod>("efectivo");
  const [ticket, setTicket] = useState<TicketState>(TICKET_NONE);
  const [toast, setToast] = useState<{ msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const apiB64Ref = useRef<string | null>(null); // jpeg 1100px para OCR y Storage

  const load = useCallback(async () => {
    const [fRes, eRes] = await Promise.all([
      sb.from("fundings").select("*").order("created_at", { ascending: false }),
      sb.from("expenses").select("*").order("created_at", { ascending: false }),
    ]);
    setFundings(((fRes.data as FundingRow[]) || []).map(fundingToUI));
    setExpenses(((eRes.data as ExpenseRow[]) || []).map(rowToUI));
    if (isOwner) {
      const { data: r } = await sb.from("profiles").select("id, business_id, name, role").eq("role", "runner").limit(1);
      setRunner((r && (r[0] as Profile)) || null);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setToast({ msg }); setTimeout(() => setToast(null), 2600); };

  /* ----- derived: dos divisiones de dinero ----- */
  const totalFunded = fundings.reduce((s, f) => s + num(f.amount), 0);
  const cashSpent = expenses.filter((e) => e.payMethod === "efectivo").reduce((s, e) => s + num(e.total), 0);
  const cardSpent = expenses.filter((e) => e.payMethod === "tarjeta").reduce((s, e) => s + num(e.total), 0);
  const cashBalance = totalFunded - cashSpent; // división EFECTIVO: resta
  const threshold = num(biz.low_cash_threshold) || 700;
  const lowCash = cashBalance <= threshold;
  const todays = expenses.filter((e) => e.dateISO === todayISO()).sort((a, b) => b.createdAt - a.createdAt);
  const runnerName = isOwner ? (runner?.name || "tu encargado de compra") : profile.name;

  /* ----- aviso servidor: revisa umbral y manda correos una sola vez ----- */
  const pingLowBalance = () => { fetch("/api/low-balance", { method: "POST" }).catch(() => {}); };

  /* ----- registro de compra ----- */
  function startCompra() { setTicket(TICKET_NONE); apiB64Ref.current = null; setModal("paymethod"); }
  function chooseMethod(m: PayMethod) { setPayMethod(m); setModal("compra"); }
  function pickTicketPhoto() { fileRef.current && fileRef.current.click(); }

  async function onTicketFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setTicket({ status: "checking", thumb: null, ocr: null, error: "" });
    try {
      const apiUrl = await fileToScaled(file, 1100, 0.7);
      const thumb = await fileToScaled(file, 760, 0.6);
      const b64 = apiUrl.split(",")[1];
      apiB64Ref.current = b64;
      setTicket((t) => ({ ...t, thumb }));
      const p = await readReceipt(b64); // el sistema evalúa que el ticket sea legible
      setTicket({ status: "ok", thumb, ocr: p, error: "" });
    } catch (err) {
      apiB64Ref.current = null;
      const msg = err instanceof Error && err.message === "ilegible"
        ? "El ticket no se ve bien. Toma la foto de nuevo, con buena luz y sin mover el teléfono."
        : "No pudimos revisar el ticket. Intenta tomar la foto otra vez.";
      setTicket({ status: "bad", thumb: null, ocr: null, error: msg });
    }
  }

  async function saveCompra(store: string, m: Montos): Promise<string> {
    if (ticket.status !== "ok" || !apiB64Ref.current) return "Sube la foto del ticket para poder registrar.";

    const id = crypto.randomUUID();
    const path = `${biz.id}/${id}.jpg`;
    // OJO: sin upsert. El id es nuevo cada vez, así que no hay nada que reemplazar,
    // y `upsert: true` obliga a Storage a LEER el objeto primero — algo que el
    // encargado ya no puede hacer (las fotos son solo del dueño desde 0002),
    // así que fallaba con 403 y salía "No se pudo subir la foto".
    const { error: upErr } = await sb.storage.from("receipts").upload(path, b64ToBlob(apiB64Ref.current), { contentType: "image/jpeg" });
    if (upErr) return `No se pudo subir la foto: ${upErr.message}`;

    const p = ticket.ocr || {};
    const items = (p.items || []).filter((i) => (i.name || "").trim()).map((i) => ({ name: (i.name || "").trim(), qty: num(i.qty) || 1, price: num(i.price) }));
    // Manda lo que anotó el encargado; si dejó un campo vacío (a veces el
    // ticket no lo trae) se usa lo que el sistema leyó del ticket.
    const anotadoO = (typed: string, delTicket: unknown) => (typed.trim() !== "" ? num(typed) : num(delTicket));
    const row = {
      id, business_id: biz.id, runner_id: profile.id,
      store, category: "", concept: "",
      payment_method: payMethod,
      subtotal: anotadoO(m.subtotal, p.subtotal),
      iva: anotadoO(m.iva, p.iva),
      ieps: anotadoO(m.ieps, p.ieps),
      total: num(m.total),
      items, source: "ocr" as const, photo_path: path,
      spent_at: todayISO(), // la fecha la pone el sistema, no el encargado
    };
    const { data: saved, error } = await sb.from("expenses").insert(row).select().single();
    if (error || !saved) return "No se pudo guardar. Revisa tu conexión.";

    setExpenses([rowToUI(saved as ExpenseRow), ...expenses]);
    setTicket(TICKET_NONE); apiB64Ref.current = null; setModal(null);
    flash("Compra registrada");
    pingLowBalance();
    return "";
  }

  /* ----- recarga con foto obligatoria ----- */
  async function saveFunding(amount: string, note: string, photoB64: string): Promise<string> {
    if (!photoB64) return "Toma la foto entregando el efectivo para poder recargar.";
    const id = crypto.randomUUID();
    const iso = todayISO();
    const path = `${biz.id}/${iso.slice(0, 7)}/${iso}_${id}.jpg`; // carpeta por mes, nombre = fecha
    const { error: upErr } = await sb.storage.from("cash-photos").upload(path, b64ToBlob(photoB64), { contentType: "image/jpeg" });
    if (upErr) return `No se pudo subir la foto: ${upErr.message}`;

    const row = { id, business_id: biz.id, runner_id: runner?.id ?? null, amount: num(amount), note: note || "Recarga", photo_path: path };
    const { data: saved, error } = await sb.from("fundings").insert(row).select().single();
    if (error || !saved) return "No se pudo recargar. Revisa tu conexión.";
    setFundings([fundingToUI(saved as FundingRow), ...fundings]);
    setModal(null); flash("Saldo recargado");
    pingLowBalance();
    return "";
  }

  async function saveConfig(cfg: { businessName: string; runnerName: string; dailyFloat: number }) {
    const { error } = await sb.from("businesses").update({ name: cfg.businessName, daily_float: cfg.dailyFloat }).eq("id", biz.id);
    if (error) { flash("No se pudo guardar. Revisa tu conexión."); return; }
    if (runner && cfg.runnerName && cfg.runnerName !== runner.name) {
      await sb.from("profiles").update({ name: cfg.runnerName }).eq("id", runner.id);
      setRunner({ ...runner, name: cfg.runnerName });
    }
    setBiz({ ...biz, name: cfg.businessName, daily_float: cfg.dailyFloat });
    setModal(null); flash("Ajustes guardados");
  }

  async function logout() {
    await sb.auth.signOut();
    window.location.href = "/login";
  }

  if (!loaded) {
    return (
      <div className="cuadra">
        <div style={{ display: "flex", height: "70vh", alignItems: "center", justifyContent: "center", color: "var(--muted)", gap: 10 }}>
          <Loader2 className="spin" size={20} /> Cargando…
        </div>
      </div>
    );
  }

  return (
    <div className="cuadra">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onTicketFile} />

      <div className="wrap">
        {/* top bar */}
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">$</div>
            <div>
              <div className="brand-name">Vertify</div>
              <div className="brand-sub">{biz.name}</div>
            </div>
          </div>
          <div className="topbar-right">
            <div className="rolechip">{isOwner ? <><Store size={15} />Dueño</> : <><Wallet size={15} />Encargado</>}</div>
            <button className="iconbtn" title="Ajustes" onClick={() => setModal("settings")}><Settings size={17} /></button>
          </div>
        </header>

        {/* fecha automática, siempre visible arriba */}
        <div className="datebar"><CalendarDays size={15} />{labelDateLong(todayISO())}</div>

        {lowCash && (
          <div className="banner-warn" style={{ marginTop: 10 }}>
            <AlertTriangle size={15} />
            {isOwner
              ? `Queda poco efectivo (${money(Math.max(cashBalance, 0))}). Prepara la siguiente entrega.`
              : `Queda poco efectivo (${money(Math.max(cashBalance, 0))}). Pídele más dinero a tu superior.`}
          </div>
        )}

        {!isOwner
          ? <Encargado runnerName={runnerName} cashBalance={cashBalance} totalFunded={totalFunded} cardSpent={cardSpent} todays={todays} onCompra={startCompra} />
          : <Dueno biz={biz} cashBalance={cashBalance} totalFunded={totalFunded} cardSpent={cardSpent} expenses={expenses} onRecarga={() => setModal("recarga")} onFotos={(s) => { setFotosSel(s); setModal("fotos"); }} />}
      </div>

      {/* modals */}
      {modal === "paymethod" && (
        <Sheet title="¿Cómo hiciste tu compra?" onClose={() => setModal(null)}>
          <div className="choose">
            <button className="choose-btn" onClick={() => chooseMethod("efectivo")}>
              <span className="choose-ic"><Banknote size={22} /></span>
              <span><span className="choose-t">Efectivo</span><span className="choose-d">Pagaste con el dinero que te entregaron. Baja tu saldo.</span></span>
            </button>
            <button className="choose-btn" onClick={() => chooseMethod("tarjeta")}>
              <span className="choose-ic"><CreditCard size={22} /></span>
              <span><span className="choose-t">Tarjeta</span><span className="choose-d">Pagaste con la tarjeta del negocio. Se va sumando aparte.</span></span>
            </button>
          </div>
        </Sheet>
      )}

      {modal === "compra" && (
        <Sheet title={`Registrar compra · ${payMethod === "tarjeta" ? "Tarjeta" : "Efectivo"}`} onClose={() => { setModal(null); setTicket(TICKET_NONE); apiB64Ref.current = null; }}>
          <CompraForm
            ticket={ticket}
            onPickPhoto={pickTicketPhoto}
            onSave={saveCompra}
            onCancel={() => { setModal(null); setTicket(TICKET_NONE); apiB64Ref.current = null; }}
          />
        </Sheet>
      )}

      {modal === "recarga" && (
        <Sheet title="Recargar saldo" onClose={() => setModal(null)}>
          <RecargaForm defaultAmount={num(biz.daily_float)} runnerName={runnerName} onSave={saveFunding} onCancel={() => setModal(null)} />
        </Sheet>
      )}

      {modal === "fotos" && (
        <Sheet title="Fotos" onClose={() => setModal(null)}>
          <FotosGallery expenses={expenses} fundings={fundings} initialSel={fotosSel} />
        </Sheet>
      )}

      {modal === "settings" && (
        <Sheet title="Ajustes" onClose={() => setModal(null)}>
          {isOwner
            ? <SettingsForm biz={biz} runner={runner} onSave={saveConfig} onCreateRunner={() => setModal("runner")} onLogout={logout} />
            : (
              <div>
                <p className="hint" style={{ fontSize: 14, marginBottom: 16 }}>Sesión de {profile.name}. Si necesitas cambiar algo de tu cuenta, pídeselo a tu superior.</p>
                <button className="btn btn-ghost btn-block" onClick={logout}><LogOut size={16} />Cerrar sesión</button>
              </div>
            )}
        </Sheet>
      )}

      {modal === "runner" && (
        <Sheet title="Cuenta del encargado de compra" onClose={() => setModal("settings")}>
          <RunnerForm
            onDone={async () => {
              const { data: r } = await sb.from("profiles").select("id, business_id, name, role").eq("role", "runner").limit(1);
              setRunner((r && (r[0] as Profile)) || null);
              setModal(null); flash("Cuenta del encargado creada");
            }}
            onCancel={() => setModal("settings")}
          />
        </Sheet>
      )}

      {toast && <div className="toast"><Check size={16} />{toast.msg}</div>}
    </div>
  );
}

/* ============================================================
   Sección de saldo: dos divisiones (Efectivo resta, Tarjeta suma)
   ============================================================ */
function DuoBalance({ title, cashBalance, totalFunded, cardSpent, children }: {
  title: string; cashBalance: number; totalFunded: number; cardSpent: number; children?: React.ReactNode;
}) {
  const ratio = totalFunded > 0 ? Math.max(0, Math.min(1, cashBalance / totalFunded)) : (cashBalance > 0 ? 1 : 0);
  let state = "ok";
  if (cashBalance <= 0) state = "empty";
  else if (ratio < 0.15) state = "low";
  else if (ratio < 0.4) state = "mid";

  return (
    <section className={`gauge-card owner g-${state}`}>
      <div className="gauge-greet">{title}</div>
      <div className="duo">
        <div className="duo-col">
          <div className="duo-tag"><Banknote size={14} />EFECTIVO</div>
          <div className="gauge-amount duo-amount">{money(cashBalance < 0 ? 0 : cashBalance)}</div>
          <div className="gauge-of">de {money(totalFunded)} entregados · va restando</div>
          <div className="gauge-track"><div className={`gauge-fill f-${state}`} style={{ width: `${Math.max(ratio * 100, cashBalance > 0 ? 4 : 0)}%` }} /></div>
        </div>
        <div className="duo-sep" />
        <div className="duo-col">
          <div className="duo-tag"><CreditCard size={14} />TARJETA</div>
          <div className="gauge-amount duo-amount">{money(cardSpent)}</div>
          <div className="gauge-of">gastado con tarjeta · empieza en cero y va sumando</div>
        </div>
      </div>
      {children}
    </section>
  );
}

/* ============================================================
   Vista del encargado de compra
   ============================================================ */
function Encargado({ runnerName, cashBalance, totalFunded, cardSpent, todays, onCompra }: {
  runnerName: string; cashBalance: number; totalFunded: number; cardSpent: number;
  todays: UIExpense[]; onCompra: () => void;
}) {
  const spentToday = todays.reduce((s, e) => s + num(e.total), 0);
  return (
    <>
      <DuoBalance title={`Hola ${runnerName}, así va el dinero`} cashBalance={cashBalance} totalFunded={totalFunded} cardSpent={cardSpent} />

      <div className="cta-stack">
        <button className="btn btn-primary btn-lg btn-block" onClick={onCompra}><Camera size={19} />REGISTRAR COMPRA</button>
      </div>

      <div className="section-title"><span>Hoy gastaste</span><span className="muted" style={{ fontFamily: "var(--disp)", fontWeight: 600 }}>{money(spentToday)}</span></div>
      {todays.length === 0
        ? <div className="card"><div className="empty"><div className="big">Aún no registras compras hoy</div>Pulsa REGISTRAR COMPRA y sube la foto del ticket.</div></div>
        : <div className="card">{todays.map((e) => <ExpenseRowView key={e.id} e={e} />)}</div>}
    </>
  );
}

/* ============================================================
   Vista del dueño: calendario + 4 cuadros + tiendas + fotos
   ============================================================ */
function Dueno({ biz, cashBalance, totalFunded, cardSpent, expenses, onRecarga, onFotos }: {
  biz: Business; cashBalance: number; totalFunded: number; cardSpent: number;
  expenses: UIExpense[]; onRecarga: () => void; onFotos: (sel: DateSel | null) => void;
}) {
  const [sel, setSel] = useState<DateSel | null>({ start: todayISO(), end: todayISO() });
  const [showCal, setShowCal] = useState(false);

  const inSel = (iso: string) => !sel || (iso >= sel.start && iso <= (sel.end || sel.start));
  const periodExp = expenses.filter((e) => inSel(e.dateISO)).sort((a, b) => b.createdAt - a.createdAt);
  const spentP = periodExp.reduce((s, e) => s + num(e.total), 0);
  const ivaP = periodExp.reduce((s, e) => s + num(e.iva), 0);
  const iepsP = periodExp.reduce((s, e) => s + num(e.ieps), 0);

  // group by day
  const groups: Record<string, UIExpense[]> = {};
  periodExp.forEach((e) => { (groups[e.dateISO] = groups[e.dateISO] || []).push(e); });
  const days = Object.keys(groups).sort((a, b) => isoToDate(b).getTime() - isoToDate(a).getTime());

  // breakdown por tienda (antes: categoría)
  const byStore: Record<string, number> = {};
  periodExp.forEach((e) => { const k = e.store || "Sin tienda"; byStore[k] = (byStore[k] || 0) + num(e.total); });
  const stores = Object.entries(byStore).sort((a, b) => b[1] - a[1]);
  const maxStore = stores.length ? stores[0][1] : 1;

  const periodLabel = !sel
    ? "en total"
    : sel.start === (sel.end || sel.start)
      ? (sel.start === todayISO() ? "hoy" : `el ${labelDate(sel.start)}`)
      : `del ${labelDate(sel.start)} al ${labelDate(sel.end || sel.start)}`;

  const csvName = !sel
    ? `vertify_todo_${todayISO()}.csv`
    : sel.start === (sel.end || sel.start)
      ? `vertify_${sel.start}.csv`
      : `vertify_${sel.start}_a_${sel.end}.csv`;

  return (
    <>
      <DuoBalance title="Dinero en manos de tu encargado de compra" cashBalance={cashBalance} totalFunded={totalFunded} cardSpent={cardSpent}>
        <button className="btn btn-onwhite" style={{ marginTop: 16 }} onClick={onRecarga}><Plus size={16} />Recargar saldo</button>
      </DuoBalance>

      <div className="owner-bar">
        <button className={`btn btn-ghost mini-btn ${showCal ? "active-cal" : ""}`} onClick={() => setShowCal(!showCal)}>
          <CalendarDays size={15} />{sel ? (sel.start === (sel.end || sel.start) ? labelDate(sel.start) : `${labelDate(sel.start)} – ${labelDate(sel.end || sel.start)}`) : "Todos los días"}
          {showCal ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost mini-btn" onClick={() => onFotos(sel)}><ImageIcon size={15} />Ver fotos</button>
          <button className="btn btn-ghost mini-btn" onClick={() => exportCSV(periodExp, csvName)} disabled={!periodExp.length}><Download size={15} />Exportar a Excel</button>
        </div>
      </div>

      {showCal && <CalendarPicker sel={sel} setSel={setSel} marked={new Set(expenses.map((e) => e.dateISO))} />}

      <div className="sumgrid four">
        <div className="sumcard"><div className="k">Gastado {periodLabel}</div><div className="v">{money(spentP)}</div></div>
        <div className="sumcard"><div className="k">Movimientos</div><div className="v">{periodExp.length}</div></div>
        <div className="sumcard"><div className="k">IVA</div><div className="v">{money(ivaP)}</div></div>
        <div className="sumcard"><div className="k">IEPS</div><div className="v">{money(iepsP)}</div></div>
      </div>

      {stores.length > 0 && (
        <>
          <div className="section-title"><span>En qué tiendas se fue ({periodLabel})</span></div>
          <div className="card" style={{ padding: "12px 16px" }}>
            {stores.map(([c, v]) => (
              <div className="bar-row" key={c}>
                <div className="bar-label">{c}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max((v / maxStore) * 100, 6)}%` }} /></div>
                <div className="bar-val">{money(v)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title"><span>Movimientos {periodLabel}</span></div>
      {periodExp.length === 0
        ? <div className="card"><div className="empty"><div className="big">Sin movimientos en estas fechas</div>Cuando el encargado registre una compra, aparece aquí con su ticket.</div></div>
        : days.map((d) => {
          const list = groups[d]; const sum = list.reduce((s, e) => s + num(e.total), 0);
          return (
            <div key={d}>
              <div className="day-head"><div className="day-name">{labelDate(d)}</div><div className="day-sum">{list.length} mov · {money(sum)}</div></div>
              <div className="card">{list.map((e) => <ExpenseRowView key={e.id} e={e} owner />)}</div>
            </div>
          );
        })}
    </>
  );
}

/* ============================================================
   Calendario: un día o un segmento de fechas
   ============================================================ */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["L", "M", "M", "J", "V", "S", "D"];

function CalendarPicker({ sel, setSel, marked }: {
  sel: DateSel | null; setSel: (s: DateSel | null) => void; marked: Set<string>;
}) {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [rangeMode, setRangeMode] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  const y = month.getFullYear(), m = month.getMonth();
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(dateToISO(new Date(y, m, d)));

  function tap(iso: string) {
    if (!rangeMode) { setSel({ start: iso, end: iso }); setPendingStart(null); return; }
    if (!pendingStart) { setPendingStart(iso); setSel({ start: iso, end: null }); return; }
    const [a, b] = pendingStart <= iso ? [pendingStart, iso] : [iso, pendingStart];
    setSel({ start: a, end: b }); setPendingStart(null);
  }

  const isSel = (iso: string) => !!sel && iso >= sel.start && iso <= (sel.end || sel.start);
  const isEdge = (iso: string) => !!sel && (iso === sel.start || iso === (sel.end || sel.start));

  return (
    <div className="card cal">
      <div className="cal-head">
        <button className="iconbtn" onClick={() => setMonth(new Date(y, m - 1, 1))}><ChevronLeft size={16} /></button>
        <div className="cal-title">{MESES[m]} {y}</div>
        <button className="iconbtn" onClick={() => setMonth(new Date(y, m + 1, 1))}><ChevronRight size={16} /></button>
      </div>
      <div className="cal-grid cal-days">{DIAS.map((d, i) => <div key={i} className="cal-dow">{d}</div>)}</div>
      <div className="cal-grid">
        {cells.map((iso, i) => iso === null
          ? <div key={i} />
          : (
            <button
              key={i}
              className={`cal-day ${isSel(iso) ? "in" : ""} ${isEdge(iso) ? "edge" : ""} ${iso === todayISO() ? "today" : ""}`}
              onClick={() => tap(iso)}
            >
              {Number(iso.slice(8))}
              {marked.has(iso) && <span className="cal-dot" />}
            </button>
          ))}
      </div>
      <div className="cal-foot">
        <button className={`linkbtn ${rangeMode ? "on" : ""}`} onClick={() => { setRangeMode(!rangeMode); setPendingStart(null); }}>
          {rangeMode ? <Check size={14} /> : null}Elegir rango de fechas
        </button>
        <div style={{ display: "flex", gap: 12 }}>
          <button className="linkbtn" onClick={() => { setSel({ start: todayISO(), end: todayISO() }); setPendingStart(null); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); }}>Hoy</button>
          <button className="linkbtn" onClick={() => { setSel(null); setPendingStart(null); }}>Ver todo</button>
        </div>
      </div>
      {rangeMode && <div className="hint" style={{ padding: "0 14px 12px" }}>{pendingStart ? `Desde el ${labelDate(pendingStart)} — ahora toca el día final.` : "Toca el primer día del rango y luego el último."}</div>}
    </div>
  );
}

/* ============================================================
   Fila de gasto (badge de pago en vez de categoría)
   ============================================================ */
function ExpenseRowView({ e, owner }: { e: UIExpense; owner?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="exp-wrap">
      <div className="exp" onClick={() => setOpen(!open)}>
        <div className="exp-ic">{e.source === "ocr" ? <Receipt size={18} /> : <PencilLine size={18} />}</div>
        <div className="exp-main">
          <div className="exp-store">{e.store || "Sin nombre"}</div>
          <div className="exp-meta">
            <span>{labelTime(e.createdAt)}</span>
            <span className={`badge ${e.payMethod === "tarjeta" ? "badge-manual" : "badge-ocr"}`}>{e.payMethod === "tarjeta" ? "Tarjeta" : "Efectivo"}</span>
          </div>
        </div>
        <div className="exp-right">
          <div className="exp-amt">{money(e.total)}</div>
          {open ? <ChevronDown size={16} className="chev" /> : <ChevronRight size={16} className="chev" />}
        </div>
      </div>
      {open && (
        <div className="exp-detail">
          {e.items && e.items.length > 0 ? e.items.map((i, k) => (
            <div className="item-line" key={k}><span>{i.qty > 1 ? `${i.qty}× ` : ""}{i.name}</span><span>{money(i.price)}</span></div>
          )) : <div className="hint">Sin desglose de productos.</div>}
          <div className="tax-grid">
            <span>Subtotal {money(e.subtotal)}</span><span>IVA {money(e.iva)}</span><span>IEPS {money(e.ieps)}</span><span style={{ fontWeight: 600, color: "var(--ink)" }}>Total {money(e.total)}</span>
          </div>
          {owner && e.hasPhoto && e.photoPath && <StoragePhoto path={e.photoPath} bucket="receipts" />}
        </div>
      )}
    </div>
  );
}

function StoragePhoto({ path, bucket }: { path: string; bucket: "receipts" | "cash-photos" }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/receipt-url?path=${encodeURIComponent(path)}&bucket=${bucket}`);
        const data = await res.json();
        if (res.ok && data.url) setSrc(data.url); else setErr(true);
      } catch { setErr(true); }
    })();
  }, [path, bucket]);
  if (err) return null;
  if (!src) return <div className="hint" style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}><ImageIcon size={14} /> Cargando foto…</div>;
  return <div className="exp-photo"><img src={src} alt="foto" /></div>;
}

/* ============================================================
   Galería de fotos (tickets + entregas de efectivo) — solo dueño
   ============================================================ */
function FotosGallery({ expenses, fundings, initialSel }: { expenses: UIExpense[]; fundings: UIFunding[]; initialSel: DateSel | null }) {
  const [sel, setSel] = useState<DateSel | null>(initialSel);
  const inSel = (iso: string) => !sel || (iso >= sel.start && iso <= (sel.end || sel.start));

  const tickets = expenses.filter((e) => e.hasPhoto && e.photoPath && inSel(e.dateISO));
  const entregas = fundings.filter((f) => f.photoPath && inSel(f.dateISO));

  return (
    <div>
      <CalendarPicker sel={sel} setSel={setSel} marked={new Set([...expenses.filter((e) => e.hasPhoto).map((e) => e.dateISO), ...fundings.filter((f) => f.photoPath).map((f) => f.dateISO)])} />

      <div className="section-title" style={{ marginTop: 16 }}><span>Tickets de compras</span><span className="muted">{tickets.length}</span></div>
      {tickets.length === 0
        ? <div className="hint" style={{ padding: "4px 4px 10px" }}>No hay fotos de tickets en estas fechas.</div>
        : tickets.map((e) => (
          <div key={e.id} className="foto-item">
            <div className="foto-cap"><b>{e.store}</b> · {labelDate(e.dateISO)} · {money(e.total)}</div>
            <StoragePhoto path={e.photoPath!} bucket="receipts" />
          </div>
        ))}

      <div className="section-title"><span>Entregas de efectivo</span><span className="muted">{entregas.length}</span></div>
      {entregas.length === 0
        ? <div className="hint" style={{ padding: "4px 4px 10px" }}>No hay fotos de entregas en estas fechas.</div>
        : entregas.map((f) => (
          <div key={f.id} className="foto-item">
            <div className="foto-cap"><b>{money(f.amount)}</b> · {labelDate(f.dateISO)}{f.note ? ` · ${f.note}` : ""}</div>
            <StoragePhoto path={f.photoPath!} bucket="cash-photos" />
          </div>
        ))}
    </div>
  );
}

/* ============================================================
   Registro de compra del encargado: tienda + cantidad + ticket
   ============================================================ */
function CompraForm({ ticket, onPickPhoto, onSave, onCancel }: {
  ticket: TicketState;
  onPickPhoto: () => void;
  onSave: (store: string, m: Montos) => Promise<string>;
  onCancel: () => void;
}) {
  const [store, setStore] = useState<string>("");
  const [m, setM] = useState<Montos>(MONTOS_VACIOS);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  const set = (k: keyof Montos) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setM((prev) => ({ ...prev, [k]: e.target.value }));
    setConfirmado(false);
  };

  const ticketOK = ticket.status === "ok";
  const rev = revisarMontos(m, ticket.ocr);
  const hayProblema = ticketOK && (rev.difs.length > 0 || rev.noCuadra);

  /** Copia al formulario lo que el sistema leyó del ticket. */
  function autollenar() {
    const o = ticket.ocr || {};
    const put = (typed: string, delTicket: unknown) => (num(delTicket) > 0 ? String(num(delTicket)) : typed);
    setM({
      total: put(m.total, o.total),
      subtotal: put(m.subtotal, o.subtotal),
      iva: put(m.iva, o.iva),
      ieps: put(m.ieps, o.ieps),
    });
    setConfirmado(false);
  }

  async function submit() {
    if (!store) return setErr("Elige la tienda donde compraste.");
    if (num(m.total) <= 0) return setErr("Pon el total que gastaste. Es obligatorio.");
    if (!ticketOK) return setErr("Sube la foto del ticket. Es obligatoria.");
    if (hayProblema && !confirmado) return setErr("Lo que anotaste no coincide con el ticket. Corrígelo, o marca la casilla si estás seguro.");
    setErr("");
    setSaving(true);
    const failMsg = await onSave(store, m);
    setSaving(false);
    if (failMsg) setErr(failMsg);
  }

  return (
    <div>
      <div className="datebar in-sheet"><CalendarDays size={14} />{labelDateLong(todayISO())}</div>

      <div className="field">
        <label className="label">¿En qué tienda compraste?</label>
        <select className="input" value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="">Elige la tienda…</option>
          {TIENDAS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="field total-field" style={{ marginTop: 0 }}>
        <label className="label">Total que gastaste (obligatorio)</label>
        <input className="input total-input" value={m.total} onChange={set("total")} inputMode="decimal" placeholder="0.00" />
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label className="label">Desglose del ticket</label>
        <div className="row3b">
          <div><div className="minilabel">Subtotal</div><input className="input mini" value={m.subtotal} onChange={set("subtotal")} inputMode="decimal" placeholder="0.00" /></div>
          <div><div className="minilabel">IVA</div><input className="input mini" value={m.iva} onChange={set("iva")} inputMode="decimal" placeholder="0.00" /></div>
          <div><div className="minilabel">IEPS</div><input className="input mini" value={m.ieps} onChange={set("ieps")} inputMode="decimal" placeholder="0.00" /></div>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>Anótalos siempre que el ticket los traiga. Si tu ticket no los tiene, puedes dejarlos vacíos.</div>
      </div>

      {/* ticket obligatorio */}
      {ticket.status === "none" && (
        <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={onPickPhoto}>
          <Camera size={17} />Subir ticket (obligatorio)
        </button>
      )}
      {ticket.status === "checking" && (
        <div className="ticket-check">
          {ticket.thumb && <img src={ticket.thumb} alt="ticket" />}
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
            <Loader2 className="spin" size={16} />Revisando que el ticket se vea bien…
          </div>
        </div>
      )}
      {ticketOK && (
        <div className="ticket-ok">
          {ticket.thumb && <img src={ticket.thumb} alt="ticket" />}
          <div>
            <div className="banner-ok" style={{ margin: 0 }}><Check size={15} />Ticket aprobado. Se ve bien.</div>
            <div className="hint" style={{ marginTop: 8 }}>
              El ticket dice: total {money(num(ticket.ocr?.total))} · subtotal {money(num(ticket.ocr?.subtotal))} · IVA {money(num(ticket.ocr?.iva))} · IEPS {money(num(ticket.ocr?.ieps))}
            </div>
            <button className="linkbtn" style={{ marginTop: 6 }} onClick={onPickPhoto}><Camera size={14} />Tomar otra foto</button>
          </div>
        </div>
      )}
      {ticket.status === "bad" && (
        <div style={{ marginTop: 12 }}>
          <div className="banner-warn"><AlertTriangle size={15} />{ticket.error}</div>
          <button className="btn btn-ghost btn-block" onClick={onPickPhoto}><Camera size={17} />Tomar la foto otra vez</button>
        </div>
      )}

      {/* revisión: lo anotado contra el ticket */}
      {ticketOK && (
        <div className={`verif ${hayProblema ? "verif-bad" : rev.todoBien ? "verif-ok" : ""}`}>
          {hayProblema ? (
            <>
              <div className="verif-head"><AlertTriangle size={15} />Revisa estos datos</div>
              {rev.difs.map((d) => (
                <div className="verif-line" key={d.label}>
                  <span>{d.label}</span>
                  <span>anotaste <b>{money(d.anotado)}</b> · el ticket dice <b>{money(d.ticket)}</b></span>
                </div>
              ))}
              {rev.noCuadra && (
                <div className="verif-line">
                  <span>La suma</span>
                  <span>subtotal + IVA + IEPS da <b>{money(rev.suma)}</b>, no <b>{money(num(m.total))}</b></span>
                </div>
              )}
              <label className="verif-check">
                <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
                Ya lo revisé y mis datos son los correctos
              </label>
            </>
          ) : rev.todoBien ? (
            <div className="verif-head"><Check size={15} />Todo cuadra con el ticket</div>
          ) : (
            <div className="verif-head"><Receipt size={15} />Anota los datos del ticket para que el sistema los revise</div>
          )}
          {rev.faltantes.length > 0 && (
            <button className="linkbtn" onClick={autollenar}>
              <PencilLine size={14} />Copiar del ticket: {rev.faltantes.join(", ")}
            </button>
          )}
        </div>
      )}

      {err && <div className="err"><AlertTriangle size={14} />{err}</div>}

      <div className="row2" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost btn-block" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={saving || !ticketOK}>
          {saving ? <Loader2 className="spin" size={17} /> : <Check size={17} />}Registrar
        </button>
      </div>
    </div>
  );
}

/* ---------- recarga con foto obligatoria de la entrega ---------- */
function RecargaForm({ defaultAmount, runnerName, onSave, onCancel }: {
  defaultAmount: number; runnerName: string;
  onSave: (a: string, n: string, photoB64: string) => Promise<string>; onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(defaultAmount));
  const [note, setNote] = useState("");
  const [thumb, setThumb] = useState<string | null>(null);
  const [photoB64, setPhotoB64] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const apiUrl = await fileToScaled(file, 1100, 0.7);
      setThumb(await fileToScaled(file, 560, 0.6));
      setPhotoB64(apiUrl.split(",")[1]);
      setErr("");
    } catch {
      setErr("No se pudo procesar la foto. Intenta de nuevo.");
    }
  }

  async function submit() {
    if (num(amount) <= 0) return setErr("Pon la cantidad que estás entregando.");
    if (!photoB64) return setErr("Toma la foto entregando el efectivo. Es obligatoria.");
    setErr(""); setSaving(true);
    const failMsg = await onSave(amount, note, photoB64);
    setSaving(false);
    if (failMsg) setErr(failMsg);
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <p className="hint" style={{ fontSize: 14, marginBottom: 14 }}>
        Agrega dinero al saldo de {runnerName}. Para protegerte de malentendidos, la foto
        entregando el efectivo es obligatoria y queda guardada con la fecha de hoy.
      </p>
      <div className="field"><label className="label">Cantidad</label><input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
      <div className="field"><label className="label">Nota (opcional)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Fondo del día, compra grande…" /></div>

      {thumb
        ? (
          <div className="ticket-ok">
            <img src={thumb} alt="entrega" />
            <div>
              <div className="banner-ok" style={{ margin: 0 }}><Check size={15} />Foto lista.</div>
              <button className="linkbtn" style={{ marginTop: 6 }} onClick={() => fileRef.current?.click()}><Camera size={14} />Tomar otra foto</button>
            </div>
          </div>
        )
        : (
          <button className="btn btn-ghost btn-block" onClick={() => fileRef.current?.click()}>
            <Camera size={17} />Foto entregando el efectivo (obligatoria)
          </button>
        )}

      {err && <div className="err"><AlertTriangle size={14} />{err}</div>}

      <div className="row2" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost btn-block" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={saving || !photoB64}>
          {saving ? <Loader2 className="spin" size={17} /> : <Banknote size={17} />}Recargar
        </button>
      </div>
    </div>
  );
}

/* ---------- settings form ---------- */
function SettingsForm({ biz, runner, onSave, onCreateRunner, onLogout }: {
  biz: Business; runner: Profile | null;
  onSave: (c: { businessName: string; runnerName: string; dailyFloat: number }) => void | Promise<void>;
  onCreateRunner: () => void; onLogout: () => void;
}) {
  const [businessName, setBn] = useState(biz.name);
  const [runnerName, setRn] = useState(runner?.name || "");
  const [dailyFloat, setDf] = useState(String(num(biz.daily_float)));
  return (
    <div>
      <div className="field"><label className="label">Nombre del negocio</label><input className="input" value={businessName} onChange={(e) => setBn(e.target.value)} /></div>
      {runner
        ? <div className="field"><label className="label">Nombre del encargado de compra</label><input className="input" value={runnerName} onChange={(e) => setRn(e.target.value)} /></div>
        : (
          <div className="field">
            <label className="label">Encargado de compra</label>
            <button className="btn btn-ghost btn-block" onClick={onCreateRunner}><UserPlus size={16} />Crear cuenta del encargado</button>
            <div className="hint" style={{ marginTop: 6 }}>Tú le creas su acceso y le pasas las claves en persona.</div>
          </div>
        )}
      <div className="field"><label className="label">Fondo diario sugerido</label><input className="input" value={dailyFloat} onChange={(e) => setDf(e.target.value)} inputMode="decimal" /><div className="hint">Es el monto que aparece por defecto al recargar.</div></div>
      <button className="btn btn-primary btn-block" style={{ marginTop: 6 }} onClick={() => onSave({ businessName: businessName.trim() || "Mi Restaurante", runnerName: runnerName.trim(), dailyFloat: num(dailyFloat) || 2000 })}><Check size={17} />Guardar ajustes</button>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onLogout}><LogOut size={16} />Cerrar sesión</button>
    </div>
  );
}

/* ---------- alta del encargado de compra ---------- */
function RunnerForm({ onDone, onCancel }: { onDone: () => void | Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return setErr("Escribe el nombre del encargado.");
    if (!email.trim().includes("@")) return setErr("Escribe un correo válido.");
    if (password.length < 8) return setErr("La contraseña debe tener al menos 8 caracteres.");
    setErr(""); setSaving(true);
    try {
      const res = await fetch("/api/create-runner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "No se pudo crear la cuenta."); setSaving(false); return; }
      await onDone();
    } catch {
      setErr("No se pudo crear la cuenta. Revisa tu conexión.");
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="hint" style={{ fontSize: 14, marginBottom: 14 }}>Crea el acceso de tu encargado de compra y pásale el correo y la contraseña en persona. Él entra una vez en su teléfono y su sesión queda guardada.</p>
      <div className="field"><label className="label">Nombre</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rubén" /></div>
      <div className="field"><label className="label">Correo</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="encargado@tunegocio.com" /></div>
      <div className="field"><label className="label">Contraseña</label><input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" /></div>
      {err && <div className="err"><AlertTriangle size={14} />{err}</div>}
      <div className="row2" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost btn-block" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <UserPlus size={17} />}Crear cuenta</button>
      </div>
    </div>
  );
}

/* ---------- sheet/modal ---------- */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><div className="sheet-title">{title}</div><button className="iconbtn" onClick={onClose}><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}
