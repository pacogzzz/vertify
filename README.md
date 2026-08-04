# Vertify

Control de gastos del **encargado de compra** para restaurantes: el dueño entrega un fondo en efectivo (con foto de la entrega), el encargado compra y registra cada compra con la foto obligatoria del ticket, y el control se lleva en **dos divisiones dentro de la misma sección**:

- **EFECTIVO** — empieza en el efectivo entregado por el dueño y **va restando** con cada compra en efectivo.
- **TARJETA** — empieza en **cero** y **va sumando** lo gastado con la tarjeta del negocio.

Port de producción del prototipo `cuadra.jsx` (la implementación de referencia).

**Stack:** Next.js (App Router) + TypeScript · Supabase (Auth, Postgres, Storage) · Google Gemini para OCR (free tier, fallback Anthropic) · PWA instalable · deploy en Vercel.

---

## 1. Correr en local

```bash
npm install
cp .env.local.example .env.local   # y llena tus llaves
npm run dev                        # http://localhost:3000
```

Variables de `.env.local`:

| Variable | Dónde vive | Qué es |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | cliente + server | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cliente + server | Publishable key (o legacy anon) |
| `NEXT_PUBLIC_SITE_URL` | server | Base de los links de confirmación de correo |
| `SUPABASE_SERVICE_ROLE_KEY` | **solo server** | Crea cuentas y firma URLs de fotos |
| `GEMINI_API_KEY` | **solo server** | OCR de tickets (Google AI Studio, free tier) |
| `ANTHROPIC_API_KEY` | **solo server** | Opcional: fallback de OCR de pago |
| `SMTP_HOST` / `SMTP_PORT` | **solo server** | Opcional: servidor de correo para el aviso de efectivo bajo |
| `SMTP_USER` / `SMTP_PASS` | **solo server** | Usuario y contraseña de ese servidor |
| `EMAIL_FROM` | **solo server** | Remitente de los avisos |

## 2. Base de datos

Abre el **SQL Editor** de tu proyecto en [supabase.com](https://supabase.com) y corre, en orden:

```
supabase/migrations/0001_init.sql     # esquema base, RLS y bucket receipts
supabase/migrations/0002_vertify.sql  # efectivo/tarjeta, fotos de entrega, alerta $700
```

`0002` agrega `payment_method` a las compras, `photo_path` a las entregas de efectivo, el umbral de alerta al negocio, y el bucket privado `cash-photos`. También deja las fotos de tickets **visibles solo para el dueño** (antes el encargado podía verlas).

## 3. Verificación por correo al crear cuenta

El alta del dueño usa `signUp`, así que Supabase manda un correo de confirmación y la cuenta **no puede entrar hasta confirmarlo**.

> **Importante:** el servicio de correo integrado de Supabase solo permite **~2 correos por hora**. Para producción hay que configurar **SMTP propio** en *Authentication → Emails → SMTP Settings*. Sin dominio propio, Gmail funciona bien: host `smtp.gmail.com`, puerto `465`, tu correo como usuario, y una **contraseña de aplicación** de Google como contraseña. Sin eso, los registros fallarán con "límite de correos" en cuanto haya un poco de uso.

## 4. Fotos (tickets y entregas de efectivo)

Todo vive en **Supabase Storage**, en dos buckets **privados**:

- `receipts/{business_id}/{expense_id}.jpg` — tickets de compra.
- `cash-photos/{business_id}/{YYYY-MM}/{YYYY-MM-DD}_{id}.jpg` — entregas de efectivo, en carpeta por mes y con la fecha en el nombre.

Solo el dueño puede verlas (RLS + signed URLs de 1 hora generadas en el server). El botón **Ver fotos** abre la galería del rango de fechas elegido, y el Excel incluye una columna **Link de ticket** que apunta a `/ticket/{id}` (pide sesión de dueño y redirige a la foto).

> **No usar `upsert: true` al subir.** Con upsert, Storage lee el objeto antes de escribirlo, y desde `0002` el encargado ya no tiene permiso de lectura sobre `receipts`: la subida falla con un 403 de RLS. Las rutas llevan un UUID nuevo cada vez, así que no hay nada que reemplazar. El E2E tiene un check que falla si esto se revierte.

## 5. Cómo se usa

**Dueño:** crea el negocio en `/registro`, confirma su correo, y desde Ajustes crea la cuenta del **encargado de compra**. Para recargar saldo **es obligatorio tomar la foto entregando el efectivo**. En su panel elige un día o un **rango de fechas** en el calendario, y ve cuatro cuadros (Gastado, Movimientos, IVA, IEPS), el desglose **por tienda**, los movimientos, y los botones **Ver fotos** y **Exportar a Excel**.

**Encargado de compra:** un solo botón verde **REGISTRAR COMPRA** → elige *Efectivo* o *Tarjeta* → escoge la **tienda** de la lista, anota el **total** y el desglose (**subtotal, IVA, IEPS**) y sube la foto del ticket. El sistema revisa que el ticket se vea bien y, cuando lo aprueba, se habilita **Registrar**. La **fecha la pone la app sola** (se muestra arriba); no hay campo de fecha, categoría ni concepto.

**Obligatorio:** el total y la foto del ticket — las dos cosas que el encargado siempre tiene a la mano.
**Opcional:** subtotal, IVA e IEPS, porque no todos los tickets los traen. Los campos aparecen siempre para que se acostumbre a llenarlos; si los deja vacíos se guarda lo que el OCR leyó del ticket.

**Verificación cruzada:** el OCR lee el ticket y la app compara, campo por campo, lo anotado contra lo leído (tolerancia de $1 por redondeos), y además revisa que *subtotal + IVA + IEPS = total*. Si algo no coincide se muestra la diferencia y hay que marcar una casilla de confirmación para registrar de todos modos — así el encargado nunca queda atorado si el OCR se equivoca, pero tampoco pasa un dato mal sin darse cuenta. El botón **Copiar del ticket** llena de golpe lo que el ticket sí trae.

La lista de tiendas vive en `lib/stores.ts`.

## 5.1 Corte diario (se reinicia a las 24:00)

Todo lo que la pantalla llama *hoy* arranca en **cero a las 00:00**, para que un día no se mezcle con el anterior:

- **Gastado hoy**, **efectivo de hoy**, **tarjeta de hoy** y **número de compras** se calculan solo con los movimientos cuyo `spent_at` es la fecha de hoy.
- El **efectivo NO se reinicia**: es dinero real que se queda en la bolsa del encargado. Lo que se reinicia es el conteo y la barra, que vuelve a medirse contra el efectivo disponible **ese día** (`apertura + recargas de hoy`) en vez de contra todo lo entregado en la historia — antes la barra se iba encogiendo semana tras semana.
- La **apertura** del día (`fundings anteriores − gastos en efectivo anteriores`) se muestra como *"arrancaste el día con $X"*.

El corte lo dispara el hook `useToday` en `components/CuadraApp.tsx`: programa un temporizador a las 00:00:02, y además vuelve a revisar en `visibilitychange` y `focus` porque el temporizador no corre si el sistema durmió el proceso. Al cambiar el día recarga los datos, avisa con un toast, y si el dueño estaba viendo "hoy" en el calendario, la selección se mueve sola al día nuevo.

> **Sin esto**, un teléfono que queda abierto toda la noche seguiría mostrando el día anterior: `todayISO()` solo se recalcula cuando algo provoca un render. El E2E tiene cuatro checks que siembran un día anterior completo y verifican que no se cuele en el corte de hoy.

No hay nada que reiniciar en la base de datos: el corte se deriva de `spent_at` al leer, así que el histórico completo se conserva y el dueño lo sigue viendo con el calendario.

## 6. Aviso de efectivo bajo

Cuando el efectivo baja de **$700** (`low_cash_threshold` en `businesses`), la app muestra un aviso a **ambos** roles y, si hay SMTP configurado, manda un correo a los dos. Conviene usar el mismo servidor de correo que Supabase. El aviso se manda **una sola vez** y se reinicia solo cuando se recarga por encima del umbral.

## 7. OCR de tickets

- Endpoint server-side `POST /api/read-receipt`; la key **nunca** toca el cliente.
- Proveedor por defecto: **Gemini** (`@google/genai`, modelo `gemini-2.5-flash`, salida JSON forzada). Las keys nuevas `AQ.` de AI Studio funcionan nativas con este SDK; **no** usar la ruta OpenAI-compatible.
- Diseño intercambiable (`lib/ocr.ts`): si Gemini falla por error técnico y hay `ANTHROPIC_API_KEY`, cae a **Claude Haiku** automáticamente.
- Además de extraer los montos, el OCR es el **filtro de calidad**: si el ticket sale ilegible, no se puede guardar la compra.

## 8. Pruebas

```bash
npm run dev                                          # en otra terminal
node --env-file=.env.local scripts/e2e-check.mjs     # E2E contra Supabase real
```

Crea usuarios `@cuadra-test.dev`, verifica flujos, RLS, storage, las dos divisiones de dinero y la alerta de $700, y **borra todo** al terminar.

Para revisar la interfaz a ojo con datos de muestra:

```bash
node --env-file=.env.local scripts/seed-demo.mjs           # siembra
node --env-file=.env.local scripts/seed-demo.mjs --clean   # borra
```

## 9. Deploy en Vercel

Push a `main` despliega solo (repo conectado). Las variables nuevas (`NEXT_PUBLIC_SITE_URL`, y si las usas `RESEND_API_KEY` / `EMAIL_FROM`) hay que agregarlas en **Settings → Environment Variables**.

## 10. Decisiones marcadas

- **Notificaciones push:** siguen fuera (requieren convenio con Apple). El aviso de efectivo bajo va por **pantalla + correo**.
- **Saldo por persona:** el saldo es del negocio completo (v1 = un encargado). Con varios habría que llevarlo por persona.
- **Multi-negocio:** el modelo ya lo soporta (todo cuelga de `business_id` con RLS); la UI asume un negocio por usuario.
