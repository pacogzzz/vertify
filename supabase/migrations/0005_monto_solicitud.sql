-- ============================================================
-- Vertify — Lista Compra: el dinero que representa una solicitud
-- de compra (para que Rubén y el dueño vean cuánto se está
-- quitando, no solo el nombre del insumo).
-- Correr en el editor SQL de Supabase DESPUÉS de 0004_lista_compra.sql.
-- ============================================================

alter table public.solicitudes add column if not exists monto numeric;
-- Solo aplica a tipo='compra' (requerido × precio del insumo en ese
-- momento); en tipo='precio' se queda en null, porque ahí el precio
-- antes/después ya lo dicen precio_actual/precio_propuesto.
