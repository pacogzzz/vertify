import { useState, useEffect, useRef } from "react";
import {
  Camera, PencilLine, Wallet, Plus, Download, RotateCcw, Settings, Check, X,
  ChevronDown, ChevronRight, Receipt, Store, AlertTriangle,
  Loader2, Image as ImageIcon, Banknote
} from "lucide-react";

/* ============================================================
   Cuadra — control de gastos del mandadero (prototipo MVP)
   Modelo de datos pensado multi-negocio / multi-usuario.
   Persistencia: window.storage (sobrevive entre sesiones),
   con fallback en memoria si no está disponible.
   ============================================================ */

const BIZ = "biz1"; // en producción: id real del negocio
const K = {
  config: `zb_config:${BIZ}`,
  fundings: `zb_fundings:${BIZ}`,
  expenses: `zb_expenses:${BIZ}`,
  seeded: `zb_seeded:${BIZ}`,
  photo: (id) => `zb_photo:${id}`,
};
const CATS = ["Alimentos", "Bebidas", "Abarrotes", "Carnes", "Frutas y verduras", "Limpieza", "Desechables", "Otros"];

/* ---------- storage layer ---------- */
const mem = new Map();
const hasStore = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
async function rawGet(key) {
  if (hasStore) { try { const r = await window.storage.get(key); return r ? r.value : null; } catch { return null; } }
  return mem.has(key) ? mem.get(key) : null;
}
async function rawSet(key, val) {
  if (hasStore) { try { await window.storage.set(key, val); return; } catch (e) { console.error(e); } }
  mem.set(key, val);
}
async function rawDel(key) {
  if (hasStore) { try { await window.storage.delete(key); } catch {} }
  mem.delete(key);
}
async function getJSON(key, fb) { const v = await rawGet(key); if (v == null) return fb; try { return JSON.parse(v); } catch { return fb; } }
async function setJSON(key, obj) { await rawSet(key, JSON.stringify(obj)); }

/* ---------- helpers ---------- */
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const num = (x) => { const n = typeof x === "number" ? x : parseFloat(x); return isNaN(n) ? 0 : n; };
const money = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(num(n));
const toStr = (n) => (n ? String(n) : "");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function isoToDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function inPeriod(iso, period) {
  if (!iso) iso = todayISO();
  const d = isoToDate(iso); const t = new Date(); t.setHours(0, 0, 0, 0);
  if (period === "hoy") return iso === todayISO();
  if (period === "semana") { const s = new Date(t); s.setDate(t.getDate() - 6); return d >= s && d <= t; }
  if (period === "mes") return d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
  return true;
}
function labelDate(iso) {
  try { return isoToDate(iso).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return iso; }
}
function labelTime(ts) {
  try { return new Date(ts).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

/* ---------- image scaling ---------- */
function fileToScaled(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width >= height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const c = document.createElement("canvas"); c.width = width; c.height = height;
      c.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img")); };
    img.src = url;
  });
}

/* ---------- OCR via Anthropic API ---------- */
async function readReceipt(base64) {
  const prompt = `Eres un extractor de datos de tickets de compra de tiendas en México (HEB, Sam's Club, Costco, Walmart, Soriana, etc.).
Analiza la imagen del ticket y devuelve ÚNICAMENTE un objeto JSON válido, sin texto adicional, sin markdown.
Estructura exacta:
{"store": "nombre de la tienda", "dateISO": "YYYY-MM-DD o null", "subtotal": 0, "iva": 0, "ieps": 0, "total": 0, "items": [{"name": "producto", "qty": 1, "price": 0}]}
Reglas: montos como número sin símbolo ni comas. Si un dato no aparece usa 0 (o null en dateISO). Incluye en items todos los productos legibles con su importe total en "price". Si la imagen no es un ticket legible, devuelve {"error":"ilegible"}.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (parsed && parsed.error) throw new Error("ilegible");
  return parsed;
}

/* ---------- CSV export ---------- */
function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function exportCSV(rows, filename) {
  const header = ["Fecha", "Hora", "Tienda", "Categoría", "Concepto", "Subtotal", "IVA", "IEPS", "Total", "Origen", "Productos"];
  const lines = [header.join(",")];
  rows.forEach((e) => {
    const productos = (e.items || []).map((i) => `${i.qty || 1}x ${i.name} (${money(i.price)})`).join(" | ");
    lines.push([e.dateISO, labelTime(e.createdAt), e.store, e.category, e.concept || "", num(e.subtotal), num(e.iva), num(e.ieps), num(e.total), e.source === "ocr" ? "Foto" : "Manual", productos].map(csvCell).join(","));
  });
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ============================================================
   App
   ============================================================ */
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("mandadero");
  const [config, setConfig] = useState({ businessName: "Mi Restaurante", runnerName: "Rubén", dailyFloat: 2000 });
  const [fundings, setFundings] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [period, setPeriod] = useState("hoy");
  const [modal, setModal] = useState(null); // capture | reading | form | recarga | settings | reset
  const [formInit, setFormInit] = useState(null);
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [ocr, setOcr] = useState({ loading: false, error: null });
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  /* ----- load + seed ----- */
  useEffect(() => {
    (async () => {
      const seeded = await rawGet(K.seeded);
      if (!seeded) {
        const cfg = { businessName: "Mi Restaurante", runnerName: "Rubén", dailyFloat: 2000 };
        const now = Date.now();
        const fund = [{ id: uid(), amount: 2000, dateISO: todayISO(), createdAt: now - 36e5, note: "Fondo del día" }];
        const exp = [
          { id: uid(), dateISO: todayISO(), store: "HEB", category: "Frutas y verduras", concept: "", subtotal: 420.5, iva: 67.28, ieps: 0, total: 487.78, source: "ocr", createdAt: now - 30e5, hasPhoto: false,
            items: [ { name: "Jitomate saladet kg", qty: 5, price: 145 }, { name: "Cebolla blanca kg", qty: 4, price: 96 }, { name: "Aguacate hass kg", qty: 3, price: 179.5 } ] },
          { id: uid(), dateISO: todayISO(), store: "Tortillería La Esperanza", category: "Alimentos", concept: "Tortilla de maíz", subtotal: 120, iva: 0, ieps: 0, total: 120, source: "manual", createdAt: now - 12e5, hasPhoto: false, items: [{ name: "Tortilla de maíz kg", qty: 6, price: 120 }] },
        ];
        setConfig(cfg); setFundings(fund); setExpenses(exp);
        await setJSON(K.config, cfg); await setJSON(K.fundings, fund); await setJSON(K.expenses, exp);
        await rawSet(K.seeded, "1");
      } else {
        setConfig(await getJSON(K.config, config));
        setFundings(await getJSON(K.fundings, []));
        setExpenses(await getJSON(K.expenses, []));
      }
      setLoaded(true);
    })();
    // eslint-disable-next-line
  }, []);

  const flash = (msg, kind = "ok") => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2600); };

  /* ----- derived ----- */
  const totalFunded = fundings.reduce((s, f) => s + num(f.amount), 0);
  const totalSpent = expenses.reduce((s, e) => s + num(e.total), 0);
  const balance = totalFunded - totalSpent;
  const todays = expenses.filter((e) => e.dateISO === todayISO()).sort((a, b) => b.createdAt - a.createdAt);

  /* ----- actions ----- */
  function openManual() { setPendingPhoto(null); setFormInit({ store: "", dateISO: todayISO(), category: "Abarrotes", concept: "", items: [], subtotal: "", iva: "", ieps: "", total: "", source: "manual" }); setOcr({ loading: false, error: null }); setModal("form"); }

  function pickPhoto() { fileRef.current && fileRef.current.click(); }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setModal("reading"); setOcr({ loading: true, error: null });
    try {
      const apiUrl = await fileToScaled(file, 1100, 0.7);
      const thumb = await fileToScaled(file, 760, 0.6);
      setPendingPhoto(thumb);
      const b64 = apiUrl.split(",")[1];
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
    } catch (err) {
      setFormInit({ store: "", dateISO: todayISO(), category: "Abarrotes", concept: "", items: [], subtotal: "", iva: "", ieps: "", total: "", source: "ocr" });
      setOcr({ loading: false, error: "No pude leer el ticket. Captura los datos a mano o reintenta con mejor luz." });
      setModal("form");
    }
  }

  async function saveExpense(data) {
    const id = uid();
    const exp = { id, dateISO: data.dateISO || todayISO(), store: data.store.trim(), category: data.category, concept: data.concept.trim(), subtotal: num(data.subtotal), iva: num(data.iva), ieps: num(data.ieps), total: num(data.total), source: data.source, createdAt: Date.now(), hasPhoto: !!pendingPhoto, items: (data.items || []).filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), qty: num(i.qty) || 1, price: num(i.price) })) };
    if (pendingPhoto) await rawSet(K.photo(id), pendingPhoto);
    const next = [exp, ...expenses];
    setExpenses(next); await setJSON(K.expenses, next);
    setPendingPhoto(null); setModal(null);
    flash("Gasto registrado");
  }

  async function saveFunding(amount, note) {
    const f = { id: uid(), amount: num(amount), dateISO: todayISO(), createdAt: Date.now(), note: note || "Recarga" };
    const next = [f, ...fundings];
    setFundings(next); await setJSON(K.fundings, next);
    setModal(null); flash("Saldo recargado");
  }

  async function saveConfig(cfg) { setConfig(cfg); await setJSON(K.config, cfg); setModal(null); flash("Ajustes guardados"); }

  async function resetData() {
    for (const e of expenses) await rawDel(K.photo(e.id));
    const cfg = config; const fund = [{ id: uid(), amount: num(cfg.dailyFloat), dateISO: todayISO(), createdAt: Date.now(), note: "Fondo del día" }];
    setExpenses([]); setFundings(fund);
    await setJSON(K.expenses, []); await setJSON(K.fundings, fund);
    setModal(null); flash("Datos reiniciados");
  }

  if (!loaded) {
    return (
      <div className="cuadra"><style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div style={{ display: "flex", height: "70vh", alignItems: "center", justifyContent: "center", color: "var(--muted)", gap: 10 }}>
          <Loader2 className="spin" size={20} /> Cargando…
        </div>
      </div>
    );
  }

  return (
    <div className="cuadra">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      <div className="wrap">
        {/* top bar */}
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">$</div>
            <div>
              <div className="brand-name">Cuadra</div>
              <div className="brand-sub">{config.businessName}</div>
            </div>
          </div>
          <div className="topbar-right">
            <div className="switch" role="tablist">
              <button className={view === "mandadero" ? "active" : ""} onClick={() => setView("mandadero")}><Wallet size={15} />Mandadero</button>
              <button className={view === "dueno" ? "active" : ""} onClick={() => setView("dueno")}><Store size={15} />Dueño</button>
            </div>
            <button className="iconbtn" title="Ajustes" onClick={() => setModal("settings")}><Settings size={17} /></button>
          </div>
        </header>

        {view === "mandadero"
          ? <Mandadero config={config} balance={balance} assigned={totalFunded} todays={todays} onScan={pickPhoto} onManual={openManual} />
          : <Dueno config={config} balance={balance} totalFunded={totalFunded} expenses={expenses} period={period} setPeriod={setPeriod} onRecarga={() => setModal("recarga")} />}
      </div>

      {/* modals */}
      {modal === "capture" && (
        <Sheet title="Registrar gasto" onClose={() => setModal(null)}>
          <div className="choose">
            <button className="choose-btn" onClick={() => { setModal(null); pickPhoto(); }}>
              <span className="choose-ic"><Camera size={22} /></span>
              <span><span className="choose-t">Tomar foto del ticket</span><span className="choose-d">El sistema lee tienda, monto y productos</span></span>
            </button>
            <button className="choose-btn" onClick={openManual}>
              <span className="choose-ic"><PencilLine size={22} /></span>
              <span><span className="choose-t">Capturar a mano</span><span className="choose-d">Para tortillería, mercado y locales sin ticket</span></span>
            </button>
          </div>
        </Sheet>
      )}

      {modal === "reading" && (
        <Sheet title="Leyendo ticket" onClose={() => { setModal(null); setPendingPhoto(null); }}>
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
        <Sheet title={formInit.source === "ocr" ? "Confirma el gasto" : "Gasto manual"} onClose={() => { setModal(null); setPendingPhoto(null); }}>
          {ocr.error && <div className="banner-warn"><AlertTriangle size={15} />{ocr.error}</div>}
          {formInit.source === "ocr" && !ocr.error && <div className="banner-ok"><Check size={15} />Leí el ticket. Revisa que todo cuadre antes de guardar.</div>}
          <ExpenseForm init={formInit} photo={pendingPhoto} onSave={saveExpense} onCancel={() => { setModal(null); setPendingPhoto(null); }} />
        </Sheet>
      )}

      {modal === "recarga" && (
        <Sheet title="Recargar saldo" onClose={() => setModal(null)}>
          <RecargaForm defaultAmount={config.dailyFloat} runnerName={config.runnerName} onSave={saveFunding} onCancel={() => setModal(null)} />
        </Sheet>
      )}

      {modal === "settings" && (
        <Sheet title="Ajustes" onClose={() => setModal(null)}>
          <SettingsForm config={config} onSave={saveConfig} onReset={() => setModal("reset")} />
        </Sheet>
      )}

      {modal === "reset" && (
        <Sheet title="¿Reiniciar datos?" onClose={() => setModal(null)}>
          <p className="hint" style={{ fontSize: 14, marginBottom: 16 }}>Esto borra todos los gastos registrados y deja el fondo del día en {money(config.dailyFloat)}. Úsalo para empezar limpio con datos reales. No se puede deshacer.</p>
          <div className="row2">
            <button className="btn btn-ghost btn-block" onClick={() => setModal("settings")}>Cancelar</button>
            <button className="btn btn-danger btn-block" onClick={resetData}><RotateCcw size={16} />Reiniciar</button>
          </div>
        </Sheet>
      )}

      {toast && <div className="toast"><Check size={16} />{toast.msg}</div>}
    </div>
  );
}

/* ============================================================
   Mandadero view
   ============================================================ */
function Mandadero({ config, balance, assigned, todays, onScan, onManual }) {
  const ratio = assigned > 0 ? Math.max(0, Math.min(1, balance / assigned)) : (balance > 0 ? 1 : 0);
  let state = "ok", status = "Vas bien. Cada compra baja tu saldo.";
  if (balance <= 0) { state = "empty"; status = "Saldo agotado — pídele recarga a tu jefe."; }
  else if (ratio < 0.15) { state = "low"; status = "Te queda poco. Avísale a tu jefe pronto."; }
  else if (ratio < 0.4) { state = "mid"; status = "Llevas buen ritmo, ojo con lo que queda."; }
  const spentToday = todays.reduce((s, e) => s + num(e.total), 0);

  return (
    <>
      <section className={`gauge-card g-${state}`}>
        <div className="gauge-greet">Hola {config.runnerName}, te quedan</div>
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
        : <div className="card">{todays.map((e) => <ExpenseRow key={e.id} e={e} />)}</div>}
    </>
  );
}

/* ============================================================
   Dueño view
   ============================================================ */
function Dueno({ config, balance, totalFunded, expenses, period, setPeriod, onRecarga }) {
  const periodExp = expenses.filter((e) => inPeriod(e.dateISO, period)).sort((a, b) => b.createdAt - a.createdAt);
  const spentP = periodExp.reduce((s, e) => s + num(e.total), 0);
  const ivaP = periodExp.reduce((s, e) => s + num(e.iva), 0);

  // group by day
  const groups = {};
  periodExp.forEach((e) => { (groups[e.dateISO] = groups[e.dateISO] || []).push(e); });
  const days = Object.keys(groups).sort((a, b) => isoToDate(b) - isoToDate(a));

  // breakdown by category
  const byCat = {};
  periodExp.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + num(e.total); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 1;

  const periodLabel = { hoy: "hoy", semana: "esta semana", mes: "este mes" }[period];

  return (
    <>
      <section className={`gauge-card owner g-${balance <= 0 ? "empty" : balance < num(config.dailyFloat) * 0.4 ? "mid" : "ok"}`}>
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
              <div className="card">{list.map((e) => <ExpenseRow key={e.id} e={e} owner />)}</div>
            </div>
          );
        })}
      <div className="footnote">Las alertas en tiempo real por cada movimiento llegan en la versión con servidor.</div>
    </>
  );
}

/* ============================================================
   Expense row (expandable)
   ============================================================ */
function ExpenseRow({ e, owner }) {
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
          {owner && e.hasPhoto && <ExpensePhoto id={e.id} />}
        </div>
      )}
    </div>
  );
}

function ExpensePhoto({ id }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { (async () => { const v = await rawGet(K.photo(id)); if (v) setSrc(v); else setErr(true); })(); }, [id]);
  if (err) return null;
  if (!src) return <div className="hint" style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}><ImageIcon size={14} /> Cargando ticket…</div>;
  return <div className="exp-photo"><img src={src} alt="ticket" /></div>;
}

/* ============================================================
   Expense form (OCR confirm + manual)
   ============================================================ */
function ExpenseForm({ init, photo, onSave, onCancel }) {
  const [store, setStore] = useState(init.store);
  const [dateISO, setDateISO] = useState(init.dateISO);
  const [category, setCategory] = useState(init.category);
  const [concept, setConcept] = useState(init.concept || "");
  const [items, setItems] = useState(init.items || []);
  const [subtotal, setSubtotal] = useState(init.subtotal);
  const [iva, setIva] = useState(init.iva);
  const [ieps, setIeps] = useState(init.ieps);
  const [total, setTotal] = useState(init.total);
  const [err, setErr] = useState("");

  const itemsSum = items.reduce((s, i) => s + num(i.price), 0);
  const taxSum = num(subtotal) + num(iva) + num(ieps);

  const setItem = (idx, field, val) => setItems(items.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const addItem = () => setItems([...items, { name: "", qty: "1", price: "" }]);
  const delItem = (idx) => setItems(items.filter((_, i) => i !== idx));

  function submit() {
    if (!store.trim()) return setErr("Escribe la tienda o el lugar.");
    if (num(total) <= 0) return setErr("Pon cuánto se gastó en total.");
    setErr("");
    onSave({ store, dateISO, category, concept, items, subtotal, iva, ieps, total, source: init.source });
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
        <button className="btn btn-ghost btn-block" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={submit}><Check size={17} />Guardar gasto</button>
      </div>
    </div>
  );
}

/* ---------- recarga form ---------- */
function RecargaForm({ defaultAmount, runnerName, onSave, onCancel }) {
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

/* ---------- settings form ---------- */
function SettingsForm({ config, onSave, onReset }) {
  const [businessName, setBn] = useState(config.businessName);
  const [runnerName, setRn] = useState(config.runnerName);
  const [dailyFloat, setDf] = useState(String(config.dailyFloat));
  return (
    <div>
      <div className="field"><label className="label">Nombre del negocio</label><input className="input" value={businessName} onChange={(e) => setBn(e.target.value)} /></div>
      <div className="field"><label className="label">Nombre del mandadero</label><input className="input" value={runnerName} onChange={(e) => setRn(e.target.value)} /></div>
      <div className="field"><label className="label">Fondo diario sugerido</label><input className="input" value={dailyFloat} onChange={(e) => setDf(e.target.value)} inputMode="decimal" /><div className="hint">Es el monto que aparece por defecto al recargar.</div></div>
      <button className="btn btn-primary btn-block" style={{ marginTop: 6 }} onClick={() => onSave({ businessName: businessName.trim() || "Mi Restaurante", runnerName: runnerName.trim() || "Mandadero", dailyFloat: num(dailyFloat) || 2000 })}><Check size={17} />Guardar ajustes</button>
      <button className="btn btn-danger btn-block" style={{ marginTop: 10 }} onClick={onReset}><RotateCcw size={16} />Reiniciar datos (empezar limpio)</button>
    </div>
  );
}

/* ---------- sheet/modal ---------- */
function Sheet({ title, onClose, children }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><div className="sheet-title">{title}</div><button className="iconbtn" onClick={onClose}><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

/* ============================================================
   Styles
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');
.cuadra{
  --ink:#14241C; --paper:#EEF1EC; --surface:#FFFFFF; --line:#DCE4DD; --muted:#5E6E64;
  --saldo:#15784C; --saldo-deep:#0F5C39; --amber:#C2860D; --danger:#B23A28;
  --disp:'Space Grotesk',system-ui,sans-serif; --body:'Inter',system-ui,sans-serif;
  font-family:var(--body); color:var(--ink); background:var(--paper); min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
.cuadra *{box-sizing:border-box;}
.cuadra .wrap{max-width:680px;margin:0 auto;padding:0 16px 110px;}

.cuadra .topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 2px 14px;flex-wrap:wrap;}
.cuadra .brand{display:flex;align-items:center;gap:11px;}
.cuadra .brand-mark{width:40px;height:40px;border-radius:12px;background:linear-gradient(155deg,#27B06E,#0F5C39);color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:700;font-size:22px;box-shadow:0 4px 14px rgba(15,92,57,.25);}
.cuadra .brand-name{font-family:var(--disp);font-weight:700;font-size:22px;letter-spacing:-.02em;line-height:1;}
.cuadra .brand-sub{font-size:12px;color:var(--muted);margin-top:2px;}
.cuadra .topbar-right{display:flex;align-items:center;gap:8px;}
.cuadra .switch{display:inline-flex;background:#fff;border:1px solid var(--line);border-radius:999px;padding:3px;}
.cuadra .switch button{border:0;background:transparent;font:inherit;font-weight:600;font-size:13px;padding:7px 12px;border-radius:999px;color:var(--muted);cursor:pointer;display:flex;gap:6px;align-items:center;transition:.15s;}
.cuadra .switch button.active{background:var(--ink);color:#fff;}
.cuadra .iconbtn{width:38px;height:38px;border-radius:11px;border:1px solid var(--line);background:#fff;color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:.15s;}
.cuadra .iconbtn:hover{background:var(--paper);}

/* gauge */
.cuadra .gauge-card{background:var(--ink);color:#fff;border-radius:24px;padding:24px 22px 22px;position:relative;overflow:hidden;box-shadow:0 14px 40px rgba(20,36,28,.16);}
.cuadra .gauge-card::after{content:"";position:absolute;right:-40px;top:-40px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(39,176,110,.22),transparent 70%);}
.cuadra .gauge-card.g-low::after,.cuadra .gauge-card.g-mid::after{background:radial-gradient(circle,rgba(224,165,58,.20),transparent 70%);}
.cuadra .gauge-card.g-empty::after{background:radial-gradient(circle,rgba(210,84,63,.22),transparent 70%);}
.cuadra .gauge-greet{font-size:13px;opacity:.7;position:relative;}
.cuadra .gauge-amount{font-family:var(--disp);font-weight:700;font-size:46px;letter-spacing:-.03em;line-height:1;margin:8px 0 5px;font-variant-numeric:tabular-nums;position:relative;}
.cuadra .gauge-of{font-size:12.5px;opacity:.62;position:relative;}
.cuadra .gauge-track{margin-top:18px;height:16px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden;position:relative;}
.cuadra .gauge-fill{height:100%;border-radius:999px;transition:width .7s cubic-bezier(.22,.61,.36,1);background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.13) 0 6px,transparent 6px 12px),linear-gradient(180deg,#2FC07C,#13724A);}
.cuadra .gauge-fill.f-mid{background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.13) 0 6px,transparent 6px 12px),linear-gradient(180deg,#E7B14A,#C2860D);}
.cuadra .gauge-fill.f-low{background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.13) 0 6px,transparent 6px 12px),linear-gradient(180deg,#E08A4A,#C26A0D);}
.cuadra .gauge-fill.f-empty{background:#D2543F;}
.cuadra .gauge-status{margin-top:14px;display:flex;align-items:center;gap:8px;font-size:13px;position:relative;}
.cuadra .s-ok{color:#9DE7C2;} .cuadra .s-mid,.cuadra .s-low{color:#F4CE86;} .cuadra .s-empty{color:#F2B3A6;}
.cuadra .gauge-card.owner{background:linear-gradient(160deg,#1B3429,#14241C);}
.cuadra .btn-onwhite,.cuadra .btn.btn-onwhite{background:#fff;color:var(--saldo-deep);border:0;font-weight:600;border-radius:12px;padding:11px 16px;display:inline-flex;gap:8px;align-items:center;cursor:pointer;font:inherit;font-weight:600;}

/* buttons */
.cuadra .btn{font:inherit;font-weight:600;border-radius:14px;padding:13px 16px;border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:9px;font-size:15px;transition:.15s;}
.cuadra .btn-primary{background:var(--saldo);color:#fff;box-shadow:0 6px 16px rgba(21,120,76,.22);}
.cuadra .btn-primary:hover{background:var(--saldo-deep);}
.cuadra .btn-ghost{background:#fff;color:var(--ink);border-color:var(--line);}
.cuadra .btn-ghost:hover{background:var(--paper);}
.cuadra .btn-danger{background:#fff;color:var(--danger);border-color:#E7C9C2;}
.cuadra .btn-danger:hover{background:#FBF1EF;}
.cuadra .btn-block{width:100%;}
.cuadra .btn-lg{padding:17px;font-size:16px;}
.cuadra .btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;}
.cuadra .cta-stack{display:grid;gap:10px;margin-top:18px;}

/* sections */
.cuadra .section-title{font-family:var(--disp);font-weight:600;font-size:15px;margin:24px 4px 10px;display:flex;justify-content:space-between;align-items:center;}
.cuadra .muted{color:var(--muted);}
.cuadra .card{background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;}
.cuadra .footnote{font-size:11.5px;color:var(--muted);text-align:center;margin-top:18px;padding:0 12px;}

/* owner bar */
.cuadra .owner-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:18px;flex-wrap:wrap;}
.cuadra .tabs{display:inline-flex;background:#fff;border:1px solid var(--line);border-radius:12px;padding:3px;gap:2px;}
.cuadra .tabs button{border:0;background:transparent;font:inherit;font-weight:600;font-size:13px;padding:7px 15px;border-radius:9px;color:var(--muted);cursor:pointer;}
.cuadra .tabs button.active{background:var(--paper);color:var(--ink);}
.cuadra .mini-btn{padding:8px 13px;font-size:13px;border-radius:11px;}

/* summary cards */
.cuadra .sumgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px;}
.cuadra .sumcard{background:#fff;border:1px solid var(--line);border-radius:14px;padding:13px 14px;}
.cuadra .sumcard .k{font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em;}
.cuadra .sumcard .v{font-family:var(--disp);font-weight:700;font-size:19px;margin-top:5px;font-variant-numeric:tabular-nums;}

/* breakdown bars */
.cuadra .bar-row{display:flex;align-items:center;gap:10px;padding:7px 0;font-size:13px;}
.cuadra .bar-label{width:120px;flex-shrink:0;color:#37463D;}
.cuadra .bar-track{flex:1;height:9px;background:var(--paper);border-radius:999px;overflow:hidden;}
.cuadra .bar-fill{height:100%;background:linear-gradient(90deg,#27B06E,#15784C);border-radius:999px;}
.cuadra .bar-val{width:90px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;font-family:var(--disp);font-size:13px;}

/* day groups */
.cuadra .day-head{display:flex;justify-content:space-between;align-items:baseline;padding:16px 4px 7px;}
.cuadra .day-name{font-weight:600;font-size:13px;text-transform:capitalize;}
.cuadra .day-sum{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;}

/* expense rows */
.cuadra .exp-wrap{border-top:1px solid #EFF3EE;}
.cuadra .exp-wrap:first-child{border-top:0;}
.cuadra .exp{display:flex;gap:12px;padding:14px 16px;align-items:center;cursor:pointer;}
.cuadra .exp:hover{background:#FAFBFA;}
.cuadra .exp-ic{width:38px;height:38px;border-radius:11px;background:var(--paper);display:flex;align-items:center;justify-content:center;color:var(--saldo);flex-shrink:0;}
.cuadra .exp-main{flex:1;min-width:0;}
.cuadra .exp-store{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cuadra .exp-meta{font-size:12px;color:var(--muted);display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:2px;}
.cuadra .exp-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.cuadra .exp-amt{font-family:var(--disp);font-weight:600;font-variant-numeric:tabular-nums;font-size:15px;}
.cuadra .chev{color:var(--muted);}
.cuadra .badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em;}
.cuadra .badge-ocr{background:#E2F2E9;color:var(--saldo-deep);}
.cuadra .badge-manual{background:#F1EEE4;color:#7A6A33;}
.cuadra .exp-detail{padding:2px 16px 16px 66px;}
.cuadra .item-line{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:6px 0;border-bottom:1px dashed #EDEFEC;color:#33403A;}
.cuadra .tax-grid{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-top:10px;}
.cuadra .exp-photo img{width:100%;max-width:340px;border-radius:12px;margin-top:12px;border:1px solid var(--line);display:block;}

/* empty */
.cuadra .empty{padding:28px 18px;text-align:center;color:var(--muted);font-size:14px;line-height:1.5;}
.cuadra .empty .big{font-weight:600;color:#37463D;margin-bottom:4px;}

/* overlay / sheet */
.cuadra .overlay{position:fixed;inset:0;background:rgba(16,30,23,.5);backdrop-filter:blur(2px);display:flex;align-items:flex-end;justify-content:center;z-index:50;}
.cuadra .sheet{background:#fff;width:100%;max-width:480px;border-radius:22px 22px 0 0;max-height:93vh;overflow:auto;padding:20px 20px 26px;}
@media(min-width:560px){.cuadra .overlay{align-items:center;padding:18px;}.cuadra .sheet{border-radius:22px;}}
.cuadra .sheet-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;}
.cuadra .sheet-title{font-family:var(--disp);font-weight:700;font-size:19px;}

/* choose */
.cuadra .choose{display:grid;gap:12px;}
.cuadra .choose-btn{display:flex;gap:14px;align-items:center;padding:17px;border:1px solid var(--line);border-radius:16px;background:#fff;cursor:pointer;text-align:left;width:100%;transition:.15s;}
.cuadra .choose-btn:hover{border-color:var(--saldo);background:#FAFCFB;}
.cuadra .choose-ic{width:46px;height:46px;border-radius:13px;background:var(--paper);display:flex;align-items:center;justify-content:center;color:var(--saldo);flex-shrink:0;}
.cuadra .choose-t{font-weight:600;font-size:15px;display:block;}
.cuadra .choose-d{font-size:12.5px;color:var(--muted);display:block;margin-top:2px;}

/* reading */
.cuadra .reading{display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px 10px;text-align:center;}
.cuadra .reading img{width:150px;border-radius:12px;border:1px solid var(--line);}

/* forms */
.cuadra .field{margin-bottom:13px;}
.cuadra .label{display:block;font-size:12.5px;font-weight:600;color:#3A4A41;margin-bottom:6px;}
.cuadra .input{width:100%;font:inherit;font-size:15px;padding:12px 13px;border:1px solid var(--line);border-radius:11px;background:#FCFDFC;color:var(--ink);outline:none;transition:.12s;}
.cuadra .input:focus{border-color:var(--saldo);box-shadow:0 0 0 3px rgba(21,120,76,.12);}
.cuadra select.input{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%235E6E64' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:34px;}
.cuadra .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.cuadra .row3b{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
.cuadra .items-head{display:flex;justify-content:space-between;align-items:center;margin:8px 0 7px;}
.cuadra .item-edit{display:grid;grid-template-columns:1fr 54px 80px 32px;gap:6px;align-items:center;margin-bottom:6px;}
.cuadra .mini{padding:9px 9px;font-size:13px;}
.cuadra .linkbtn{background:none;border:0;color:var(--saldo);font:inherit;font-weight:600;font-size:13px;cursor:pointer;display:inline-flex;gap:5px;align-items:center;padding:4px;}
.cuadra .iconx{background:var(--paper);border:0;border-radius:9px;width:32px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--muted);}
.cuadra .iconx:hover{color:var(--danger);}
.cuadra .hint{font-size:12px;color:var(--muted);}
.cuadra .err{color:var(--danger);font-size:12.5px;margin-top:8px;display:flex;gap:6px;align-items:center;}
.cuadra .total-field{margin-top:6px;padding:14px;background:var(--paper);border-radius:13px;}
.cuadra .total-row{display:flex;gap:10px;align-items:center;}
.cuadra .total-input{font-family:var(--disp);font-weight:700;font-size:20px;background:#fff;}
.cuadra .form-photo img{width:100%;max-width:200px;border-radius:12px;border:1px solid var(--line);margin:0 auto 14px;display:block;}

/* banners */
.cuadra .banner-ok,.cuadra .banner-warn{display:flex;gap:8px;align-items:flex-start;font-size:13px;padding:11px 13px;border-radius:12px;margin-bottom:14px;line-height:1.4;}
.cuadra .banner-ok{background:#E6F3EC;color:var(--saldo-deep);}
.cuadra .banner-warn{background:#FBEEE9;color:#A23A22;}

/* toast */
.cuadra .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:12px 18px;border-radius:13px;font-size:14px;font-weight:500;z-index:60;display:flex;gap:9px;align-items:center;box-shadow:0 10px 34px rgba(0,0,0,.24);}

.cuadra .spin{animation:cuadra-spin 1s linear infinite;}
@keyframes cuadra-spin{to{transform:rotate(360deg);}}
.cuadra button:focus-visible,.cuadra .input:focus-visible{outline:2px solid var(--saldo);outline-offset:2px;}
@media(prefers-reduced-motion:reduce){.cuadra *{animation-duration:.001ms!important;transition-duration:.001ms!important;}}
`;
