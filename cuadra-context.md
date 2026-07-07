# Cuadra — Contexto para llevar el prototipo a producción

Este documento le dice a Claude Code **qué construir** y, sobre todo, **qué preservar** del prototipo que ya funciona. La regla de oro: **portar, no reescribir**. El archivo `cuadra.jsx` es la implementación de referencia (UI, copys, flujos, lógica de dinero y prompt de OCR ya validados). No rediseñar.

---

## 1. Qué es Cuadra

App para que el **dueño** de un restaurante controle en qué gasta su **mandadero** (la persona que hace las compras de insumos en HEB, Sam's, Costco, mercado, tortillería, etc.). El mandadero recibe un fondo, compra, y cada compra se registra con foto del ticket (OCR lee tienda, fecha, total, IVA, IEPS y productos) o a mano. El saldo baja solo y el dueño ve todo ordenado por día/semana/mes.

Pensado **multi-negocio / multi-usuario** desde el modelo de datos, aunque hoy se use con un solo restaurante y un solo mandadero. Es el primer prototipo de un producto general/vendible.

## 2. El archivo de referencia: `cuadra.jsx`

Es un componente React de un solo archivo, ya funcional, con:
- UI completa en español (vista Mandadero + vista Dueño), diseño "Cuadra" (paleta verde tinta, tipografías Space Grotesk + Inter, la **barra de vida** del saldo como elemento estrella).
- Lógica de dinero, categorías, captura manual, vistas por periodo, export CSV.
- El **prompt exacto de OCR** (función `readReceipt`) — reusarlo tal cual.

**Mapeo prototipo → producción (esto es lo que SÍ cambia):**

| En el prototipo | En producción |
|---|---|
| `window.storage` (key-value local) | Postgres en Supabase (tablas reales) |
| Endpoint OCR mágico sin API key | Server route propio (`/api/read-receipt`) con tu `GEMINI_API_KEY` (Gemini free tier; Anthropic como fallback) |
| Switch demo Mandadero/Dueño | Auth real de Supabase + rol por usuario |
| Fotos en `zb_photo:*` (base64 local) | Supabase Storage (bucket privado) + signed URLs |
| Datos sembrados (seed) | Cuenta real del negocio; sin seed (o seed opcional para demo) |

**Lo que NO se toca:** el diseño, los copys en español, la barra de vida del saldo, los dos flujos de captura (foto / manual), el formulario de confirmación editable, las categorías, las vistas Hoy/Semana/Mes, y el comportamiento del saldo.

## 3. Roles y autenticación

Dos roles: `owner` (dueño) y `runner` (mandadero).

**Decisión por defecto (la más simple para MVP):**
- El **dueño se registra** con email + contraseña (Supabase Auth).
- El dueño **crea la cuenta del mandadero desde dentro de la app** (email + contraseña o un PIN simple) y le pasa las credenciales en persona. El mandadero entra una vez en su teléfono y se queda con sesión guardada.
- Nada de SMS por ahora (evita costo de proveedor tipo Twilio).

**Upgrade futuro (no en v1):** login por número de teléfono con OTP, para que al mandadero le sea más fácil.

Cada usuario pertenece a un `business`. El mandadero **solo ve sus propios gastos**; el dueño ve **todo su negocio**.

## 4. Lógica del dinero (preservar exactamente)

- El dueño entrega un fondo (ej. $2000). Cada entrega es un registro de **funding**.
- Solo las **compras registradas** (expenses) bajan el saldo.
- **Saldo actual = Σ(fundings) − Σ(expenses).** Es un ledger corrido.
- Lo que sobra **se arrastra** al día siguiente (no se reinicia).
- Sin comprobante no hay gasto válido; el dueño recarga cuando quiere (otro funding).
- El campo que baja el saldo es el **total pagado** del gasto (no el subtotal).

## 5. Modelo de datos (schema sugerido)

Postgres / Supabase. Ajustar nombres si hace falta, pero respetar la forma.

```sql
-- businesses
id uuid pk default gen_random_uuid()
name text not null
daily_float numeric default 2000        -- fondo diario sugerido
created_at timestamptz default now()

-- profiles (1:1 con auth.users)
id uuid pk references auth.users(id)
business_id uuid references businesses(id)
name text not null
role text not null check (role in ('owner','runner'))
created_at timestamptz default now()

-- fundings (entregas/recargas de dinero)
id uuid pk default gen_random_uuid()
business_id uuid references businesses(id) not null
runner_id uuid references profiles(id)    -- a quién se le entregó
amount numeric not null
note text
created_at timestamptz default now()

-- expenses (gastos)
id uuid pk default gen_random_uuid()
business_id uuid references businesses(id) not null
runner_id uuid references profiles(id) not null   -- quién lo registró
store text not null
category text not null
concept text
subtotal numeric default 0
iva numeric default 0
ieps numeric default 0
total numeric not null            -- lo que baja del saldo
items jsonb default '[]'          -- [{name, qty, price}], misma forma que el prototipo
source text not null check (source in ('ocr','manual'))
photo_path text                   -- ruta en Storage (null si manual sin foto)
spent_at date default current_date
created_at timestamptz default now()
```

**Items como JSONB** para reflejar el prototipo y agilizar. Si más adelante se quiere reportería por producto, se normaliza a una tabla hija; no es necesario para v1.

**Storage:** bucket privado `receipts`. La foto se sube ahí; `photo_path` guarda la ruta. El dueño la ve vía **signed URL** temporal.

## 6. OCR (lectura de tickets)

- **Proveedor por defecto: Google Gemini (free tier).** Elegido para que el OCR salga **gratis** al volumen de un restaurante. Diseñar el server route como **intercambiable**: una sola función `readReceipt(imageBase64)` con el proveedor detrás, para poder cambiar a Anthropic sin tocar el resto de la app.
- Endpoint **server-side**: `POST /api/read-receipt` (API route / server action de Next.js). **Nunca** exponer la API key en el cliente (el SDK de Gemini lo advierte explícitamente).
- Recibe la imagen (reducida a ~1100px antes de mandarla, para gastar menos tokens), llama a **Gemini** con visión usando `process.env.GEMINI_API_KEY`, y devuelve el JSON parseado.
- **Reusar el prompt exacto** de la función `readReceipt` en `cuadra.jsx` (extrae `store, dateISO, subtotal, iva, ieps, total, items[]`; devuelve `{"error":"ilegible"}` si no se puede leer).
- **SDK y modelo (Gemini):** paquete oficial `@google/genai` (Google Gen AI SDK). Modelo por defecto `gemini-2.5-flash` (buena visión + elegible en free tier; alternativa de mayor cuota `gemini-2.5-flash-lite`). **Confirmar en la página de pricing de AI Studio qué modelos Flash muestran "Free tier: Available"** — Google lo cambia seguido. NO usar modelos Pro (son de pago) ni `gemini-flash-latest` (apunta a un Flash de pago).
- **Formato de la key:** las keys nuevas de AI Studio son *auth keys* con prefijo `AQ.` (las viejas `AIza` se están apagando en 2026). Funcionan de forma **nativa** con `@google/genai`. **No** enrutar el OCR por la ruta OpenAI-compatible de Gemini: ahí las `AQ.` fallan con 401.
- Forzar salida JSON con `responseMimeType: "application/json"` (opcionalmente un `responseSchema`) y parsear `response.text`. Referencia de la llamada:
  ```ts
  import { GoogleGenAI } from "@google/genai";
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const r = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { inlineData: { mimeType: "image/jpeg", data: base64SinPrefijo } },
      { text: PROMPT_DE_readReceipt },
    ],
    config: { responseMimeType: "application/json" },
  });
  const data = JSON.parse(r.text); // {store, dateISO, subtotal, iva, ieps, total, items}
  ```
- **Alternativa de pago (fallback, ya soportada por el diseño intercambiable):** Anthropic con `process.env.ANTHROPIC_API_KEY`, modelo `claude-haiku-4-5-20251001` (sub-centavo por ticket, y no entrena con tus datos). Útil cuando el producto escale a varios negocios y una sola key gratis de Gemini tope su cuota (los límites del free tier son por proyecto de Google Cloud, no por key).
- El resultado **siempre se muestra editable** antes de guardar (igual que el prototipo). Si falla, cae a **captura manual**.
- Flujo en el teléfono: el mandadero toma la foto → se sube a Storage → server lee → devuelve datos → el mandadero confirma/corrige → se guarda el expense con su `photo_path`.

## 7. Captura manual (para locales sin ticket: tortillería, mercado)

Mismos campos que el prototipo: `store`, `spent_at`, `category`, `concept` (opcional), `items[]` (opcional, con name/qty/price), `subtotal`, `iva`, `ieps`, `total` (requerido). Validar: `store` no vacío y `total > 0`.

## 8. Categorías, periodos y export

- Categorías: `Alimentos, Bebidas, Abarrotes, Carnes, Frutas y verduras, Limpieza, Desechables, Otros`.
- Vista dueño con tabs **Hoy / Semana (últimos 7 días) / Mes (mes calendario)**, desglose por categoría, y movimientos agrupados por día (igual que el prototipo).
- Botón **Exportar a Excel** (CSV con BOM UTF-8) del periodo seleccionado.

## 9. Seguridad (obligatorio)

- **RLS activado** en todas las tablas:
  - `profiles`: cada quien lee su propio perfil; el dueño lee perfiles de su `business_id`.
  - `expenses` / `fundings`: lectura y escritura restringida a filas del mismo `business_id`. El `runner` solo inserta/lee sus propios `expenses`; el `owner` lee todo el negocio y crea `fundings`.
- Llaves **solo server-side**: `SUPABASE_SERVICE_ROLE_KEY` y `GEMINI_API_KEY` (y `ANTHROPIC_API_KEY` si se usa el fallback) jamás en el bundle del cliente.
- Bucket `receipts` privado; acceso solo vía signed URLs generadas en el server.

## 10. PWA (listo para teléfono)

- `manifest.json` (nombre "Cuadra", iconos 192/512, theme color verde tinta `#14241C`, display `standalone`, orientación portrait).
- Service worker para instalabilidad y cache básico de la shell (p. ej. `next-pwa` o SW manual). App-first / mobile-first.
- Objetivo: abrir la URL en Chrome del teléfono → "Agregar a pantalla de inicio" → se comporta como app.
- **Notificaciones push: NO en v1.** Las alertas al dueño quedan dentro de la app (feed de movimientos). Dejar el web-push (VAPID) como mejora posterior y anotarlo en el README. No prometer push funcionando.

## 11. Stack y variables de entorno

- **Next.js (App Router) + TypeScript**, deploy en **Vercel**.
- **Supabase**: Postgres + Auth + Storage.
- `.env.local`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=...
  NEXT_PUBLIC_SUPABASE_ANON_KEY=...        # publishable key (o legacy anon)
  SUPABASE_SERVICE_ROLE_KEY=...            # solo server (secret / legacy service_role)
  GEMINI_API_KEY=...                       # solo server — OCR (Google AI Studio, free tier)
  # ANTHROPIC_API_KEY=...                  # solo server — opcional, fallback de OCR de pago
  ```

## 12. Entregables esperados de Claude Code

1. App Next.js corriendo en local (`npm run dev`) con el login real y los dos roles.
2. Migraciones SQL del schema + políticas RLS (en `/supabase` o como SQL para correr en el editor de Supabase).
3. OCR funcionando vía server route con la API key.
4. PWA instalable.
5. Deploy a Vercel (o instrucciones exactas para hacerlo).
6. `README.md` con: cómo correr local, cómo crear el primer negocio + cuenta de dueño, cómo el dueño da de alta al mandadero, y la nota honesta sobre push notifications.
7. Antes de hacer deploy o tocar credenciales, **preguntar** y confirmar conmigo.

---

**Recordatorio final:** la UX, los copys en español, el diseño y la lógica del dinero ya están validados en `cuadra.jsx`. Construir el backend y el auth **alrededor** de eso. Si algo del prototipo entra en conflicto con producción, marcarlo y preguntar — no rehacer por tu cuenta.
