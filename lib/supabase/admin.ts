import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con la SERVICE ROLE KEY: salta RLS.
 * SOLO importar desde rutas /api o código de servidor. Jamás en componentes cliente.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el server");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
