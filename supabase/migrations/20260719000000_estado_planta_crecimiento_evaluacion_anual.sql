-- =============================================================================
-- MIGRACIÓN 20260719000000 — estado_planta: agrega 'crecimiento' y
-- 'evaluacion_anual' (North Star v5, sección 5, punto 3)
--
-- v4 había resuelto la secuencia post-Trasplante creando un estado propio por
-- INDIVIDUO (individuos.fase_actual) en vez de extender el único timeline de
-- `plantas.estado` — ese error (confirmado con evidencia real, ver North Star
-- v5 sección 0) se corrige acá: el enum del cruce pasa de 8 a 10 valores.
--
-- Van insertados en su posición real de secuencia (BEFORE/AFTER) aunque
-- ninguna consulta de este proyecto compara el enum con < / > (verificado por
-- grep en supabase/migrations: todo el código usa igualdad, nunca orden) — se
-- respeta el orden real de todos modos, por claridad y porque algún reporte
-- futuro podría apoyarse en enumsortorder.
--
-- ADD VALUE va en su propia migración, sin nada más: Postgres no permite usar
-- un valor nuevo de enum dentro de la misma transacción en que se agrega.
-- =============================================================================

alter type estado_planta add value 'crecimiento' after 'trasplante';
alter type estado_planta add value 'evaluacion_anual' after 'crecimiento';
