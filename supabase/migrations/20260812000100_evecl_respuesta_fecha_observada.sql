-- =============================================================================
-- MIGRACIÓN 20260812000100 — EVECL: evecl_respuesta.fecha_observada
-- (Fix B, parte 2/2 — esquema)
--
-- Fecha opcional ligada a UNA respuesta puntual (ej. cuándo se observó el
-- estado fenológico en terreno). NO es una serie temporal: sigue existiendo
-- una sola respuesta por (ficha_id, descriptor_id) — el mismo descriptor no
-- se repite con distintas fechas para la misma ficha. El unique
-- (ficha_id, descriptor_id) de la migración de esquema E1 no se toca.
-- =============================================================================

alter table evecl_respuesta add column fecha_observada date;

comment on column evecl_respuesta.fecha_observada is 'Fecha opcional de observación de ESTA respuesta puntual (ej. descriptores de fenología). No es una serie temporal: sigue habiendo una sola respuesta por (ficha_id, descriptor_id) — el unique no cambia.';
