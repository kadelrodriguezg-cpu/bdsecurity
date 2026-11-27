-- =============================================================================
-- MIGRACIÓN 005 — SUPABASE STORAGE (BUCKET + POLÍTICAS)
--
-- Las fotos y videos NO van en la base SQL: van en Supabase Storage (object
-- storage). Supabase implementa Storage sobre una tabla interna storage.objects
-- que también tiene RLS. Acá creamos el bucket privado y sus políticas.
--
-- Convención de rutas dentro del bucket:
--   plantas/<codigo_sistema>/<registro_id>/<nombre_archivo>
-- Esto agrupa los archivos por planta y por evento, y hace fácil razonar sobre
-- permisos por prefijo de carpeta si más adelante se necesita.
-- =============================================================================


-- =============================================================================
-- BUCKET: media-plantas (PRIVADO)
-- public = false  → los objetos NO son accesibles por URL pública. El acceso
-- se hace con URLs firmadas (signed URLs) temporales que genera la app, o vía
-- la API autenticada. Requisito no negociable #5: nada público por default.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('media-plantas', 'media-plantas', false)
on conflict (id) do nothing;


-- =============================================================================
-- POLÍTICAS RLS sobre storage.objects, acotadas a este bucket.
-- storage.objects es la tabla que Supabase usa por detrás; bucket_id filtra
-- para que estas reglas apliquen SOLO a media-plantas y no a otros buckets.
-- =============================================================================

-- LECTURA: cualquier usuario autenticado puede leer/descargar objetos del bucket.
-- (El control fino sobre linaje es de la base, no de las fotos; una foto de una
-- planta no revela el cruzamiento genético.)
create policy storage_media_select_autenticados
  on storage.objects for select
  to authenticated
  using (bucket_id = 'media-plantas');

-- SUBIDA: cualquier usuario autenticado puede subir archivos al bucket.
-- owner se setea automáticamente al usuario que sube.
create policy storage_media_insert_autenticados
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'media-plantas');

-- BORRADO: solo el dueño del objeto (quien lo subió) puede borrarlo.
-- owner es la columna que Storage llena con el uid de quien subió el archivo.
create policy storage_media_delete_propietario
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'media-plantas' and owner = auth.uid());

-- No creamos policy de UPDATE: los archivos son inmutables una vez subidos.
-- Para "reemplazar" una foto, se sube una nueva y se borra la vieja.
