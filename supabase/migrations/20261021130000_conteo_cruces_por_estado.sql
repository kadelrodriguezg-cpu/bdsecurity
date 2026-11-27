-- =============================================================================
-- MIGRACIÓN 20261021130000 — CONTEO DE CRUCES POR ESTADO EN EL SERVIDOR
-- (brecha B8)
--
-- Problema que cierra: conteoPorEstado (frontend/src/api/plantas.ts) traía
-- TODOS los cruces para contarlos en el cliente. Con ~2000 cruces eso son
-- 2000 filas por cada carga del inicio, y además PostgREST corta en max_rows
-- (1000, supabase/config.toml): pasado ese número el conteo salía mal.
--
-- La RPC agrupa en la base y devuelve un objeto {estado: cantidad}, la misma
-- forma que ya consumía la pantalla. SECURITY INVOKER sobre la vista
-- plantas_operativas (security_invoker = on): respeta el RLS de plantas y no
-- toca linaje. Excluye cruces de prueba y archivados, igual que el listado.
-- =============================================================================

create or replace function conteo_cruces_por_estado()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_object_agg(estado, cantidad), '{}'::jsonb)
  from (
    select estado, count(*) as cantidad
    from plantas_operativas
    where not es_prueba
    group by estado
  ) por_estado;
$$;

comment on function conteo_cruces_por_estado() is
  'Cantidad de cruces vivos (sin pruebas ni archivados) por estado, como objeto {estado: cantidad}. Agrega en la base en vez de traer todas las filas al cliente.';

revoke all on function conteo_cruces_por_estado() from public, anon;
grant execute on function conteo_cruces_por_estado() to authenticated, service_role;
