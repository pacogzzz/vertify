-- ============================================================
-- Vertify — Ventas y flujos Fase 2: fotos de la app bancaria que
-- sube el Dueño, con OCR automático (monto + concepto) y la
-- comparación contra lo que reportó Caja ese día. Encargado de
-- compra no tiene acceso a nada de esto; Administrador solo lee.
-- Correr en el editor SQL de Supabase DESPUÉS de 0010_corte_cerrado_hoy_fecha.sql.
-- ============================================================

create table if not exists public.fotos_banco (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) not null,
  fecha date not null,
  subido_por uuid references public.profiles(id) not null,
  foto_path text not null,
  monto numeric not null,
  concepto text not null check (concepto in ('efectivo', 'tarjeta')),
  -- snapshot calculado al guardar, comparando contra cortes_caja de esa fecha
  coincide boolean not null,
  created_at timestamptz default now()
);

create index if not exists fotos_banco_fecha_idx on public.fotos_banco (business_id, fecha);

alter table public.fotos_banco enable row level security;

-- Nada de insert/update/delete por RLS: todo pasa por /api/fotos-banco
-- con el service role (igual que cortes_caja), solo el dueño puede llamarlo.
create policy "dueno admin leen fotos_banco" on public.fotos_banco
  for select to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() in ('owner', 'admin'));

-- ---------- Storage: fotos de la app bancaria — solo el Dueño sube,
-- Dueño/Admin leen ----------

insert into storage.buckets (id, name, public) values ('banco-photos', 'banco-photos', false) on conflict (id) do nothing;

create policy "dueno sube fotos de banco" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'banco-photos'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() = 'owner'
  );

create policy "dueno admin leen fotos de banco" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'banco-photos'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() in ('owner', 'admin')
  );
