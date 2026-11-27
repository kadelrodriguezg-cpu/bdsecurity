-- Clase 2 (APLICAR): borra las filas de evento_archivos cuyo objeto ya no existe en
-- el bucket media-plantas. Ver informe_metadatos_sin_objeto.sql.
-- Solo evento_archivos; pcr_analisis.informe_pdf_url y evecl_respuesta.foto_path
-- no se tocan (son datos científicos: decisión humana).
--
-- NO ES PARA CORRER EN PRODUCCIÓN SIN respaldo previo (docs/respaldo_produccion.md)
-- y el OK escrito de Kadel. Probado solo en local. La fila borrada queda COMPLETA
-- (to_jsonb) en audit_log.detalle.fila, así que se puede reconstruir.
--
-- Una transacción: recalcula el conjunto, muestra el conteo y solo aplica si
-- confirmar=SI, esperado coincide y operador no está vacío; si no, rollback.
--
-- Uso (siempre PRIMERO sin confirmar):
--   docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
--     -v operador="nombre de quien ejecuta" [-v filtro_codigo=LIMP-] \
--     [-v esperado=<n> -v confirmar=SI] < aplicar_metadatos_sin_objeto.sql
-- Variables: operador (obligatoria para aplicar), confirmar ('NO'), esperado (''),
--            filtro_codigo ('') como en los demás scripts.
-- Si hay que restaurar binarios desde un respaldo de Storage, hacerlo ANTES de correr
-- este script (con los binarios de vuelta, estas filas vuelven a ser válidas).
\set ON_ERROR_STOP on
\if :{?confirmar}
\else
  \set confirmar NO
\endif
\if :{?esperado}
\else
  \set esperado ''
\endif
\if :{?operador}
\else
  \set operador ''
\endif
\if :{?filtro_codigo}
\else
  \set filtro_codigo ''
\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
lock table public.evento_archivos in share row exclusive mode;

create temp table _lim_archivos on commit drop as
select a.id as archivo_id, r.planta_id, r.id as registro_id, pl.codigo_sistema, a.storage_path, to_jsonb(a) as fila
from public.evento_archivos a
join public.registros_evento r on r.id = a.registro_id
join public.plantas pl on pl.id = r.planta_id
where starts_with(pl.codigo_sistema, :'filtro_codigo')
  and not exists (select 1 from storage.objects o where o.bucket_id = 'media-plantas' and o.name = a.storage_path);

select count(*) as n from _lim_archivos \gset
\echo 'Clase 2: filas de evento_archivos a borrar (objeto inexistente) =' :n
select codigo_sistema, storage_path, archivo_id from _lim_archivos order by codigo_sistema, storage_path limit 50;

select (:'confirmar' = 'SI' and :'esperado' = :'n' and :'operador' <> '') as autorizado \gset
\if :autorizado
  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  select null, l.planta_id, 'limpieza_datos', array['evento_archivos'],
         jsonb_build_object(
           'clase', 'metadato_sin_objeto', 'script', 'aplicar_metadatos_sin_objeto.sql',
           'cambio', 'borrar_fila_evento_archivos', 'archivo_id', l.archivo_id, 'registro_id', l.registro_id,
           'storage_path', l.storage_path, 'fila', l.fila,
           'motivo', 'La fila apuntaba a un objeto inexistente en media-plantas (ícono roto, A1-G3-10).',
           'operador', :'operador')
  from _lim_archivos l;

  delete from public.evento_archivos a using _lim_archivos l where a.id = l.archivo_id;

  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (null, null, 'limpieza_datos_resumen', array['evento_archivos'],
          jsonb_build_object('clase', 'metadato_sin_objeto', 'script', 'aplicar_metadatos_sin_objeto.sql',
                             'filas_borradas', :'n'::int, 'esperado', :'esperado', 'filtro_codigo', :'filtro_codigo',
                             'operador', :'operador'));

  select count(*) as faltan from _lim_archivos l where exists (select 1 from public.evento_archivos a where a.id = l.archivo_id) \gset
  select (:faltan = 0) as verificado \gset
  \if :verificado
    commit;
    \echo 'APLICADO: filas de evento_archivos borradas =' :n
  \else
    rollback;
    \echo 'ERROR: la verificación posterior falló; se revirtió todo.'
  \endif
\else
  rollback;
  \echo 'NO SE APLICÓ NADA (rollback). Para aplicar: -v confirmar=SI -v esperado=' :n ' -v operador="..."'
\endif
