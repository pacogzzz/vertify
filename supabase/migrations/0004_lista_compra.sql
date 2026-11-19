-- ============================================================
-- Vertify — Lista Compra: catálogo de insumos, captura diaria
-- del Chef, checklist de Rubén, y solicitudes (precio / compra)
-- con aprobación del dueño.
-- Correr en el editor SQL de Supabase DESPUÉS de 0003_colaboradores.sql.
-- Después de correr esto, sembrar el catálogo con:
--   node --env-file=.env.local scripts/seed-insumos.mjs
-- ============================================================

-- ---------- insumos: catálogo del negocio ----------

create table if not exists public.insumos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) not null,
  categoria text not null,
  nombre text not null,
  unidad text not null,
  precio numeric,              -- null = sin precio todavía (Rubén lo propone, dueño aprueba)
  nivel_min numeric,           -- referencia para alertas (Fase 2)
  nivel_max numeric,
  activo boolean not null default true,
  created_at timestamptz default now()
);

create index if not exists insumos_business_idx on public.insumos (business_id, categoria, nombre);

-- ---------- listas_compra: el envío diario del Chef (una por chef por día) ----------

create table if not exists public.listas_compra (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) not null,
  chef_id uuid references public.profiles(id) not null,
  fecha date not null default current_date,
  created_at timestamptz default now(),
  unique (business_id, chef_id, fecha)
);

-- ---------- lista_compra_items: insumo por insumo dentro de esa lista ----------
-- Guarda nombre/categoría/unidad del insumo en el momento (snapshot): así el
-- Chef nunca necesita leer la tabla `insumos` (que trae el precio) para ver
-- su propia lista — ver política de lectura de `insumos` más abajo.

create table if not exists public.lista_compra_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) not null,
  lista_id uuid references public.listas_compra(id) not null,
  insumo_id uuid references public.insumos(id) not null,
  nombre text not null,
  categoria text not null,
  unidad text not null,
  fecha date not null default current_date, -- igual que en listas_compra: evita un join solo para filtrar "hoy"
  requerido numeric not null default 0,
  existencia numeric not null default 0,
  -- pendiente: recién pedido · confirmado: Rubén lo palomeó (comprado) ·
  -- rechazado: se aprobó una solicitud de compra para quitarlo (no se compra)
  status text not null default 'pendiente' check (status in ('pendiente', 'confirmado', 'rechazado')),
  confirmado_por uuid references public.profiles(id),
  confirmado_at timestamptz,
  created_at timestamptz default now(),
  unique (lista_id, insumo_id)
);

create index if not exists lista_items_business_idx on public.lista_compra_items (business_id, lista_id);

-- ---------- solicitudes: precio (Rubén propone un precio) o compra (Rubén
-- propone quitar un insumo de la lista de hoy) — siempre las resuelve el dueño ----------

create table if not exists public.solicitudes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) not null,
  tipo text not null check (tipo in ('precio', 'compra')),
  insumo_id uuid references public.insumos(id) not null,
  insumo_nombre text not null,                 -- snapshot, para mostrar sin hacer join
  lista_compra_item_id uuid references public.lista_compra_items(id), -- solo tipo='compra'
  precio_actual numeric,                        -- solo tipo='precio'
  precio_propuesto numeric,                     -- solo tipo='precio'
  nota text,
  solicitado_por uuid references public.profiles(id) not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'declinada')),
  resuelto_por uuid references public.profiles(id),
  resuelto_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists solicitudes_business_idx on public.solicitudes (business_id, status);

-- ---------- RLS ----------

alter table public.insumos enable row level security;
alter table public.listas_compra enable row level security;
alter table public.lista_compra_items enable row level security;
alter table public.solicitudes enable row level security;

-- insumos: el Chef NUNCA lee esta tabla directo (trae precio). Ve el
-- catálogo sin precio a través de la función insumos_para_chef() de abajo.
create policy "dueno admin encargado leen insumos" on public.insumos
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'admin', 'runner')
  );
-- Nada de insert/update/delete por RLS: el precio se cambia solo por
-- /api/insumos/precio (dueño) o /api/solicitudes/resolver (al aprobar), los
-- dos con el service role — así queda centralizado y auditable.

-- listas_compra: cualquiera del negocio la lee; solo el Chef la crea/actualiza.
create policy "negocio lee listas_compra" on public.listas_compra
  for select to authenticated
  using (business_id = public.current_business_id());

create policy "chef crea su lista" on public.listas_compra
  for insert to authenticated
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() = 'chef'
    and chef_id = auth.uid()
  );

create policy "chef actualiza su lista" on public.listas_compra
  for update to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() = 'chef'
    and chef_id = auth.uid()
  )
  with check (chef_id = auth.uid());

-- lista_compra_items: cualquiera del negocio la lee (sin precio: el precio
-- vive en `insumos`, no aquí). El Chef la crea/edita; Rubén solo puede
-- marcar "confirmado" (el palomeo) — "rechazado" únicamente lo pone el
-- servidor al aprobar una solicitud de compra, nunca el cliente.
create policy "negocio lee lista_compra_items" on public.lista_compra_items
  for select to authenticated
  using (business_id = public.current_business_id());

create policy "chef crea items de su lista" on public.lista_compra_items
  for insert to authenticated
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() = 'chef'
  );

-- OJO: el with check también lleva el rol (no solo el using). Postgres
-- combina el with check de varias políticas de UPDATE con OR, así que si
-- este faltara, el with check más permisivo de esta política se colaría
-- por encima del de "encargado palomea items" y dejaría a Rubén poner
-- cualquier status, incluido 'rechazado'.
create policy "chef edita items de su lista" on public.lista_compra_items
  for update to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() = 'chef')
  with check (business_id = public.current_business_id() and public.current_user_role() = 'chef');

create policy "encargado palomea items" on public.lista_compra_items
  for update to authenticated
  using (business_id = public.current_business_id() and public.current_user_role() = 'runner')
  with check (
    business_id = public.current_business_id()
    and status in ('pendiente', 'confirmado')
  );

-- solicitudes: dueño/administrador/encargado las leen (traen precios); el
-- Chef nunca. Solo el Encargado (Rubén) las crea; resolverlas (aprobar o
-- declinar) es siempre server-side con el service role.
create policy "dueno admin encargado leen solicitudes" on public.solicitudes
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'admin', 'runner')
  );

create policy "encargado crea solicitudes" on public.solicitudes
  for insert to authenticated
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() = 'runner'
    and solicitado_por = auth.uid()
    and status = 'pendiente'
  );

-- ---------- catálogo para el Chef, SIN precio (bypassa RLS a propósito,
-- igual que current_business_id()/current_user_role(): nunca selecciona la
-- columna `precio`, así que ni con el inspector de red se puede ver) ----------

create or replace function public.insumos_para_chef()
returns table (id uuid, categoria text, nombre text, unidad text)
language sql stable security definer
set search_path = public
as $$
  select id, categoria, nombre, unidad
  from public.insumos
  where business_id = public.current_business_id() and activo = true
  order by categoria, nombre;
$$;

grant execute on function public.insumos_para_chef() to authenticated;
