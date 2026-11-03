# Vertify — notas para Claude

Contexto operativo del repo. Ver también `README.md` (cómo correr/usar la
app) y `cuadra-context.md` (especificación original del producto).

## Publicación

Push a `main` publica solo — no hay paso manual. El plan Hobby de Vercel
solo deja publicar a miembros del equipo, así que el push de un
colaborador que no es el dueño lo bloquea Vercel directamente; para eso
existe `.github/workflows/deploy.yml`, que publica con el token de
Vercel del dueño en su lugar. Cuando publica el dueño, Vercel lo hace
solo y ese workflow se salta.

**No modificar ese workflow** (no agregar paso de build, caché, ni
`vercel pull`/`vercel build --prebuilt`). Es deliberado que NO compile
dentro de GitHub Actions: solo sube el código y deja que Vercel lo
compile de su lado, que es donde existen las variables de entorno
(Supabase, Gemini, correo). Ya se intentó compilar en Actions y tumbó
producción — el token no puede leer esas variables ahí, el build salía
sin llaves y el middleware tronaba (`MIDDLEWARE_INVOCATION_FAILED`) en
todas las rutas. Si crees que hace falta tocarlo, pregunta antes de
hacerlo.

## Base de datos: las migraciones no se aplican solas

El código vive en GitHub/Vercel; la base vive en Supabase. Nada las
sincroniza. Si agregas un archivo en `supabase/migrations/`, hay que
pegarlo y correrlo A MANO en el SQL Editor de Supabase — decirlo
explícitamente en la respuesta (nombre del archivo + el recordatorio de
correrla), nunca darlo por hecho. Si se publica código que le pide a la
base algo que todavía no existe, la app truena al entrar.

Estado actual: `0001`, `0002` y `0003` ya están aplicadas en producción.

## Storage: nunca `upsert: true`

Con `upsert: true`, Storage lee el objeto antes de escribirlo, y desde
la migración `0002` el encargado no tiene permiso de lectura sobre
`receipts`: la subida falla con 403 de RLS. Las rutas ya llevan un UUID
nuevo cada vez, así que no hay nada que reemplazar. Hay un check de E2E
que falla si esto se revierte (ver `scripts/e2e-check.mjs`).

## Secretos

`.env.local` está en `.gitignore` y ahí se queda — nunca subirlo ni
pegar sus valores en chat, commits o issues. Las variables de
producción ya están configuradas en Vercel; no hay que tocarlas,
mandarlas ni volverlas a generar.

Nunca deben llegar al cliente: `SUPABASE_SERVICE_ROLE_KEY`,
`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `SMTP_USER`, `SMTP_PASS`.

## Datos del proyecto

| | |
|---|---|
| Stack | Next.js 15 (App Router) + TypeScript, Supabase (Auth, Postgres con RLS, Storage privado), Vercel |
| Producción | https://vertify-lacorte.vercel.app |
| Tiendas | lista en `lib/stores.ts` (array `as const`); agregar una es solo editar ese archivo |
| Migraciones | `supabase/migrations/` |
| Pruebas | `node --env-file=.env.local scripts/e2e-check.mjs` |
| TypeScript | quedarse en la v5 — la v6 rompe Next 15 |

Antes de subir un cambio, correr `npx tsc --noEmit`.
