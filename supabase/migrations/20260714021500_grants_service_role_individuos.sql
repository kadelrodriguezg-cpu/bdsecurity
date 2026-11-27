-- =============================================================================
-- MIGRACIÓN 20260714021500 — GRANTS FALTANTES PARA service_role
--
-- Bug encontrado corriendo los tests de RLS (Prompt 2, Parte E) contra la base
-- local: `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role` (migración
-- 009) solo aplica a las tablas que EXISTÍAN en el momento de ejecutarse esa
-- sentencia. No es un default privilege (eso requeriría ALTER DEFAULT
-- PRIVILEGES): las tablas creadas después (individuos, evaluaciones,
-- pcr_analisis, baja_motivo) NO heredaron el grant. Confirmado también en
-- producción: service_role solo tenía TRUNCATE/REFERENCES/TRIGGER sobre
-- individuos, sin SELECT/INSERT/UPDATE/DELETE.
--
-- Mismo motivo que la migración 009 documenta para `authenticated`: hay que
-- declarar los grants explícitamente por cada tabla nueva, no asumir que el
-- rol administrativo los tiene por default.
-- =============================================================================

grant all on individuos     to service_role;
grant all on evaluaciones   to service_role;
grant all on pcr_analisis   to service_role;
grant all on baja_motivo    to service_role;
