-- =============================================================================
-- SPRINT 5 (2/5) — Comparación de rondas (deltas por categoría y parámetro).
-- Corresponde a docs/BDSecurity_Documento_Maestro.md, Fase 2 / 2.2.
--
-- Umbrales configurables: se agregan a scoring_version (no una tabla nueva).
-- Razón: son escalares por versión, mismo alcance/ciclo de vida que el resto
-- de la config de scoring (versionados junto con pesos y métricas; revisables
-- "sin migración" con un UPDATE), y scoring_version ya es exactamente el
-- lugar donde vive el resto de la configuración no hardcodeada del sistema
-- (criterio_desempate es el precedente directo: un valor de configuración
-- ajustable vive como columna en esta misma tabla). Una tabla nueva de una
-- sola fila por versión sería una indirección sin beneficio real.
--
-- Ambas rondas de un par se puntúan con la MISMA scoring_version — la activa
-- hoy para la especie/fase del individuo — no la que estuviera vigente en la
-- fecha original de cada ronda. Así el delta refleja cambio biológico real,
-- no un cambio de esquema de ponderación entre medio.
-- =============================================================================

alter table scoring_version
  add column umbral_delta_leve numeric not null default 0.05,
  add column umbral_delta_marcado numeric not null default 0.15;

alter table scoring_version
  add constraint scoring_version_umbrales_delta_check
  check (
    umbral_delta_leve >= 0
    and umbral_delta_leve <= umbral_delta_marcado
    and umbral_delta_marcado <= 1
  );

comment on column scoring_version.umbral_delta_leve is
  'Umbral |delta| bajo el cual un cambio entre rondas se etiqueta "estable" (2.2 del documento maestro). Configurable sin migración vía UPDATE.';
comment on column scoring_version.umbral_delta_marcado is
  'Umbral |delta| a partir del cual un cambio se etiqueta "marcado" (entre umbral_delta_leve y este: "leve"). Configurable sin migración vía UPDATE.';

-- ---------------------------------------------------------------------------
-- Helpers reutilizables: cálculo de métricas/categorías normalizadas para UNA
-- evaluación arbitraria (no necesariamente "la última ronda", a diferencia de
-- calcular_ranking_operativo). Se extraen acá porque tanto los deltas como
-- (más adelante en este sprint) la comparación de snapshots contra el ranking
-- vivo necesitan la misma lógica de normalización/categorización sobre
-- evaluaciones puntuales. calcular_ranking_operativo NO se reescribe para
-- usar estos helpers: mantiene su cálculo ya verificado sin cambios, para no
-- introducir riesgo de regresión en una función con múltiples consumidores.
-- Sigue el patrón ya establecido en el código (evaluacion_tiene_descriptores_
-- completos) de recibir la fila completa `evaluaciones` como parámetro.
-- ---------------------------------------------------------------------------

create or replace function calcular_metricas_evaluacion(
  p_evaluacion evaluaciones,
  p_scoring_version_id uuid
)
returns table (
  metrica text,
  categoria categoria_scoring,
  peso numeric,
  valor numeric,
  normalizado numeric
)
language sql
stable
parallel safe
set search_path = public
as $$
  select
    sm.metrica,
    sm.categoria,
    sm.peso,
    valor.valor,
    normalizar_metrica_scoring(
      valor.valor,
      coalesce(rr.minimo_esperado, sm.minimo_normalizacion),
      coalesce(rr.maximo_esperado, sm.maximo_normalizacion),
      sm.direccion_favorable
    ) as normalizado
  from scoring_metrica sm
  left join rango_referencia rr on rr.id = sm.rango_referencia_id
  left join lateral (
    select case sm.metrica
      when 'brotacion' then p_evaluacion.brotacion::numeric
      when 'floracion' then p_evaluacion.floracion::numeric
      when 'cuaja' then p_evaluacion.cuaja::numeric
      when 'concentracion_cosecha' then p_evaluacion.concentracion_cosecha::numeric
      when 'calibre_mm' then p_evaluacion.calibre_mm
      when 'firmeza' then p_evaluacion.firmeza::numeric
      when 'color' then p_evaluacion.color::numeric
      when 'bloom' then p_evaluacion.bloom::numeric
      when 'brix' then p_evaluacion.brix
      when 'rend_kg_planta' then p_evaluacion.rend_kg_planta
      when 'rend_t_ha' then p_evaluacion.rend_t_ha
      when 'pct_fruta_exportable' then p_evaluacion.pct_fruta_exportable
      when 'dano_calor' then p_evaluacion.dano_calor::numeric
      when 'golpe_sol' then p_evaluacion.golpe_sol::numeric
      when 'caida_fruto' then p_evaluacion.caida_fruto::numeric
      else null
    end as valor
  ) valor on true
  where sm.scoring_version_id = p_scoring_version_id;
$$;

comment on function calcular_metricas_evaluacion(evaluaciones, uuid) is
  'Valor + normalizado por métrica configurada, para UNA evaluación puntual. Reutilizado por obtener_comparacion_rondas y por comparar snapshots contra el ranking vivo.';

create or replace function calcular_categorias_evaluacion(
  p_evaluacion evaluaciones,
  p_scoring_version_id uuid
)
returns table (categoria categoria_scoring, subpuntaje numeric)
language sql
stable
parallel safe
set search_path = public
as $$
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
    from calcular_metricas_evaluacion(p_evaluacion, p_scoring_version_id) m
    group by m.categoria
  ) c on c.categoria = todas.categoria;
$$;

comment on function calcular_categorias_evaluacion(evaluaciones, uuid) is
  'Subpuntaje por categoría (NULL si ninguna métrica de esa categoría tiene valor) para UNA evaluación puntual. Mismas 4 claves siempre, mismo criterio que calcular_ranking_operativo.';

create or replace function etiquetar_delta(
  p_delta numeric,
  p_umbral_leve numeric,
  p_umbral_marcado numeric
)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_delta is null then null
    when abs(p_delta) < p_umbral_leve then 'estable'
    when abs(p_delta) < p_umbral_marcado then
      case when p_delta > 0 then 'mejoro_leve' else 'empeoro_leve' end
    else
      case when p_delta > 0 then 'mejoro_marcado' else 'empeoro_marcado' end
  end;
$$;

comment on function etiquetar_delta(numeric, numeric, numeric) is
  'Etiqueta de cambio según los umbrales de 2.2 del documento maestro. NULL si el delta es NULL (falta una de las dos rondas).';

-- ---------------------------------------------------------------------------
-- obtener_comparacion_rondas: delta por categoría y por parámetro entre
-- rondas CONSECUTIVAS del MISMO tipo_ronda (nunca compara anual contra
-- multisitio). Acepta un individuo puntual o un cruce completo (todos sus
-- individuos vivos). Devuelve TODOS los pares consecutivos disponibles
-- (1→2, 2→3), no solo el más reciente — para series/mini-gráficos (3.b, 3.f).
-- ---------------------------------------------------------------------------

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
      e.fila as evaluacion
    from ronda_evaluacion_anual r
    join alcance a on a.individuo_id = r.individuo_id
    left join lateral (
      select ev as fila
      from evaluaciones ev
      where ev.ronda_id = r.id
        and ev.estado in ('completa', 'corregida')
      order by ev.fecha desc, ev.updated_at desc, ev.id desc
      limit 1
    ) e on true
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
    -- OJO: "act.evaluacion IS NOT NULL" sobre un valor compuesto NO significa
    -- "la fila existe" — para tipos fila, IS NOT NULL exige que TODOS los
    -- campos sean no nulos (semántica SQL estándar de comparación de filas).
    -- evaluaciones tiene columnas nullable (predio_id, observaciones, etc.),
    -- así que esa condición descartaba filas reales. Se verifica por .id, que
    -- es NOT NULL en toda fila real y NULL solo cuando el LATERAL no
    -- encontró ninguna evaluación completa/corregida para esa ronda.
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
      ) order by ind.codigo_display, ind.tipo_ronda, ind.numero_actual)
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
  'Delta por categoría y por parámetro entre rondas consecutivas del MISMO tipo_ronda (Sprint 5, 2.2 del documento maestro). Un individuo o un cruce completo (XOR). Devuelve todos los pares consecutivos disponibles, no solo el último.';

revoke all on function obtener_comparacion_rondas(uuid, uuid) from public, anon;
grant execute on function obtener_comparacion_rondas(uuid, uuid) to authenticated, service_role;
