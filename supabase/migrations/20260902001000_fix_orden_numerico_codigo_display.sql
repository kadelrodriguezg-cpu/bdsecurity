-- =============================================================================
-- FIX — orden de ranking por codigo_display como texto plano
--
-- Consecuencia directa de 20260902000000 (codigo_display sin padding fijo):
-- de acá en adelante conviven en un mismo cruce códigos con distinto ancho
-- (ej. "P01".."P99" ya generados, con cero inicial, junto a "P100", "P101"...
-- generados después del fix, sin cero). Todo ORDER BY que comparaba
-- codigo_display como texto plano ordenaría mal esos casos: "P100" < "P99"
-- alfabéticamente (compara caracter a caracter: '1' < '9'), aunque
-- numéricamente 100 > 99.
--
-- Se agrega un helper `codigo_display_numero()` que extrae el número después
-- de la última "P" (funciona igual para "02-001-P1", "02-001-P01",
-- "02-001-P100"... y para el código corto "P01"/"P100" que usa
-- obtener_mapa_cruce — no asume ningún ancho fijo de dígitos), y se lo usa
-- como criterio de orden numérico en TODAS las funciones que ordenaban por
-- codigo_display (relevadas en la auditoría de la Fase 1: dos calculan la
-- POSICIÓN real del ranking — obtener_ranking_operativo y
-- obtener_ranking_global_filtrado — más congelar_ranking, cuyo row_number()
-- se persiste en ranking_snapshot_resultado; las demás solo controlan orden
-- de listas para UI). codigo_display se deja como desempate final por si dos
-- códigos coincidieran en el número (no debería pasar, es global unique, pero
-- queda como guarda).
--
-- No se toca ninguna fila existente: solo CREATE OR REPLACE FUNCTION.
-- =============================================================================

create or replace function codigo_display_numero(p_codigo_display text)
returns integer
language sql
immutable
parallel safe
as $$
  select (regexp_match(p_codigo_display, 'P(\d+)$'))[1]::integer
$$;

comment on function codigo_display_numero(text) is
  'Extrae el correlativo numérico al final de un codigo_display o codigo_corto (ej. "02-001-P100" -> 100, "P01" -> 1), sin asumir ancho fijo. Usado como criterio de orden numérico donde antes se comparaba codigo_display como texto plano (ver 20260902001000).';

-- ---------------------------------------------------------------------------
-- obtener_ranking_operativo
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
                 codigo_display_numero(b.codigo_display) asc,
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
      case when p_orden = 'codigo_asc' then codigo_display_numero(codigo_display) end asc,
      codigo_display_numero(codigo_display) asc,
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

comment on function obtener_ranking_operativo(uuid, uuid, integer, integer, text) is
  'Ranking operativo paginado (Sprint 5, tie-break por categorías). Desempate por codigo_display_numero (numérico, no texto plano — fix 20260902001000, ver auditoría de codigo_display sin padding).';

-- ---------------------------------------------------------------------------
-- obtener_ranking_global_filtrado
-- ---------------------------------------------------------------------------
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

comment on function obtener_ranking_global_filtrado(uuid, uuid, date, date, estado_vital, integer, integer, text) is
  'Ranking global filtrado por especie (Sprint 5). Desempate por codigo_display_numero (numérico, no texto plano — fix 20260902001000).';

-- ---------------------------------------------------------------------------
-- congelar_ranking — su row_number() se PERSISTE en ranking_snapshot_resultado.
-- ---------------------------------------------------------------------------
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
  from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id) r
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
$$;

comment on function congelar_ranking(text, uuid, uuid) is
  'Congela el ranking vivo (Sprint 5: posición y orden alineados a puntaje desc, codigo_display_numero asc — fix 20260902001000, antes comparaba codigo_display como texto plano; detalle incluye categorias además de metricas). Solo admin.';

-- ---------------------------------------------------------------------------
-- comparar_snapshot_vivo — solo orden de lista para UI, no recalcula posicion.
-- ---------------------------------------------------------------------------
create or replace function comparar_snapshot_vivo(p_snapshot_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
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
    from calcular_ranking_operativo(v_version_viva_id, v_snapshot.planta_id, v_snapshot.especie_id) r
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
$$;

comment on function comparar_snapshot_vivo(uuid) is
  'Compara un snapshot congelado contra el ranking vivo actual (Sprint 5, 2.2 del documento maestro). Incluye individuos que salieron/entraron del ranking desde que se congeló (full outer join). Lista ordenada por codigo_display_numero, no texto plano (fix 20260902001000).';

-- ---------------------------------------------------------------------------
-- obtener_comparacion_rondas — solo orden de lista para UI.
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
  'Delta por categoría y por parámetro entre rondas consecutivas del MISMO tipo_ronda (Sprint 5, 2.2 del documento maestro). Un individuo o un cruce completo (XOR). Devuelve todos los pares consecutivos disponibles, no solo el último. Lista ordenada por codigo_display_numero (fix 20260902001000).';

-- ---------------------------------------------------------------------------
-- listar_individuos_procedimiento_predio — solo orden de lista para UI.
-- ---------------------------------------------------------------------------
create or replace function listar_individuos_procedimiento_predio(
  p_procedimiento_id uuid,
  p_predio_id uuid
)
returns table (individuo_id uuid, codigo_display text, sector_id uuid, sector_nombre text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_planta_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if not exists (
    select 1 from procedimiento_objetivos
    where procedimiento_id = p_procedimiento_id and tipo = 'predio' and predio_id = p_predio_id
  ) then
    raise exception 'El predio no es objetivo de este procedimiento' using errcode = '42501';
  end if;
  select planta_id into v_planta_id from procedimiento_objetivos
  where procedimiento_id = p_procedimiento_id and tipo = 'cruzamiento' limit 1;
  return query
  select i.id, i.codigo_display, s.id, s.nombre
  from emplazamiento_individuo e
  join individuos i on i.id = e.individuo_id
  join sector s on s.id = e.sector_id
  where i.planta_id = v_planta_id
    and s.predio_id = p_predio_id
    and e.fecha_fin is null
  order by codigo_display_numero(i.codigo_display), i.codigo_display;
end;
$$;

-- ---------------------------------------------------------------------------
-- obtener_mapa_cruce — ordena por codigo_corto (sufijo corto, ej. "P01"), no
-- por codigo_display completo, pero mismo problema de comparación textual.
-- ---------------------------------------------------------------------------
create or replace function obtener_mapa_cruce(p_planta_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_resultado jsonb;
  v_codigo_sistema text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  select codigo_sistema into v_codigo_sistema from plantas where id = p_planta_id and eliminado_at is null;
  if not found then
    raise exception 'Cruce no encontrado' using errcode = 'P0002';
  end if;

  with vigentes as materialized (
    select
      ei.individuo_id,
      s.predio_id,
      i.estado_vital,
      substring(i.codigo_display from length(v_codigo_sistema) + 2) as codigo_corto
    from emplazamiento_individuo ei
    join individuos i on i.id = ei.individuo_id
    join sector s on s.id = ei.sector_id
    where ei.fecha_fin is null
      and i.planta_id = p_planta_id
  ), clusters as (
    select
      p.id as predio_id,
      p.nombre as predio_nombre,
      p.latitud,
      p.longitud,
      count(*)::integer as individuos,
      count(*) filter (where v.estado_vital = 'vivo')::integer as individuos_vivos,
      jsonb_agg(jsonb_build_object('codigo_corto', v.codigo_corto, 'vivo', v.estado_vital = 'vivo') order by codigo_display_numero(v.codigo_corto), v.codigo_corto) as codigos
    from vigentes v
    join predio p on p.id = v.predio_id
    group by p.id, p.nombre, p.latitud, p.longitud
  )
  select jsonb_build_object(
    'planta_id', p_planta_id,
    'total_individuos_emplazados', (select count(*) from vigentes),
    'clusters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'predio_id', c.predio_id,
        'predio_nombre', c.predio_nombre,
        'latitud', c.latitud,
        'longitud', c.longitud,
        'tiene_coordenada', c.latitud is not null,
        'individuos', c.individuos,
        'individuos_vivos', c.individuos_vivos,
        'codigos_individuos', c.codigos
      ) order by c.predio_nombre)
      from clusters c
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function obtener_mapa_cruce(uuid) is
  'Emplazamientos vigentes de los individuos de UN cruce, agregados por predio (cluster + conteo + coordenada del predio + código corto de cada individuo emplazado ahí, ej. "P01"). Fuente de coordenada: predio.latitud/longitud (Sprint 4), no emplazamiento_coordenada. tiene_coordenada=false cuando el predio no fue geolocalizado. Códigos ordenados por codigo_display_numero (fix 20260902001000).';
