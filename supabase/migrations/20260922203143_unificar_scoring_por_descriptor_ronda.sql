-- D2: una ronda puede contener varias visitas parciales. El scoring debe
-- construir una sola fotografia de la ronda tomando, descriptor por descriptor,
-- el valor no nulo mas reciente (fecha, updated_at, id descendentes).
--
-- La tripleta de muestra es deliberadamente atomica: cantidad_frutos,
-- peso_total_g y peso_promedio_g provienen de la visita mas reciente que tenga
-- ambos insumos. Nunca se divide el peso de una muestra por el conteo de otra.
--
-- Las cuatro funciones consumidoras se reemplazan en esta misma migracion para
-- que ranking, rama de no vivos, comparacion y serie historica nunca queden con
-- semanticas distintas durante un despliegue.

create or replace function unificar_evaluacion_ronda(p_ronda_id uuid)
returns setof evaluaciones
language sql
stable
security invoker
set search_path = public
as $$
  with cerradas as materialized (
    select e.*
    from evaluaciones e
    where e.ronda_id = p_ronda_id
      and e.estado in ('completa', 'corregida')
  ), representante as (
    select e as evaluacion
    from cerradas e
    order by e.fecha desc, e.updated_at desc, e.id desc
    limit 1
  ), descriptores as (
    select
      (array_agg(e.brotacion order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.brotacion is not null))[1] as brotacion,
      (array_agg(e.floracion order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.floracion is not null))[1] as floracion,
      (array_agg(e.cuaja order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.cuaja is not null))[1] as cuaja,
      (array_agg(e.concentracion_cosecha order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.concentracion_cosecha is not null))[1] as concentracion_cosecha,
      (array_agg(e.calibre_mm order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.calibre_mm is not null))[1] as calibre_mm,
      (array_agg(e.firmeza order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.firmeza is not null))[1] as firmeza,
      (array_agg(e.color order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.color is not null))[1] as color,
      (array_agg(e.bloom order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.bloom is not null))[1] as bloom,
      (array_agg(e.brix order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.brix is not null))[1] as brix,
      (array_agg(e.rend_kg_planta order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.rend_kg_planta is not null))[1] as rend_kg_planta,
      (array_agg(e.rend_t_ha order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.rend_t_ha is not null))[1] as rend_t_ha,
      (array_agg(e.pct_fruta_exportable order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.pct_fruta_exportable is not null))[1] as pct_fruta_exportable,
      (array_agg(e.dano_calor order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.dano_calor is not null))[1] as dano_calor,
      (array_agg(e.golpe_sol order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.golpe_sol is not null))[1] as golpe_sol,
      (array_agg(e.caida_fruto order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.caida_fruto is not null))[1] as caida_fruto
    from cerradas e
  ), muestra as (
    select e.cantidad_frutos, e.peso_total_g, e.peso_promedio_g
    from cerradas e
    where e.cantidad_frutos is not null
      and e.peso_total_g is not null
    order by e.fecha desc, e.updated_at desc, e.id desc
    limit 1
  )
  select jsonb_populate_record(
    null::evaluaciones,
    to_jsonb(rep.evaluacion) || jsonb_build_object(
      'brotacion', d.brotacion,
      'floracion', d.floracion,
      'cuaja', d.cuaja,
      'concentracion_cosecha', d.concentracion_cosecha,
      'calibre_mm', d.calibre_mm,
      'firmeza', d.firmeza,
      'color', d.color,
      'bloom', d.bloom,
      'brix', d.brix,
      'rend_kg_planta', d.rend_kg_planta,
      'rend_t_ha', d.rend_t_ha,
      'pct_fruta_exportable', d.pct_fruta_exportable,
      'dano_calor', d.dano_calor,
      'golpe_sol', d.golpe_sol,
      'caida_fruto', d.caida_fruto,
      'cantidad_frutos', m.cantidad_frutos,
      'peso_total_g', m.peso_total_g,
      'peso_promedio_g', m.peso_promedio_g
    )
  )
  from representante rep
  cross join descriptores d
  left join muestra m on true;
$$;

revoke all on function unificar_evaluacion_ronda(uuid) from public, anon;
grant execute on function unificar_evaluacion_ronda(uuid) to authenticated, service_role;

comment on function unificar_evaluacion_ronda(uuid) is
  'Fotografia unificada de una ronda: cada descriptor usa el valor no NULL mas '
  'reciente por fecha/updated_at/id DESC. La tripleta cantidad/peso/promedio se '
  'toma completa de una sola visita con ambos insumos; nunca mezcla muestras. '
  'Los metadatos de fila pertenecen a la visita cerrada mas reciente.';

create or replace function calcular_ranking_operativo(
  p_scoring_version_id uuid,
  p_planta_id uuid default null,
  p_especie_id uuid default null
)
returns table (
  individuo_id uuid,
  codigo_display text,
  planta_id uuid,
  codigo_sistema text,
  especie_id uuid,
  evaluacion_id uuid,
  fecha_evaluacion date,
  evaluacion_updated_at timestamptz,
  numero_ronda smallint,
  estado_evaluacion estado_evaluacion,
  requiere_revision boolean,
  no_comparable boolean,
  scoring_version_id uuid,
  scoring_version_nombre text,
  puntaje_ponderado numeric,
  elegible boolean,
  motivo_exclusion text,
  detalle_metricas jsonb,
  detalle_categorias jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with alcance as (
    select
      i.id as individuo_id,
      i.codigo_display,
      i.planta_id,
      p.codigo_sistema,
      p.especie_id
    from individuos i
    join plantas p on p.id = i.planta_id
    where i.estado_vital = 'vivo'
      and p.eliminado_at is null
      and (p_planta_id is null or p.id = p_planta_id)
      and (p_especie_id is null or p.especie_id = p_especie_id)
  ), ultima_ronda as (
    select distinct on (r.individuo_id)
      r.individuo_id,
      r.id as ronda_id,
      r.numero_ronda
    from ronda_evaluacion_anual r
    join alcance a on a.individuo_id = r.individuo_id
    where r.tipo_ronda = 'anual'
    order by r.individuo_id, r.numero_ronda desc, r.created_at desc, r.id desc
  ), base as (
    select
      a.*,
      ur.numero_ronda,
      e.id as evaluacion_id,
      e.fecha as fecha_evaluacion,
      e.updated_at as evaluacion_updated_at,
      e.estado as estado_evaluacion,
      e.requiere_revision,
      e.no_comparable,
      e.brotacion, e.floracion, e.cuaja, e.concentracion_cosecha,
      e.calibre_mm, e.firmeza, e.color, e.bloom, e.brix,
      e.rend_kg_planta, e.rend_t_ha, e.pct_fruta_exportable,
      e.dano_calor, e.golpe_sol, e.caida_fruto,
      sv.id as scoring_version_id,
      sv.nombre as scoring_version_nombre
    from alcance a
    left join ultima_ronda ur on ur.individuo_id = a.individuo_id
    left join lateral unificar_evaluacion_ronda(ur.ronda_id) e on true
    left join scoring_version sv on sv.id = p_scoring_version_id
  ), calculado as (
    select
      b.*,
      metricas.configuradas,
      metricas.disponibles,
      metricas.puntaje,
      metricas.detalle,
      metricas.detalle_categorias
    from base b
    left join lateral (
      with m as (
        select
          sm.id,
          sm.metrica,
          sm.categoria,
          sm.peso,
          valor.valor,
          normalizar_metrica_scoring(
            valor.valor,
            coalesce(rr.minimo_esperado, sm.minimo_normalizacion),
            coalesce(rr.maximo_esperado, sm.maximo_normalizacion),
            sm.direccion_favorable
          ) as normalizado,
          case
            when rr.maximo_esperado is not null and valor.valor is not null
              then valor.valor > rr.maximo_esperado
            else null
          end as fuera_rango_superior,
          case
            when rr.minimo_esperado is not null and valor.valor is not null
              then valor.valor < rr.minimo_esperado
            else null
          end as fuera_rango_inferior
        from scoring_metrica sm
        left join rango_referencia rr on rr.id = sm.rango_referencia_id
        left join lateral (
          select case sm.metrica
            when 'brotacion' then b.brotacion::numeric
            when 'floracion' then b.floracion::numeric
            when 'cuaja' then b.cuaja::numeric
            when 'concentracion_cosecha' then b.concentracion_cosecha::numeric
            when 'calibre_mm' then b.calibre_mm
            when 'firmeza' then b.firmeza::numeric
            when 'color' then b.color::numeric
            when 'bloom' then b.bloom::numeric
            when 'brix' then b.brix
            when 'rend_kg_planta' then b.rend_kg_planta
            when 'rend_t_ha' then b.rend_t_ha
            when 'pct_fruta_exportable' then b.pct_fruta_exportable
            when 'dano_calor' then b.dano_calor::numeric
            when 'golpe_sol' then b.golpe_sol::numeric
            when 'caida_fruto' then b.caida_fruto::numeric
            else null
          end as valor
        ) valor on true
        where sm.scoring_version_id = b.scoring_version_id
      ), cat as (
        select
          todas.categoria,
          c.subpuntaje
        from unnest(enum_range(null::categoria_scoring)) as todas(categoria)
        left join (
          select
            m.categoria,
            case
              when sum(m.peso) filter (where m.valor is not null) > 0 then
                sum(m.normalizado * m.peso) filter (where m.valor is not null)
                / sum(m.peso) filter (where m.valor is not null)
              else null
            end as subpuntaje
          from m
          group by m.categoria
        ) c on c.categoria = todas.categoria
      )
      select
        (select count(*) from m)::integer as configuradas,
        (select count(*) from m where valor is not null)::integer as disponibles,
        (
          select case
            when exists (
              select 1 from scoring_categoria_peso scp0
              where scp0.scoring_version_id = b.scoring_version_id
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
               and scp.scoring_version_id = b.scoring_version_id
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
        ) as puntaje,
        (
          select coalesce(
            jsonb_object_agg(
              metrica,
              jsonb_build_object(
                'valor', valor,
                'peso', peso,
                'normalizado', normalizado,
                'fuera_rango_superior', fuera_rango_superior,
                'fuera_rango_inferior', fuera_rango_inferior
              )
            ) filter (where id is not null),
            '{}'::jsonb
          )
          from m
        ) as detalle,
        (
          select coalesce(jsonb_object_agg(cat.categoria, cat.subpuntaje), '{}'::jsonb)
          from cat
        ) as detalle_categorias
    ) metricas on true
  )
  select
    c.individuo_id,
    c.codigo_display,
    c.planta_id,
    c.codigo_sistema,
    c.especie_id,
    c.evaluacion_id,
    c.fecha_evaluacion,
    c.evaluacion_updated_at,
    c.numero_ronda,
    c.estado_evaluacion,
    coalesce(c.requiere_revision, false),
    coalesce(c.no_comparable, false),
    c.scoring_version_id,
    c.scoring_version_nombre,
    case
      when c.evaluacion_id is not null
        and not coalesce(c.requiere_revision, false)
        and not coalesce(c.no_comparable, false)
        and c.configuradas > 0
        and c.disponibles = c.configuradas
      then round(c.puntaje, 4)
      else null
    end,
    c.evaluacion_id is not null
      and not coalesce(c.requiere_revision, false)
      and not coalesce(c.no_comparable, false)
      and c.configuradas > 0
      and c.disponibles = c.configuradas,
    case
      when c.numero_ronda is null then 'sin_ronda'
      when c.evaluacion_id is null then 'sin_evaluacion_completa_en_ronda_actual'
      when c.requiere_revision then 'requiere_revision'
      when c.no_comparable then 'no_comparable'
      when c.scoring_version_id is null then 'sin_version_scoring'
      when c.configuradas = 0 then 'version_sin_metricas'
      when c.disponibles < c.configuradas then 'faltan_metricas_scoring'
      else null
    end,
    coalesce(c.detalle, '{}'::jsonb),
    coalesce(c.detalle_categorias, '{}'::jsonb)
  from calculado c;
$$;

comment on function calcular_ranking_operativo(uuid, uuid, uuid) is
  'Motor canonico de ranking. Para la ronda anual vigente unifica cada descriptor '
  'desde su valor no NULL mas reciente mediante unificar_evaluacion_ronda; conserva '
  'el gate de cobertura completa y el scoring ponderado por categorias.';

create or replace function obtener_ranking_global_filtrado(
  p_especie_id uuid,
  p_planta_id uuid default null,
  p_fecha_desde date default null,
  p_fecha_hasta date default null,
  p_estado_vital estado_vital default 'vivo',
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
  v_version_id uuid;
  v_version_nombre text;
  v_desempate jsonb;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if p_especie_id is null then
    raise exception 'La especie es obligatoria para el ranking global' using errcode = '22023';
  end if;
  if p_fecha_desde is not null and p_fecha_hasta is not null and p_fecha_desde > p_fecha_hasta then
    raise exception 'El rango de fechas es inválido' using errcode = '22007';
  end if;
  if p_limite < 1 or p_limite > 100 or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode = '22023';
  end if;
  if p_orden not in ('puntaje_desc', 'puntaje_asc', 'codigo_asc', 'fecha_desc') then
    raise exception 'Orden no permitido' using errcode = '22023';
  end if;
  if p_planta_id is not null and not exists (
    select 1 from plantas
    where id = p_planta_id
      and especie_id = p_especie_id
      and eliminado_at is null
  ) then
    raise exception 'El cruce no pertenece a la especie seleccionada o está eliminado' using errcode = '22023';
  end if;

  v_version_id := resolver_scoring_version(p_especie_id, 'evaluacion_anual', current_date);
  select nombre, criterio_desempate
    into v_version_nombre, v_desempate
  from scoring_version
  where id = v_version_id;

  with vivos as materialized (
    select
      r.individuo_id, r.codigo_display, r.planta_id, r.codigo_sistema,
      r.especie_id, 'vivo'::estado_vital as estado_vital,
      r.evaluacion_id, r.fecha_evaluacion, r.evaluacion_updated_at,
      r.numero_ronda, r.estado_evaluacion, r.requiere_revision,
      r.no_comparable, r.scoring_version_id, r.scoring_version_nombre,
      r.puntaje_ponderado, r.elegible, r.motivo_exclusion, r.detalle_metricas
    from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id) r
    where p_estado_vital is null or p_estado_vital = 'vivo'
  ), no_vivos as materialized (
    select
      i.id as individuo_id,
      i.codigo_display,
      p.id as planta_id,
      p.codigo_sistema,
      p.especie_id,
      i.estado_vital,
      ev.id as evaluacion_id,
      ev.fecha as fecha_evaluacion,
      ev.updated_at as evaluacion_updated_at,
      ronda.numero_ronda,
      ev.estado as estado_evaluacion,
      coalesce(ev.requiere_revision, false) as requiere_revision,
      coalesce(ev.no_comparable, false) as no_comparable,
      v_version_id as scoring_version_id,
      v_version_nombre as scoring_version_nombre,
      null::numeric as puntaje_ponderado,
      false as elegible,
      case i.estado_vital
        when 'descartado' then 'individuo_descartado'
        when 'muerto' then 'individuo_muerto'
      end as motivo_exclusion,
      '{}'::jsonb as detalle_metricas
    from individuos i
    join plantas p on p.id = i.planta_id
    left join lateral (
      select r.id, r.numero_ronda
      from ronda_evaluacion_anual r
      where r.individuo_id = i.id
        and r.tipo_ronda = 'anual'
      order by r.numero_ronda desc, r.created_at desc, r.id desc
      limit 1
    ) ronda on true
    left join lateral unificar_evaluacion_ronda(ronda.id) ev on true
    where p.especie_id = p_especie_id
      and p.eliminado_at is null
      and i.estado_vital <> 'vivo'
      and (p_planta_id is null or p.id = p_planta_id)
      and (p_estado_vital is null or i.estado_vital = p_estado_vital)
  ), base as materialized (
    select * from vivos
    union all
    select * from no_vivos
  ), filtrado as materialized (
    select *
    from base
    where (p_fecha_desde is null or fecha_evaluacion >= p_fecha_desde)
      and (p_fecha_hasta is null or fecha_evaluacion <= p_fecha_hasta)
  ), posicionado as (
    select
      f.*,
      case when f.elegible then row_number() over (
        partition by f.elegible
        order by f.puntaje_ponderado desc nulls last,
                 codigo_display_numero(f.codigo_display) asc,
                 f.codigo_display asc
      ) end as posicion
    from filtrado f
  ), pagina as (
    select *
    from posicionado
    order by
      case when p_orden = 'puntaje_desc' then puntaje_ponderado end desc nulls last,
      case when p_orden = 'puntaje_asc' then puntaje_ponderado end asc nulls last,
      case when p_orden = 'fecha_desc' then fecha_evaluacion end desc nulls last,
      case when p_orden = 'codigo_asc' then codigo_display_numero(codigo_display) end asc,
      codigo_display_numero(codigo_display) asc,
      codigo_display asc
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(pagina)) from pagina), '[]'::jsonb),
    'total', (select count(*) from filtrado),
    'poblacion_comparada', (select count(*) from filtrado where elegible),
    'limite', p_limite,
    'offset', p_offset,
    'orden', p_orden,
    'scoring_version_id', v_version_id,
    'scoring_version_nombre', v_version_nombre,
    'criterios', jsonb_build_object(
      'alcance', 'especie',
      'seleccion_evaluacion', 'ronda vigente unificada por descriptor; fecha, updated_at e id DESC',
      'exclusiones', jsonb_build_array('borrador', 'anulada', 'requiere_revision', 'no_comparable', 'metricas_incompletas', 'individuo_no_vivo'),
      'desempate', coalesce(v_desempate, '[]'::jsonb)
    ),
    'filtros', jsonb_build_object(
      'especie_id', p_especie_id,
      'planta_id', p_planta_id,
      'fecha_desde', p_fecha_desde,
      'fecha_hasta', p_fecha_hasta,
      'estado_vital', p_estado_vital
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function obtener_ranking_global_filtrado(uuid, uuid, date, date, estado_vital, integer, integer, text) is
  'Ranking global filtrado. Los vivos delegan en el motor canonico y la rama de '
  'no vivos usa los mismos metadatos de ronda unificada; orden numerico de codigo.';

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

comment on function obtener_comparacion_rondas(uuid, uuid) is
  'Deltas entre rondas consecutivas del mismo tipo. Cada ronda se compara desde '
  'su fotografia unificada por descriptor, no desde una unica visita.';

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

comment on function obtener_series_historicas_cientificas(uuid, uuid, date, date) is
  'Serie mensual de SCORING por rondas unificadas. Desde D2 evaluaciones_elegibles '
  'cuenta rondas elegibles, no visitas: cada ronda aporta como maximo un puntaje '
  'en el mes de su visita cerrada mas reciente. La ronda se unifica completa antes '
  'del filtro temporal para no amputar descriptores de visitas anteriores.';

-- obtener_dashboard_cientifico no cambia: su feed y
-- evaluaciones_ultimos_30_dias miden visitas cerradas como actividad, no scoring.
-- listar_cruces_analiticos tampoco cambia: max(e.updated_at) mide actividad y su
-- puntaje ya delega en calcular_ranking_operativo.
