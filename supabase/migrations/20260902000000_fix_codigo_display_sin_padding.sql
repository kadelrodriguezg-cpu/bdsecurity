-- =============================================================================
-- FIX — generar_codigo_individuo truncaba el correlativo en vez de rellenarlo
--
-- Causa raíz (confirmada con evidencia real contra producción, cruce 02-001):
-- lpad(string, length, fill) en Postgres NO solo rellena — si `string` ya es
-- más largo que `length`, lo TRUNCA por la derecha, quedándose con los
-- primeros `length` caracteres. lpad(v_siguiente::text, 2, '0') asumía que
-- v_siguiente nunca pasaría de 2 dígitos: para v_siguiente=100,
-- lpad('100', 2, '0') devolvía '10' (no '100'), y el nuevo codigo_display
-- colisionaba con el individuo #10 ya existente (unique_violation 23505).
-- Todo v_siguiente >= 100 cae siempre en un código de 2 dígitos ya usado
-- (10-99), así que el bug bloqueaba PERMANENTEMENTE cualquier cruce al
-- llegar a 99 individuos — no era una condición de carrera ni un problema de
-- volumen del lote.
--
-- Confirmado sin drift: el DDL desplegado en producción (pg_get_functiondef)
-- es idéntico al de la migración 20260714020000 — el bug es el mismo código
-- fuente en ambos lados, no una desincronización.
--
-- Fix (decisión explícita, no reabrir): se quita el padding fijo. El
-- correlativo se usa tal cual (v_siguiente::text), sin ceros de relleno.
-- Resultado esperado en un cruce que arranca de cero: P1, P2... P9, P10...
-- P99, P100, P101...
--
-- Los 99 codigo_display ya generados en cruces existentes (ej. "02-001-P01"
-- .. "02-001-P99", CON cero inicial) son inmutables por diseño
-- (proteger_identidad_individuo los bloquea) y esta migración NO los toca —
-- ningún UPDATE sobre `individuos`, solo CREATE OR REPLACE FUNCTION. Para
-- esos cruces, los códigos nuevos a partir del #100 conviven con formato
-- distinto (sin cero) respecto a los existentes (con cero) — es intencional,
-- no un bug. El criterio de orden del ranking se corrige aparte (próxima
-- migración) para que el formato mixto no afecte la posición calculada.
-- =============================================================================

create or replace function generar_codigo_individuo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo_sistema text;
  v_siguiente      int;
begin
  perform pg_advisory_xact_lock(hashtext(new.planta_id::text));

  select codigo_sistema into v_codigo_sistema from plantas where id = new.planta_id;
  if not found then
    raise exception 'Planta % no encontrada', new.planta_id using errcode = 'P0002';
  end if;

  select count(*) + 1 into v_siguiente from individuos where planta_id = new.planta_id;

  new.codigo_display := v_codigo_sistema || '-P' || v_siguiente::text;
  return new;
end;
$$;

comment on function generar_codigo_individuo is 'Genera codigo_display = {codigo_sistema}-P{n} correlativo por planta_id, SIN padding fijo (fix 20260902: lpad(...,2,''0'') truncaba a partir de 3 dígitos y colisionaba con individuos ya numerados 10-99 — ver supabase/migrations/20260902000000). Serializado con advisory lock para evitar colisiones entre inserts concurrentes.';
