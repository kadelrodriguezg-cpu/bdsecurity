-- =============================================================================
-- M-08 (auditoria post-consolidacion, 04-10-2026): aplicar el gate de
-- calidad del ranking tambien a la serie historica y a la comparacion de
-- rondas.
--
-- Decision de dominio vigente (20260923134041): si cualquier metrica que
-- participa del scoring de la version en uso proviene de una visita marcada
-- requiere_revision o no_comparable, la RONDA COMPLETA queda inelegible
-- (motivo_exclusion = 'contiene_metrica_marcada'). Hasta ahora solo lo
-- aplicaba calcular_ranking_operativo; obtener_series_historicas_cientificas
-- y obtener_comparacion_rondas seguian usando esa ronda, asi que la pantalla
-- podia contradecir al ranking.
--
-- Cambios (CREATE OR REPLACE desde la ultima definicion completa, en
-- 20260922203143; el resto del cuerpo queda igual):
-- - ronda_contiene_metrica_marcada(ronda, version): el mismo predicado que
--   usa el ranking (obtener_procedencia_calidad_ronda contra scoring_metrica
--   de la version), en una funcion para no copiarlo dos veces mas.
-- - Series: excluye la ronda marcada del conteo y del promedio mensual.
--   (Ya excluia requiere_revision/no_comparable de la evaluacion unificada.)
-- - Comparacion: excluye el par si cualquiera de las dos rondas esta en
--   revision, es no comparable o contiene una metrica marcada.
--
-- PENDIENTE (no se hace aqui, por decision del dueno): factorizar la formula
-- de puntaje por categoria; series la sigue calculando inline.
-- No modifica calcular_ranking_operativo.
-- =============================================================================

create or replace function public.ronda_contiene_metrica_marcada(
  p_ronda_id uuid,
  p_scoring_version_id uuid
)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(bool_or(
    sm.metrica = any(coalesce(proc.descriptores_con_revision, '{}'::text[]))
    or sm.metrica = any(coalesce(proc.descriptores_no_comparables, '{}'::text[]))
  ), false)
  from obtener_procedencia_calidad_ronda(p_ronda_id) proc
  join scoring_metrica sm on sm.scoring_version_id = p_scoring_version_id;
$$;

comment on function public.ronda_contiene_metrica_marcada(uuid, uuid) is
  'true si alguna metrica de scoring_metrica de la version proviene de una visita requiere_revision o no_comparable (mismo predicado que el gate de calcular_ranking_operativo).';

revoke execute on function public.ronda_contiene_metrica_marcada(uuid, uuid) from public, anon;
grant execute on function public.ronda_contiene_metrica_marcada(uuid, uuid) to authenticated, service_role;

create or replace function obtener_comparacion_rondas(
  p_individuo_id uuid default null,
  p_planta_id uuid default null
)
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
  if (p_individuo_id is null) = (p_planta_id is null) then
    raise exception 'Indica exactamente un individuo o un cruce' using errcode = '22023';
  end if;

  with alcance as (
    select i.id as individuo_id, i.codigo_display, p.especie_id,
      resolver_scoring_version(p.especie_id, 'evaluacion_anual', current_date) as scoring_version_id
    from individuos i
    join plantas p on p.id = i.planta_id
    where i.estado_vital = 'vivo'
      and p.eliminado_at is null
      and (p_individuo_id is null or i.id = p_individuo_id)
      and (p_planta_id is null or p.id = p_planta_id)
  ), evaluacion_por_ronda as (
    select
      r.individuo_id,
      r.tipo_ronda,
      r.numero_ronda,
      a.codigo_display,
      a.scoring_version_id,
      r.id as ronda_id,
      e as evaluacion
    from ronda_evaluacion_anual r
    join alcance a on a.individuo_id = r.individuo_id
    left join lateral unificar_evaluacion_ronda(r.id) e on true
  ), pares as (
    select
      act.individuo_id,
      act.codigo_display,
      act.tipo_ronda,
      act.scoring_version_id,
      ant.numero_ronda as numero_anterior,
      act.numero_ronda as numero_actual,
      ant.evaluacion as evaluacion_anterior,
      act.evaluacion as evaluacion_actual
    from evaluacion_por_ronda act
    join evaluacion_por_ronda ant
      on ant.individuo_id = act.individuo_id
     and ant.tipo_ronda = act.tipo_ronda
     and ant.numero_ronda = act.numero_ronda - 1
    where (act.evaluacion).id is not null
      and (ant.evaluacion).id is not null
      -- Mismo gate que calcular_ranking_operativo: una ronda en revision, no
      -- comparable o con una metrica marcada no entra en ninguna comparacion.
      and not coalesce((act.evaluacion).requiere_revision, false)
      and not coalesce((act.evaluacion).no_comparable, false)
      and not coalesce((ant.evaluacion).requiere_revision, false)
      and not coalesce((ant.evaluacion).no_comparable, false)
      and not ronda_contiene_metrica_marcada(act.ronda_id, act.scoring_version_id)
      and not ronda_contiene_metrica_marcada(ant.ronda_id, act.scoring_version_id)
  ), pares_calculados as (
    select
      p.*,
      sv.umbral_delta_leve,
      sv.umbral_delta_marcado,
      cat_ant.categoria,
      cat_ant.subpuntaje as subpuntaje_anterior,
      cat_act.subpuntaje as subpuntaje_actual
    from pares p
    join scoring_version sv on sv.id = p.scoring_version_id
    join lateral calcular_categorias_evaluacion(p.evaluacion_anterior, p.scoring_version_id) cat_ant on true
    join lateral calcular_categorias_evaluacion(p.evaluacion_actual, p.scoring_version_id) cat_act
      on cat_act.categoria = cat_ant.categoria
  ), deltas_categoria as (
    select
      individuo_id, codigo_display, tipo_ronda, numero_anterior, numero_actual,
      categoria, subpuntaje_anterior, subpuntaje_actual,
      (subpuntaje_actual - subpuntaje_anterior) as delta,
      etiquetar_delta(subpuntaje_actual - subpuntaje_anterior, umbral_delta_leve, umbral_delta_marcado) as etiqueta
    from pares_calculados
  ), metricas_par as (
    select
      p.individuo_id, p.codigo_display, p.tipo_ronda, p.numero_anterior, p.numero_actual,
      sv.umbral_delta_leve, sv.umbral_delta_marcado,
      m_ant.metrica, m_ant.categoria,
      m_ant.valor as valor_anterior, m_ant.normalizado as normalizado_anterior,
      m_act.valor as valor_actual, m_act.normalizado as normalizado_actual
    from pares p
    join scoring_version sv on sv.id = p.scoring_version_id
    join lateral calcular_metricas_evaluacion(p.evaluacion_anterior, p.scoring_version_id) m_ant on true
    join lateral calcular_metricas_evaluacion(p.evaluacion_actual, p.scoring_version_id) m_act
      on m_act.metrica = m_ant.metrica
  ), deltas_parametro as (
    select
      individuo_id, codigo_display, tipo_ronda, numero_anterior, numero_actual,
      metrica, categoria, valor_anterior, valor_actual,
      normalizado_anterior, normalizado_actual,
      (normalizado_actual - normalizado_anterior) as delta,
      etiquetar_delta(normalizado_actual - normalizado_anterior, umbral_delta_leve, umbral_delta_marcado) as etiqueta
    from metricas_par
    where normalizado_anterior is not null and normalizado_actual is not null
  )
  select jsonb_build_object(
    'individuos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'individuo_id', ind.individuo_id,
        'codigo_display', ind.codigo_display,
        'tipo_ronda', ind.tipo_ronda,
        'numero_anterior', ind.numero_anterior,
        'numero_actual', ind.numero_actual,
        'deltas_categoria', ind.deltas_categoria,
        'deltas_parametro', coalesce(ind.deltas_parametro, '[]'::jsonb)
      ) order by codigo_display_numero(ind.codigo_display), ind.codigo_display, ind.tipo_ronda, ind.numero_actual)
      from (
        select
          dc.individuo_id, dc.codigo_display, dc.tipo_ronda, dc.numero_anterior, dc.numero_actual,
          jsonb_agg(jsonb_build_object(
            'categoria', dc.categoria,
            'valor_anterior', dc.subpuntaje_anterior,
            'valor_actual', dc.subpuntaje_actual,
            'delta', dc.delta,
            'etiqueta', dc.etiqueta
          ) order by dc.categoria) as deltas_categoria,
          (
            select jsonb_agg(jsonb_build_object(
              'metrica', dp.metrica,
              'categoria', dp.categoria,
              'valor_anterior', dp.valor_anterior,
              'valor_actual', dp.valor_actual,
              'normalizado_anterior', dp.normalizado_anterior,
              'normalizado_actual', dp.normalizado_actual,
              'delta', dp.delta,
              'etiqueta', dp.etiqueta
            ) order by dp.metrica)
            from deltas_parametro dp
            where dp.individuo_id = dc.individuo_id
              and dp.tipo_ronda = dc.tipo_ronda
              and dp.numero_actual = dc.numero_actual
          ) as deltas_parametro
        from deltas_categoria dc
        group by dc.individuo_id, dc.codigo_display, dc.tipo_ronda, dc.numero_anterior, dc.numero_actual
      ) ind
    ), '[]'::jsonb),
    'umbrales', (
      select jsonb_build_object('leve', umbral_delta_leve, 'marcado', umbral_delta_marcado)
      from scoring_version
      where id = (select scoring_version_id from alcance limit 1)
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

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
  ), rondas_base as (
    select
      r.id as ronda_id,
      e as evaluacion,
      e.fecha,
      p.especie_id,
      p.estado as fase
    from ronda_evaluacion_anual r
    join individuos i on i.id = r.individuo_id
    join plantas p on p.id = i.planta_id
    cross join lateral unificar_evaluacion_ronda(r.id) e
    where p.eliminado_at is null
      and p.especie_id = p_especie_id
      and (p_planta_id is null or p.id = p_planta_id)
      -- La ronda se unifica completa antes de aplicar el filtro. La fecha
      -- representativa es la visita cerrada mas reciente de esa ronda.
      and e.fecha between v_desde and v_hasta
      and not e.requiere_revision
      and not e.no_comparable
  ), rondas_puntuadas as (
    select
      rb.*,
      sv.id as scoring_version_id,
      metricas.configuradas,
      metricas.disponibles,
      metricas.puntaje
    from rondas_base rb
    left join lateral (
      select resolver_scoring_version(rb.especie_id, rb.fase, rb.fecha) as id
    ) sv on true
    left join lateral (
      with m as (
        select *
        from calcular_metricas_evaluacion(rb.evaluacion, sv.id)
      ), cat as (
        select *
        from calcular_categorias_evaluacion(rb.evaluacion, sv.id)
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
      count(*) filter (where configuradas > 0 and disponibles = configuradas)::integer as rondas_elegibles,
      round(avg(puntaje) filter (where configuradas > 0 and disponibles = configuradas), 4) as puntaje_promedio
    from rondas_puntuadas
    -- Mismo gate que calcular_ranking_operativo: la ronda con una metrica
    -- marcada queda fuera de la serie completa, no solo de su promedio.
    where not ronda_contiene_metrica_marcada(ronda_id, scoring_version_id)
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
        -- Se conserva la clave publica por compatibilidad, pero desde D2 cuenta
        -- rondas unificadas elegibles, no visitas/evaluaciones individuales.
        'evaluaciones_elegibles', coalesce(s.rondas_elegibles, 0),
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

notify pgrst, 'reload schema';
