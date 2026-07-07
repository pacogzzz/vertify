"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, PencilLine, Wallet, Plus, Download, Settings, Check, X,
  ChevronDown, ChevronRight, Receipt, Store, AlertTriangle,
  Loader2, Image as ImageIcon, Banknote, LogOut, UserPlus,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Business, Profile, ExpenseRow, FundingRow, ExpenseItem, ReceiptData } from "@/lib/types";

/* ============================================================
   Cuadra — port de producción del prototipo cuadra.jsx.
   UI, copys y lógica de dinero intactos; persistencia en Supabase.
   ============================================================ */

const CATS = ["Alimentos", "Bebidas", "Abarrotes", "Carnes", "Frutas y verduras", "Limpieza", "Desechables", "Otros"];

/* ---------- helpers (idénticos al prototipo) ---------- */
const num = (x: unknown) => { const n = typeof x === "number" ? x : parseFloat(String(x)); return isNaN(n) ? 0 : n; };
const money = (n: unknown) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(num(n));
const toStr = (n: number) => (n ? String(n) : "");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function isoToDate(iso: string) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function inPeriod(iso: string, period: string) {
  if (!iso) iso = todayISO();
  const d = isoToDate(iso); const t = new Date(); t.setHours(0, 0, 0, 0);
  if (period === "hoy") return iso === todayISO();
  if (period === "semana") { const s = new Date(t); s.setDate(t.getDate() - 6); return d >= s && d <= t; }
  if (period === "mes") return d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
  return true;
}
function labelDate(iso: string) {
  try { return isoToDate(iso).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return iso; }
}
function labelTime(ts: number) {
  try { return new Date(ts).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

/* ---------- tipos de UI (misma forma que el prototipo) ---------- */
interface UIExpense {
  id: string; dateISO: string; store: string; category: string; concept: string;
  subtotal: number; iva: number; ieps: number; total: number;
  source: "ocr" | "manual"; createdAt: number; hasPhoto: boolean; photoPath: string | null;
  items: ExpenseItem[];
}
interface UIFunding { id: string; amount: number; dateISO: string; createdAt: number; note: string }
interface FormItem { name: string; qty: string; price: string }
interface FormInit {
  store: string; dateISO: string; category: string; concept: string;
  items: FormItem[]; subtotal: string; iva: string; ieps: string; total: string;
  source: "ocr" | "manual";
}

function rowToUI(e: ExpenseRow): UIExpense {
  return {
    id: e.id, dateISO: e.spent_at, store: e.store, category: e.category, concept: e.concept || "",
    subtotal: num(e.subtotal), iva: num(e.iva), ieps: num(e.ieps), total: num(e.total),
    source: e.source, createdAt: new Date(e.created_at).getTime(),
    hasPhoto: !!e.photo_path, photoPath: e.photo_path, items: e.items || [],
  };
}
function fundingToUI(f: FundingRow): UIFunding {
  return { id: f.id, amount: num(f.amount), dateISO: (f.created_at || "").slice(0, 10), createdAt: new Date(f.created_at).getTime(), note: f.note || "" };
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

/* ---------- OCR via server route (la key vive en el server) ---------- */
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

/* ---------- CSV export (idéntico al prototipo) ---------- */
function csvCell(v: unknown) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function exportCSV(rows: UIExpense[], filename: string) {
  const header = ["Fecha", "Hora", "Tienda", "Categoría", "Concepto", "Subtotal", "IVA", "IEPS", "Total", "Origen", "Productos"];
  const lines = [header.join(",")];
  rows.forEach((e) => {
    const productos = (e.items || []).map((i) => `${i.qty || 1}x ${i.name} (${money(i.price)})`).join(" | ");
    lines.push([e.dateISO, labelTime(e.createdAt), e.store, e.category, e.concept || "", num(e.subtotal), num(e.iva), num(e.ieps), num(e.total), e.source === "ocr" ? "Foto" : "Manual", productos].map(csvCell).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ============================================================
   App
   ============================================================ */
type ModalKind = "reading" | "form" | "recarga" | "settings" | "runner" | null;

export default function CuadraApp({ profile, business }: { profile: Profile; business: Business }) {
  const sb = supabaseBrowser();
  const isOwner = profile.role === "owner";

  const [loaded, setLoaded] = useState(false);
  const [biz, setBiz] = useState<Business>(business);
  const [runner, setRunner] = useState<Profile | null>(null);
  const [fundings, setFundings] = useState<UIFunding[]>([]);
  const [expenses, setExpenses] = useState<UIExpense[]>([]);
  const [period, setPeriod] = useState("hoy");
  const [modal, setModal] = useState<ModalKind>(null);
  const [formInit, setFormInit] = useState<FormInit | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [ocr, setOcr] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
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

  /* ----- derived (lógica de dinero intacta) ----- */
  const totalFunded = fundings.reduce((s, f) => s + num(f.amount), 0);
  const totalSpent = expenses.reduce((s, e) => s + num(e.total), 0);
  const balance = totalFunded - totalSpent;
  const todays = expenses.filter((e) => e.dateISO === todayISO()).sort((a, b) => b.createdAt - a.createdAt);
  const runnerName = isOwner ? (runner?.name || "tu mandadero") : profile.name;

  /* ----- actions ----- */
  function openManual() {
    setPendingPhoto(null); apiB64Ref.current = null;
    setFormInit({ store: "", dateISO: todayISO(), category: "Abarrotes", concept: "", items: [], subtotal: "", iva: "", ieps: "", total: "", source: "manual" });
    setOcr({ loading: false, error: null }); setModal("form");
  }

  function pickPhoto() { fileRef.current && fileRef.current.click(); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setModal("reading"); setOcr({ loading: true, error: null });
    try {
      const apiUrl = await fileToScaled(file, 1100, 0.7);
      const thumb = await fileToScaled(file, 760, 0.6);
      setPendingPhoto(thumb);
      const b64 = apiUrl.split(",")[1];
      apiB64Ref.current = b64;
      const p = await readReceipt(b64);
      setFormInit({
        store: p.store || "", dateISO: p.dateISO || todayISO(), category: "Abarrotes", concept: "",
        subtotal: toStr(num(p.subtotal)), iva: toStr(num(p.iva)), ieps: toStr(num(p.ieps)),
        total: toStr(num(p.total) || (num(p.subtotal) + num(p.iva) + num(p.ieps))),
        items: (p.items || []).map((i) => ({ name: i.name || "", qty: i.qty ? String(i.qty) : "1", price: toStr(num(i.price)) })),
        source: "ocr",
      });
      setOcr({ loading: false, error: null });
      setModal("form");
    } catch {
      setFormInit({ store: "", dateISO: todayISO(), category: "Abarrotes", concept: "", items: [], subtotal: "", iva: "", ieps: "", total: "", source: "ocr" });
      setOcr({ loading: false, error: "No pude leer el ticket. Captura los datos a mano o reintenta con mejor luz." });
      setModal("form");
    }
  }

  async function saveExpense(data: FormInit) {
    const id = crypto.randomUUID();
    let photoPath: string | null = null;

    if (apiB64Ref.current) {
      const path = `${biz.id}/${id}.jpg`;
      const { error: upErr } = await sb.storage.from("receipts").upload(path, b64ToBlob(apiB64Ref.current), { contentType: "image/jpeg", upsert: true });
      if (!upErr) photoPath = path;
    }

    const items = (data.items || []).filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), qty: num(i.qty) || 1, price: num(i.price) }));
    const row = {
      id, business_id: biz.id, runner_id: profile.id,
      store: data.store.trim(), category: data.category, concept: data.concept.trim(),
      subtotal: num(data.subtotal), iva: num(data.iva), ieps: num(data.ieps), total: num(data.total),
      items, source: data.source, photo_path: photoPath, spent_at: data.dateISO || todayISO(),
    };
    const { data: saved, error } = await sb.from("expenses").insert(row).select().single();
    if (error || !saved) { flash("No se pudo guardar. Revisa tu conexión."); return; }

    setExpenses([rowToUI(saved as ExpenseRow), ...expenses]);
    setPendingPhoto(null); apiB64Ref.current = null; setModal(null);
    flash("Gasto registrado");
  }

  async function saveFunding(amount: string, note: string) {
    const row = { business_id: biz.id, runner_id: runner?.id ?? null, amount: num(amount), note: note || "Recarga" };
    const { data: saved, error } = await sb.from("fundings").insert(row).select().single();
    if (error || !saved) { flash("No se pudo recargar. Revisa tu conexión."); return; }
    setFundings([fundingToUI(saved as FundingRow), ...fundings]);
    setModal(null); flash("Saldo recargado");
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
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      <div className="wrap">
        {/* top bar */}
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">$</div>
            <div>
              <div className="brand-name">Cuadra</div>
              <div className="brand-sub">{biz.name}</div>
            </div>
          </div>
          <div className="topbar-right">
            <div className="rolechip">{isOwner ? <><Store size={15} />Dueño</> : <><Wallet size={15} />Mandadero</>}</div>
            <button className="iconbtn" title="Ajustes" onClick={() => setModal("settings")}><Settings size={17} /></button>
          </div>
        </header>

        {!isOwner
          ? <Mandadero runnerName={runnerName} balance={balance} assigned={totalFunded} todays={todays} onScan={pickPhoto} onManual={openManual} />
          : <Dueno dailyFloat={num(biz.daily_float)} balance={balance} totalFunded={totalFunded} expenses={expenses} period={period} setPeriod={setPeriod} onRecarga={() => setModal("recarga")} />}
      </div>

      {/* modals */}
      {modal === "reading" && (
        <Sheet title="Leyendo ticket" onClose={() => { setModal(null); setPendingPhoto(null); apiB64Ref.current = null; }}>
          <div className="reading">
            {pendingPhoto && <img src={pendingPhoto} alt="ticket" />}
            <div style={{ display: "flex", gap: 9, alignItems: "center", color: "var(--ink)", fontWeight: 600 }}>
              <Loader2 className="spin" size={18} /> Leyendo tienda, monto y productos…
            </div>
            <div className="hint">Tarda unos segundos.</div>
          </div>
        </Sheet>
      )}

      {modal === "form" && formInit && (
        <Sheet title={formInit.source === "ocr" ? "Confirma el gasto" : "Gasto manual"} onClose={() => { setModal(null); setPendingPhoto(null); apiB64Ref.current = null; }}>
          {ocr.error && <div className="banner-warn"><AlertTriangle size={15} />{ocr.error}</div>}
          {formInit.source === "ocr" && !ocr.error && <div className="banner-ok"><Check size={15} />Leí el ticket. Revisa que todo cuadre antes de guardar.</div>}
          <ExpenseForm init={formInit} photo={pendingPhoto} onSave={saveExpense} onCancel={() => { setModal(null); setPendingPhoto(null); apiB64Ref.current = null; }} />
        </Sheet>
      )}

      {modal === "recarga" && (
        <Sheet title="Recargar saldo" onClose={() => setModal(null)}>
          <RecargaForm defaultAmount={num(biz.daily_float)} runnerName={runnerName} onSave={saveFunding} onCancel={() => setModal(null)} />
        </Sheet>
      )}

      {modal === "settings" && (
        <Sheet title="Ajustes" onClose={() => setModal(null)}>
          {isOwner
            ? <SettingsForm biz={biz} runner={runner} onSave={saveConfig} onCreateRunner={() => setModal("runner")} onLogout={logout} />
            : (
              <div>
                <p className="hint" style={{ fontSize: 14, marginBottom: 16 }}>Sesión de {profile.name}. Si necesitas cambiar algo de tu cuenta, pídeselo a tu jefe.</p>
                <button className="btn btn-ghost btn-block" onClick={logout}><LogOut size={16} />Cerrar sesión</button>
              </div>
            )}
        </Sheet>
      )}

      {modal === "runner" && (
        <Sheet title="Cuenta del mandadero" onClose={() => setModal("settings")}>
          <RunnerForm
            onDone={async () => {
              const { data: r } = await sb.from("profiles").select("id, business_id, name, role").eq("role", "runner").limit(1);
              setRunner((r && (r[0] as Profile)) || null);
              setModal(null); flash("Cuenta del mandadero creada");
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
   Mandadero view (intacta)
   ============================================================ */
function Mandadero({ runnerName, balance, assigned, todays, onScan, onManual }: {
  runnerName: string; balance: number; assigned: number; todays: UIExpense[];
  onScan: () => void; onManual: () => void;
}) {
  const ratio = assigned > 0 ? Math.max(0, Math.min(1, balance / assigned)) : (balance > 0 ? 1 : 0);
  let state = "ok", status = "Vas bien. Cada compra baja tu saldo.";
  if (balance <= 0) { state = "empty"; status = "Saldo agotado — pídele recarga a tu jefe."; }
  else if (ratio < 0.15) { state = "low"; status = "Te queda poco. Avísale a tu jefe pronto."; }
  else if (ratio < 0.4) { state = "mid"; status = "Llevas buen ritmo, ojo con lo que queda."; }
  const spentToday = todays.reduce((s, e) => s + num(e.total), 0);

  return (
    <>
      <section className={`gauge-card g-${state}`}>
        <div className="gauge-greet">Hola {runnerName}, te quedan</div>
        <div className="gauge-amount">{money(balance < 0 ? 0 : balance)}</div>
        <div className="gauge-of">de {money(assigned)} que te han dado en total</div>
        <div className="gauge-track"><div className={`gauge-fill f-${state}`} style={{ width: `${Math.max(ratio * 100, balance > 0 ? 4 : 0)}%` }} /></div>
        <div className={`gauge-status s-${state}`}>{state === "ok" ? <Check size={15} /> : <AlertTriangle size={15} />}{status}</div>
      </section>

      <div className="cta-stack">
        <button className="btn btn-primary btn-lg btn-block" onClick={onScan}><Camera size={19} />Tomar foto del ticket</button>
        <button className="btn btn-ghost btn-block" onClick={onManual}><PencilLine size={17} />Capturar gasto a mano</button>
      </div>

      <div className="section-title"><span>Hoy gastaste</span><span className="muted" style={{ fontFamily: "var(--disp)", fontWeight: 600 }}>{money(spentToday)}</span></div>
      {todays.length === 0
        ? <div className="card"><div className="empty"><div className="big">Aún no registras gastos hoy</div>Toma foto del ticket de tu primera compra.</div></div>
        : <div className="card">{todays.map((e) => <ExpenseRowView key={e.id} e={e} />)}</div>}
    </>
  );
}

/* ============================================================
   Dueño view (intacta)
   ============================================================ */
function Dueno({ dailyFloat, balance, totalFunded, expenses, period, setPeriod, onRecarga }: {
  dailyFloat: number; balance: number; totalFunded: number; expenses: UIExpense[];
  period: string; setPeriod: (p: string) => void; onRecarga: () => void;
}) {
  const periodExp = expenses.filter((e) => inPeriod(e.dateISO, period)).sort((a, b) => b.createdAt - a.createdAt);
  const spentP = periodExp.reduce((s, e) => s + num(e.total), 0);
  const ivaP = periodExp.reduce((s, e) => s + num(e.iva), 0);

  // group by day
  const groups: Record<string, UIExpense[]> = {};
  periodExp.forEach((e) => { (groups[e.dateISO] = groups[e.dateISO] || []).push(e); });
  const days = Object.keys(groups).sort((a, b) => isoToDate(b).getTime() - isoToDate(a).getTime());

  // breakdown by category
  const byCat: Record<string, number> = {};
  periodExp.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + num(e.total); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 1;

  const periodLabel = ({ hoy: "hoy", semana: "esta semana", mes: "este mes" } as Record<string, string>)[period];

  return (
    <>
      <section className={`gauge-card owner g-${balance <= 0 ? "empty" : balance < dailyFloat * 0.4 ? "mid" : "ok"}`}>
        <div className="gauge-greet">Saldo en mano del mandadero</div>
        <div className="gauge-amount" style={{ fontSize: 40 }}>{money(balance < 0 ? 0 : balance)}</div>
        <div className="gauge-of">Entregado en total {money(totalFunded)} · Gastado {money(totalFunded - balance)}</div>
        <button className="btn btn-onwhite" style={{ marginTop: 16 }} onClick={onRecarga}><Plus size={16} />Recargar saldo</button>
      </section>

      <div className="owner-bar">
        <div className="tabs">
          {["hoy", "semana", "mes"].map((p) => <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>{p === "hoy" ? "Hoy" : p === "semana" ? "Semana" : "Mes"}</button>)}
        </div>
        <button className="btn btn-ghost mini-btn" onClick={() => exportCSV(periodExp, `cuadra_${period}_${todayISO()}.csv`)} disabled={!periodExp.length}><Download size={15} />Exportar a Excel</button>
      </div>

      <div className="sumgrid">
        <div className="sumcard"><div className="k">Gastado {periodLabel}</div><div className="v">{money(spentP)}</div></div>
        <div className="sumcard"><div className="k">Movimientos</div><div className="v">{periodExp.length}</div></div>
        <div className="sumcard"><div className="k">IVA acumulado</div><div className="v">{money(ivaP)}</div></div>
      </div>

      {cats.length > 0 && (
        <>
          <div className="section-title"><span>En qué se fue ({periodLabel})</span></div>
          <div className="card" style={{ padding: "12px 16px" }}>
            {cats.map(([c, v]) => (
              <div className="bar-row" key={c}>
                <div className="bar-label">{c}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max((v / maxCat) * 100, 6)}%` }} /></div>
                <div className="bar-val">{money(v)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title"><span>Movimientos {periodLabel}</span></div>
      {periodExp.length === 0
        ? <div className="card"><div className="empty"><div className="big">Sin movimientos en este periodo</div>Cuando el mandadero registre un gasto, aparece aquí con su ticket.</div></div>
        : days.map((d) => {
          const list = groups[d]; const sum = list.reduce((s, e) => s + num(e.total), 0);
          return (
            <div key={d}>
              <div className="day-head"><div className="day-name">{labelDate(d)}</div><div className="day-sum">{list.length} mov · {money(sum)}</div></div>
              <div className="card">{list.map((e) => <ExpenseRowView key={e.id} e={e} owner />)}</div>
            </div>
          );
        })}
      <div className="footnote">Las alertas por cada movimiento se ven aquí, en el feed. Notificaciones push llegan en una versión futura.</div>
    </>
  );
}

/* ============================================================
   Expense row (expandable, intacta)
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
            <span>{labelTime(e.createdAt)}</span><span>·</span><span>{e.category}</span>
            <span className={`badge ${e.source === "ocr" ? "badge-ocr" : "badge-manual"}`}>{e.source === "ocr" ? "Foto" : "Manual"}</span>
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
          {owner && e.hasPhoto && e.photoPath && <ExpensePhoto path={e.photoPath} />}
        </div>
      )}
    </div>
  );
}

function ExpensePhoto({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/receipt-url?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (res.ok && data.url) setSrc(data.url); else setErr(true);
      } catch { setErr(true); }
    })();
  }, [path]);
  if (err) return null;
  if (!src) return <div className="hint" style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}><ImageIcon size={14} /> Cargando ticket…</div>;
  return <div className="exp-photo"><img src={src} alt="ticket" /></div>;
}

/* ============================================================
   Expense form (OCR confirm + manual, intacta)
   ============================================================ */
function ExpenseForm({ init, photo, onSave, onCancel }: {
  init: FormInit; photo: string | null; onSave: (d: FormInit) => void | Promise<void>; onCancel: () => void;
}) {
  const [store, setStore] = useState(init.store);
  const [dateISO, setDateISO] = useState(init.dateISO);
  const [category, setCategory] = useState(init.category);
  const [concept, setConcept] = useState(init.concept || "");
  const [items, setItems] = useState<FormItem[]>(init.items || []);
  const [subtotal, setSubtotal] = useState(init.subtotal);
  const [iva, setIva] = useState(init.iva);
  const [ieps, setIeps] = useState(init.ieps);
  const [total, setTotal] = useState(init.total);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const itemsSum = items.reduce((s, i) => s + num(i.price), 0);
  const taxSum = num(subtotal) + num(iva) + num(ieps);

  const setItem = (idx: number, field: keyof FormItem, val: string) => setItems(items.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const addItem = () => setItems([...items, { name: "", qty: "1", price: "" }]);
  const delItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  async function submit() {
    if (!store.trim()) return setErr("Escribe la tienda o el lugar.");
    if (num(total) <= 0) return setErr("Pon cuánto se gastó en total.");
    setErr("");
    setSaving(true);
    await onSave({ store, dateISO, category, concept, items, subtotal, iva, ieps, total, source: init.source });
    setSaving(false);
  }

  return (
    <div>
      {photo && <div className="form-photo"><img src={photo} alt="ticket" /></div>}

      <div className="row2">
        <div className="field"><label className="label">Tienda / lugar</label><input className="input" value={store} onChange={(e) => setStore(e.target.value)} placeholder="HEB, tortillería…" /></div>
        <div className="field"><label className="label">Fecha</label><input className="input" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} /></div>
      </div>

      <div className="row2">
        <div className="field"><label className="label">Categoría</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div className="field"><label className="label">Concepto (opcional)</label><input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Verdura de la semana…" /></div>
      </div>

      <div className="items-head"><label className="label" style={{ margin: 0 }}>Productos</label><button className="linkbtn" onClick={addItem}><Plus size={14} />Agregar</button></div>
      {items.length === 0 && <div className="hint" style={{ marginBottom: 8 }}>Sin productos. Puedes agregarlos o dejar solo el total.</div>}
      {items.map((it, i) => (
        <div className="item-edit" key={i}>
          <input className="input mini" value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} placeholder="Producto" />
          <input className="input mini" value={it.qty} onChange={(e) => setItem(i, "qty", e.target.value)} inputMode="decimal" placeholder="Cant" />
          <input className="input mini" value={it.price} onChange={(e) => setItem(i, "price", e.target.value)} inputMode="decimal" placeholder="$" />
          <button className="iconx" onClick={() => delItem(i)}><X size={15} /></button>
        </div>
      ))}
      {items.length > 0 && <div className="hint" style={{ marginBottom: 10 }}>Suma de productos: {money(itemsSum)}</div>}

      <div className="row3b">
        <div className="field"><label className="label">Subtotal</label><input className="input" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} inputMode="decimal" placeholder="0" /></div>
        <div className="field"><label className="label">IVA</label><input className="input" value={iva} onChange={(e) => setIva(e.target.value)} inputMode="decimal" placeholder="0" /></div>
        <div className="field"><label className="label">IEPS</label><input className="input" value={ieps} onChange={(e) => setIeps(e.target.value)} inputMode="decimal" placeholder="0" /></div>
      </div>

      <div className="field total-field">
        <label className="label">Total pagado <span className="muted">· lo que baja del saldo</span></label>
        <div className="total-row">
          <input className="input total-input" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="0.00" />
          {taxSum > 0 && Math.abs(taxSum - num(total)) > 0.5 && <button className="linkbtn" onClick={() => setTotal(String(taxSum))}>Usar {money(taxSum)}</button>}
        </div>
      </div>

      {err && <div className="err"><AlertTriangle size={14} />{err}</div>}

      <div className="row2" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost btn-block" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <Check size={17} />}Guardar gasto</button>
      </div>
    </div>
  );
}

/* ---------- recarga form (intacta) ---------- */
function RecargaForm({ defaultAmount, runnerName, onSave, onCancel }: {
  defaultAmount: number; runnerName: string; onSave: (a: string, n: string) => void | Promise<void>; onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(defaultAmount));
  const [note, setNote] = useState("");
  return (
    <div>
      <p className="hint" style={{ fontSize: 14, marginBottom: 14 }}>Agrega dinero al saldo de {runnerName}. Se suma a lo que le quede.</p>
      <div className="field"><label className="label">Cantidad</label><input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
      <div className="field"><label className="label">Nota (opcional)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Fondo del día, compra grande…" /></div>
      <div className="row2" style={{ marginTop: 6 }}>
        <button className="btn btn-ghost btn-block" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={() => num(amount) > 0 && onSave(amount, note)}><Banknote size={17} />Recargar</button>
      </div>
    </div>
  );
}

/* ---------- settings form (adaptada: sin reset destructivo; alta de mandadero + logout) ---------- */
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
        ? <div className="field"><label className="label">Nombre del mandadero</label><input className="input" value={runnerName} onChange={(e) => setRn(e.target.value)} /></div>
        : (
          <div className="field">
            <label className="label">Mandadero</label>
            <button className="btn btn-ghost btn-block" onClick={onCreateRunner}><UserPlus size={16} />Crear cuenta del mandadero</button>
            <div className="hint" style={{ marginTop: 6 }}>Tú le creas su acceso y le pasas las claves en persona.</div>
          </div>
        )}
      <div className="field"><label className="label">Fondo diario sugerido</label><input className="input" value={dailyFloat} onChange={(e) => setDf(e.target.value)} inputMode="decimal" /><div className="hint">Es el monto que aparece por defecto al recargar.</div></div>
      <button className="btn btn-primary btn-block" style={{ marginTop: 6 }} onClick={() => onSave({ businessName: businessName.trim() || "Mi Restaurante", runnerName: runnerName.trim(), dailyFloat: num(dailyFloat) || 2000 })}><Check size={17} />Guardar ajustes</button>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onLogout}><LogOut size={16} />Cerrar sesión</button>
    </div>
  );
}

/* ---------- alta del mandadero (nuevo: requerido por auth real) ---------- */
function RunnerForm({ onDone, onCancel }: { onDone: () => void | Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return setErr("Escribe el nombre del mandadero.");
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
      <p className="hint" style={{ fontSize: 14, marginBottom: 14 }}>Crea el acceso de tu mandadero y pásale el correo y la contraseña en persona. Él entra una vez en su teléfono y su sesión queda guardada.</p>
      <div className="field"><label className="label">Nombre</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rubén" /></div>
      <div className="field"><label className="label">Correo</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="mandadero@tunegocio.com" /></div>
      <div className="field"><label className="label">Contraseña</label><input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" /></div>
      {err && <div className="err"><AlertTriangle size={14} />{err}</div>}
      <div className="row2" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost btn-block" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <UserPlus size={17} />}Crear cuenta</button>
      </div>
    </div>
  );
}

/* ---------- sheet/modal (intacta) ---------- */
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
