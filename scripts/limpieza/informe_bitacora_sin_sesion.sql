-- Clase 5: eventos de bitácora de polinización sin sesión (A1-G2-06 / A1-024; invariante P13).
--
-- Un evento de registros_evento (tipo 'polinizacion', no eliminado) sin ninguna
-- sesión en polinizacion_evento del mismo cruce y fecha: «bitácora falsa». Causas:
-- quitarUltimoPolinizacionEvento borra la sesión pero no su evento, o el insert
-- de la sesión falló después de haberse escrito el evento. El Historial muestra
-- una sesión que ya no existe.
--
-- Qué corrige el script de aplicación: marca el evento como eliminado (borrado
-- lógico, reversible: eliminado_at = null lo restaura). Solo corrige los
-- AUTOMATIZABLES: sin archivos adjuntos, cruce activo y fuera de proceso_finalizado.
-- Los demás se listan aquí como «revisar a mano».
--
-- SOLO LECTURA. Uso:
--   docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
--     [-v filtro_codigo=LIMP-] < informe_bitacora_sin_sesion.sql
-- Variable: filtro_codigo ('') = solo cruces cuyo codigo_sistema empieza con ese texto.
\set ON_ERROR_STOP on
\if :{?filtro_codigo}
\else
  \set filtro_codigo ''
\endif

begin read only;

\echo '== Clase 5: eventos de bitácora de polinización sin sesión =='
with huerfanos as (
  select r.id, r.planta_id, r.fecha, r.notas, pl.codigo_sistema, pl.estado, pl.eliminado_at as cruce_archivado,
         exists (select 1 from public.evento_archivos a where a.registro_id = r.id) as con_archivos
  from public.registros_evento r
  join public.plantas pl on pl.id = r.planta_id
  where r.tipo_evento = 'polinizacion' and r.eliminado_at is null
    and starts_with(pl.codigo_sistema, :'filtro_codigo')
    and not exists (select 1 from public.polinizacion_evento e where e.planta_id = r.planta_id and e.fecha = r.fecha)
)
select count(*) as bitacora_sin_sesion,
       count(*) filter (where cruce_archivado is null and estado <> 'proceso_finalizado' and not con_archivos) as automatizables,
       count(*) filter (where con_archivos) as revisar_a_mano_con_archivos,
       count(*) filter (where cruce_archivado is not null) as revisar_a_mano_cruce_archivado,
       count(*) filter (where cruce_archivado is null and estado = 'proceso_finalizado') as revisar_a_mano_proceso_finalizado
from huerfanos;

\echo 'Detalle (hasta 100)'
select pl.codigo_sistema, r.id as registro_id, r.fecha, r.created_by, r.created_at,
       r.notas is not null and btrim(r.notas) <> '' as tiene_notas,
       exists (select 1 from public.evento_archivos a where a.registro_id = r.id) as con_archivos,
       pl.estado, pl.eliminado_at is not null as cruce_archivado,
       case when pl.eliminado_at is not null then 'revisar a mano: cruce archivado'
            when pl.estado = 'proceso_finalizado' then 'revisar a mano: proceso finalizado'
            when exists (select 1 from public.evento_archivos a where a.registro_id = r.id) then 'revisar a mano: tiene archivos'
            else 'automatizable' end as tratamiento
from public.registros_evento r
join public.plantas pl on pl.id = r.planta_id
where r.tipo_evento = 'polinizacion' and r.eliminado_at is null
  and starts_with(pl.codigo_sistema, :'filtro_codigo')
  and not exists (select 1 from public.polinizacion_evento e where e.planta_id = r.planta_id and e.fecha = r.fecha)
order by pl.codigo_sistema, r.fecha
limit 100;

rollback;
