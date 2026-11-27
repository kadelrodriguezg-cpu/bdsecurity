-- Clase 2: metadatos de archivo que apuntan a un objeto inexistente (invariante B01; A1-G3-10).
--
-- Una fila de public.evento_archivos cuyo storage_path no existe en el bucket
-- media-plantas: la ficha muestra un ícono roto. Producción tenía 0 en la
-- Corrida 1; la clase existe para detectarla si aparece (p. ej. si alguien
-- borra binarios a mano).
-- Solo informativo (sin corrección automática): public.pcr_analisis.informe_pdf_url
-- y public.evecl_respuesta.foto_path que apunten a un objeto inexistente. Se
-- cuentan abajo, pero corregirlos cambia datos científicos y queda a decisión humana.
--
-- SOLO LECTURA. Uso:
--   docker exec -i supabase_db_dbsecurity-frutales psql -U postgres -d postgres \
--     [-v filtro_codigo=LIMP-] < informe_metadatos_sin_objeto.sql
-- Variable: filtro_codigo ('') = solo cruces cuyo codigo_sistema empieza con ese texto.
\set ON_ERROR_STOP on
\if :{?filtro_codigo}
\else
  \set filtro_codigo ''
\endif

begin read only;

\echo '== Clase 2: metadatos de evento_archivos sin objeto en Storage =='
select count(*) as metadatos_sin_objeto,
       count(*) filter (where r.eliminado_at is not null) as de_eventos_eliminados
from public.evento_archivos a
join public.registros_evento r on r.id = a.registro_id
join public.plantas pl on pl.id = r.planta_id
where starts_with(pl.codigo_sistema, :'filtro_codigo')
  and not exists (select 1 from storage.objects o where o.bucket_id = 'media-plantas' and o.name = a.storage_path);

\echo 'Detalle (hasta 100)'
select a.id as archivo_id, pl.codigo_sistema, r.id as registro_id, r.tipo_evento, r.fecha,
       r.eliminado_at is not null as evento_eliminado, a.storage_path, a.tipo, a.created_at
from public.evento_archivos a
join public.registros_evento r on r.id = a.registro_id
join public.plantas pl on pl.id = r.planta_id
where starts_with(pl.codigo_sistema, :'filtro_codigo')
  and not exists (select 1 from storage.objects o where o.bucket_id = 'media-plantas' and o.name = a.storage_path)
order by a.created_at
limit 100;

\echo 'Solo informativo: otras referencias a objetos inexistentes (sin corrección automática)'
select 'pcr_analisis.informe_pdf_url' as referencia, count(*) as n
from public.pcr_analisis p
where p.informe_pdf_url is not null
  and not exists (select 1 from storage.objects o where o.bucket_id = 'media-plantas' and o.name = p.informe_pdf_url)
union all
select 'evecl_respuesta.foto_path', count(*)
from public.evecl_respuesta e
where e.foto_path is not null
  and not exists (select 1 from storage.objects o where o.bucket_id = 'evecl-fotos' and o.name = e.foto_path);

rollback;
