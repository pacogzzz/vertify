/* Siembra una cuenta de PRUEBA con datos de muestra para revisar la UI a ojo.
   Sembrar:  node --env-file=.env.local scripts/seed-demo.mjs
   Limpiar:  node --env-file=.env.local scripts/seed-demo.mjs --clean
   Los usuarios usan el dominio @cuadra-test.dev y se borran por completo. */
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const OWNER = { email: "visual-owner@cuadra-test.dev", password: "prueba-visual-123", name: "Paco", biz: "La Corte" };
const RUNNER = { email: "visual-runner@cuadra-test.dev", password: "prueba-visual-123", name: "Rubén" };

async function emptyBucket(bucket, prefix) {
  const { data: entries } = await admin.storage.from(bucket).list(prefix);
  for (const e of entries || []) {
    const p = `${prefix}/${e.name}`;
    if (e.id === null) await emptyBucket(bucket, p);
    else await admin.storage.from(bucket).remove([p]);
  }
}

async function clean() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ids = (users?.users || []).filter((u) => u.email?.endsWith("@cuadra-test.dev")).map((u) => u.id);
  if (!ids.length) return 0;
  await admin.from("expenses").delete().in("runner_id", ids);
  const { data: profs } = await admin.from("profiles").select("business_id").in("id", ids);
  const bizIds = [...new Set((profs || []).map((p) => p.business_id))];
  if (bizIds.length) {
    await admin.from("fundings").delete().in("business_id", bizIds);
    for (const b of bizIds) { await emptyBucket("receipts", b); await emptyBucket("cash-photos", b); }
  }
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  if (bizIds.length) await admin.from("businesses").delete().in("id", bizIds);
  return ids.length;
}

if (process.argv.includes("--clean")) {
  console.log("limpiados:", await clean());
  process.exit(0);
}

await clean();

const { data: o } = await admin.auth.admin.createUser({ email: OWNER.email, password: OWNER.password, email_confirm: true });
const { data: biz } = await admin.from("businesses").insert({ name: OWNER.biz }).select().single();
await admin.from("profiles").insert({ id: o.user.id, business_id: biz.id, name: OWNER.name, role: "owner" });

const { data: r } = await admin.auth.admin.createUser({ email: RUNNER.email, password: RUNNER.password, email_confirm: true });
await admin.from("profiles").insert({ id: r.user.id, business_id: biz.id, name: RUNNER.name, role: "runner" });

const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = new Date();
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };

// entrega de efectivo con foto
const fId = crypto.randomUUID();
const cashPath = `${biz.id}/${daysAgo(6).slice(0, 7)}/${daysAgo(6)}_${fId}.jpg`;
await admin.storage.from("cash-photos").upload(cashPath, jpeg, { contentType: "image/jpeg", upsert: true });
await admin.from("fundings").insert({ id: fId, business_id: biz.id, runner_id: r.user.id, amount: 5000, note: "Fondo de la semana", photo_path: cashPath });

const compras = [
  { store: "HEB", pay: "efectivo", sub: 420.5, iva: 67.28, ieps: 0, total: 487.78, d: 0 },
  { store: "Frutería Aguilar", pay: "efectivo", sub: 310, iva: 0, ieps: 0, total: 310, d: 0 },
  { store: "Office Depot", pay: "tarjeta", sub: 300, iva: 48, ieps: 0, total: 348, d: 0 },
  { store: "Sukarne", pay: "efectivo", sub: 890, iva: 142.4, ieps: 0, total: 1032.4, d: 1 },
  { store: "Tortillería (Toño)", pay: "efectivo", sub: 120, iva: 0, ieps: 0, total: 120, d: 2 },
  { store: "City Club", pay: "tarjeta", sub: 1500, iva: 240, ieps: 85, total: 1825, d: 3 },
  { store: "Soriana", pay: "efectivo", sub: 640, iva: 102.4, ieps: 30, total: 772.4, d: 5 },
];
for (const c of compras) {
  const id = crypto.randomUUID();
  const path = `${biz.id}/${id}.jpg`;
  await admin.storage.from("receipts").upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
  await admin.from("expenses").insert({
    id, business_id: biz.id, runner_id: r.user.id, store: c.store, payment_method: c.pay,
    subtotal: c.sub, iva: c.iva, ieps: c.ieps, total: c.total,
    items: [{ name: "Producto de ejemplo", qty: 2, price: c.sub / 2 }],
    source: "ocr", photo_path: path, spent_at: daysAgo(c.d),
  });
}

console.log("OK owner:", OWNER.email, "/", OWNER.password);
console.log("OK runner:", RUNNER.email, "/", RUNNER.password);
