"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, Check, X, AlertTriangle, Download, RefreshCw,
  Send, ShoppingCart, Tag, PackageX, LogOut,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile, InsumoChef, ListaCompraItemRow, ListaCompraItemStatus, SolicitudRow } from "@/lib/types";

/* ============================================================
   Lista Compra — catálogo de insumos, captura diaria del Chef,
   checklist de Rubén, y solicitudes (precio / compra) con
   aprobación del dueño. Vive aparte de CuadraApp.tsx porque ya
   estaba muy grande.
   ============================================================ */

const num = (x: unknown) => { const n = typeof x === "number" ? x : parseFloat(String(x)); return isNaN(n) ? 0 : n; };
const money = (n: unknown) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(num(n));
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const yesterdayISO = () => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function csvCell(v: unknown) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

/* ---------- sheet/modal (copia local: evita un import circular con CuadraApp.tsx) ---------- */
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

/* ============================================================
   Pantalla del Chef: captura diaria, exportar, avisos
   ============================================================ */
export function ChefCaptura({ profile, bizId, onLogout }: { profile: Profile; bizId: string; onLogout: () => void }) {
  const sb = supabaseBrowser();
  const [loaded, setLoaded] = useState(false);
  const [insumos, setInsumos] = useState<InsumoChef[]>([]);
  const [listaId, setListaId] = useState<string | null>(null);
  const [valores, setValores] = useState<Record<string, { requerido: string; existencia: string }>>({});
  const [estados, setEstados] = useState<Record<string, ListaCompraItemStatus>>({});
  const [pedidosAyer, setPedidosAyer] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const load = useCallback(async () => {
    const hoy = todayISO();
    const [{ data: ins }, { data: lista }, { data: ayer }] = await Promise.all([
      sb.rpc("insumos_para_chef"),
      sb.from("listas_compra").select("id").eq("chef_id", profile.id).eq("fecha", hoy).maybeSingle(),
      sb.from("lista_compra_items").select("insumo_id, requerido").eq("fecha", yesterdayISO()),
    ]);
    setInsumos(((ins as InsumoChef[]) || []).slice().sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre)));
    setPedidosAyer(new Set((ayer || []).filter((it: { insumo_id: string; requerido: number }) => it.requerido > 0).map((it: { insumo_id: string }) => it.insumo_id)));

    if (lista) {
      setListaId(lista.id);
      const { data: items } = await sb.from("lista_compra_items").select("*").eq("lista_id", lista.id);
      const v: typeof valores = {};
      const st: typeof estados = {};
      ((items as ListaCompraItemRow[]) || []).forEach((it) => {
        v[it.insumo_id] = { requerido: it.requerido ? String(it.requerido) : "", existencia: it.existencia ? String(it.existencia) : "" };
        st[it.insumo_id] = it.status;
      });
      setValores(v);
      setEstados(st);
    } else {
      setListaId(null);
      setValores({});
      setEstados({});
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  useEffect(() => { load(); }, [load]);

  const grupos = useMemo(() => {
    const q = normalize(search.trim());
    const filtrados = q ? insumos.filter((i) => normalize(i.nombre).includes(q)) : insumos;
    const g: Record<string, InsumoChef[]> = {};
    filtrados.forEach((i) => { (g[i.categoria] = g[i.categoria] || []).push(i); });
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  }, [insumos, search]);

  const rechazados = insumos.filter((i) => estados[i.id] === "rechazado");

  function setVal(insumoId: string, campo: "requerido" | "existencia", val: string) {
    setValores((prev) => ({ ...prev, [insumoId]: { requerido: prev[insumoId]?.requerido || "", existencia: prev[insumoId]?.existencia || "", [campo]: val } }));
  }

  async function guardar() {
    setSaving(true);
    const hoy = todayISO();
    let lid = listaId;
    if (!lid) {
      const { data, error } = await sb
        .from("listas_compra")
        .upsert({ business_id: bizId, chef_id: profile.id, fecha: hoy }, { onConflict: "business_id,chef_id,fecha" })
        .select()
        .single();
      if (error || !data) { flash("No se pudo guardar. Revisa tu conexión."); setSaving(false); return; }
      lid = data.id;
      setListaId(lid);
    }
    const rows = Object.entries(valores)
      .filter(([, v]) => num(v.requerido) > 0 || num(v.existencia) > 0)
      .map(([insumoId, v]) => {
        const insumo = insumos.find((i) => i.id === insumoId);
        if (!insumo) return null;
        return {
          business_id: bizId, lista_id: lid, insumo_id: insumoId,
          nombre: insumo.nombre, categoria: insumo.categoria, unidad: insumo.unidad, fecha: hoy,
          requerido: num(v.requerido), existencia: num(v.existencia),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) { flash("Pon al menos un producto."); setSaving(false); return; }
    const { error } = await sb.from("lista_compra_items").upsert(rows, { onConflict: "lista_id,insumo_id" });
    setSaving(false);
    if (error) { flash("No se pudo guardar. Revisa tu conexión."); return; }
    flash("Pedido guardado");
    await load();
  }

  function descargarCSV() {
    const header = ["Categoría", "Insumo", "Unidad", "Requerido", "Existencia"];
    const lines = [header.join(",")];
    grupos.forEach(([, items]) => items.forEach((i) => {
      const v = valores[i.id];
      if (!v || (!v.requerido && !v.existencia)) return;
      lines.push([i.categoria, i.nombre, i.unidad, v.requerido || "0", v.existencia || "0"].map(csvCell).join(","));
    }));
    if (lines.length === 1) { flash("Todavía no hay nada que descargar."); return; }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `lista-compra-${todayISO()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  const confirmados = insumos.filter((i) => estados[i.id] === "confirmado").length;

  // Fase 2: avisos automáticos — no bloquean nada, solo informan.
  function alertasDe(i: InsumoChef, v: { requerido: string; existencia: string }) {
    const exceso = i.nivel_max != null && num(v.existencia) + num(v.requerido) > i.nivel_max;
    const repetido = pedidosAyer.has(i.id) && num(v.requerido) > 0;
    return { exceso, repetido };
  }
  const totalExceso = insumos.filter((i) => alertasDe(i, valores[i.id] || { requerido: "", existencia: "" }).exceso).length;
  const totalRepetido = insumos.filter((i) => alertasDe(i, valores[i.id] || { requerido: "", existencia: "" }).repetido).length;

  return (
    <div className="cuadra" style={{ minHeight: "100vh" }}>
      <div className="wrap">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">$</div>
            <div><div className="brand-name">Vertify</div><div className="brand-sub">Chef</div></div>
          </div>
          <div className="topbar-right">
            <div className="rolechip">👨‍🍳 Chef</div>
            <button className="iconbtn" title="Cerrar sesión" onClick={onLogout}><LogOut size={17} /></button>
          </div>
        </header>

        {!loaded ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 className="spin" size={22} /></div>
        ) : (
          <>
            {rechazados.length > 0 && (
              <div className="banner-warn" style={{ marginTop: 10 }}>
                <AlertTriangle size={15} />
                No se van a comprar hoy: {rechazados.map((r) => r.nombre).join(", ")}
              </div>
            )}

            <div className="owner-bar" style={{ marginTop: 16 }}>
              <div className="hint">{listaId ? `${confirmados} de ${Object.keys(valores).length} ya comprados` : "Todavía no has mandado tu pedido de hoy"}</div>
              <button className="btn btn-ghost mini-btn" onClick={() => load()}><RefreshCw size={14} />Actualizar</button>
            </div>

            {(totalExceso > 0 || totalRepetido > 0) && (
              <div className="hint" style={{ marginTop: 6 }}>
                {totalExceso > 0 && `⚠ ${totalExceso} con posible exceso`}
                {totalExceso > 0 && totalRepetido > 0 && " · "}
                {totalRepetido > 0 && `↻ ${totalRepetido} repetido${totalRepetido > 1 ? "s" : ""} de ayer`}
              </div>
            )}

            <div className="field" style={{ marginTop: 10 }}>
              <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar insumo…" />
            </div>

            {grupos.map(([cat, items]) => (
              <div key={cat}>
                <div className="section-title"><span>{cat}</span></div>
                <div className="card" style={{ padding: "6px 16px" }}>
                  {items.map((i) => {
                    const v = valores[i.id] || { requerido: "", existencia: "" };
                    const estado = estados[i.id];
                    const { exceso, repetido } = alertasDe(i, v);
                    return (
                      <div key={i.id} style={{ padding: "10px 0", borderTop: "1px solid #EFF3EE" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{i.nombre} <span className="hint">({i.unidad})</span></div>
                          {estado === "confirmado" && <span className="badge badge-ocr">Comprado</span>}
                          {estado === "rechazado" && <span className="badge badge-manual">No se compra</span>}
                        </div>
                        <div className="row3b" style={{ marginTop: 6 }}>
                          <div><div className="minilabel">Requerido</div><input className="input mini" value={v.requerido} onChange={(e) => setVal(i.id, "requerido", e.target.value)} inputMode="decimal" placeholder="0" /></div>
                          <div><div className="minilabel">Existencia</div><input className="input mini" value={v.existencia} onChange={(e) => setVal(i.id, "existencia", e.target.value)} inputMode="decimal" placeholder="0" /></div>
                        </div>
                        {(exceso || repetido) && (
                          <div className="hint" style={{ marginTop: 5, color: "var(--amber)" }}>
                            {exceso && "⚠ posible exceso (más del máximo normal)"}
                            {exceso && repetido && " · "}
                            {repetido && "↻ también se pidió ayer"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="row2" style={{ marginTop: 18, marginBottom: 10 }}>
              <button className="btn btn-ghost btn-block" onClick={descargarCSV}><Download size={16} />Descargar Excel</button>
              <button className="btn btn-primary btn-block" onClick={guardar} disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <Check size={17} />}Guardar pedido</button>
            </div>
          </>
        )}

        {toast && <div className="toast"><Check size={16} />{toast}</div>}
      </div>
    </div>
  );
}

/* ============================================================
   Módulo Lista Compra — Dueño / Administrador / Encargado
   ============================================================ */
export function ListaCompraModule({ bizId, profile, flash }: { bizId: string; profile: Profile; flash: (msg: string) => void }) {
  const sb = supabaseBrowser();
  const isOwner = profile.role === "owner";
  const isRunner = profile.role === "runner";

  const [loaded, setLoaded] = useState(false);
  const [precios, setPrecios] = useState<Record<string, { nombre: string; precio: number | null; nivel_max: number | null }>>({});
  const [items, setItems] = useState<ListaCompraItemRow[]>([]);
  const [pedidosAyer, setPedidosAyer] = useState<Set<string>>(new Set());
  const [solicitudes, setSolicitudes] = useState<SolicitudRow[]>([]);
  const [sheet, setSheet] = useState<{ kind: "compra" | "precio"; item: ListaCompraItemRow } | null>(null);
  const [editPrecio, setEditPrecio] = useState<{ insumoId: string; nombre: string; precio: number | null } | null>(null);

  const load = useCallback(async () => {
    const hoy = todayISO();
    const [insRes, itemsRes, ayerRes, solRes] = await Promise.all([
      sb.from("insumos").select("id, nombre, precio, nivel_max"),
      sb.from("lista_compra_items").select("*").eq("fecha", hoy),
      sb.from("lista_compra_items").select("insumo_id, requerido").eq("fecha", yesterdayISO()),
      isOwner || isRunner ? sb.from("solicitudes").select("*").order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
    const map: Record<string, { nombre: string; precio: number | null; nivel_max: number | null }> = {};
    (insRes.data || []).forEach((i: { id: string; nombre: string; precio: number | null; nivel_max: number | null }) => { map[i.id] = { nombre: i.nombre, precio: i.precio, nivel_max: i.nivel_max }; });
    setPrecios(map);
    setItems((((itemsRes.data as ListaCompraItemRow[]) || [])).sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre)));
    setPedidosAyer(new Set((ayerRes.data || []).filter((it: { insumo_id: string; requerido: number }) => it.requerido > 0).map((it: { insumo_id: string }) => it.insumo_id)));
    setSolicitudes((solRes.data as SolicitudRow[]) || []);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!loaded) return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 className="spin" size={22} /></div>;

  const vigentes = items.filter((i) => i.status !== "rechazado");
  const totalDinero = vigentes.reduce((s, it) => { const p = precios[it.insumo_id]?.precio; return p ? s + p * it.requerido : s; }, 0);
  const sinPrecio = vigentes.filter((it) => precios[it.insumo_id]?.precio == null).length;

  // Fase 2: avisos automáticos — no bloquean nada, solo informan.
  function alertasDe(it: ListaCompraItemRow) {
    const nivelMax = precios[it.insumo_id]?.nivel_max;
    const exceso = nivelMax != null && it.existencia + it.requerido > nivelMax;
    const repetido = pedidosAyer.has(it.insumo_id);
    return { exceso, repetido };
  }
  const totalExceso = vigentes.filter((it) => alertasDe(it).exceso).length;
  const totalRepetido = vigentes.filter((it) => alertasDe(it).repetido).length;

  async function palomear(item: ListaCompraItemRow) {
    const { error } = await sb.from("lista_compra_items").update({ status: "confirmado", confirmado_por: profile.id, confirmado_at: new Date().toISOString() }).eq("id", item.id);
    if (error) { flash("No se pudo marcar."); return; }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "confirmado" } : i)));
    flash("Marcado como comprado");
  }

  const pendientes = solicitudes.filter((s) => s.status === "pendiente");
  const historial = solicitudes.filter((s) => s.status !== "pendiente");

  return (
    <div>
      <div className="section-title" style={{ marginTop: 18 }}><span>Lista Compra</span><span className="muted">hoy</span></div>

      <div className="sumgrid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="sumcard">
          <div className="k">Representa</div>
          <div className="v">{money(totalDinero)}</div>
          {sinPrecio > 0 && <div className="s">{sinPrecio} sin precio todavía</div>}
        </div>
        <div className="sumcard"><div className="k">Insumos pedidos</div><div className="v">{vigentes.length}</div></div>
      </div>

      {(totalExceso > 0 || totalRepetido > 0) && (
        <div className="hint" style={{ marginTop: 8 }}>
          {totalExceso > 0 && `⚠ ${totalExceso} con posible exceso`}
          {totalExceso > 0 && totalRepetido > 0 && " · "}
          {totalRepetido > 0 && `↻ ${totalRepetido} repetido${totalRepetido > 1 ? "s" : ""} de ayer`}
        </div>
      )}

      {items.length === 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="empty"><div className="big">Todavía no hay lista de hoy</div>En cuanto el Chef suba su pedido, aparece aquí.</div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 14 }}>
          {items.map((it) => (
            <ListaItemRow
              key={it.id}
              item={it}
              precio={precios[it.insumo_id]?.precio ?? null}
              alertas={alertasDe(it)}
              isRunner={isRunner}
              isOwner={isOwner}
              onPalomear={() => palomear(it)}
              onSolicitarCompra={() => setSheet({ kind: "compra", item: it })}
              onSolicitarPrecio={() => setSheet({ kind: "precio", item: it })}
              onEditarPrecio={() => setEditPrecio({ insumoId: it.insumo_id, nombre: it.nombre, precio: precios[it.insumo_id]?.precio ?? null })}
            />
          ))}
        </div>
      )}

      {isOwner && pendientes.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}><span>Solicitudes pendientes</span><span className="muted">{pendientes.length}</span></div>
          <div className="card">
            {pendientes.map((s) => (
              <SolicitudPendienteRow
                key={s.id}
                s={s}
                flash={flash}
                onResolved={(id, aprobada) => {
                  setSolicitudes((prev) => prev.map((x) => (x.id === id ? { ...x, status: aprobada ? "aprobada" : "declinada" } : x)));
                  if (aprobada) load(); // puede haber cambiado un precio o el status de un item
                }}
              />
            ))}
          </div>
        </>
      )}

      {(isOwner || isRunner) && historial.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}><span>Historial de solicitudes</span></div>
          <div className="card">
            {historial.map((s) => (
              <div key={s.id} style={{ padding: "10px 16px", borderTop: "1px solid #EFF3EE" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.insumo_nombre}</div>
                  <span className={`badge ${s.status === "aprobada" ? "badge-ocr" : "badge-manual"}`}>{s.status === "aprobada" ? "Aprobada" : "Declinada"}</span>
                </div>
                <div className="hint">
                  {s.tipo === "precio"
                    ? `Precio propuesto ${money(s.precio_propuesto)}`
                    : `Pidió quitarlo de la lista${s.monto != null ? ` · se ahorró ${money(s.monto)}` : ""}`}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {sheet?.kind === "compra" && (
        <Sheet title="Pedir quitar de la lista" onClose={() => setSheet(null)}>
          <SolicitarCompraForm
            item={sheet.item}
            precio={precios[sheet.item.insumo_id]?.precio ?? null}
            onDone={() => { setSheet(null); flash("Solicitud enviada"); load(); }}
            onCancel={() => setSheet(null)}
          />
        </Sheet>
      )}
      {sheet?.kind === "precio" && (
        <Sheet title="Proponer precio" onClose={() => setSheet(null)}>
          <SolicitarPrecioForm item={sheet.item} precioActual={precios[sheet.item.insumo_id]?.precio ?? null} onDone={() => { setSheet(null); flash("Solicitud enviada"); load(); }} onCancel={() => setSheet(null)} />
        </Sheet>
      )}
      {editPrecio && (
        <Sheet title="Cambiar precio" onClose={() => setEditPrecio(null)}>
          <EditarPrecioForm insumoId={editPrecio.insumoId} nombre={editPrecio.nombre} precioActual={editPrecio.precio} onDone={() => { setEditPrecio(null); flash("Precio actualizado"); load(); }} onCancel={() => setEditPrecio(null)} />
        </Sheet>
      )}
    </div>
  );
}

function ListaItemRow({ item, precio, alertas, isRunner, isOwner, onPalomear, onSolicitarCompra, onSolicitarPrecio, onEditarPrecio }: {
  item: ListaCompraItemRow; precio: number | null; alertas: { exceso: boolean; repetido: boolean }; isRunner: boolean; isOwner: boolean;
  onPalomear: () => void; onSolicitarCompra: () => void; onSolicitarPrecio: () => void; onEditarPrecio: () => void;
}) {
  const subtotal = precio != null ? precio * item.requerido : null;
  return (
    <div className="exp-wrap">
      <div className="exp" style={{ cursor: "default" }}>
        <div className="exp-ic"><ShoppingCart size={18} /></div>
        <div className="exp-main">
          <div className="exp-store">{item.nombre}</div>
          <div className="exp-meta">
            <span>{item.requerido} {item.unidad} pedido</span>
            <span>existencia {item.existencia}</span>
            {item.status === "confirmado" && <span className="badge badge-ocr">Comprado</span>}
            {item.status === "rechazado" && <span className="badge badge-manual">No se compra</span>}
          </div>
          {(alertas.exceso || alertas.repetido) && (
            <div className="hint" style={{ marginTop: 3, color: "var(--amber)" }}>
              {alertas.exceso && "⚠ posible exceso"}
              {alertas.exceso && alertas.repetido && " · "}
              {alertas.repetido && "↻ también se pidió ayer"}
            </div>
          )}
        </div>
        <div className="exp-right">
          <div className="exp-amt">{subtotal != null ? money(subtotal) : "sin precio"}</div>
        </div>
      </div>
      {item.status === "pendiente" && (isRunner || isOwner) && (
        <div style={{ display: "flex", gap: 10, padding: "0 16px 12px", flexWrap: "wrap" }}>
          {isRunner && <button className="linkbtn" onClick={onPalomear}><Check size={14} />Marcar comprado</button>}
          {isRunner && <button className="linkbtn" onClick={onSolicitarCompra}><PackageX size={14} />Pedir quitar</button>}
          {isRunner && <button className="linkbtn" onClick={onSolicitarPrecio}><Tag size={14} />Proponer precio</button>}
          {isOwner && <button className="linkbtn" onClick={onEditarPrecio}><Tag size={14} />Cambiar precio</button>}
        </div>
      )}
    </div>
  );
}

function SolicitarCompraForm({ item, precio, onDone, onCancel }: {
  item: ListaCompraItemRow; precio: number | null; onDone: () => void; onCancel: () => void;
}) {
  const monto = precio != null ? precio * item.requerido : null;
  const [nota, setNota] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setErr(""); setSaving(true);
    try {
      const res = await fetch("/api/solicitudes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "compra", insumo_id: item.insumo_id, lista_compra_item_id: item.id, nota }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "No se pudo mandar la solicitud."); setSaving(false); return; }
      onDone();
    } catch {
      setErr("No se pudo mandar. Revisa tu conexión.");
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="hint" style={{ fontSize: 14, marginBottom: 14 }}>
        Le vas a pedir al dueño que <b>no se compre {item.nombre}</b> hoy
        ({item.requerido} {item.unidad}
        {monto != null ? <> · representa <b>{money(monto)}</b></> : " · este insumo todavía no tiene precio"}).
        Si lo aprueba, no se gasta ese dinero.
      </p>
      <div className="field"><label className="label">Nota (opcional)</label><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ya hay suficiente en almacén…" /></div>
      {err && <div className="err"><AlertTriangle size={14} />{err}</div>}
      <div className="row2" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost btn-block" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Send size={16} />}Mandar solicitud</button>
      </div>
    </div>
  );
}

function SolicitarPrecioForm({ item, precioActual, onDone, onCancel }: {
  item: ListaCompraItemRow; precioActual: number | null; onDone: () => void; onCancel: () => void;
}) {
  const [precio, setPrecio] = useState("");
  const [nota, setNota] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (num(precio) <= 0) return setErr("Pon un precio válido.");
    setErr(""); setSaving(true);
    try {
      const res = await fetch("/api/solicitudes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "precio", insumo_id: item.insumo_id, precio_propuesto: num(precio), nota }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "No se pudo mandar la solicitud."); setSaving(false); return; }
      onDone();
    } catch {
      setErr("No se pudo mandar. Revisa tu conexión.");
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="hint" style={{ fontSize: 14, marginBottom: 14 }}>
        {item.nombre} — precio actual: {precioActual != null ? money(precioActual) : "sin precio"}
      </p>
      <div className="field"><label className="label">Precio propuesto</label><input className="input" value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder="0.00" /></div>
      <div className="field"><label className="label">Nota (opcional)</label><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Subió de precio en la tienda…" /></div>
      {err && <div className="err"><AlertTriangle size={14} />{err}</div>}
      <div className="row2" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost btn-block" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Send size={16} />}Mandar solicitud</button>
      </div>
    </div>
  );
}

function EditarPrecioForm({ insumoId, nombre, precioActual, onDone, onCancel }: {
  insumoId: string; nombre: string; precioActual: number | null; onDone: () => void; onCancel: () => void;
}) {
  const [precio, setPrecio] = useState(precioActual != null ? String(precioActual) : "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (num(precio) <= 0) return setErr("Pon un precio válido.");
    setErr(""); setSaving(true);
    try {
      const res = await fetch("/api/insumos/precio", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insumo_id: insumoId, precio: num(precio) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "No se pudo cambiar el precio."); setSaving(false); return; }
      onDone();
    } catch {
      setErr("No se pudo cambiar. Revisa tu conexión.");
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="hint" style={{ fontSize: 14, marginBottom: 14 }}>{nombre}</p>
      <div className="field"><label className="label">Precio nuevo</label><input className="input" value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder="0.00" /></div>
      {err && <div className="err"><AlertTriangle size={14} />{err}</div>}
      <div className="row2" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost btn-block" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Guardar</button>
      </div>
    </div>
  );
}

function SolicitudPendienteRow({ s, flash, onResolved }: {
  s: SolicitudRow; flash: (msg: string) => void; onResolved: (id: string, aprobada: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function resolver(aprobar: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/solicitudes/resolver", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solicitud_id: s.id, aprobar }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { flash(data.error || "No se pudo resolver."); setBusy(false); return; }
      onResolved(s.id, aprobar);
      flash(aprobar ? "Solicitud aprobada" : "Solicitud declinada");
    } catch {
      flash("No se pudo resolver. Revisa tu conexión.");
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid #EFF3EE" }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.insumo_nombre}</div>
      <div className="hint">
        {s.tipo === "precio"
          ? `Precio propuesto: ${money(s.precio_propuesto)} (antes ${s.precio_actual != null ? money(s.precio_actual) : "sin precio"})`
          : `Pide quitarlo de la lista de hoy (está en exceso)${s.monto != null ? ` · representa ${money(s.monto)}` : ""}`}
      </div>
      {s.nota && <div className="hint">&quot;{s.nota}&quot;</div>}
      <div className="row2" style={{ marginTop: 8 }}>
        <button className="btn btn-ghost btn-block" onClick={() => resolver(false)} disabled={busy}><X size={15} />Declinar</button>
        <button className="btn btn-primary btn-block" onClick={() => resolver(true)} disabled={busy}><Check size={15} />Aceptar</button>
      </div>
    </div>
  );
}
