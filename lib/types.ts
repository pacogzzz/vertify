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
