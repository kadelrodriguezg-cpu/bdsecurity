-- =============================================================================
-- MIGRACIÓN 20260719000500 — elimina el mini-pipeline por individuo (v4)
-- (North Star v5, sección 5, puntos 1-2 y 6)
--
-- v4 introdujo individuos.fase_actual + avanzar_fase_individuo() como una
-- mini-timeline paralela por individuo. Repetía, a menor escala, el mismo
-- error del pipeline paralelo original de cruces (ver North Star v5 sección
-- 0.1): dos sistemas de registro en paralelo, uno de los cuales termina
-- incompleto. Se elimina por completo; el único timeline vuelve a ser
-- `plantas.estado` (ya ampliado a 10 valores en la migración anterior).
--
-- Confirmado por query directa (Parte A del prompt de reunificación): todos
-- los datos existentes bajo individuos/evaluacion_reducida/
-- ronda_evaluacion_anual/multisitio/baja_motivo pertenecen a cruces de prueba
-- generados por la suite de tests automatizada (códigos IND-<epoch>,
-- V4-<epoch>, REINICIO-<epoch>, IND-FUERA-<epoch>, sin linaje, mismo usuario,
-- misma ventana de segundos). La única planta con linaje real (02-001, seed
-- de Notion) nunca llegó a Trasplante y no tiene ningún dato bajo este
-- esquema. Se descartan sin backup adicional (confirmado explícitamente).
-- =============================================================================

-- Conteo exacto de lo descartado, para el reporte de verificación (Parte H).
do $$
declare
  v_individuos integer;
  v_eval_reducida integer;
  v_rondas integer;
  v_evaluaciones integer;
  v_pcr integer;
  v_multisitio integer;
  v_baja integer;
begin
  select count(*) into v_individuos from individuos;
  select count(*) into v_eval_reducida from evaluacion_reducida;
  select count(*) into v_rondas from ronda_evaluacion_anual;
  select count(*) into v_evaluaciones from evaluaciones;
  select count(*) into v_pcr from pcr_analisis;
  select count(*) into v_multisitio from multisitio;
  select count(*) into v_baja from baja_motivo;

  raise notice 'Descarte esquema v4 (todo confirmado de prueba): individuos=%, evaluacion_reducida=%, ronda_evaluacion_anual=%, evaluaciones=%, pcr_analisis=%, multisitio=%, baja_motivo=%',
    v_individuos, v_eval_reducida, v_rondas, v_evaluaciones, v_pcr, v_multisitio, v_baja;
end;
$$;

-- Se borran en orden de dependencia (satélites antes que individuos) para no
-- toparse con los ON DELETE RESTRICT de las FKs.
delete from pcr_analisis;
delete from evaluaciones;
delete from ronda_evaluacion_anual;
delete from multisitio;
delete from baja_motivo;
delete from evaluacion_reducida;
delete from individuos;


-- =============================================================================
-- avanzar_fase_individuo — ya no corresponde: no existe estado de fase propio
-- del individuo que avanzar.
-- =============================================================================
drop function if exists avanzar_fase_individuo(uuid, text);


-- =============================================================================
-- iniciar_ronda_evaluacion — validaba individuos.fase_actual = 'evaluacion_anual'.
-- Pasa a validar plantas.estado = 'evaluacion_anual', resuelto vía
-- individuos.planta_id (North Star v5, sección 5, punto 6). De paso, agrega
-- la validación de estado_vital que faltaba por completo en v4 (North Star
-- v5, sección 6, defecto bloqueante): un individuo dado de baja no puede
-- recibir una ronda nueva.
-- =============================================================================
create or replace function iniciar_ronda_evaluacion(p_individuo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_estado       estado_planta;
  v_estado_vital estado_vital;
  v_siguiente    smallint;
  v_ronda_id     uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select p.estado, i.estado_vital
    into v_estado, v_estado_vital
  from individuos i
  join plantas p on p.id = i.planta_id
  where i.id = p_individuo_id;

  if not found then
    raise exception 'Individuo % no encontrado', p_individuo_id using errcode = 'P0002';
  end if;

  if v_estado_vital <> 'vivo' then
    raise exception 'El individuo no está vivo — no puede recibir una nueva ronda de evaluación' using errcode = '42501';
  end if;

  if v_estado <> 'evaluacion_anual' then
    raise exception 'El cruce debe estar en la fase Evaluación anual para iniciar una ronda (fase actual del cruce: %)', v_estado
      using errcode = '42501';
  end if;

  select count(*) into v_siguiente from ronda_evaluacion_anual where individuo_id = p_individuo_id;
  if v_siguiente >= 3 then
    raise exception 'Este individuo ya tiene 3 rondas de evaluación anual — no se pueden crear más'
      using errcode = '42501';
  end if;

  insert into ronda_evaluacion_anual (individuo_id, numero_ronda, anio, fecha_inicio, created_by)
  values (p_individuo_id, v_siguiente + 1, extract(year from current_date)::int, current_date, v_uid)
  returning id into v_ronda_id;

  return jsonb_build_object('ronda_id', v_ronda_id, 'numero_ronda', v_siguiente + 1);
end;
$$;

comment on function iniciar_ronda_evaluacion is 'Crea la siguiente ronda (1-3) de evaluación anual para un individuo vivo cuyo CRUCE esté en estado evaluacion_anual (North Star v5 — ya no depende de individuos.fase_actual, eliminada). Rechaza si ya hay 3 rondas o si el individuo no está vivo.';


-- =============================================================================
-- individuos.fase_actual / fase_individuo — se elimina la columna y el tipo.
-- =============================================================================
alter table individuos drop column fase_actual;
drop type if exists fase_individuo;
