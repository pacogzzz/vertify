export type Role = "owner" | "runner" | "chef" | "admin" | "caja";

export interface Business {
  id: string;
  name: string;
  daily_float: number;
  low_cash_threshold: number;
  low_cash_alerted: boolean;
}

export interface Profile {
  id: string;
  business_id: string;
  name: string;
  role: Role;
  /** Solo colaboradores (no el dueño): el usuario con el que entran, sin correo real. */
  username?: string | null;
}

export interface ExpenseItem {
  name: string;
  qty: number;
  price: number;
}

/** Fila de la tabla expenses tal como viene de Supabase */
export interface ExpenseRow {
  id: string;
  business_id: string;
  runner_id: string;
  store: string;
  category: string | null;
  concept: string | null;
  payment_method: "efectivo" | "tarjeta";
  subtotal: number;
  iva: number;
  ieps: number;
  total: number;
  items: ExpenseItem[];
  source: "ocr" | "manual";
  photo_path: string | null;
  spent_at: string; // YYYY-MM-DD
  created_at: string;
}

export interface FundingRow {
  id: string;
  business_id: string;
  runner_id: string | null;
  amount: number;
  note: string | null;
  photo_path: string | null;
  created_at: string;
}

/** Respuesta del OCR (misma forma que el prototipo) */
export interface ReceiptData {
  store?: string;
  dateISO?: string | null;
  subtotal?: number;
  iva?: number;
  ieps?: number;
  total?: number;
  items?: { name?: string; qty?: number; price?: number }[];
  error?: string;
}

/* ---------- Lista Compra ---------- */

/** Catálogo de insumos. El Chef nunca lee esto directo (trae precio); usa
 *  la función insumos_para_chef() del servidor, que nunca manda el precio. */
export interface InsumoRow {
  id: string;
  business_id: string;
  categoria: string;
  nombre: string;
  unidad: string;
  precio: number | null;
  nivel_min: number | null;
  nivel_max: number | null;
  activo: boolean;
}

/** Lo que ve el Chef al armar su lista: igual que InsumoRow pero sin precio. */
export interface InsumoChef {
  id: string;
  categoria: string;
  nombre: string;
  unidad: string;
}

export interface ListaCompraRow {
  id: string;
  business_id: string;
  chef_id: string;
  fecha: string; // YYYY-MM-DD
}

export type ListaCompraItemStatus = "pendiente" | "confirmado" | "rechazado";

export interface ListaCompraItemRow {
  id: string;
  business_id: string;
  lista_id: string;
  insumo_id: string;
  nombre: string;
  categoria: string;
  unidad: string;
  fecha: string; // YYYY-MM-DD
  requerido: number;
  existencia: number;
  status: ListaCompraItemStatus;
  confirmado_por: string | null;
}

export type SolicitudTipo = "precio" | "compra";
export type SolicitudStatus = "pendiente" | "aprobada" | "declinada";

export interface SolicitudRow {
  id: string;
  business_id: string;
  tipo: SolicitudTipo;
  insumo_id: string;
  insumo_nombre: string;
  lista_compra_item_id: string | null;
  precio_actual: number | null;
  precio_propuesto: number | null;
  nota: string | null;
  solicitado_por: string;
  status: SolicitudStatus;
  resuelto_por: string | null;
  resuelto_at: string | null;
  created_at: string;
}
