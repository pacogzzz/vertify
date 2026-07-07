# Cuadra

Control de gastos del mandadero para restaurantes: el dueño entrega un fondo, el mandadero compra y registra cada gasto con foto del ticket (OCR) o a mano, y el saldo baja solo. **Saldo = Σ(recargas) − Σ(gastos)**; lo que sobra se arrastra al día siguiente.

Port de producción del prototipo `cuadra.jsx` (la implementación de referencia — UI, copys y lógica de dinero intactos).

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
| `SUPABASE_SERVICE_ROLE_KEY` | **solo server** | Crea cuentas y firma URLs de tickets |
| `GEMINI_API_KEY` | **solo server** | OCR de tickets (Google AI Studio, free tier) |
| `ANTHROPIC_API_KEY` | **solo server** | Opcional: fallback de OCR de pago |

## 2. Base de datos (una sola vez)

Abre el **SQL Editor** de tu proyecto en [supabase.com](https://supabase.com) y corre completo:

```
supabase/migrations/0001_init.sql
```

Eso crea las tablas (`businesses`, `profiles`, `fundings`, `expenses`), **activa RLS** en todas (aislamiento por `business_id`: el mandadero solo ve sus gastos, el dueño ve todo su negocio) y crea el bucket **privado** `receipts` con sus políticas. Las fotos se ven solo vía signed URLs generadas en el server.

## 3. Crear el negocio y la cuenta del dueño

1. Abre la app → **"Crea tu negocio"** (`/registro`).
2. Llena nombre del negocio, tu nombre, correo y contraseña (mínimo 8 caracteres).
3. Entras directo como **dueño**: verás el saldo, las vistas Hoy/Semana/Mes y el botón de recarga.

## 4. Dar de alta al mandadero

1. Como dueño, toca el engrane (**Ajustes**) → **"Crear cuenta del mandadero"**.
2. Pon su nombre, un correo y una contraseña, y pásale esas claves **en persona**.
3. El mandadero entra una vez en `/login` desde su teléfono y su sesión queda guardada. Él solo ve su saldo y sus propios gastos.

## 5. Instalar como app en el teléfono

Abre la URL en Chrome del teléfono → menú → **"Agregar a pantalla de inicio"**. Se instala como app (pantalla completa, ícono propio, orientación vertical).

> **Nota honesta sobre notificaciones push:** NO hay push en v1. Las alertas al dueño viven dentro de la app (el feed de movimientos). El upgrade a web-push (VAPID) queda anotado como mejora posterior.

## 6. OCR de tickets

- Endpoint server-side `POST /api/read-receipt`; la key **nunca** toca el cliente.
- Proveedor por defecto: **Gemini** (`@google/genai`, modelo `gemini-2.5-flash`, salida JSON forzada). Las keys nuevas `AQ.` de AI Studio funcionan nativas con este SDK; **no** usar la ruta OpenAI-compatible.
- Diseño intercambiable (`lib/ocr.ts`): si Gemini falla por error técnico y hay `ANTHROPIC_API_KEY`, cae a **Claude Haiku** automáticamente. Con `OCR_PROVIDER=anthropic` inviertes el orden.
- El resultado siempre se muestra **editable** antes de guardar; si el ticket es ilegible, la app cae a captura manual.

## 7. Deploy en Vercel

1. Sube el repo a GitHub y en [vercel.com](https://vercel.com) → **Add New Project** → importa el repo (framework: Next.js, sin config extra).
2. En **Settings → Environment Variables** agrega las cinco variables de `.env.local` (las secretas solo como server-side, jamás con prefijo `NEXT_PUBLIC_`).
3. Deploy. Abre la URL de producción en el teléfono e instálala (paso 5).

## 8. Decisiones marcadas (prototipo vs producción)

- **"Reiniciar datos" se quitó**: en el prototipo borraba el storage local para demos; en producción borraría gastos reales del negocio. Si lo quieres de vuelta (solo dueño, con doble confirmación), es un cambio pequeño.
- **Saldo del mandadero**: como en el prototipo, el saldo es del negocio completo (v1 = un mandadero). Con varios mandaderos habría que llevar saldo por persona.
- **Multi-negocio**: el modelo de datos ya lo soporta (todo cuelga de `business_id` con RLS); la UI de v1 asume un negocio por usuario.
