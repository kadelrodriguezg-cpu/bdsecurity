-- =============================================================================
-- SPRINT 1 — SEGURIDAD P0: revocación de privilegios destructivos en tablas
-- históricas (Fase 0 de docs/BDSecurity_Documento_Maestro.md).
--
-- Diagnóstico confirmado (auditoría técnica + query directa a
-- information_schema.role_table_grants / pg_class.relacl sobre una réplica
-- local limpia, migraciones replayadas desde cero):
--
--   La migración 20260719004150_corregir_privilegios_tablas_nuevas.sql revocó
--   TRUNCATE/REFERENCES/TRIGGER/MAINTAIN de anon y authenticated SOLO en 5
--   tablas nuevas (rango_referencia, scoring_version, scoring_metrica,
--   ranking_snapshot, ranking_snapshot_resultado) y ajustó el default ACL del
--   rol postgres para que las tablas CREADAS DESPUÉS de esa migración nazcan
--   limpias. Eso funcionó: todas las tablas creadas después de 004150
--   (sitio, sector, emplazamiento_*, procedimientos*, etc.) ya nacieron sin
--   estos privilegios.
--
--   Pero el default ACL no es retroactivo: todas las tablas creadas ANTES de
--   004150 heredaron en su creación el default ACL histórico del rol
--   postgres, que en Supabase incluye TRUNCATE, REFERENCES, TRIGGER y
--   MAINTAIN para anon y authenticated (bits D,x,t,m del ACL —
--   ver pg_class.relacl). Esto sigue vigente en producción para las tablas de
--   dominio reales: plantas, individuos, evaluaciones, perfiles, audit_log,
--   registros_evento, evento_archivos, y el resto de tablas históricas
--   listadas abajo. RLS no protege contra TRUNCATE (no es una operación
--   filtrable por fila), así que cualquier usuario autenticado — o incluso
--   anónimo, dado que el default ACL le concede lo mismo — puede vaciar
--   `plantas` hoy.
--
-- Nota técnica de verificación: information_schema.role_table_grants en este
-- Postgres 17.6 NO expone MAINTAIN como privilege_type (solo devuelve los 7
-- privilegios "clásicos"), aunque el bit sí existe en el ACL crudo
-- (pg_class.relacl). La verificación de este cambio, por lo tanto, se hizo
-- también contra pg_class.relacl directamente, no solo contra
-- information_schema. Ver evidencia en el resumen del sprint, no en este
-- archivo.
--
-- Alcance de este REVOKE: solo TRUNCATE, REFERENCES, TRIGGER, MAINTAIN.
-- No toca SELECT/INSERT/UPDATE/DELETE — esos privilegios los declara cada
-- migración de forma explícita por tabla (patrón establecido en
-- 20260702000009_grants_explicitos.sql y seguido desde entonces) y no forman
-- parte de este default ACL heredado. Confirmado con diff de
-- information_schema.role_table_grants antes/después: cero cambios en filas
-- SELECT/INSERT/UPDATE/DELETE. Por eso este archivo NO incluye una sección de
-- GRANT: no hay nada que re-otorgar, porque nada funcional se revocó. El
-- frontend (frontend/src/api/*) tampoco depende de TRUNCATE/REFERENCES/
-- TRIGGER en ningún punto: PostgREST no expone DDL a los roles de la API.
-- =============================================================================

revoke truncate, references, trigger, maintain
on all tables in schema public
from anon, authenticated;

-- Restatement idempotente del default ACL ya fijado en 004150. Se repite acá
-- para que este archivo sea autocontenido como cierre completo del P0, en
-- caso de que alguna vez se audite esta migración de forma aislada.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables
  from anon, authenticated;
