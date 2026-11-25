-- ============================================================
-- Vertify — corte_cerrado_hoy() usaba current_date (zona horaria del
-- servidor, UTC), no la fecha local de México: pasada la medianoche UTC
-- (6pm en México) ya no coincidía con la fecha que el cliente guardó, y
-- Caja podía volver a ver el formulario vacío el mismo día. Ahora recibe
-- la fecha ya calculada en el navegador (igual que el resto de la app).
-- Correr en el editor SQL de Supabase DESPUÉS de 0009_ventas_flujos_fase1_caja.sql.
-- ============================================================

drop function if exists public.corte_cerrado_hoy();

create function public.corte_cerrado_hoy(p_fecha date)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cortes_caja
    where business_id = public.current_business_id() and fecha = p_fecha
  );
$$;

grant execute on function public.corte_cerrado_hoy(date) to authenticated;
