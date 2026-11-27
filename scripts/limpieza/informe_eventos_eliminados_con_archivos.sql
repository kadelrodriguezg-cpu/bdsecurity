-- Clase 3: eventos de bitácora eliminados (borrado lógico) que conservan sus archivos (invariante B03; A1-G3-20).
--
-- El borrado lógico (registros_evento.eliminado_at) no toca Storage: los
-- binarios y las filas de evento_archivos siguen ahí y un admin puede restaurar
-- el evento por la API. Por eso esta clase es SOLO INFORME: no existe script
-- de aplicación. Borrar esos archivos haría irrecuperable un evento que hoy se
-- puede restaurar; es una decisión de Kadel, evento por evento.
--
-- SOLO LECTURA. Uso:
--   docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
--     [-v filtro_codigo=LIMP-] < informe_eventos_eliminados_con_archivos.sql
-- Variable: filtro_codigo ('') = solo cruces cuyo codigo_sistema empieza con ese texto.
\set ON_ERROR_STOP on
\if :{?filtro_codigo}
\else
  \set filtro_codigo ''
\endif

begin read only;

\echo '== Clase 3: eventos eliminados con archivos todavía en Storage (solo informe) =='
select count(distinct r.id) as eventos, count(*) as archivos
from public.registros_evento r
join public.plantas pl on pl.id = r.planta_id
join public.evento_archivos a on a.registro_id = r.id
where r.eliminado_at is not null
  and starts_with(pl.codigo_sistema, :'filtro_codigo')
  and exists (select 1 from storage.objects o where o.bucket_id = 'media-plantas' and o.name = a.storage_path);

\echo 'Detalle (hasta 100)'
select pl.codigo_sistema, r.id as registro_id, r.tipo_evento, r.fecha, r.eliminado_at,
       a.id as archivo_id, a.storage_path, a.tipo
from public.registros_evento r
join public.plantas pl on pl.id = r.planta_id
join public.evento_archivos a on a.registro_id = r.id
where r.eliminado_at is not null
  and starts_with(pl.codigo_sistema, :'filtro_codigo')
  and exists (select 1 from storage.objects o where o.bucket_id = 'media-plantas' and o.name = a.storage_path)
order by r.eliminado_at, r.id
limit 100;

rollback;
