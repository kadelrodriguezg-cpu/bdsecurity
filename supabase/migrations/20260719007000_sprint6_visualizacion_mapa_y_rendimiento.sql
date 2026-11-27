-- =============================================================================
-- Sprint 6: contratos de visualización y consulta territorial a escala.
--
-- Estas funciones son capas de consulta. No modifican la fuente de verdad
-- territorial ni devuelven linaje. Las coordenadas solo se entregan desde la
-- consulta de viewport, que exige admin explícitamente.
-- =============================================================================

create index if not exists idx_evaluaciones_series_comparables
  on evaluaciones (fecha, ronda_id)
  where estado in ('completa', 'corregida')
    and not requiere_revision
    and not no_comparable;

create index if not exists idx_procedimientos_actividad_fecha
  on procedimientos (fecha_inicio, estado);

create index if not exists idx_emplazamiento_coordenada_viewport
  on emplazamiento_coordenada (latitud, longitud)
  where latitud is not null and longitud is not null;


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
    raise exception 'Selecciona una especie para comparar tendencias científicas'
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
      e.id,
      e.fecha,
      e.brotacion, e.floracion, e.cuaja, e.concentracion_cosecha,
      e.calibre_mm, e.firmeza, e.color, e.bloom, e.brix,
      e.rend_kg_planta, e.rend_t_ha, e.pct_fruta_exportable,
      e.dano_calor, e.golpe_sol, e.caida_fruto,
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
      select
        count(sm.id)::integer as configuradas,
        count(valor.valor)::integer as disponibles,
        case
          when sum(sm.peso) filter (where valor.valor is not null) > 0 then
            sum(
              normalizar_metrica_scoring(
                valor.valor,
                coalesce(rr.minimo_esperado, sm.minimo_normalizacion),
                coalesce(rr.maximo_esperado, sm.maximo_normalizacion),
                sm.direccion_favorable
              ) * sm.peso
            ) filter (where valor.valor is not null)
            / sum(sm.peso) filter (where valor.valor is not null)
          else null
        end as puntaje
      from scoring_metrica sm
      left join rango_referencia rr on rr.id = sm.rango_referencia_id
      left join lateral (
        select case sm.metrica
          when 'brotacion' then eb.brotacion::numeric
          when 'floracion' then eb.floracion::numeric
          when 'cuaja' then eb.cuaja::numeric
          when 'concentracion_cosecha' then eb.concentracion_cosecha::numeric
          when 'calibre_mm' then eb.calibre_mm
          when 'firmeza' then eb.firmeza::numeric
          when 'color' then eb.color::numeric
          when 'bloom' then eb.bloom::numeric
          when 'brix' then eb.brix
          when 'rend_kg_planta' then eb.rend_kg_planta
          when 'rend_t_ha' then eb.rend_t_ha
          when 'pct_fruta_exportable' then eb.pct_fruta_exportable
          when 'dano_calor' then eb.dano_calor::numeric
          when 'golpe_sol' then eb.golpe_sol::numeric
          when 'caida_fruto' then eb.caida_fruto::numeric
          else null
        end as valor
      ) valor on true
      where sm.scoring_version_id = sv.id
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
  'Series agregadas por especie para gráficos. Calcula scoring en PostgreSQL y no devuelve linaje ni datos de ubicación.';


create or replace function obtener_resumen_mapa_territorial(
  p_especie_id uuid default null,
  p_predio_id uuid default null,
  p_sector_id uuid default null,
  p_limite integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if p_limite < 1 or p_limite > 500 or p_offset < 0 then
    raise exception 'Paginación territorial inválida' using errcode = '22023';
  end if;

  with clusters as (
    select
      si.id as sitio_id,
      si.nombre as sitio_nombre,
      p.id as predio_id,
      p.nombre as predio_nombre,
      s.id as sector_id,
      s.nombre as sector_nombre,
      count(ei.id)::integer as individuos,
      count(ei.id) filter (where i.estado_vital = 'vivo')::integer as individuos_vivos
    from emplazamiento_individuo ei
    join individuos i on i.id = ei.individuo_id
    join plantas pl on pl.id = i.planta_id
    join sector s on s.id = ei.sector_id
    join predio p on p.id = s.predio_id
    join sitio si on si.id = p.sitio_id
    where ei.fecha_fin is null
      and pl.eliminado_at is null
      and (p_especie_id is null or pl.especie_id = p_especie_id)
      and (p_predio_id is null or p.id = p_predio_id)
      and (p_sector_id is null or s.id = p_sector_id)
    group by si.id, si.nombre, p.id, p.nombre, s.id, s.nombre
  ), pagina as (
    select * from clusters
    order by sitio_nombre, predio_nombre, sector_nombre
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'precision', 'agregada',
    'total', (select count(*) from clusters),
    'limite', p_limite,
    'offset', p_offset,
    'clusters', coalesce((select jsonb_agg(to_jsonb(pagina) order by sitio_nombre, predio_nombre, sector_nombre) from pagina), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer) to authenticated, service_role;

comment on function obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer) is
  'Mapa territorial agregado para cualquier usuario autenticado. No consulta ni expone coordenadas, precisión ni referencias operativas.';


create or replace function consultar_mapa_viewport(
  p_latitud_minima numeric,
  p_latitud_maxima numeric,
  p_longitud_minima numeric,
  p_longitud_maxima numeric,
  p_especie_id uuid default null,
  p_limite integer default 250,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede consultar coordenadas por viewport'
      using errcode = '42501';
  end if;
  if p_latitud_minima is null or p_latitud_maxima is null
     or p_longitud_minima is null or p_longitud_maxima is null
     or p_latitud_minima >= p_latitud_maxima
     or p_longitud_minima >= p_longitud_maxima
     or p_latitud_minima < -90 or p_latitud_maxima > 90
     or p_longitud_minima < -180 or p_longitud_maxima > 180 then
    raise exception 'Viewport geográfico inválido' using errcode = '22023';
  end if;
  if p_limite < 1 or p_limite > 500 or p_offset < 0 then
    raise exception 'Paginación de viewport inválida' using errcode = '22023';
  end if;

  with puntos as (
    select
      ei.id as emplazamiento_id,
      s.id as sector_id,
      s.nombre as sector_nombre,
      p.id as predio_id,
      p.nombre as predio_nombre,
      si.id as sitio_id,
      si.nombre as sitio_nombre,
      ec.latitud,
      ec.longitud,
      ec.precision_metros
    from emplazamiento_coordenada ec
    join emplazamiento_individuo ei on ei.id = ec.emplazamiento_id and ei.fecha_fin is null
    join individuos i on i.id = ei.individuo_id
    join plantas pl on pl.id = i.planta_id and pl.eliminado_at is null
    join sector s on s.id = ei.sector_id
    join predio p on p.id = s.predio_id
    join sitio si on si.id = p.sitio_id
    where ec.latitud between p_latitud_minima and p_latitud_maxima
      and ec.longitud between p_longitud_minima and p_longitud_maxima
      and (p_especie_id is null or pl.especie_id = p_especie_id)
  ), pagina as (
    select * from puntos
    order by sitio_nombre, predio_nombre, sector_nombre, latitud, longitud
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'precision', 'exacta_admin',
    'total', (select count(*) from puntos),
    'limite', p_limite,
    'offset', p_offset,
    'puntos', coalesce((select jsonb_agg(to_jsonb(pagina) order by sitio_nombre, predio_nombre, sector_nombre, latitud, longitud) from pagina), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer) from public, anon;
grant execute on function consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer) to authenticated, service_role;

comment on function consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer) is
  'Consulta paginada de coordenadas exactas por viewport. Security definer con verificación explícita de es_admin(); nunca accesible para operarios.';
