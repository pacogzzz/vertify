/* Siembra el catálogo de insumos (Lista Compra) de un negocio REAL.
   Cruza el inventario (PDF) de La Corte contra el Excel de precios —
   210 de 235 insumos ya trajeron precio; los otros 25 quedan sin precio
   (Rubén los completa con una solicitud de precio desde la app).

   Uso:
     node --env-file=.env.local scripts/seed-insumos.mjs <business_id>
     node --env-file=.env.local scripts/seed-insumos.mjs <business_id> --clean

   <business_id> es el id del negocio real (columna `id` de `businesses`
   en Supabase). No corre contra nada si no lo das explícito, para no
   sembrar por accidente en el negocio equivocado. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const businessId = process.argv[2];
const clean = process.argv.includes("--clean");

if (!businessId || businessId.startsWith("--")) {
  console.error("Falta el business_id. Uso: node --env-file=.env.local scripts/seed-insumos.mjs <business_id> [--clean]");
  process.exit(1);
}

const { data: biz, error: bizErr } = await admin.from("businesses").select("id, name").eq("id", businessId).single();
if (bizErr || !biz) {
  console.error("No se encontró ese business_id:", bizErr?.message || "sin resultado");
  process.exit(1);
}
console.log(`Negocio: ${biz.name} (${biz.id})`);

if (clean) {
  const { error } = await admin.from("insumos").delete().eq("business_id", businessId);
  console.log(error ? `Error al limpiar: ${error.message}` : "Catálogo de insumos borrado.");
  process.exit(error ? 1 : 0);
}

const { count: existing } = await admin.from("insumos").select("id", { count: "exact", head: true }).eq("business_id", businessId);
if (existing && existing > 0) {
  console.error(`Ya hay ${existing} insumos para este negocio. Corre con --clean primero si quieres volver a sembrar.`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(join(__dirname, "insumos-seed-data.json"), "utf8"));
const rows = data.map((d) => ({
  business_id: businessId,
  categoria: d.categoria,
  nombre: d.nombre,
  unidad: d.unidad,
  precio: d.precio,
  nivel_min: d.min,
  nivel_max: d.max,
}));

// en bloques, para no mandar una sola petición gigante
const BATCH = 50;
let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const { error } = await admin.from("insumos").insert(batch);
  if (error) {
    console.error(`Error insertando el lote ${i}-${i + batch.length}:`, error.message);
    process.exit(1);
  }
  inserted += batch.length;
}

const conPrecio = rows.filter((r) => r.precio !== null).length;
console.log(`Listo: ${inserted} insumos sembrados (${conPrecio} con precio, ${inserted - conPrecio} sin precio todavía).`);
