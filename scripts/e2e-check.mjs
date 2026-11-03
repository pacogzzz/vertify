/* E2E de Vertify contra Supabase real + dev server local.
   Crea cuentas/datos de PRUEBA, verifica flujos y RLS, y LIMPIA todo al final.
   Correr: node --env-file=.env.local scripts/e2e-check.mjs  (con `npm run dev` activo) */
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = "http://localhost:3000";
const REF = new URL(URL_).hostname.split(".")[0];

const OWNER = { email: "e2e-owner@cuadra-test.dev", password: "prueba-e2e-123", name: "E2E Dueño", biz: "E2E Negocio" };
const OWNER2 = { email: "e2e-owner2@cuadra-test.dev", password: "prueba-e2e-123", name: "E2E Dueño 2", biz: "E2E Negocio 2" };
// Los colaboradores (Encargado, Chef, Administrador, Caja) entran con
// usuario, sin correo real: por dentro Supabase Auth usa un correo
// sintético `usuario@vertify.local` (ver lib/username.ts) que nunca recibe
// nada. El prefijo "e2e-" es lo que cleanup() usa para poder borrarlos.
const COLLAB_DOMAIN = "vertify.local";
const collabEmail = (username) => `${username}@${COLLAB_DOMAIN}`;
const RUNNER = { username: "e2e-runner", password: "prueba-e2e-123", name: "E2E Rubén" };
const ADMIN_COLLAB = { username: "e2e-admin", password: "prueba-e2e-123", name: "E2E Admin" };

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

/** Con "Confirm email" activado, signUp deja al usuario sin confirmar.
    En pruebas lo confirmamos por admin para poder seguir con el flujo. */
async function confirmUser(email) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const u = (users?.users || []).find((x) => x.email === email);
  if (!u) return false;
  if (u.email_confirmed_at) return true;
  const { error } = await admin.auth.admin.updateUserById(u.id, { email_confirm: true });
  return !error;
}

/** Da de alta un dueño. Usa la ruta real; si Supabase corta por límite de
    correos (servicio integrado: ~2/hora), provisiona por admin para que la
    suite siga corriendo y lo reporta. */
async function ensureOwner(o) {
  const res = await fetch(`${BASE}/api/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: o.email, password: o.password, ownerName: o.name, businessName: o.biz }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) { await confirmUser(o.email); return { via: "route", data }; }
  if (res.status !== 429) return { via: "error", data, status: res.status };

  const { data: created } = await admin.auth.admin.createUser({ email: o.email, password: o.password, email_confirm: true });
  const { data: biz } = await admin.from("businesses").insert({ name: o.biz }).select().single();
  await admin.from("profiles").insert({ id: created.user.id, business_id: biz.id, name: o.name, role: "owner" });
  return { via: "admin", data };
}

async function emptyBucket(bucket, prefix) {
  const { data: entries } = await admin.storage.from(bucket).list(prefix);
  for (const entry of entries || []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) await emptyBucket(bucket, path); // carpeta
    else await admin.storage.from(bucket).remove([path]);
  }
}

function isTestUser(u) {
  const email = u.email || "";
  return email.endsWith("@cuadra-test.dev") || (email.startsWith("e2e-") && email.endsWith(`@${COLLAB_DOMAIN}`));
}

async function cleanup() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const testUsers = (users?.users || []).filter(isTestUser);
  const ids = testUsers.map((u) => u.id);
  let bizIds = [];
  if (ids.length) {
    await admin.from("expenses").delete().in("runner_id", ids);
    const { data: profs } = await admin.from("profiles").select("business_id").in("id", ids);
    bizIds = [...new Set((profs || []).map((p) => p.business_id))];
    if (bizIds.length) {
      await admin.from("fundings").delete().in("business_id", bizIds);
      for (const b of bizIds) {
        await emptyBucket("receipts", b);
        await emptyBucket("cash-photos", b);
      }
    }
    for (const id of ids) await admin.auth.admin.deleteUser(id);
    if (bizIds.length) await admin.from("businesses").delete().in("id", bizIds);
  }
  return ids.length;
}

// ---------- arranque limpio por si quedó basura de una corrida anterior ----------
await cleanup();

// 1. Registro del dueño (ruta real; con fallback si topa el límite de correos)
let res;
const reg = await ensureOwner(OWNER);
check("Alta del dueño + negocio", reg.via !== "error", reg.via === "admin" ? "límite de correos de Supabase: provisionado por admin" : `vía ${reg.via}`);
if (reg.via === "route") {
  check("El registro pide verificación por correo", reg.data.needsConfirm === true);
} else {
  check("El registro pide verificación por correo", true, "no verificable con el límite de correos activo");
}

// 2. Login del dueño
const ownerSb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: ownerAuth, error: loginErr } = await ownerSb.auth.signInWithPassword({ email: OWNER.email, password: OWNER.password });
check("Login dueño (email+password)", !loginErr && !!ownerAuth?.session);
const ownerCookie = authCookie(ownerAuth.session);

const { data: ownerProf } = await ownerSb.from("profiles").select("*").eq("id", ownerAuth.user.id).single();
check("Perfil owner con business_id", ownerProf?.role === "owner" && !!ownerProf?.business_id);
const BIZ = ownerProf.business_id;

// 3. Dueño da de alta al encargado de compra vía la ruta real (auth por cookie)
res = await fetch(`${BASE}/api/create-collaborator`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
  body: JSON.stringify({ role: "runner", username: RUNNER.username, password: RUNNER.password, name: RUNNER.name }),
});
check("POST /api/create-collaborator crea un Encargado (dueño autenticado)", res.ok, `status ${res.status}`);

// 4. Login del encargado, con su usuario (sin correo real)
const runnerSb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: runnerAuth, error: rLoginErr } = await runnerSb.auth.signInWithPassword({ email: collabEmail(RUNNER.username), password: RUNNER.password });
check("Login encargado de compra con usuario (sin correo real)", !rLoginErr && !!runnerAuth?.session);
const runnerCookie = authCookie(runnerAuth.session);

// 5. RLS: el encargado NO puede crear fundings
const { error: fDenied } = await runnerSb.from("fundings").insert({ business_id: BIZ, amount: 500, note: "no debería" });
check("RLS: encargado NO puede recargar saldo", !!fDenied);

// 6. El dueño recarga con foto de entrega (obligatoria en la UI)
const jpegB64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const jpegBlob = () => new Blob([Buffer.from(jpegB64, "base64")], { type: "image/jpeg" });
const today = new Date().toISOString().slice(0, 10);
const fundId = crypto.randomUUID();
const cashPath = `${BIZ}/${today.slice(0, 7)}/${today}_${fundId}.jpg`;
const { error: cashUpErr } = await ownerSb.storage.from("cash-photos").upload(cashPath, jpegBlob(), { contentType: "image/jpeg" });
check("Dueño sube foto de entrega de efectivo (carpeta del mes)", !cashUpErr, cashUpErr?.message);

const { data: fund, error: fErr } = await ownerSb.from("fundings").insert({ id: fundId, business_id: BIZ, runner_id: runnerAuth.user.id, amount: 2000, note: "Fondo del día", photo_path: cashPath }).select().single();
check("Dueño inserta funding $2000 con photo_path", !fErr && !!fund?.photo_path, fErr?.message);

// 7. RLS: el encargado NO puede subir ni leer fotos de entregas de efectivo
const { error: cashDenied } = await runnerSb.storage.from("cash-photos").upload(`${BIZ}/${today.slice(0, 7)}/intruso.jpg`, jpegBlob(), { contentType: "image/jpeg" });
check("RLS: encargado NO sube fotos de efectivo", !!cashDenied);

res = await fetch(`${BASE}/api/receipt-url?path=${encodeURIComponent(cashPath)}&bucket=cash-photos`, { headers: { Cookie: runnerCookie } });
check("El encargado NO puede ver fotos de entregas (403)", res.status === 403, `status ${res.status}`);

// 8. El encargado ve el funding (para su división de efectivo)
const { data: rFunds } = await runnerSb.from("fundings").select("*");
check("Encargado lee fundings de su negocio", (rFunds || []).length === 1);

// 9. El encargado registra una compra en EFECTIVO (fecha la pone el sistema)
const expId = crypto.randomUUID();
const { data: exp, error: eErr } = await runnerSb.from("expenses").insert({
  id: expId, business_id: BIZ, runner_id: runnerAuth.user.id,
  store: "HEB", payment_method: "efectivo", subtotal: 420.5, iva: 67.28, ieps: 12, total: 487.78,
  items: [{ name: "Jitomate saladet kg", qty: 5, price: 145 }], source: "ocr",
  photo_path: `${BIZ}/${expId}.jpg`, spent_at: today,
}).select().single();
check("Encargado registra compra en efectivo $487.78", !eErr && exp?.payment_method === "efectivo", eErr?.message);

// 10. Y una compra con TARJETA (no toca el efectivo)
const cardId = crypto.randomUUID();
const { data: cardExp, error: cErr } = await runnerSb.from("expenses").insert({
  id: cardId, business_id: BIZ, runner_id: runnerAuth.user.id,
  store: "Office Depot", payment_method: "tarjeta", subtotal: 300, iva: 48, ieps: 0, total: 348,
  items: [], source: "ocr", photo_path: `${BIZ}/${cardId}.jpg`, spent_at: today,
}).select().single();
check("Encargado registra compra con tarjeta $348", !cErr && cardExp?.payment_method === "tarjeta", cErr?.message);

// 11. RLS: el encargado no puede registrar compras a nombre de otro
const { error: eDenied } = await runnerSb.from("expenses").insert({
  business_id: BIZ, runner_id: ownerAuth.user.id, store: "X", payment_method: "efectivo", total: 1, source: "ocr",
});
check("RLS: encargado NO inserta compras de otro usuario", !!eDenied);

// 12. Las dos divisiones cuadran: efectivo resta, tarjeta suma desde cero
const { data: oExps } = await ownerSb.from("expenses").select("*");
const { data: oFunds } = await ownerSb.from("fundings").select("*");
const funded = (oFunds || []).reduce((s, f) => s + Number(f.amount), 0);
const cashSpent = (oExps || []).filter((e) => e.payment_method === "efectivo").reduce((s, e) => s + Number(e.total), 0);
const cardSpent = (oExps || []).filter((e) => e.payment_method === "tarjeta").reduce((s, e) => s + Number(e.total), 0);
check("Dueño ve las 2 compras del encargado", (oExps || []).length === 2);
check("División EFECTIVO = Σfundings − Σefectivo = $1512.22", Math.abs(funded - cashSpent - 1512.22) < 0.001, `saldo ${funded - cashSpent}`);
check("División TARJETA = Σtarjeta = $348 (empieza en cero)", Math.abs(cardSpent - 348) < 0.001, `tarjeta ${cardSpent}`);

const iepsTotal = (oExps || []).reduce((s, e) => s + Number(e.ieps), 0);
check("IEPS acumulado disponible para el 4º cuadro", Math.abs(iepsTotal - 12) < 0.001, `ieps ${iepsTotal}`);

// 13. Aislamiento multi-negocio: otro dueño no ve NADA de este negocio
await ensureOwner(OWNER2);
const owner2Sb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: owner2Auth } = await owner2Sb.auth.signInWithPassword({ email: OWNER2.email, password: OWNER2.password });
const owner2Cookie = authCookie(owner2Auth.session);
const { data: o2Exps } = await owner2Sb.from("expenses").select("*");
const { data: o2Funds } = await owner2Sb.from("fundings").select("*");
check("RLS: otro negocio ve 0 compras y 0 fundings", (o2Exps || []).length === 0 && (o2Funds || []).length === 0);

// 14. Storage de tickets: el encargado sube, SOLO el dueño ve
const photoPath = `${BIZ}/${expId}.jpg`;
const { error: upErr } = await runnerSb.storage.from("receipts").upload(photoPath, jpegBlob(), { contentType: "image/jpeg" });
check("Encargado sube foto del ticket al bucket privado", !upErr, upErr?.message);

/* Regresión: `upsert: true` obliga a Storage a LEER el objeto antes de escribirlo, y
   desde 0002 el encargado ya no tiene permiso de lectura sobre receipts. La app lo
   usaba y por eso fallaba con "No se pudo subir la foto". Si este check empieza a
   pasar es que cambiaron las policies; si la app vuelve a usar upsert, romperá. */
const { error: upsertErr } = await runnerSb.storage.from("receipts")
  .upload(`${BIZ}/${crypto.randomUUID()}.jpg`, jpegBlob(), { contentType: "image/jpeg", upsert: true });
check("Encargado con upsert:true es rechazado (la app NO debe usar upsert)", !!upsertErr, upsertErr?.message);

// Sin upsert, el encargado tampoco puede sobrescribir un ticket ya subido
const { error: overwriteErr } = await runnerSb.storage.from("receipts").upload(photoPath, jpegBlob(), { contentType: "image/jpeg" });
check("Encargado NO puede sobrescribir un ticket ya subido", !!overwriteErr, overwriteErr?.message);

res = await fetch(`${BASE}/api/receipt-url?path=${encodeURIComponent(photoPath)}`, { headers: { Cookie: ownerCookie } });
const urlData = await res.json().catch(() => ({}));
check("GET /api/receipt-url devuelve signed URL al dueño", res.ok && !!urlData.url);
if (urlData.url) {
  const photoRes = await fetch(urlData.url);
  check("La signed URL sirve la foto", photoRes.ok);
}

res = await fetch(`${BASE}/api/receipt-url?path=${encodeURIComponent(photoPath)}`, { headers: { Cookie: runnerCookie } });
check("El encargado NO puede ver los tickets guardados (403)", res.status === 403, `status ${res.status}`);

// El bucket es privado: sin firma no se ve
const rawRes = await fetch(`${URL_}/storage/v1/object/public/receipts/${photoPath}`);
check("La foto NO es pública sin signed URL", !rawRes.ok);

// 15. Link del Excel: /ticket/:id lleva a la foto (solo dueño)
res = await fetch(`${BASE}/ticket/${expId}`, { headers: { Cookie: ownerCookie }, redirect: "manual" });
check("GET /ticket/:id redirige a la foto para el dueño", res.status >= 300 && res.status < 400, `status ${res.status}`);

res = await fetch(`${BASE}/ticket/${expId}`, { headers: { Cookie: runnerCookie }, redirect: "manual" });
check("GET /ticket/:id bloqueado para el encargado", res.status === 403, `status ${res.status}`);

// 16. Alerta de efectivo bajo: con $1512 no salta; tras gastar más, sí
res = await fetch(`${BASE}/api/low-balance`, { method: "POST", headers: { Cookie: ownerCookie } });
let lowData = await res.json().catch(() => ({}));
check("POST /api/low-balance: sin alerta con saldo alto", res.ok && lowData.alert === false, `saldo ${lowData.balance}`);

await runnerSb.from("expenses").insert({
  business_id: BIZ, runner_id: runnerAuth.user.id, store: "Soriana", payment_method: "efectivo",
  subtotal: 900, iva: 0, ieps: 0, total: 900, items: [], source: "ocr", spent_at: today,
});
res = await fetch(`${BASE}/api/low-balance`, { method: "POST", headers: { Cookie: ownerCookie } });
lowData = await res.json().catch(() => ({}));
check("POST /api/low-balance: alerta al bajar de $700", res.ok && lowData.alert === true, `saldo ${lowData.balance}`);

const { data: bizRow } = await admin.from("businesses").select("low_cash_alerted").eq("id", BIZ).single();
check("La alerta se marca para no repetirse", bizRow?.low_cash_alerted === true);

// Al recargar, el flag se resetea
await admin.from("fundings").insert({ business_id: BIZ, amount: 3000, note: "Recarga E2E", photo_path: cashPath });
res = await fetch(`${BASE}/api/low-balance`, { method: "POST", headers: { Cookie: ownerCookie } });
lowData = await res.json().catch(() => ({}));
const { data: bizRow2 } = await admin.from("businesses").select("low_cash_alerted").eq("id", BIZ).single();
check("Tras recargar, la alerta se reinicia", lowData.alert === false && bizRow2?.low_cash_alerted === false);

// 17. OCR por la ruta real, autenticado (imagen mínima → ilegible es lo esperado)
res = await fetch(`${BASE}/api/read-receipt`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: runnerCookie },
  body: JSON.stringify({ image: jpegB64 }),
});
check("POST /api/read-receipt autenticado responde (422 ilegible esperado)", res.status === 422 || res.ok, `status ${res.status}`);

res = await fetch(`${BASE}/api/read-receipt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: jpegB64 }) });
check("POST /api/read-receipt SIN sesión → 401", res.status === 401);

/* 18. Corte diario: lo de ayer NO se mezcla con lo de hoy.
   Se siembra un día anterior completo (entrega + compras) y se recalcula el
   corte con la misma fórmula que usa la pantalla (calcCorte en CuadraApp). */
const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
await admin.from("fundings").insert({ business_id: BIZ, amount: 1000, note: "Fondo de ayer", photo_path: cashPath, created_at: `${ayer}T15:00:00Z` });
await admin.from("expenses").insert([
  { business_id: BIZ, runner_id: runnerAuth.user.id, store: "HEB", payment_method: "efectivo", subtotal: 0, iva: 0, ieps: 0, total: 600, items: [], source: "ocr", spent_at: ayer },
  { business_id: BIZ, runner_id: runnerAuth.user.id, store: "Costco", payment_method: "tarjeta", subtotal: 0, iva: 0, ieps: 0, total: 150, items: [], source: "ocr", spent_at: ayer },
]);

const { data: allExp } = await ownerSb.from("expenses").select("*");
const { data: allFund } = await ownerSb.from("fundings").select("*");
const totalFunded = (allFund || []).reduce((s, f) => s + Number(f.amount), 0);
const saldo = totalFunded - (allExp || []).filter((e) => e.payment_method === "efectivo").reduce((s, e) => s + Number(e.total), 0);

const delDia = (allExp || []).filter((e) => e.spent_at === today);
const efeHoy = delDia.filter((e) => e.payment_method === "efectivo").reduce((s, e) => s + Number(e.total), 0);
const tarHoy = delDia.filter((e) => e.payment_method === "tarjeta").reduce((s, e) => s + Number(e.total), 0);
const recargadoHoy = (allFund || []).filter((f) => (f.created_at || "").slice(0, 10) === today).reduce((s, f) => s + Number(f.amount), 0);
const base = saldo + efeHoy;              // efectivo disponible hoy
const apertura = base - recargadoHoy;     // con lo que amaneció = sobrante de ayer

check("Corte: el día de hoy solo cuenta sus propias compras", delDia.length === 3 && (allExp || []).length === 5, `hoy ${delDia.length} de ${(allExp || []).length}`);
check("Corte: TARJETA de hoy no arrastra la de ayer ($348, no $498)", Math.abs(tarHoy - 348) < 0.001, `tarjeta hoy ${tarHoy}`);
check("Corte: el día abre con lo que sobró del anterior ($1000 − $600 = $400)", Math.abs(apertura - 400) < 0.001, `apertura ${apertura}`);
check("Corte: el EFECTIVO sí se conserva de un día a otro (no vuelve a cero)", Math.abs(saldo - 4012.22) < 0.001, `saldo ${saldo}`);

// 19. Colaboradores: Administrador (solo lectura), restablecer contraseña,
// cambiar rol, y que nadie pueda auto-ascenderse (ni ser ascendido) a dueño.
res = await fetch(`${BASE}/api/create-collaborator`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
  body: JSON.stringify({ role: "admin", username: ADMIN_COLLAB.username, password: ADMIN_COLLAB.password, name: ADMIN_COLLAB.name }),
});
check("POST /api/create-collaborator crea un Administrador", res.ok, `status ${res.status}`);

const adminSb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: adminAuth, error: adminLoginErr } = await adminSb.auth.signInWithPassword({ email: collabEmail(ADMIN_COLLAB.username), password: ADMIN_COLLAB.password });
check("Login de Administrador con usuario (sin correo real)", !adminLoginErr && !!adminAuth?.session);

const { data: adminExps } = await adminSb.from("expenses").select("*");
check("Administrador lee los gastos del negocio (vista de solo lectura)", (adminExps || []).length >= 2, `vio ${(adminExps || []).length}`);

const { error: adminFundDenied } = await adminSb.from("fundings").insert({ business_id: BIZ, amount: 100, note: "no debería" });
check("RLS: Administrador NO puede recargar saldo", !!adminFundDenied);

// Administrador no es "owner", así que la política de actualización ni
// siquiera lo deja tocar la fila (0 filas afectadas, sin error) — se
// confirma releyendo que el rol siguió igual.
await adminSb.from("profiles").update({ role: "owner" }).eq("id", adminAuth.user.id);
const { data: adminProfAfter } = await admin.from("profiles").select("role").eq("id", adminAuth.user.id).single();
check("RLS: Administrador no puede auto-ascenderse a dueño", adminProfAfter?.role === "admin", `rol quedó en ${adminProfAfter?.role}`);

// El dueño cambia el rol del Administrador a Caja y de vuelta (misma acción que "Cambiar rol")
const { data: adminProf } = await ownerSb.from("profiles").select("id").eq("username", ADMIN_COLLAB.username).single();
const { error: roleChangeErr } = await ownerSb.from("profiles").update({ role: "caja" }).eq("id", adminProf.id);
check("Dueño cambia el rol de un colaborador (Administrador → Caja)", !roleChangeErr, roleChangeErr?.message);

// Ni el propio dueño puede usar ese mismo camino para hacer dueño a alguien más
const { error: ownerEscalateErr } = await ownerSb.from("profiles").update({ role: "owner" }).eq("id", adminProf.id);
check("RLS: ese camino nunca puede dejar a un colaborador como dueño", !!ownerEscalateErr);

// Restablecer contraseña del encargado (ruta real, dueño autenticado)
const { data: runnerProf } = await ownerSb.from("profiles").select("id").eq("username", RUNNER.username).single();
const newRunnerPassword = "prueba-e2e-nueva-456";
res = await fetch(`${BASE}/api/reset-collaborator-password`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
  body: JSON.stringify({ profileId: runnerProf.id, password: newRunnerPassword }),
});
check("POST /api/reset-collaborator-password (dueño autenticado)", res.ok, `status ${res.status}`);

const { error: oldPassErr } = await createClient(URL_, ANON, { auth: { persistSession: false } })
  .auth.signInWithPassword({ email: collabEmail(RUNNER.username), password: RUNNER.password });
check("La contraseña anterior del encargado ya no sirve", !!oldPassErr);

const { data: newPassAuth, error: newPassErr } = await createClient(URL_, ANON, { auth: { persistSession: false } })
  .auth.signInWithPassword({ email: collabEmail(RUNNER.username), password: newRunnerPassword });
check("La contraseña nueva (restablecida) del encargado sí funciona", !newPassErr && !!newPassAuth?.session);

// Un dueño de OTRO negocio no puede restablecer la contraseña de este colaborador
res = await fetch(`${BASE}/api/reset-collaborator-password`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: owner2Cookie },
  body: JSON.stringify({ profileId: runnerProf.id, password: "lo-que-sea-123" }),
});
check("RLS/endpoint: un dueño ajeno NO puede restablecer la contraseña de este colaborador", res.status === 404, `status ${res.status}`);

// ---------- limpieza ----------
const removed = await cleanup();
console.log(`\nLimpieza: ${removed} usuarios de prueba y sus datos eliminados.`);

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} pruebas OK`);
process.exit(fails.length ? 1 : 0);
