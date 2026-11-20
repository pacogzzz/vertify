-- ============================================================
-- Vertify — Lista Compra Fase 3: reducir compra (ahorro), y
-- funciones de solo-lectura para que el Chef vea notificaciones
-- e historial SIN precio (sigue sin poder leer `insumos.precio`
-- ni la tabla `solicitudes`, que trae dinero).
-- Correr en el editor SQL de Supabase DESPUÉS de 0006_alertas_lista_compra.sql.
-- ============================================================

-- comprado: cantidad real que Rubén compró, si fue menor a `requerido`
-- (reducción). NULL = compró exactamente lo pedido.
alter table public.lista_compra_items add column if not exists comprado numeric;
alter table public.lista_compra_items add column if not exists nota_reduccion text;

-- ---------- notificaciones_chef(): insumos que el dueño aprobó quitar de
-- la lista, con el motivo, para las listas del Chef que llama. Nunca trae
-- dinero (ni precio ni monto) ----------
create or replace function public.notificaciones_chef()
returns table (id uuid, insumo_nombre text, nota text, fecha date, resuelto_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select s.id, s.insumo_nombre, s.nota, i.fecha, s.resuelto_at
  from public.solicitudes s
  join public.lista_compra_items i on i.id = s.lista_compra_item_id
  join public.listas_compra l on l.id = i.lista_id
  where l.chef_id = auth.uid()
    and s.tipo = 'compra'
    and s.status = 'aprobada'
  order by s.resuelto_at desc
  limit 60;
$$;

grant execute on function public.notificaciones_chef() to authenticated;

-- ---------- historial_chef(fecha): la lista de un día pasado del Chef que
-- llama, tal como quedó, sin precio ----------
create or replace function public.historial_chef(p_fecha date)
returns table (
  insumo_id uuid, nombre text, categoria text, unidad text,
  requerido numeric, existencia numeric, comprado numeric, status text
)
language sql stable security definer
set search_path = public
as $$
  select i.insumo_id, i.nombre, i.categoria, i.unidad, i.requerido, i.existencia, i.comprado, i.status
  from public.lista_compra_items i
  join public.listas_compra l on l.id = i.lista_id
  where l.chef_id = auth.uid() and i.fecha = p_fecha
  order by i.categoria, i.nombre;
$$;

grant execute on function public.historial_chef(date) to authenticated;
