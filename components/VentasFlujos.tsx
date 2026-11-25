"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2, Check, X, AlertTriangle, Camera, FileSpreadsheet, Plus, Trash2, LogOut, Banknote, CreditCard,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile, CorteCajaRow, FotoBancoRow } from "@/lib/types";

/* ============================================================
   Ventas y flujos — Fase 1: cierre de turno de Caja (alimenta el
   sistema, nunca lee dinero ni métricas). Fase 2: el Dueño sube
   fotos de la app bancaria, el OCR las lee solo, y se comparan
   contra lo que reportó Caja (Administrador ve igual, sin poder
   subir nada; Encargado de compra no tiene acceso). Vive aparte
   de CuadraApp.tsx por el mismo motivo que ListaCompra.tsx.
   ============================================================ */

const num = (x: unknown) => { const n = typeof x === "number" ? x : parseFloat(String(x)); return isNaN(n) ? 0 : n; };
const money = (n: unknown) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(num(n));
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/* ---------- imagen: igual al prototipo (escala a JPEG antes de subir) ---------- */
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
  const bin = atob(b64.split(",")[1] || b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: "image/jpeg" });
}

type Gasto = { id: string; monto: string; concepto: string; fotoB64: string | null };

export function CajaCaptura({ profile, bizId, onLogout }: { profile: Profile; bizId: string; onLogout: () => void }) {
  const sb = supabaseBrowser();
  const [loaded, setLoaded] = useState(false);
  const [cerrado, setCerrado] = useState(false);

  const [efectivo, setEfectivo] = useState("");
  const [tarjeta, setTarjeta] = useState("");
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [fotoSobre, setFotoSobre] = useState<string | null>(null);
  const [fotoExcel, setFotoExcel] = useState<string | null>(null);
  const [archivoVenta, setArchivoVenta] = useState<File | null>(null);

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const fotoRef = useRef<HTMLInputElement>(null);
  const fotoTargetRef = useRef<string | null>(null); // "sobre" | "pantalla" | id de gasto
  const excelRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const { data } = await sb.rpc("corte_cerrado_hoy", { p_fecha: todayISO() });
    setCerrado(!!data);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  function pedirFoto(target: string) {
    fotoTargetRef.current = target;
    fotoRef.current?.click();
  }

  async function onFotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const b64 = await fileToScaled(file, 1400, 0.82);
    const target = fotoTargetRef.current;
    if (target === "sobre") setFotoSobre(b64);
    else if (target === "pantalla") setFotoExcel(b64);
    else if (target) setGastos((prev) => prev.map((g) => (g.id === target ? { ...g, fotoB64: b64 } : g)));
  }

  function onExcelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setArchivoVenta(file);
  }

  function agregarGasto() {
    setGastos((prev) => [...prev, { id: crypto.randomUUID(), monto: "", concepto: "", fotoB64: null }]);
  }
  function quitarGasto(id: string) {
    setGastos((prev) => prev.filter((g) => g.id !== id));
  }
  function setGasto(id: string, campo: "monto" | "concepto", val: string) {
    setGastos((prev) => prev.map((g) => (g.id === id ? { ...g, [campo]: val } : g)));
  }

  async function cerrarTurno() {
    setErr("");
    if (efectivo === "" || num(efectivo) < 0) return setErr("Pon la venta en efectivo.");
    if (tarjeta === "" || num(tarjeta) < 0) return setErr("Pon la venta en tarjeta.");
    for (const g of gastos) {
      if (!g.monto || num(g.monto) <= 0) return setErr("Cada gasto necesita un monto.");
      if (!g.concepto.trim()) return setErr("Cada gasto necesita un concepto.");
      if (!g.fotoB64) return setErr("Cada gasto necesita su foto.");
    }
    if (!fotoSobre) return setErr("Falta la foto del sobre con el efectivo.");
    if (!fotoExcel) return setErr("Falta la foto de la pantalla del excel.");
    if (!archivoVenta) return setErr("Falta subir el excel con la venta del día.");

    setSaving(true);
    try {
      const hoy = todayISO();
      const mes = hoy.slice(0, 7);
      const subirFoto = async (b64: string, tag: string) => {
        const path = `${bizId}/${mes}/${hoy}_${tag}_${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from("caja-photos").upload(path, b64ToBlob(b64), { contentType: "image/jpeg" });
        if (error) throw new Error("No se pudo subir una foto. Revisa tu conexión.");
        return path;
      };

      const sobrePath = await subirFoto(fotoSobre, "sobre");
      const pantallaPath = await subirFoto(fotoExcel, "pantalla");

      const ext = archivoVenta.name.includes(".") ? archivoVenta.name.split(".").pop() : "xlsx";
      const excelPath = `${bizId}/${mes}/${hoy}_venta_${crypto.randomUUID()}.${ext}`;
      const { error: excelErr } = await sb.storage.from("documents").upload(excelPath, archivoVenta, {
        contentType: archivoVenta.type || "application/octet-stream",
      });
      if (excelErr) throw new Error("No se pudo subir el excel. Revisa tu conexión.");

      const gastosConFoto = await Promise.all(
        gastos.map(async (g) => ({
          monto: num(g.monto),
          concepto: g.concepto.trim(),
          foto_path: await subirFoto(g.fotoB64!, "gasto"),
        }))
      );

      const res = await fetch("/api/cortes-caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: hoy,
          venta_efectivo: num(efectivo),
          venta_tarjeta: num(tarjeta),
          foto_sobre_path: sobrePath,
          foto_excel_path: pantallaPath,
          excel_venta_path: excelPath,
          gastos: gastosConFoto,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo cerrar el turno.");
      setCerrado(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cerrar el turno.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cuadra" style={{ minHeight: "100vh" }}>
      <div className="wrap">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">$</div>
            <div><div className="brand-name">Vertify</div><div className="brand-sub">Caja</div></div>
          </div>
          <div className="topbar-right">
            <div className="rolechip"><Banknote size={15} />Caja</div>
            <button className="iconbtn" title="Cerrar sesión" onClick={onLogout}><LogOut size={17} /></button>
          </div>
        </header>

        <input ref={fotoRef} type="file" accept="image/*" hidden onChange={onFotoFile} />
        <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onExcelFile} />

        {!loaded ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 className="spin" size={22} /></div>
        ) : cerrado ? (
          <div className="card" style={{ marginTop: 40, padding: "36px 20px", textAlign: "center" }}>
            <Check size={30} style={{ opacity: 0.6, marginBottom: 10, color: "var(--saldo)" }} />
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Gracias por su información</div>
            <div className="hint">Turno cerrado</div>
          </div>
        ) : (
          <>
            <div className="section-title" style={{ marginTop: 18 }}><span>Cierre de turno</span><span className="muted">{todayISO()}</span></div>

            <div className="card" style={{ padding: 16 }}>
              <div className="row2">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label">Venta en efectivo</label>
                  <input className="input" value={efectivo} onChange={(e) => setEfectivo(e.target.value)} inputMode="decimal" placeholder="0.00" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label">Venta en tarjeta</label>
                  <input className="input" value={tarjeta} onChange={(e) => setTarjeta(e.target.value)} inputMode="decimal" placeholder="0.00" />
                </div>
              </div>
            </div>

            <div className="items-head" style={{ marginTop: 18 }}>
              <div className="section-title" style={{ margin: 0 }}><span>Gastos de caja</span></div>
              <button className="linkbtn" onClick={agregarGasto}><Plus size={14} />Agregar gasto</button>
            </div>
            {gastos.length === 0 ? (
              <div className="hint" style={{ padding: "4px 4px 10px" }}>Si no sacaste dinero de caja, deja esto vacío.</div>
            ) : (
              <div className="card" style={{ padding: "6px 16px" }}>
                {gastos.map((g) => (
                  <div key={g.id} style={{ padding: "12px 0", borderTop: "1px solid #EFF3EE" }}>
                    <div className="row2">
                      <div><div className="minilabel">Monto</div><input className="input mini" value={g.monto} onChange={(e) => setGasto(g.id, "monto", e.target.value)} inputMode="decimal" placeholder="0.00" /></div>
                      <div><div className="minilabel">Concepto</div><input className="input mini" value={g.concepto} onChange={(e) => setGasto(g.id, "concepto", e.target.value)} placeholder="¿En qué se gastó?" /></div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                      {g.fotoB64 ? (
                        <img src={g.fotoB64} alt="" style={{ width: 42, height: 42, borderRadius: 9, objectFit: "cover" }} />
                      ) : (
                        <button className="linkbtn" onClick={() => pedirFoto(g.id)}><Camera size={14} />Foto del ticket</button>
                      )}
                      {g.fotoB64 && <button className="linkbtn" onClick={() => pedirFoto(g.id)}>Cambiar foto</button>}
                      <button className="iconx" style={{ marginLeft: "auto" }} onClick={() => quitarGasto(g.id)}><Trash2 size={15} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="section-title" style={{ marginTop: 18 }}><span>Comprobantes obligatorios</span></div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #EFF3EE" }}>
                {fotoSobre ? <img src={fotoSobre} alt="" style={{ width: 46, height: 46, borderRadius: 10, objectFit: "cover" }} /> : <div className="exp-ic"><Camera size={18} /></div>}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Foto del sobre con el efectivo</div>
                  <button className="linkbtn" onClick={() => pedirFoto("sobre")}>{fotoSobre ? "Cambiar foto" : "Tomar foto"}</button>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #EFF3EE" }}>
                {fotoExcel ? <img src={fotoExcel} alt="" style={{ width: 46, height: 46, borderRadius: 10, objectFit: "cover" }} /> : <div className="exp-ic"><Camera size={18} /></div>}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Foto de la pantalla del excel</div>
                  <button className="linkbtn" onClick={() => pedirFoto("pantalla")}>{fotoExcel ? "Cambiar foto" : "Tomar foto"}</button>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0 8px" }}>
                <div className="exp-ic"><FileSpreadsheet size={18} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Excel con la venta del día</div>
                  {archivoVenta && <div className="hint">{archivoVenta.name}</div>}
                  <button className="linkbtn" onClick={() => excelRef.current?.click()}>{archivoVenta ? "Cambiar archivo" : "Subir excel"}</button>
                </div>
              </div>
            </div>

            {err && <div className="err" style={{ marginTop: 12 }}><AlertTriangle size={14} />{err}</div>}

            <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 18, marginBottom: 10 }} onClick={cerrarTurno} disabled={saving}>
              {saving ? <Loader2 className="spin" size={18} /> : <CreditCard size={18} />}Cerrar turno
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Módulo Ventas y flujos — Fase 2: validación con el banco.
   Dueño sube, Administrador solo ve (sin controles de subida).
   ============================================================ */
export function VentasFlujosModule({ profile, bizId, flash }: { profile: Profile; bizId: string; flash: (msg: string) => void }) {
  const sb = supabaseBrowser();
  const isOwner = profile.role === "owner";

  const [loaded, setLoaded] = useState(false);
  const [corte, setCorte] = useState<CorteCajaRow | null>(null);
  const [fotos, setFotos] = useState<FotoBancoRow[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const fotoRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const hoy = todayISO();
    const [{ data: c }, { data: f }] = await Promise.all([
      sb.from("cortes_caja").select("*").eq("fecha", hoy).maybeSingle(),
      sb.from("fotos_banco").select("*").eq("fecha", hoy).order("created_at", { ascending: false }),
    ]);
    setCorte((c as CorteCajaRow) || null);
    setFotos((f as FotoBancoRow[]) || []);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onFotoBanco(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSubiendo(true);
    try {
      const b64Full = await fileToScaled(file, 1400, 0.85);
      const b64 = b64Full.split(",")[1] || b64Full;

      let ocrRes: Response;
      try {
        ocrRes = await fetch("/api/leer-foto-banco", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: b64 }),
          signal: AbortSignal.timeout(45000),
        });
      } catch {
        throw new Error("El banco está tardando en leer la foto. Intenta de nuevo en un momento.");
      }
      const ocrData = await ocrRes.json().catch(() => ({}));
      if (!ocrRes.ok) throw new Error(ocrData.error === "ilegible" ? "No se pudo leer la foto. Intenta con otra." : "No se pudo leer la foto.");
      if (!ocrData.monto || !ocrData.concepto) throw new Error("No se pudo leer un monto o concepto válido en la foto.");

      const hoy = todayISO();
      const path = `${bizId}/${hoy.slice(0, 7)}/${hoy}_banco_${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await sb.storage.from("banco-photos").upload(path, b64ToBlob(b64Full), { contentType: "image/jpeg" });
      if (upErr) throw new Error("No se pudo subir la foto. Revisa tu conexión.");

      const saveRes = await fetch("/api/fotos-banco", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha: hoy, foto_path: path, monto: ocrData.monto, concepto: ocrData.concepto }),
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saveData.error || "No se pudo guardar.");

      setFotos((prev) => [saveData.row as FotoBancoRow, ...prev]);
      flash(saveData.row.coincide ? "Coincide con lo que reportó Caja" : "No coincide con lo que reportó Caja");
    } catch (err) {
      flash(err instanceof Error ? err.message : "No se pudo procesar la foto.");
    } finally {
      setSubiendo(false);
    }
  }

  if (!loaded) return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 className="spin" size={22} /></div>;

  return (
    <div>
      <div className="section-title" style={{ marginTop: 18 }}><span>Ventas y flujos</span><span className="muted">hoy</span></div>

      <div className="sumgrid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="sumcard"><div className="k">Caja reportó efectivo</div><div className="v">{corte ? money(corte.venta_efectivo) : "—"}</div></div>
        <div className="sumcard"><div className="k">Caja reportó tarjeta</div><div className="v">{corte ? money(corte.venta_tarjeta) : "—"}</div></div>
      </div>

      {isOwner && (
        <>
          <input ref={fotoRef} type="file" accept="image/*" hidden onChange={onFotoBanco} />
          <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={() => fotoRef.current?.click()} disabled={subiendo}>
            {subiendo ? <Loader2 className="spin" size={16} /> : <Camera size={16} />}Subir foto del banco
          </button>
          {subiendo && <div className="hint" style={{ marginTop: 6, textAlign: "center" }}>Leyendo la foto, puede tardar hasta 45 segundos…</div>}
        </>
      )}

      <div className="section-title" style={{ marginTop: 18 }}><span>Validación con el banco</span></div>
      {!corte ? (
        <div className="card"><div className="empty"><div className="big">Caja todavía no cierra turno hoy</div>En cuanto cierre turno vas a poder comparar las fotos del banco contra lo que reportó.</div></div>
      ) : fotos.length === 0 ? (
        <div className="card"><div className="empty"><div className="big">Todavía no hay fotos del banco hoy</div>{isOwner ? "Sube la primera arriba." : "El dueño todavía no sube ninguna."}</div></div>
      ) : (
        <div className="card">
          {fotos.map((f) => (
            <div key={f.id} style={{ padding: "12px 16px", borderTop: "1px solid #EFF3EE", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{money(f.monto)} <span className="hint" style={{ fontWeight: 500 }}>· {f.concepto === "efectivo" ? "Efectivo" : "Tarjeta"}</span></div>
              {f.coincide ? <Check size={20} style={{ color: "var(--saldo)", flexShrink: 0 }} /> : <X size={20} style={{ color: "var(--danger)", flexShrink: 0 }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
