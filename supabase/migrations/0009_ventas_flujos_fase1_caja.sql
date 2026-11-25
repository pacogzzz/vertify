-- ============================================================
-- Vertify — Ventas y flujos Fase 1: captura de Caja.
-- Caja nunca lee nada de dinero: solo inserta (vía
-- /api/cortes-caja con el service role, igual que insumos/
-- solicitudes) y puede preguntar si ya cerró turno hoy con
-- corte_cerrado_hoy() (sin montos).
-- Correr en el editor SQL de Supabase DESPUÉS de 0008_insumos_para_chef_nivel_min.sql.
-- ============================================================

-- ---------- cortes_caja: un cierre de turno por día ----------

create table if not exists public.cortes_caja (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) not null,
  fecha date not null,
  caja_id uuid references public.profiles(id) not null,
  venta_efectivo numeric not null,
  venta_tarjeta numeric not null,
  foto_sobre_path text not null,
  foto_excel_path text not null,
  excel_venta_path text not null,
  created_at timestamptz default now(),
  unique (business_id, fecha)
);

-- ---------- gastos_caja: gastos que se sacaron de caja ese día ----------

create table if not exists public.gastos_caja (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) not null,
  corte_id uuid references public.cortes_caja(id) not null,
  monto numeric not null,
  concepto text not null,
  foto_path text not null,
  created_at timestamptz default now()
);

create index if not exists gastos_caja_corte_idx on public.gastos_caja (corte_id);

-- ---------- RLS ----------

alter table public.cortes_caja enable row level security;
alter table public.gastos_caja enable row level security;

-- Nada de insert/update/delete por RLS en ninguna de las dos tablas: todo
-- pasa por /api/cortes-caja con el service role (igual que insumos y
-- solicitudes) — así Caja nunca puede leer ni modificar directo.
create policy "dueno admin leen cortes_caja" on public.cortes_caja
  for select to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() in ('owner', 'admin'));

create policy "dueno admin leen gastos_caja" on public.gastos_caja
  for select to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() in ('owner', 'admin'));

-- ---------- corte_cerrado_hoy(): Caja pregunta si ya cerró turno hoy,
-- sin poder leer ningún monto (bypassa RLS a propósito, nunca selecciona
-- columnas de dinero) ----------
create or replace function public.corte_cerrado_hoy()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cortes_caja
    where business_id = public.current_business_id() and fecha = current_date
  );
$$;

grant execute on function public.corte_cerrado_hoy() to authenticated;

-- ---------- Storage: fotos de Caja (sobre, pantalla de excel, gastos) y
-- documentos (excel de venta) — solo Caja sube, solo Dueño/Admin leen ----------

insert into storage.buckets (id, name, public) values ('caja-photos', 'caja-photos', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;

-- Ruta convenida: {bucket}/{business_id}/{YYYY-MM}/{YYYY-MM-DD}_{tag}_{id}.ext
create policy "caja sube fotos de caja" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'caja-photos'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() = 'caja'
  );

create policy "dueno admin leen fotos de caja" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'caja-photos'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() in ('owner', 'admin')
  );

create policy "caja sube documentos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() = 'caja'
  );

create policy "dueno admin leen documentos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() in ('owner', 'admin')
  );
