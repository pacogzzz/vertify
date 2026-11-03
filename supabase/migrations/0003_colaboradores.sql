-- ============================================================
-- Vertify — Colaboradores: usuario sin correo, roles Chef /
-- Administrador / Caja, y acceso de solo-lectura para Administrador.
-- Correr en el editor SQL de Supabase DESPUÉS de 0002_vertify.sql.
-- ============================================================

-- ---------- profiles: usuario (sin correo real) ----------

alter table public.profiles add column if not exists username text unique;

-- ---------- profiles: nuevos roles ----------
-- "runner" (Encargado) y "owner" ya existían. Se agregan "chef", "admin"
-- (Administrador, hoy de solo lectura) y "caja" (sin interfaz todavía).

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'runner', 'chef', 'admin', 'caja'));

-- El dueño ya podía actualizar cualquier perfil de su negocio (política de
-- 0001); se ajusta para que ese camino genérico NUNCA pueda convertir a
-- alguien en "owner" — ni de encargado a dueño, ni el propio dueño por
-- accidente. Crear/quitar al dueño no pasa por aquí.
drop policy if exists "owner updates business profiles" on public.profiles;
create policy "owner updates business profiles" on public.profiles
  for update to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() = 'owner')
  with check (
    business_id = public.current_business_id()
    and role in ('runner', 'chef', 'admin', 'caja')
  );

-- ---------- Administrador: mismo panel de solo-lectura que el dueño ----------
-- Mismo alcance de lectura que el dueño sobre gastos y perfiles de su
-- negocio; nunca escritura (recargar, ajustes, colaboradores siguen
-- restringidos a 'owner' en sus políticas / endpoints).

create policy "admin reads business expenses" on public.expenses
  for select to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() = 'admin');

create policy "admin reads business profiles" on public.profiles
  for select to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() = 'admin');

-- `fundings` ya es legible por cualquier miembro del negocio (política de
-- 0001, sin restricción de rol), así que Administrador ya puede verlas.
-- Las fotos (recibos y entregas de efectivo) las sirve /api/receipt-url y
-- /ticket/:id con el service role (saltan RLS); ahí se amplió el chequeo
-- de rol a 'owner' u 'admin' en el código, no hace falta tocar storage.
