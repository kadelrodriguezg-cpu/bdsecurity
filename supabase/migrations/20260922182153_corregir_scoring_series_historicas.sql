-- Corrige la divergencia latente entre la serie historica y el ranking:
-- ambas rutas deben agregar primero dentro de cada categoria y despues aplicar
-- scoring_categoria_peso, renormalizando solo sobre categorias con datos.
-- La rama de individuos no vivos de obtener_ranking_global_filtrado fue
-- revisada: no calcula puntaje (devuelve NULL y marca la exclusion), por lo
-- que no contiene una segunda copia de este error.

create or replace function obtener_series_historicas_cientificas(
  p_especie_id uuid,
  p_planta_id uuid default null,
  p_fecha_desde date default null,
  p_fecha_hasta date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desde date := coalesce(p_fecha_desde, (current_date - interval '12 months')::date);
  v_hasta date := coalesce(p_fecha_hasta, current_date);
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if p_especie_id is null then
    raise exception 'Selecciona una especie para comparar tendencias cientificas'
      using errcode = '23502';
  end if;
  if v_desde > v_hasta then
    raise exception 'La fecha inicial no puede ser posterior a la fecha final'
      using errcode = '22007';
  end if;
  if p_planta_id is not null and not exists (
    select 1 from plantas p where p.id = p_planta_id and p.especie_id = p_especie_id
  ) then
    raise exception 'El cruce no pertenece a la especie seleccionada'
      using errcode = '23503';
  end if;

  with meses as (
    select generate_series(
      date_trunc('month', v_desde)::date,
      date_trunc('month', v_hasta)::date,
      interval '1 month'
    )::date as periodo
  ), evaluaciones_base as (
    select
      e as evaluacion,
      e.fecha,
      p.especie_id,
      p.estado as fase
    from evaluaciones e
    join ronda_evaluacion_anual r on r.id = e.ronda_id
    join individuos i on i.id = r.individuo_id
    join plantas p on p.id = i.planta_id
    where p.eliminado_at is null
      and p.especie_id = p_especie_id
      and (p_planta_id is null or p.id = p_planta_id)
      and e.fecha between v_desde and v_hasta
      and e.estado in ('completa', 'corregida')
      and not e.requiere_revision
      and not e.no_comparable
  ), evaluaciones_puntuadas as (
    select
      eb.*,
      sv.id as scoring_version_id,
      metricas.configuradas,
      metricas.disponibles,
      metricas.puntaje
    from evaluaciones_base eb
    left join lateral (
      select resolver_scoring_version(eb.especie_id, eb.fase, eb.fecha) as id
    ) sv on true
    left join lateral (
      with m as (
        select *
        from calcular_metricas_evaluacion(eb.evaluacion, sv.id)
      ), cat as (
        select *
        from calcular_categorias_evaluacion(eb.evaluacion, sv.id)
      )
      select
        (select count(*) from m)::integer as configuradas,
        (select count(*) from m where valor is not null)::integer as disponibles,
        (
          select case
            when exists (
              select 1
              from scoring_categoria_peso scp0
              where scp0.scoring_version_id = sv.id
            ) then (
              select case
                when sum(scp.peso) filter (where cat.subpuntaje is not null) > 0 then
                  sum(cat.subpuntaje * scp.peso) filter (where cat.subpuntaje is not null)
                  / sum(scp.peso) filter (where cat.subpuntaje is not null)
                else null
              end
              from cat
              join scoring_categoria_peso scp
                on scp.categoria = cat.categoria
               and scp.scoring_version_id = sv.id
            )
            else (
              -- Compatibilidad con versiones anteriores sin pesos de categoria,
              -- igual que calcular_ranking_operativo.
              select case
                when sum(peso) filter (where valor is not null) > 0 then
                  sum(normalizado * peso) filter (where valor is not null)
                  / sum(peso) filter (where valor is not null)
                else null
              end
              from m
            )
          end
        ) as puntaje
    ) metricas on true
  ), scoring_por_mes as (
    select
      date_trunc('month', fecha)::date as periodo,
      count(*) filter (where configuradas > 0 and disponibles = configuradas)::integer as evaluaciones_elegibles,
      round(avg(puntaje) filter (where configuradas > 0 and disponibles = configuradas), 4) as puntaje_promedio
    from evaluaciones_puntuadas
    group by 1
  ), vivos_por_mes as (
    select
      m.periodo,
      count(i.id)::integer as individuos_vivos
    from meses m
    left join individuos i
      on i.created_at::date <= (m.periodo + interval '1 month - 1 day')::date
     and (i.fecha_baja is null or i.fecha_baja > (m.periodo + interval '1 month - 1 day')::date)
    left join plantas p on p.id = i.planta_id
    where p.especie_id = p_especie_id
      and p.eliminado_at is null
      and (p_planta_id is null or p.id = p_planta_id)
    group by m.periodo
  ), procedimientos_por_mes as (
    select
      date_trunc('month', pr.fecha_inicio)::date as periodo,
      count(*)::integer as procedimientos
    from procedimientos pr
    where pr.fecha_inicio between v_desde and v_hasta
      and exists (
        select 1
        from procedimiento_objetivos po
        join plantas p on p.id = po.planta_id
        where po.procedimiento_id = pr.id
          and p.especie_id = p_especie_id
          and (p_planta_id is null or p.id = p_planta_id)
      )
    group by 1
  )
  select jsonb_build_object(
    'especie_id', p_especie_id,
    'planta_id', p_planta_id,
    'fecha_desde', v_desde,
    'fecha_hasta', v_hasta,
    'scoring', coalesce((
      select jsonb_agg(jsonb_build_object(
        'periodo', m.periodo,
        'evaluaciones_elegibles', coalesce(s.evaluaciones_elegibles, 0),
        'puntaje_promedio', s.puntaje_promedio
      ) order by m.periodo)
      from meses m left join scoring_por_mes s on s.periodo = m.periodo
    ), '[]'::jsonb),
    'individuos_vivos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'periodo', m.periodo,
        'cantidad', coalesce(v.individuos_vivos, 0)
      ) order by m.periodo)
      from meses m left join vivos_por_mes v on v.periodo = m.periodo
    ), '[]'::jsonb),
    'procedimientos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'periodo', m.periodo,
        'cantidad', coalesce(pr.procedimientos, 0)
      ) order by m.periodo)
      from meses m left join procedimientos_por_mes pr on pr.periodo = m.periodo
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function obtener_series_historicas_cientificas(uuid, uuid, date, date) from public, anon;
grant execute on function obtener_series_historicas_cientificas(uuid, uuid, date, date) to authenticated, service_role;

comment on function obtener_series_historicas_cientificas(uuid, uuid, date, date) is
  'Series agregadas por especie para graficos. El scoring usa la misma formula '
  'por categorias que calcular_ranking_operativo: subpuntaje intr categoria, '
  'scoring_categoria_peso y renormalizacion sobre categorias presentes. No '
  'devuelve linaje ni datos de ubicacion.';
