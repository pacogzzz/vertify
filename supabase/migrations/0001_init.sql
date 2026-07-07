-- ============================================================
-- Cuadra — schema inicial + RLS + Storage
-- Correr en el editor SQL de Supabase (o con supabase db push).
-- ============================================================

-- ---------- Tablas ----------

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  daily_float numeric default 2000,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) not null,
  name text not null,
  role text not null check (role in ('owner','runner')),
  created_at timestamptz default now()
);

create table if not exists public.fundings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) not null,
  runner_id uuid references public.profiles(id),
  amount numeric not null check (amount > 0),
  note text,
  created_at timestamptz default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) not null,
  runner_id uuid references public.profiles(id) not null,
  store text not null,
  category text not null,
  concept text,
  subtotal numeric default 0,
  iva numeric default 0,
  ieps numeric default 0,
  total numeric not null check (total > 0),
  items jsonb default '[]',
  source text not null check (source in ('ocr','manual')),
  photo_path text,
  spent_at date default current_date,
  created_at timestamptz default now()
);

create index if not exists expenses_business_spent_idx on public.expenses (business_id, spent_at desc);
create index if not exists fundings_business_idx on public.fundings (business_id, created_at desc);

-- ---------- Helpers (evitan recursión de RLS sobre profiles) ----------

create or replace function public.current_business_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select business_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_business_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;

-- ---------- RLS ----------

alter table public.businesses enable row level security;
alter table public.profiles  enable row level security;
alter table public.fundings  enable row level security;
alter table public.expenses  enable row level security;

-- businesses: los miembros ven su negocio; solo el dueño lo edita
create policy "members read own business" on public.businesses
  for select to authenticated
  using (id = public.current_business_id());

create policy "owner updates business" on public.businesses
  for update to authenticated
  using (id = public.current_business_id() and public.current_user_role() = 'owner')
  with check (id = public.current_business_id());

-- profiles: cada quien lee el suyo; el dueño lee y edita los de su negocio
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "owner reads business profiles" on public.profiles
  for select to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() = 'owner');

create policy "owner updates business profiles" on public.profiles
  for update to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() = 'owner')
  with check (business_id = public.current_business_id());

-- fundings: todos los del negocio los ven; solo el dueño los crea
create policy "members read fundings" on public.fundings
  for select to authenticated
  using (business_id = public.current_business_id());

create policy "owner inserts fundings" on public.fundings
  for insert to authenticated
  with check (business_id = public.current_business_id() and public.current_user_role() = 'owner');

-- expenses: el dueño ve todo su negocio; el runner solo lo suyo
create policy "owner reads business expenses" on public.expenses
  for select to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() = 'owner');

create policy "runner reads own expenses" on public.expenses
  for select to authenticated
  using (business_id = public.current_business_id() and runner_id = auth.uid());

create policy "members insert own expenses" on public.expenses
  for insert to authenticated
  with check (business_id = public.current_business_id() and runner_id = auth.uid());

-- ---------- Storage: bucket privado para tickets ----------

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Ruta convenida: receipts/{business_id}/{expense_id}.jpg
create policy "members upload receipts" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = public.current_business_id()::text
  );

create policy "members read receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = public.current_business_id()::text
  );
