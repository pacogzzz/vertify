-- ============================================================
-- Vertify v2 (antes Cuadra) — pagos efectivo/tarjeta, fotos de
-- entrega de efectivo, fotos solo para el dueño, alerta de $700.
-- Correr en el editor SQL de Supabase DESPUÉS de 0001_init.sql.
-- ============================================================

-- ---------- expenses: método de pago + campos ahora opcionales ----------

alter table public.expenses
  add column if not exists payment_method text not null default 'efectivo'
  check (payment_method in ('efectivo','tarjeta'));

-- El encargado ya no captura categoría/concepto; quedan opcionales
alter table public.expenses alter column category set default '';
alter table public.expenses alter column category drop not null;

-- ---------- fundings: foto obligatoria de la entrega de efectivo ----------

alter table public.fundings add column if not exists photo_path text;

-- ---------- businesses: alerta de efectivo bajo ----------

alter table public.businesses
  add column if not exists low_cash_threshold numeric not null default 700;

alter table public.businesses
  add column if not exists low_cash_alerted boolean not null default false;

-- El encargado (runner) necesita poder ver el nombre del negocio y el
-- dueño necesita actualizar el flag de alerta: ya cubierto por 0001.

-- ---------- Storage: bucket privado para fotos de entrega de efectivo ----------

insert into storage.buckets (id, name, public)
values ('cash-photos', 'cash-photos', false)
on conflict (id) do nothing;

-- Ruta convenida: cash-photos/{business_id}/{YYYY-MM}/{YYYY-MM-DD}_{id}.jpg
-- Solo el dueño sube y lee fotos de entregas.
create policy "owner uploads cash photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cash-photos'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() = 'owner'
  );

create policy "owner reads cash photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cash-photos'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() = 'owner'
  );

-- ---------- Tickets: solo el dueño puede VERLOS (el encargado solo sube) ----------

drop policy if exists "members read receipts" on storage.objects;

create policy "owner reads receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() = 'owner'
  );

-- ---------- businesses: el dueño ya puede update (policy de 0001) ----------
-- Nada más que hacer aquí.
