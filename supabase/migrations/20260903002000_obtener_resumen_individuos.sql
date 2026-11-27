-- =============================================================================
-- Paso 5 (Explorador de individuos, Ronda 2 UI) — resumen agregado por cruce
-- en vez de 5 queries por fila (evaluacion_reducida x2 fases + rondas
-- anuales + rondas multisitio + emplazamientos), que hoy se disparan siempre
-- aunque la fila esté colapsada, para armar el resumen de una línea
-- (IndividuosSeccion.tsx, FilaIndividuo). Con un cruce de 100+ individuos eso
-- son 500+ requests solo por abrir la ficha. Esta RPC junta todo en una sola
-- consulta por cruce; el detalle completo de cada sección (Evaluacion
-- ReducidaResumen, RondasSeccion, MultisitioResumen) se sigue trayendo
-- aparte, pero solo cuando la fila se expande (ya era así).
-- =============================================================================

create or replace function obtener_resumen_individuos(p_planta_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not exists (select 1 from plantas where id = p_planta_id and eliminado_at is null) then
    raise exception 'Cruce no encontrado' using errcode = 'P0002';
  end if;

  with base as (
    select id as individuo_id from individuos where planta_id = p_planta_id
  ), eval_trasplante as (
    select individuo_id, count(*)::integer as n
    from evaluacion_reducida
    where fase = 'trasplante' and individuo_id in (select individuo_id from base)
    group by individuo_id
  ), eval_crecimiento as (
    select individuo_id, count(*)::integer as n
    from evaluacion_reducida
    where fase = 'crecimiento' and individuo_id in (select individuo_id from base)
    group by individuo_id
  ), rondas_anuales as (
    select individuo_id, count(*)::integer as n, max(numero_ronda) as ultima
    from ronda_evaluacion_anual
    where tipo_ronda = 'anual' and individuo_id in (select individuo_id from base)
    group by individuo_id
  ), rondas_multi as (
    select individuo_id, count(*)::integer as n
    from ronda_evaluacion_anual
    where tipo_ronda = 'multisitio' and individuo_id in (select individuo_id from base)
    group by individuo_id
  ), emplazamientos_ult as (
    select distinct on (ei.individuo_id)
      ei.individuo_id,
      s.nombre as sector_nombre,
      p.nombre as predio_nombre
    from emplazamiento_individuo ei
    join sector s on s.id = ei.sector_id
    join predio p on p.id = s.predio_id
    where ei.individuo_id in (select individuo_id from base)
    order by ei.individuo_id, ei.fecha_inicio desc
  ), emplazamientos_cnt as (
    select individuo_id, count(*)::integer as n
    from emplazamiento_individuo
    where individuo_id in (select individuo_id from base)
    group by individuo_id
  )
  select coalesce(jsonb_object_agg(b.individuo_id, jsonb_build_object(
    'count_eval_trasplante', coalesce(et.n, 0),
    'count_eval_crecimiento', coalesce(ec.n, 0),
    'rondas_count', coalesce(ra.n, 0),
    'rondas_ultima', ra.ultima,
    'rondas_multisitio_count', coalesce(rm.n, 0),
    'emplazamiento_count', coalesce(em.n, 0),
    'emplazamiento_predio_nombre', eu.predio_nombre,
    'emplazamiento_sector_nombre', eu.sector_nombre
  )), '{}'::jsonb)
  into v_resultado
  from base b
  left join eval_trasplante et on et.individuo_id = b.individuo_id
  left join eval_crecimiento ec on ec.individuo_id = b.individuo_id
  left join rondas_anuales ra on ra.individuo_id = b.individuo_id
  left join rondas_multi rm on rm.individuo_id = b.individuo_id
  left join emplazamientos_cnt em on em.individuo_id = b.individuo_id
  left join emplazamientos_ult eu on eu.individuo_id = b.individuo_id;

  return v_resultado;
end;
$$;

comment on function obtener_resumen_individuos(uuid) is
  'Resumen agregado por individuo de UN cruce (conteos de evaluación reducida por fase, rondas anuales/multisitio, emplazamientos) para el Explorador de individuos — evita 5 queries por fila x N individuos en la carga inicial de la ficha. El detalle completo de cada sección se sigue trayendo aparte, solo al expandir la fila.';

revoke all on function obtener_resumen_individuos(uuid) from public, anon;
grant execute on function obtener_resumen_individuos(uuid) to authenticated, service_role;
