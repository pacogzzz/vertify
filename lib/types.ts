export type Role = "owner" | "runner";

export interface Business {
  id: string;
  name: string;
  daily_float: number;
}

export interface Profile {
  id: string;
  business_id: string;
  name: string;
  role: Role;
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
  category: string;
  concept: string | null;
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
