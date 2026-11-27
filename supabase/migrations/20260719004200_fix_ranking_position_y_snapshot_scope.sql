-- Correcciones detectadas por las pruebas empíricas del bloque de ranking:
-- 1. las posiciones se calculan solo dentro de la población elegible;
-- 2. el alcance del snapshot se convierte explícitamente al enum persistido.

update scoring_version
set criterio_desempate = '["puntaje_desc", "fecha_evaluacion_desc", "evaluacion_updated_at_desc", "codigo_asc"]'::jsonb
where nombre = 'Selección de fruto v1 provisional (4-3-2-1)';

create or replace function obtener_ranking_operativo(
  p_planta_id uuid default null,
  p_especie_id uuid default null,
  p_limite integer default 25,
  p_offset integer default 0,
  p_orden text default 'puntaje_desc'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_especie_id uuid := p_especie_id;
  v_version_id uuid;
  v_version_nombre text;
  v_desempate jsonb;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if (p_planta_id is null) = (p_especie_id is null) then
    raise exception 'Indica exactamente un cruce o una especie' using errcode = '22023';
  end if;
  if p_limite < 1 or p_limite > 100 or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode = '22023';
  end if;
  if p_orden not in ('puntaje_desc', 'puntaje_asc', 'codigo_asc', 'fecha_desc') then
    raise exception 'Orden no permitido' using errcode = '22023';
  end if;

  if p_planta_id is not null then
    select especie_id into v_especie_id
    from plantas
    where id = p_planta_id and eliminado_at is null;
    if not found then
      raise exception 'Cruce no encontrado' using errcode = 'P0002';
    end if;
  end if;

  v_version_id := resolver_scoring_version(v_especie_id, 'evaluacion_anual', current_date);
  select nombre, criterio_desempate
    into v_version_nombre, v_desempate
  from scoring_version
  where id = v_version_id;

  with base as materialized (
    select *
    from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id)
  ), posicionado as (
    select
      b.*,
      case when b.elegible then row_number() over (
        partition by b.elegible
        order by b.puntaje_ponderado desc nulls last,
                 b.fecha_evaluacion desc nulls last,
                 b.evaluacion_updated_at desc nulls last,
                 b.codigo_display asc
      ) end as posicion
    from base b
  ), pagina as (
    select *
    from posicionado
    order by
      case when p_orden = 'puntaje_desc' then puntaje_ponderado end desc nulls last,
      case when p_orden = 'puntaje_asc' then puntaje_ponderado end asc nulls last,
      case when p_orden = 'fecha_desc' then fecha_evaluacion end desc nulls last,
      case when p_orden = 'codigo_asc' then codigo_display end asc,
      codigo_display asc
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(pagina)) from pagina), '[]'::jsonb),
    'total', (select count(*) from base),
    'poblacion_comparada', (select count(*) from base where elegible),
    'limite', p_limite,
    'offset', p_offset,
    'orden', p_orden,
    'scoring_version_id', v_version_id,
    'scoring_version_nombre', v_version_nombre,
    'criterios', jsonb_build_object(
      'alcance', case when p_planta_id is null then 'especie' else 'cruzamiento' end,
      'seleccion_evaluacion', 'ultima completa/corregida de la ronda mas reciente; fecha y updated_at como desempate',
      'exclusiones', jsonb_build_array('borrador', 'anulada', 'requiere_revision', 'no_comparable', 'metricas_incompletas'),
      'desempate', coalesce(v_desempate, '[]'::jsonb)
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

create or replace function congelar_ranking(
  p_nombre text,
  p_planta_id uuid default null,
  p_especie_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_especie_id uuid := p_especie_id;
  v_version_id uuid;
  v_version_nombre text;
  v_desempate jsonb;
  v_snapshot_id uuid;
  v_poblacion integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede congelar un ranking' using errcode = '42501';
  end if;
  if (p_planta_id is null) = (p_especie_id is null) then
    raise exception 'Indica exactamente un cruce o una especie' using errcode = '22023';
  end if;
  if coalesce(btrim(p_nombre), '') = '' then
    raise exception 'El snapshot requiere nombre' using errcode = '23514';
  end if;

  if p_planta_id is not null then
    select especie_id into v_especie_id
    from plantas
    where id = p_planta_id and eliminado_at is null;
    if not found then
      raise exception 'Cruce no encontrado' using errcode = 'P0002';
    end if;
  end if;

  v_version_id := resolver_scoring_version(v_especie_id, 'evaluacion_anual', current_date);
  if v_version_id is null then
    raise exception 'No hay versión activa de scoring para este alcance' using errcode = '23514';
  end if;

  select nombre, criterio_desempate into v_version_nombre, v_desempate
  from scoring_version where id = v_version_id;

  select count(*)::integer into v_poblacion
  from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id)
  where elegible;

  if v_poblacion = 0 then
    raise exception 'No hay población elegible para congelar' using errcode = '23514';
  end if;

  insert into ranking_snapshot (
    nombre, alcance, scoring_version_id, especie_id, planta_id,
    poblacion_comparada, criterios, created_by
  ) values (
    btrim(p_nombre),
    case when p_planta_id is null
      then 'especie'::alcance_ranking_snapshot
      else 'cruzamiento'::alcance_ranking_snapshot
    end,
    v_version_id,
    v_especie_id,
    p_planta_id,
    v_poblacion,
    jsonb_build_object(
      'scoring_version_nombre', v_version_nombre,
      'seleccion_evaluacion', 'ultima completa/corregida de la ronda mas reciente; fecha y updated_at como desempate',
      'exclusiones', jsonb_build_array('borrador', 'anulada', 'requiere_revision', 'no_comparable', 'metricas_incompletas'),
      'desempate', v_desempate
    ),
    v_uid
  ) returning id into v_snapshot_id;

  insert into ranking_snapshot_resultado (
    snapshot_id, individuo_id, codigo_display, evaluacion_id,
    posicion, puntaje, detalle
  )
  select
    v_snapshot_id,
    r.individuo_id,
    r.codigo_display,
    r.evaluacion_id,
    row_number() over (
      order by r.puntaje_ponderado desc,
               r.fecha_evaluacion desc,
               r.evaluacion_updated_at desc,
               r.codigo_display asc
    )::integer,
    r.puntaje_ponderado,
    jsonb_build_object(
      'fecha_evaluacion', r.fecha_evaluacion,
      'numero_ronda', r.numero_ronda,
      'estado_evaluacion', r.estado_evaluacion,
      'scoring_version_id', r.scoring_version_id,
      'scoring_version_nombre', r.scoring_version_nombre,
      'metricas', r.detalle_metricas
    )
  from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id) r
  where r.elegible
  order by r.puntaje_ponderado desc, r.fecha_evaluacion desc,
           r.evaluacion_updated_at desc, r.codigo_display asc;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    p_planta_id,
    'congelacion_ranking',
    array['scoring_version_id', 'evaluacion_id', 'puntaje'],
    jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'especie_id', v_especie_id,
      'poblacion', v_poblacion,
      'scoring_version_id', v_version_id
    )
  );

  return v_snapshot_id;
end;
$$;

