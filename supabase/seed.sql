-- =============================================================================
-- SEED — datos de ejemplo para desarrollo local.
-- La Supabase CLI corre este archivo automáticamente después de las migraciones
-- al hacer `supabase db reset`. NO se usa en producción.
--
-- Nota: los usuarios NO se crean acá (los gestiona Supabase Auth). Para probar
-- roles, creá usuarios desde Studio (http://localhost:54323) y luego insertá su
-- perfil con el UUID que te dé Auth. Ver README, sección "Crear un usuario de prueba".
-- =============================================================================

insert into especies (nombre, nombre_cientifico) values
  ('Arándano',  'Vaccinium corymbosum'),
  ('Mora',      'Rubus fruticosus'),
  ('Frambuesa', 'Rubus idaeus')
on conflict (nombre) do nothing;

-- Planta 02-001 con linaje SINTÉTICO. Se usa como fixture de los tests de RLS
-- (tests/rls/rls.test.ts lee el linaje al empezar y lo restaura al final, así
-- que no depende de los valores). Nunca poner linaje real acá: el seed vive en
-- Git y el linaje es el activo que el sistema protege. El estado arranca en
-- 'polinizacion' porque el test de cambio_estado (trigger 007) asume esa
-- transición inicial.
insert into plantas (codigo_sistema, especie_id, cruzamiento, mama, papa, estado, numero_notion_legacy)
select '02-001', e.id, 'SINT-0001 x OP', 'SINT-MADRE-A', 'OP', 'polinizacion', 378
from especies e where e.nombre = 'Arándano'
on conflict (codigo_sistema) do nothing;
