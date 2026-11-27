-- =============================================================================
-- Fase 0 (2/3) — Saneamiento de lecturas de evaluaciones (ver auditoría de
-- diseño previa a la evaluación por fases).
--
-- El feed "cambios_recientes" de obtener_dashboard_cientifico unía evaluaciones
-- sin filtrar por estado, a diferencia del contador 'evaluaciones_ultimos_30_dias'
-- de la misma función (que sí filtra completa/corregida desde su creación).
-- Un borrador a medio llenar o una evaluación anulada aparecían como actividad
-- "evaluación" reciente de una planta, igual que una evaluación real.
--
-- Único cambio respecto de la definición anterior: se agrega
-- "and e.estado in ('completa', 'corregida')" a la rama 'evaluacion' del CTE
-- actividad. El resto de la función queda idéntico -- no se toca el gate de
-- descriptores, ranking ni ningún otro cálculo (fuera de alcance de esta fase).
-- =============================================================================

create or replace function public.obtener_dashboard_cientifico(p_especie_id uuid default null::uuid, p_limite integer default 8)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  v_resultado jsonb;
  v_version_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if p_limite < 1 or p_limite > 25 then
    raise exception 'Límite inválido' using errcode = '22023';
  end if;

  if p_especie_id is not null then
    v_version_id := resolver_scoring_version(p_especie_id, 'evaluacion_anual', current_date);
  end if;

  with plantas_alcance as materialized (
    select p.id, p.codigo_sistema, p.especie_id, p.especie_nombre, p.estado, p.updated_at, p.fecha_cambio_estado
    from plantas_operativas p
    where p_especie_id is null or p.especie_id = p_especie_id
  ), actividad as materialized (
    select p.id as planta_id, p.codigo_sistema, p.especie_nombre, p.estado,
           p.fecha_cambio_estado as fecha, 'cambio_etapa'::text as tipo
    from plantas_alcance p
    union all
    select p.id, p.codigo_sistema, p.especie_nombre, p.estado,
           r.created_at, 'registro_campo'
    from plantas_alcance p
    join registros_evento r on r.planta_id = p.id
    union all
    select p.id, p.codigo_sistema, p.especie_nombre, p.estado,
           e.updated_at, 'evaluacion'
    from plantas_alcance p
    join individuos i on i.planta_id = p.id
    join ronda_evaluacion_anual rr on rr.individuo_id = i.id
    join evaluaciones e on e.ronda_id = rr.id
    where e.estado in ('completa', 'corregida')
  ), ultimo_cambio as materialized (
    select distinct on (a.planta_id)
      a.planta_id, a.codigo_sistema, a.especie_nombre, a.estado, a.fecha, a.tipo
    from actividad a
    order by a.planta_id, a.fecha desc, a.tipo
  ), pendientes as materialized (
    select
      p.id as planta_id,
      p.codigo_sistema,
      p.estado,
      count(*) filter (where not r.elegible)::integer as individuos_pendientes
    from plantas_alcance p
    cross join lateral calcular_ranking_operativo(
      resolver_scoring_version(p.especie_id, 'evaluacion_anual', current_date),
      p.id,
      null
    ) r
    where p.estado in ('evaluacion_anual', 'traslado_destino')
    group by p.id, p.codigo_sistema, p.estado
    having count(*) filter (where not r.elegible) > 0
  ), destacados as materialized (
    select r.*
    from calcular_ranking_operativo(v_version_id, null, p_especie_id) r
    where p_especie_id is not null and r.elegible
    order by r.puntaje_ponderado desc, r.fecha_evaluacion desc,
             r.evaluacion_updated_at desc, r.codigo_display asc
    limit p_limite
  )
  select jsonb_build_object(
    'generado_at', now(),
    'especie_id', p_especie_id,
    'resumen', jsonb_build_object(
      'cruces_activos', (select count(*) from plantas_alcance),
      'individuos_vivos', (
        select count(*) from individuos i join plantas_alcance p on p.id = i.planta_id where i.estado_vital = 'vivo'
      ),
      'evaluaciones_ultimos_30_dias', (
        select count(*)
        from evaluaciones e
        join ronda_evaluacion_anual rr on rr.id = e.ronda_id
        join individuos i on i.id = rr.individuo_id
        join plantas_alcance p on p.id = i.planta_id
        where e.estado in ('completa', 'corregida') and e.updated_at >= now() - interval '30 days'
      ),
      'procedimientos_pendientes', (
        select count(distinct pr.id)
        from procedimientos pr
        join procedimiento_objetivos po on po.procedimiento_id = pr.id
        left join individuos oi on oi.id = po.individuo_id
        join plantas_alcance p on p.id = po.planta_id or p.id = oi.planta_id
        where pr.estado in ('planificado', 'en_curso')
      ),
      'cruces_con_pendientes', (select count(*) from pendientes)
    ),
    'cambios_recientes', coalesce((
      select jsonb_agg(to_jsonb(cambio))
      from (
        select * from ultimo_cambio order by fecha desc limit p_limite
      ) cambio
    ), '[]'::jsonb),
    'destacados', coalesce((select jsonb_agg(to_jsonb(destacados)) from destacados), '[]'::jsonb),
    'pendientes', coalesce((
      select jsonb_agg(to_jsonb(pendiente))
      from (
        select * from pendientes order by individuos_pendientes desc, codigo_sistema limit p_limite
      ) pendiente
    ), '[]'::jsonb),
    'scoring_version_id', v_version_id,
    'scoring_version_nombre', (select nombre from scoring_version where id = v_version_id)
  ) into v_resultado;

  return v_resultado;
end;
$function$;

comment on function public.obtener_dashboard_cientifico(uuid, integer) is
  'Dashboard de ranking/actividad. El feed de actividad (rama evaluacion) filtra completa/corregida desde esta migración -- antes mezclaba borradores y anuladas con evaluaciones reales, igual que el contador de 30 días de la misma función.';
