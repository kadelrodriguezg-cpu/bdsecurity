-- =============================================================================
-- SPRINT 5 (1/5) — Ranking: detalle_categorias, fuera_rango, tie-break.
-- Corresponde a docs/BDSecurity_Documento_Maestro.md, Fase 2 / 2.1.
--
-- Hallazgo previo (bloqueante para diseño, confirmado por query real): hoy
-- solo existen 4 métricas, TODAS en categoria='fruto_calidad'. Fenología,
-- Producción y Estrés no tienen ninguna métrica. Por diseño (scoring_categoria_
-- peso, Sprint 2), el subpuntaje de esas 3 categorías debe ser NULL, y el
-- puntaje global se renormaliza sobre las categorías con datos — esto NO es
-- un caso hipotético, es el estado real de hoy, así que el cálculo de abajo
-- se prueba directamente contra un individuo real.
--
-- Hallazgo adicional (no pedido explícitamente, pero necesario para
-- corrección tras Sprint 3): la CTE `ultima_ronda` de calcular_ranking_
-- operativo no filtraba por tipo_ronda. Hoy es inofensivo (cero rondas
-- multisitio reales existen), pero en cuanto exista una ronda multisitio
-- para un individuo que también tiene rondas anuales, `ultima_ronda` podría
-- elegir la multisitio como "la ronda" del individuo y mezclar series en el
-- ranking científico — que es exactamente lo que 2.3 dice que NO debe pasar
-- ("no mezclar series anual y multisitio"). Se corrige acá mismo, ya que se
-- está tocando esta función de todos modos: se filtra explícitamente a
-- tipo_ronda='anual' (el ranking operativo es la selección científica anual;
-- multisitio es una serie de evaluación aparte, no alimenta este ranking).
--
-- fuera_rango_superior/inferior cuando la métrica no tiene rango_referencia
-- (hoy: firmeza y bloom, que usan metodo_normalizacion='escala', no
-- 'rango_referencia'): quedan NULL, no false. false implicaría "se verificó
-- y está dentro de rango"; NULL dice honestamente "no hay rango contra el
-- cual comparar". Mismo criterio que el subpuntaje de categoría sin datos
-- (NULL, nunca un valor fabricado).
-- =============================================================================

drop function if exists calcular_ranking_operativo(uuid, uuid, uuid);

create function calcular_ranking_operativo(
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
    left join lateral (
      select ev.*
      from evaluaciones ev
      where ev.ronda_id = ur.ronda_id
        and ev.estado in ('completa', 'corregida')
      order by ev.fecha desc, ev.updated_at desc, ev.id desc
      limit 1
    ) e on true
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
      -- Hallazgo importante de este sprint: puntaje_ponderado NUNCA pasaba
      -- por scoring_categoria_peso (Sprint 2) — seguía siendo el promedio
      -- plano ponderado por scoring_metrica.peso (el esquema "4-3-2-1
      -- provisional") sobre TODAS las métricas configuradas, sin agrupar por
      -- categoría primero. Hoy eso da el MISMO número que la fórmula correcta
      -- de 2.1 (Σ subpuntaje_categoría × peso_categoría, renormalizado sobre
      -- categorías presentes) solo porque el 100% de las métricas de hoy
      -- pertenecen a una única categoría (fruto_calidad) — promediar "todas
      -- las métricas" y promediar "las métricas de la única categoría con
      -- datos" son el mismo conjunto de filas. En cuanto se registre una
      -- métrica de otra categoría (Fenología/Producción/Estrés), ambas
      -- fórmulas divergirían silenciosamente. Se corrige acá para que
      -- puntaje_ponderado ya use scoring_categoria_peso — verificado con
      -- evidencia que da EXACTAMENTE el mismo valor que antes para los
      -- individuos reales de producción (ver pruebas del sprint), así que no
      -- hay regresión de scoring hoy, solo se cierra el hueco antes de que
      -- se vuelva un problema real. Si una scoring_version no tiene ninguna
      -- fila en scoring_categoria_peso (compatibilidad con versiones sin
      -- categorías configuradas), se conserva el promedio plano de respaldo.
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
        -- Se enumeran las 4 categorías del enum explícitamente (no solo las
        -- que aparecen agrupadas en m) para que detalle_categorias siempre
        -- tenga las 4 claves — hoy Fenología/Producción/Estrés no tienen NI
        -- UNA métrica configurada en todo el sistema (no es que falten datos
        -- de este individuo puntual), así que `m` nunca produce esos grupos
        -- por sí solo. Sin este enumerado explícito, esas 3 claves
        -- desaparecerían del JSON en vez de aparecer como null, y el
        -- frontend (tabla fija de 4 columnas por categoría) necesitaría
        -- lógica especial para saber cuáles existen hoy.
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
  'Motor de ranking científico (Sprint 5, docs/BDSecurity_Documento_Maestro.md 2.1). '
  'Filtra explícitamente tipo_ronda=''anual'' para la ronda vigente del individuo — '
  'multisitio es una serie de evaluación aparte y nunca alimenta este ranking. '
  'puntaje_ponderado ahora se calcula vía scoring_categoria_peso (Σ subpuntaje_'
  'categoría × peso_categoría, renormalizado sobre categorías presentes) en vez '
  'del promedio plano por scoring_metrica.peso que usaba antes de este sprint — '
  'con respaldo al promedio plano si la scoring_version no tiene ninguna fila en '
  'scoring_categoria_peso. detalle_categorias siempre trae las 4 categorías '
  '(fenologia/fruto_calidad/produccion/estres), con subpuntaje NULL para toda '
  'categoría sin ninguna métrica evaluada (no 0). detalle_metricas incluye '
  'fuera_rango_superior/inferior por métrica, NULL cuando la métrica no tiene '
  'rango_referencia configurado (hoy: firmeza, bloom) en vez de asumir "dentro '
  'de rango".';

revoke all on function calcular_ranking_operativo(uuid, uuid, uuid) from public, anon;
grant execute on function calcular_ranking_operativo(uuid, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tie-break: la posición numérica debe coincidir con el orden de render
-- cuando el orden es por puntaje (hallazgo Grave E2E). La causa raíz: la
-- posición se calculaba con un desempate de 3 pasos (fecha_evaluacion desc,
-- evaluacion_updated_at desc, codigo_display asc) mientras que la página
-- renderizada bajo p_orden='puntaje_desc' solo usaba 2 (puntaje, codigo_
-- display) — si dos individuos empatan en puntaje pero difieren en
-- fecha_evaluacion, la posición y el orden de fila podían divergir. Se
-- alinean ambos a EXACTAMENTE el mismo criterio: puntaje desc, codigo_display
-- asc. codigo_display es único (individuos_codigo_display_key), así que por
-- sí solo ya es un desempate completo y determinista — los pasos intermedios
-- de fecha/updated_at no aportaban nada que codigo_display no resolviera ya,
-- solo introducían la posibilidad de que posición y orden de render
-- divergieran. Se aplica el mismo fix en obtener_ranking_global_filtrado
-- (mismo bug, misma causa) más abajo en esta migración.
-- ---------------------------------------------------------------------------

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

revoke all on function obtener_ranking_operativo(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function obtener_ranking_operativo(uuid, uuid, integer, integer, text) to authenticated, service_role;

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
      r.individuo_id,
      r.codigo_display,
      r.planta_id,
      r.codigo_sistema,
      r.especie_id,
      'vivo'::estado_vital as estado_vital,
      r.evaluacion_id,
      r.fecha_evaluacion,
      r.evaluacion_updated_at,
      r.numero_ronda,
      r.estado_evaluacion,
      r.requiere_revision,
      r.no_comparable,
      r.scoring_version_id,
      r.scoring_version_nombre,
      r.puntaje_ponderado,
      r.elegible,
      r.motivo_exclusion,
      r.detalle_metricas
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
    left join lateral (
      select e.id, e.fecha, e.updated_at, e.estado, e.requiere_revision, e.no_comparable
      from evaluaciones e
      where e.ronda_id = ronda.id
        and e.estado in ('completa', 'corregida')
      order by e.fecha desc, e.updated_at desc, e.id desc
      limit 1
    ) ev on true
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
      case when p_orden = 'codigo_asc' then codigo_display end asc,
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
      'seleccion_evaluacion', 'ultima completa/corregida de la ronda mas reciente; fecha y updated_at como desempate',
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

revoke all on function obtener_ranking_global_filtrado(uuid, uuid, date, date, estado_vital, integer, integer, text)
  from public, anon;
grant execute on function obtener_ranking_global_filtrado(uuid, uuid, date, date, estado_vital, integer, integer, text)
  to authenticated, service_role;
