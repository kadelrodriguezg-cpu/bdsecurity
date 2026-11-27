-- Clase 4: sesiones de polinización sin evento de bitácora (A1-G2-06 / A1-024; invariante P14).
--
-- Una fila de public.polinizacion_evento sin ningún evento de bitácora
-- (registros_evento, tipo 'polinizacion', no eliminado) del mismo cruce y fecha.
-- Causa: agregarPolinizacionEvento escribe en cuatro pasos sin transacción; si
-- falla el registro de historial, la sesión queda guardada sin su fila narrativa.
-- No afecta el total de flores ni el ranking; el Historial de la ficha no la muestra.
--
-- Qué corrige el script de aplicación: crea el evento de bitácora que faltó (uno
-- por cruce y fecha; si hay varias sesiones el mismo día usa la más reciente).
-- Se excluyen los cruces archivados (hay que restaurarlos antes).
--
-- SOLO LECTURA. Uso:
--   docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
--     [-v filtro_codigo=LIMP-] < informe_sesiones_sin_bitacora.sql
-- Variable: filtro_codigo ('') = solo cruces cuyo codigo_sistema empieza con ese texto.
\set ON_ERROR_STOP on
\if :{?filtro_codigo}
\else
  \set filtro_codigo ''
\endif

begin read only;

\echo '== Clase 4: sesiones de polinización sin evento de bitácora =='
select count(*) as sesiones_sin_bitacora,
       count(*) filter (where pl.eliminado_at is null) as en_cruces_activos,
       count(*) filter (where pl.eliminado_at is not null) as excluidas_cruce_archivado,
       count(distinct (e.planta_id, e.fecha)) filter (where pl.eliminado_at is null) as eventos_a_crear
from public.polinizacion_evento e
join public.plantas pl on pl.id = e.planta_id
where starts_with(pl.codigo_sistema, :'filtro_codigo')
  and not exists (
    select 1 from public.registros_evento r
    where r.planta_id = e.planta_id and r.tipo_evento = 'polinizacion'
      and r.fecha = e.fecha and r.eliminado_at is null);

\echo 'Detalle (hasta 100)'
select pl.codigo_sistema, e.id as sesion_id, e.fecha, e.n_flores_cruzadas, e.es_reconstruccion,
       e.created_by, e.created_at, pl.eliminado_at is not null as cruce_archivado
from public.polinizacion_evento e
join public.plantas pl on pl.id = e.planta_id
where starts_with(pl.codigo_sistema, :'filtro_codigo')
  and not exists (
    select 1 from public.registros_evento r
    where r.planta_id = e.planta_id and r.tipo_evento = 'polinizacion'
      and r.fecha = e.fecha and r.eliminado_at is null)
order by pl.codigo_sistema, e.fecha, e.created_at
limit 100;

rollback;
