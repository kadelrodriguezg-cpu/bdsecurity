-- =============================================================================
-- MIGRACIÓN 20261021121000 — VALORES ANTERIORES Y NUEVOS AL EDITAR UNA
-- EVALUACIÓN (brecha B5)
--
-- Problema que cierra: auditar_escritura_evaluacion (última versión en
-- 20260717001000_ronda_evaluacion_anual.sql) registraba QUE hubo una edición
-- (accion edicion_evaluacion), pero no QUÉ cambió. Sin los valores anteriores
-- no se puede reconstruir ni defender un dato científico corregido.
--
-- Cambio: en un UPDATE, detalle.cambios guarda solo las columnas que cambiaron,
-- cada una como {"anterior": ..., "nuevo": ...}. Se calcula comparando
-- to_jsonb(old) con to_jsonb(new), así que una columna nueva en evaluaciones
-- queda cubierta sin tocar esta función. Se excluye updated_at, que cambia en
-- cada UPDATE y no aporta; si es lo único que cambió, no se registra la
-- edición. detalle también suma anio, que la Bitácora ya usa
-- para mostrar «ronda del año N» y que en las ediciones faltaba.
--
-- La rama INSERT y campos_expuestos quedan como estaban.
-- =============================================================================

create or replace function auditar_escritura_evaluacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_individuo_id uuid;
  v_planta_id    uuid;
  v_cambios      jsonb;
begin
  select individuo_id into v_individuo_id from ronda_evaluacion_anual where id = new.ronda_id;
  select planta_id into v_planta_id from individuos where id = v_individuo_id;

  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(), v_planta_id, 'creacion_evaluacion',
      array['ronda_id', 'anio', 'fecha'],
      jsonb_build_object('evaluacion_id', new.id, 'ronda_id', new.ronda_id, 'individuo_id', v_individuo_id, 'anio', new.anio, 'fecha', new.fecha)
    );
  elsif tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('anterior', o.value, 'nuevo', n.value)), '{}'::jsonb)
      into v_cambios
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value
      and n.key <> 'updated_at';

    -- Un UPDATE que solo movió updated_at no es una edición: no deja fila.
    if v_cambios = '{}'::jsonb then
      return new;
    end if;

    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(), v_planta_id, 'edicion_evaluacion',
      array['ronda_id', 'anio', 'fecha'],
      jsonb_build_object('evaluacion_id', new.id, 'ronda_id', new.ronda_id, 'individuo_id', v_individuo_id, 'anio', new.anio, 'cambios', v_cambios)
    );
  end if;
  return new;
end;
$$;

comment on function auditar_escritura_evaluacion is
  'Registra en audit_log cada alta o edición de una evaluación (resuelve planta_id vía individuo_id). En una edición guarda en detalle.cambios cada columna modificada con su valor anterior y nuevo (salvo updated_at).';
