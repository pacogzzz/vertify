/* E2E de Cuadra contra Supabase real + dev server local.
   Crea cuentas/datos de PRUEBA, verifica flujos y RLS, y LIMPIA todo al final.
   Correr: node --env-file=.env.local test-e2e.tmp.mjs  (con `npm run dev` activo) */
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = "http://localhost:3000";
const REF = new URL(URL_).hostname.split(".")[0];

const OWNER = { email: "e2e-owner@cuadra-test.dev", password: "prueba-e2e-123", name: "E2E Dueño", biz: "E2E Negocio" };
const OWNER2 = { email: "e2e-owner2@cuadra-test.dev", password: "prueba-e2e-123", name: "E2E Dueño 2", biz: "E2E Negocio 2" };
const RUNNER = { email: "e2e-runner@cuadra-test.dev", password: "prueba-e2e-123", name: "E2E Rubén" };

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
}

function authCookie(session) {
  const name = `sb-${REF}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  if (value.length <= 3180) return `${name}=${value}`;
  const parts = [];
  for (let i = 0; i * 3180 < value.length; i++) parts.push(`${name}.${i}=${value.slice(i * 3180, (i + 1) * 3180)}`);
  return parts.join("; ");
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

async function cleanup() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const testUsers = (users?.users || []).filter((u) => u.email?.endsWith("@cuadra-test.dev"));
  const ids = testUsers.map((u) => u.id);
  if (ids.length) {
    await admin.from("expenses").delete().in("runner_id", ids);
    const { data: profs } = await admin.from("profiles").select("business_id").in("id", ids);
    const bizIds = [...new Set((profs || []).map((p) => p.business_id))];
    if (bizIds.length) {
      await admin.from("fundings").delete().in("business_id", bizIds);
      for (const b of bizIds) {
        const { data: files } = await admin.storage.from("receipts").list(b);
        if (files?.length) await admin.storage.from("receipts").remove(files.map((f) => `${b}/${f.name}`));
      }
    }
    for (const id of ids) await admin.auth.admin.deleteUser(id);
    if (bizIds.length) await admin.from("businesses").delete().in("id", bizIds);
  }
  return ids.length;
}

// ---------- arranque limpio por si quedó basura de una corrida anterior ----------
await cleanup();

// 1. Registro del dueño vía la ruta real
let res = await fetch(`${BASE}/api/register`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: OWNER.email, password: OWNER.password, ownerName: OWNER.name, businessName: OWNER.biz }),
});
check("POST /api/register crea dueño + negocio", res.ok, `status ${res.status}`);

// 2. Login del dueño
const ownerSb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: ownerAuth, error: loginErr } = await ownerSb.auth.signInWithPassword({ email: OWNER.email, password: OWNER.password });
check("Login dueño (email+password)", !loginErr && !!ownerAuth?.session);
const ownerCookie = authCookie(ownerAuth.session);

const { data: ownerProf } = await ownerSb.from("profiles").select("*").eq("id", ownerAuth.user.id).single();
check("Perfil owner con business_id", ownerProf?.role === "owner" && !!ownerProf?.business_id);
const BIZ = ownerProf.business_id;

// 3. Dueño da de alta al mandadero vía la ruta real (auth por cookie)
res = await fetch(`${BASE}/api/create-runner`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
  body: JSON.stringify({ email: RUNNER.email, password: RUNNER.password, name: RUNNER.name }),
});
check("POST /api/create-runner (dueño autenticado)", res.ok, `status ${res.status}`);

// 4. Login del mandadero
const runnerSb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: runnerAuth, error: rLoginErr } = await runnerSb.auth.signInWithPassword({ email: RUNNER.email, password: RUNNER.password });
check("Login mandadero", !rLoginErr && !!runnerAuth?.session);

// 5. RLS: el mandadero NO puede crear fundings
const { error: fDenied } = await runnerSb.from("fundings").insert({ business_id: BIZ, amount: 500, note: "no debería" });
check("RLS: runner NO puede recargar saldo", !!fDenied);

// 6. El dueño recarga (funding real)
const { data: fund, error: fErr } = await ownerSb.from("fundings").insert({ business_id: BIZ, runner_id: runnerAuth.user.id, amount: 2000, note: "Fondo del día" }).select().single();
check("Dueño inserta funding $2000", !fErr && !!fund);

// 7. El mandadero ve el funding (para su barra de saldo)
const { data: rFunds } = await runnerSb.from("fundings").select("*");
check("Runner lee fundings de su negocio", (rFunds || []).length === 1);

// 8. El mandadero registra un gasto
const expId = crypto.randomUUID();
const { data: exp, error: eErr } = await runnerSb.from("expenses").insert({
  id: expId, business_id: BIZ, runner_id: runnerAuth.user.id,
  store: "HEB", category: "Frutas y verduras", concept: "", subtotal: 420.5, iva: 67.28, ieps: 0, total: 487.78,
  items: [{ name: "Jitomate saladet kg", qty: 5, price: 145 }], source: "manual", spent_at: new Date().toISOString().slice(0, 10),
}).select().single();
check("Runner inserta gasto $487.78", !eErr && !!exp, eErr?.message);

// 9. RLS: el runner no puede registrar gastos a nombre de otro
const { error: eDenied } = await runnerSb.from("expenses").insert({
  business_id: BIZ, runner_id: ownerAuth.user.id, store: "X", category: "Otros", total: 1, source: "manual",
});
check("RLS: runner NO inserta gastos de otro usuario", !!eDenied);

// 10. El dueño ve el gasto; saldo cuadra
const { data: oExps } = await ownerSb.from("expenses").select("*");
const { data: oFunds } = await ownerSb.from("fundings").select("*");
const saldo = (oFunds || []).reduce((s, f) => s + Number(f.amount), 0) - (oExps || []).reduce((s, e) => s + Number(e.total), 0);
check("Dueño ve el gasto del runner", (oExps || []).length === 1);
check("Saldo = Σfundings − Σexpenses = $1512.22", Math.abs(saldo - 1512.22) < 0.001, `saldo ${saldo}`);

// 11. Aislamiento multi-negocio: otro dueño no ve NADA de este negocio
await fetch(`${BASE}/api/register`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: OWNER2.email, password: OWNER2.password, ownerName: OWNER2.name, businessName: OWNER2.biz }),
});
const owner2Sb = createClient(URL_, ANON, { auth: { persistSession: false } });
await owner2Sb.auth.signInWithPassword({ email: OWNER2.email, password: OWNER2.password });
const { data: o2Exps } = await owner2Sb.from("expenses").select("*");
const { data: o2Funds } = await owner2Sb.from("fundings").select("*");
check("RLS: otro negocio ve 0 gastos y 0 fundings", (o2Exps || []).length === 0 && (o2Funds || []).length === 0);

// 12. Storage: runner sube foto del ticket, dueño obtiene signed URL
const jpegB64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const photoPath = `${BIZ}/${expId}.jpg`;
const jpegBlob = new Blob([Buffer.from(jpegB64, "base64")], { type: "image/jpeg" });
const { error: upErr } = await runnerSb.storage.from("receipts").upload(photoPath, jpegBlob, { contentType: "image/jpeg" });
check("Runner sube foto al bucket privado", !upErr, upErr?.message);

res = await fetch(`${BASE}/api/receipt-url?path=${encodeURIComponent(photoPath)}`, { headers: { Cookie: ownerCookie } });
const urlData = await res.json().catch(() => ({}));
check("GET /api/receipt-url devuelve signed URL al dueño", res.ok && !!urlData.url);
if (urlData.url) {
  const photoRes = await fetch(urlData.url);
  check("La signed URL sirve la foto", photoRes.ok);
}

// El bucket es privado: sin firma no se ve
const rawRes = await fetch(`${URL_}/storage/v1/object/public/receipts/${photoPath}`);
check("La foto NO es pública sin signed URL", !rawRes.ok);

// 13. OCR por la ruta real, autenticado (imagen mínima → ilegible es lo esperado)
res = await fetch(`${BASE}/api/read-receipt`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: authCookie(runnerAuth.session) },
  body: JSON.stringify({ image: jpegB64 }),
});
check("POST /api/read-receipt autenticado responde (422 ilegible esperado)", res.status === 422 || res.ok, `status ${res.status}`);

res = await fetch(`${BASE}/api/read-receipt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: jpegB64 }) });
check("POST /api/read-receipt SIN sesión → 401", res.status === 401);

// ---------- limpieza ----------
const removed = await cleanup();
console.log(`\nLimpieza: ${removed} usuarios de prueba y sus datos eliminados.`);

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} pruebas OK`);
process.exit(fails.length ? 1 : 0);
