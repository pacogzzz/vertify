-- ============================================================
-- Vertify — Lista Compra Fase 2: el Chef necesita el nivel_max de
-- cada insumo para la alerta de exceso (no es dinero, se puede
-- mandar sin problema). Se cambia la forma de la función, así que
-- hay que tirarla y volver a crearla (CREATE OR REPLACE no deja
-- cambiar las columnas de salida).
-- Correr en el editor SQL de Supabase DESPUÉS de 0005_monto_solicitud.sql.
-- ============================================================

drop function if exists public.insumos_para_chef();

create function public.insumos_para_chef()
returns table (id uuid, categoria text, nombre text, unidad text, nivel_max numeric)
language sql stable security definer
set search_path = public
as $$
  select id, categoria, nombre, unidad, nivel_max
  from public.insumos
  where business_id = public.current_business_id() and activo = true
  order by categoria, nombre;
$$;

grant execute on function public.insumos_para_chef() to authenticated;
