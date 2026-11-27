-- =============================================================================
-- MIGRACIÓN 20261021142000 — LAS VISTAS HISTÓRICAS CALCULAN CADA RONDA CON SU
-- VERSIÓN (brecha B6, paso 4)
--
-- Con 20261021140000 cada ronda cerrada quedó ligada a su versión de scoring,
-- y con 20261021141000 esa versión ya no cambia. Este paso deja que las vistas
-- históricas la usen.
--
-- calcular_ranking_operativo suma p_por_ronda (default false):
--   - false: todas las rondas con p_scoring_version_id («versión elegida»).
--   - true: cada ronda con la versión con que se cerró; p_scoring_version_id
--     solo cubre las rondas que todavía no se cerraron.
--
-- Decisión (auditoría 2026-10, B6): lo OPERATIVO ordena con UNA versión, la
-- activa, para que todos los individuos de un ranking se midan con la misma
-- vara. Por eso obtener_ranking_operativo, obtener_ranking_global_filtrado,
-- obtener_dashboard_cientifico, listar_cruces_analiticos y
-- obtener_scoring_planta NO se tocan: siguen llamando al motor con tres
-- argumentos, es decir, con p_por_ronda = false.
--
-- Lo HISTÓRICO usa p_por_ronda => true:
--   - congelar_ranking y comparar_snapshot_vivo (snapshots);
--   - obtener_series_historicas_cientificas, que usa la versión ligada a la
--     ronda antes que la resuelta por fecha (que ignora versiones retiradas).
-- obtener_comparacion_rondas NO cambia a propósito: compara la evolución de
-- un mismo individuo entre rondas y necesita la misma vara para ambas.
--
-- Cuerpos copiados de pg_get_functiondef de la base local; solo cambian las
-- líneas marcadas con B6 o la llamada al motor.
-- =============================================================================

drop function calcular_ranking_operativo(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.calcular_ranking_operativo(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_por_ronda boolean DEFAULT false)
 RETURNS TABLE(individuo_id uuid, codigo_display text, planta_id uuid, codigo_sistema text, especie_id uuid, evaluacion_id uuid, fecha_evaluacion date, evaluacion_updated_at timestamp with time zone, numero_ronda smallint, estado_evaluacion estado_evaluacion, requiere_revision boolean, no_comparable boolean, scoring_version_id uuid, scoring_version_nombre text, puntaje_ponderado numeric, elegible boolean, motivo_exclusion text, detalle_metricas jsonb, detalle_categorias jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      r.numero_ronda,
      r.scoring_version_id as ronda_scoring_version_id
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
      e as evaluacion_unificada,
      proc.descriptores_con_revision,
      proc.descriptores_no_comparables,
      sv.id as scoring_version_id,
      sv.nombre as scoring_version_nombre
    from alcance a
    left join ultima_ronda ur on ur.individuo_id = a.individuo_id
    left join lateral unificar_evaluacion_ronda(ur.ronda_id) e on true
    left join lateral obtener_procedencia_calidad_ronda(ur.ronda_id) proc on true
    -- B6: con p_por_ronda, cada ronda se calcula con la versión con que se
    -- cerró; p_scoring_version_id solo cubre las rondas sin cerrar. Sin
    -- p_por_ronda, todas con p_scoring_version_id (versión elegida).
    left join scoring_version sv on sv.id = case
      when p_por_ronda then coalesce(ur.ronda_scoring_version_id, p_scoring_version_id)
      else p_scoring_version_id
    end
  ), calculado as (
    select
      b.*,
      metricas.configuradas,
      metricas.disponibles,
      metricas.puntaje,
      metricas.detalle,
      metricas.detalle_categorias,
      metricas.tiene_metrica_marcada
    from base b
    left join lateral (
      with m as (
        select
          sm.id,
          sm.metrica,
          sm.categoria,
          sm.peso,
          extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) as valor,
          normalizar_metrica_scoring(
            extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica),
            coalesce(rr.minimo_esperado, sm.minimo_normalizacion),
            coalesce(rr.maximo_esperado, sm.maximo_normalizacion),
            sm.direccion_favorable
          ) as normalizado,
          case
            when rr.maximo_esperado is not null and extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) is not null
              then extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) > rr.maximo_esperado
            else null
          end as fuera_rango_superior,
          case
            when rr.minimo_esperado is not null and extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) is not null
              then extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) < rr.minimo_esperado
            else null
          end as fuera_rango_inferior,
          (
            sm.metrica = any(coalesce(b.descriptores_con_revision, '{}'::text[]))
            or sm.metrica = any(coalesce(b.descriptores_no_comparables, '{}'::text[]))
          ) as marcada
        from scoring_metrica sm
        left join rango_referencia rr on rr.id = sm.rango_referencia_id
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
        ) as detalle_categorias,
        coalesce((select bool_or(marcada) from m), false) as tiene_metrica_marcada
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
        and not coalesce(c.tiene_metrica_marcada, false)
        and not coalesce(c.requiere_revision, false)
        and not coalesce(c.no_comparable, false)
        and c.configuradas > 0
        and c.disponibles = c.configuradas
      then round(c.puntaje, 4)
      else null
    end,
    c.evaluacion_id is not null
      and not coalesce(c.tiene_metrica_marcada, false)
      and not coalesce(c.requiere_revision, false)
      and not coalesce(c.no_comparable, false)
      and c.configuradas > 0
      and c.disponibles = c.configuradas,
    case
      when c.numero_ronda is null then 'sin_ronda'
      when c.evaluacion_id is null then 'sin_evaluacion_completa_en_ronda_actual'
      when c.requiere_revision then 'requiere_revision'
      when c.no_comparable then 'no_comparable'
      -- Orden deliberado: requiere_revision/no_comparable (fila representante)
      -- van ANTES para no cambiar la etiqueta del caso simple ya cubierto por
      -- ellos (una sola visita, su propio flag) -- contiene_metrica_marcada
      -- solo se vuelve el motivo visible cuando esos dos NO detectan nada
      -- pero una visita ANTERIOR (no la representante) sí dejo una metrica
      -- marcada colgando -- exactamente el caso noviembre/diciembre que
      -- motiva este fix. La elegibilidad (mas abajo) no depende del orden:
      -- exige not tiene_metrica_marcada Y not requiere_revision Y not
      -- no_comparable, asi que el resultado booleano es identico sea cual
      -- sea el orden -- lo unico que cambia es que string se reporta.
      when coalesce(c.tiene_metrica_marcada, false) then 'contiene_metrica_marcada'
      when c.scoring_version_id is null then 'sin_version_scoring'
      when c.configuradas = 0 then 'version_sin_metricas'
      when c.disponibles < c.configuradas then 'evaluacion_parcial_en_curso'
      else null
    end,
    coalesce(c.detalle, '{}'::jsonb),
    coalesce(c.detalle_categorias, '{}'::jsonb)
  from calculado c;
$function$
;


CREATE OR REPLACE FUNCTION public.congelar_ranking(p_nombre text, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id, p_por_ronda => true)
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
               codigo_display_numero(r.codigo_display) asc,
               r.codigo_display asc
    )::integer,
    r.puntaje_ponderado,
    jsonb_build_object(
      'fecha_evaluacion', r.fecha_evaluacion,
      'numero_ronda', r.numero_ronda,
      'estado_evaluacion', r.estado_evaluacion,
      'scoring_version_id', r.scoring_version_id,
      'scoring_version_nombre', r.scoring_version_nombre,
      'metricas', r.detalle_metricas,
      'categorias', r.detalle_categorias
    )
  from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id, p_por_ronda => true) r
  where r.elegible
  order by r.puntaje_ponderado desc, codigo_display_numero(r.codigo_display) asc, r.codigo_display asc;

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
$function$
;


CREATE OR REPLACE FUNCTION public.comparar_snapshot_vivo(p_snapshot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_snapshot ranking_snapshot%rowtype;
  v_version_viva_id uuid;
  v_umbral_leve numeric;
  v_umbral_marcado numeric;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select * into v_snapshot from ranking_snapshot where id = p_snapshot_id;
  if not found then
    raise exception 'Snapshot no encontrado' using errcode = 'P0002';
  end if;

  v_version_viva_id := resolver_scoring_version(v_snapshot.especie_id, 'evaluacion_anual', current_date);
  select umbral_delta_leve, umbral_delta_marcado
    into v_umbral_leve, v_umbral_marcado
  from scoring_version where id = v_version_viva_id;

  with congelado as materialized (
    select
      rsr.individuo_id, rsr.codigo_display, rsr.puntaje,
      rsr.detalle -> 'categorias' as categorias
    from ranking_snapshot_resultado rsr
    where rsr.snapshot_id = p_snapshot_id
  ), vivo as materialized (
    select
      r.individuo_id, r.codigo_display, r.puntaje_ponderado as puntaje,
      r.detalle_categorias as categorias, r.elegible
    from calcular_ranking_operativo(v_version_viva_id, v_snapshot.planta_id, v_snapshot.especie_id, p_por_ronda => true) r
  ), comparado as (
    select
      coalesce(c.individuo_id, v.individuo_id) as individuo_id,
      coalesce(c.codigo_display, v.codigo_display) as codigo_display,
      c.puntaje as puntaje_snapshot,
      case when v.elegible then v.puntaje else null end as puntaje_vivo,
      (case when v.elegible then v.puntaje else null end) - c.puntaje as delta,
      etiquetar_delta(
        (case when v.elegible then v.puntaje else null end) - c.puntaje,
        v_umbral_leve, v_umbral_marcado
      ) as etiqueta,
      c.categorias as categorias_snapshot,
      v.categorias as categorias_vivo,
      (c.individuo_id is not null) as estaba_en_snapshot,
      (v.individuo_id is not null and v.elegible) as esta_en_vivo
    from congelado c
    full outer join vivo v on v.individuo_id = c.individuo_id
    where c.individuo_id is not null or v.elegible
  )
  select jsonb_build_object(
    'snapshot_id', p_snapshot_id,
    'scoring_version_snapshot_id', v_snapshot.scoring_version_id,
    'scoring_version_viva_id', v_version_viva_id,
    'version_cambio', v_snapshot.scoring_version_id is distinct from v_version_viva_id,
    'umbrales', jsonb_build_object('leve', v_umbral_leve, 'marcado', v_umbral_marcado),
    'individuos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'individuo_id', cm.individuo_id,
        'codigo_display', cm.codigo_display,
        'estaba_en_snapshot', cm.estaba_en_snapshot,
        'esta_en_vivo', cm.esta_en_vivo,
        'puntaje_snapshot', cm.puntaje_snapshot,
        'puntaje_vivo', cm.puntaje_vivo,
        'delta', cm.delta,
        'etiqueta', cm.etiqueta,
        'categorias_snapshot', cm.categorias_snapshot,
        'categorias_vivo', cm.categorias_vivo
      ) order by codigo_display_numero(cm.codigo_display), cm.codigo_display)
      from comparado cm
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$function$
;


CREATE OR REPLACE FUNCTION public.obtener_series_historicas_cientificas(p_especie_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      r.scoring_version_id as ronda_scoring_version_id,
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
      select coalesce(rb.ronda_scoring_version_id, resolver_scoring_version(rb.especie_id, rb.fase, rb.fecha)) as id
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
$function$
;


comment on function calcular_ranking_operativo(uuid, uuid, uuid, boolean) is
  'Motor del ranking. p_por_ronda=false: todas las rondas con la versión indicada. p_por_ronda=true: cada ronda con la versión con que se cerró (B6); la indicada solo para rondas sin cerrar.';

revoke all on function calcular_ranking_operativo(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function calcular_ranking_operativo(uuid, uuid, uuid, boolean) to authenticated, service_role;
