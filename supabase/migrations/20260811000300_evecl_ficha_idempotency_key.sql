-- =============================================================================
-- MIGRACIÓN 20260811000300 — EVECL: idempotency_key en evecl_ficha (Sprint E2)
--
-- Alteración sobre esquema E1 (cerrado), autorizada explícitamente por Kadel
-- antes de escribir esta migración (regla del prompt E2: "si necesitas un
-- campo nuevo, DETENTE y pregunta").
--
-- evecl_guardar_ficha (9.4.4) necesita idempotencia de submit ante
-- reintento de red/doble-tap en terreno, mismo patrón ya usado en el
-- proyecto para evaluaciones/pcr_analisis/procedimientos/baja_motivo
-- (migración 20260720001000): una columna idempotency_key uuid UNIQUE en la
-- tabla de destino. idempotency_key identifica el INTENTO de guardado
-- (generado una vez al montar el formulario), no el contenido — un envío
-- real nuevo usa una key nueva.
-- =============================================================================

alter table evecl_ficha add column idempotency_key uuid not null default gen_random_uuid();
alter table evecl_ficha add constraint evecl_ficha_idempotency_key_key unique (idempotency_key);

comment on column evecl_ficha.idempotency_key is
  'Identifica el intento de guardado (generado una vez al montar el formulario), no el contenido. Protege evecl_guardar_ficha contra duplicados por reintento de red/doble-tap. Mismo patrón que evaluaciones.idempotency_key (20260720001000).';
