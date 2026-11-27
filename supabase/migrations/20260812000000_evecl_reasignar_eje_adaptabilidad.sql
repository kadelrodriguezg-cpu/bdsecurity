-- =============================================================================
-- MIGRACIÓN 20260812000000 — EVECL: reasignar eje adaptabilidad → fenologia
-- (Fix B, parte 1/2 — datos, no esquema)
--
-- Los 6 descriptores que hoy tienen eje='adaptabilidad' pasan a
-- 'fenologia'. Verificado antes de esta migración con:
--   select codigo_upov, nombre from evecl_descriptor where eje = 'adaptabilidad';
-- Dio exactamente: Vigor (1), Hábito de crecimiento (2), Largo de la hoja
-- (5), Forma de la hoja (8), Hoja: intensidad del color verde del haz (10),
-- Márgenes de la hoja (11) — ninguno más. Coincide con lo esperado, se
-- procede sin detenerse a preguntar.
--
-- Tras esta migración, el eje 'adaptabilidad' queda sin descriptores
-- activos en el catálogo. El enum evecl_eje y los componentes de perfil
-- (EjePerfilCard, etc.) se conservan intactos por si en el futuro se
-- agregan descriptores a ese eje — ver nota en 9.4.3 del Documento
-- Maestro.
-- =============================================================================

update evecl_descriptor
set eje = 'fenologia'
where eje = 'adaptabilidad'
  and codigo_upov in (1, 2, 5, 8, 10, 11);
