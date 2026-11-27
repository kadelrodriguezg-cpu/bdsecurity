-- Clase 1: objetos huérfanos en Storage (A1-035, A1-036, A1-037; invariante B02).
--
-- Un objeto de los buckets de la app que ninguna fila de metadatos referencia:
--   media-plantas -> public.evento_archivos.storage_path o public.pcr_analisis.informe_pdf_url
--   evecl-fotos   -> public.evecl_respuesta.foto_path
-- Causas demostradas en la Corrida 1: reiniciar/purgar un cruce borra los
-- metadatos en cascada pero no el binario (A1-G3-04); la app sube el binario
-- ANTES de escribir la fila y no lo limpia si la escritura falla (A1-G3-05); un
-- admin que quita un adjunto ajeno borra el metadato pero Storage no le deja
-- borrar el binario (A1-G3-06).
--
-- SOLO LECTURA. Seguro en cualquier base. Uso:
--   docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
--     [-v min_edad_horas=24] [-v filtro_ruta=plantas/LIMP-] < informe_huerfanos_storage.sql
--
-- Variables (opcionales):
--   min_edad_horas  (24)  los objetos más nuevos NO cuentan: la app sube el binario
--                         antes de escribir la fila, así que una subida en curso
--                         se ve igual que un huérfano durante unos segundos.
--   filtro_ruta     ('')  solo objetos cuyo nombre empieza con este texto.
--
-- El borrado del binario NO se hace con SQL (dejaría el archivo en el disco o
-- en el almacén externo): lo hace aplicar_huerfanos_storage.mjs por la API.
\set ON_ERROR_STOP on
\if :{?min_edad_horas}
\else
  \set min_edad_horas 24
\endif
\if :{?filtro_ruta}
\else
  \set filtro_ruta ''
\endif

begin read only;

\echo '== Clase 1: huérfanos en Storage =='
\echo 'Resumen por bucket (antiguos = corregibles; recientes = excluidos por min_edad_horas)'
with refs as (
  select 'media-plantas'::text as bucket_id, storage_path as name from public.evento_archivos
  union
  select 'media-plantas', informe_pdf_url from public.pcr_analisis where informe_pdf_url is not null
  union
  select 'evecl-fotos', foto_path from public.evecl_respuesta where foto_path is not null
), objetos as (
  select o.bucket_id, o.name, o.created_at, coalesce((o.metadata->>'size')::bigint, 0) as bytes,
         exists (select 1 from refs r where r.bucket_id = o.bucket_id and r.name = o.name) as referenciado
  from storage.objects o
  where o.bucket_id in ('media-plantas', 'evecl-fotos')
    and o.name !~ '(^|/)\.emptyFolderPlaceholder$'
    and starts_with(o.name, :'filtro_ruta')
)
select bucket_id,
       count(*) as objetos,
       count(*) filter (where not referenciado and created_at <  now() - (:'min_edad_horas' || ' hours')::interval) as huerfanos_antiguos,
       count(*) filter (where not referenciado and created_at >= now() - (:'min_edad_horas' || ' hours')::interval) as huerfanos_recientes,
       coalesce(sum(bytes) filter (where not referenciado and created_at < now() - (:'min_edad_horas' || ' hours')::interval), 0) as bytes_huerfanos_antiguos
from objetos group by bucket_id order by bucket_id;

\echo 'Detalle de huérfanos antiguos (hasta 100)'
with refs as (
  select 'media-plantas'::text as bucket_id, storage_path as name from public.evento_archivos
  union
  select 'media-plantas', informe_pdf_url from public.pcr_analisis where informe_pdf_url is not null
  union
  select 'evecl-fotos', foto_path from public.evecl_respuesta where foto_path is not null
)
select o.bucket_id, o.name, o.created_at, coalesce((o.metadata->>'size')::bigint, 0) as bytes, o.owner
from storage.objects o
where o.bucket_id in ('media-plantas', 'evecl-fotos')
  and o.name !~ '(^|/)\.emptyFolderPlaceholder$'
  and starts_with(o.name, :'filtro_ruta')
  and o.created_at < now() - (:'min_edad_horas' || ' hours')::interval
  and not exists (select 1 from refs r where r.bucket_id = o.bucket_id and r.name = o.name)
order by o.created_at, o.bucket_id, o.name
limit 100;

rollback;
