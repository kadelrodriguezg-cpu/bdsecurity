-- =============================================================================
-- SPRINT 5 (3/5) — Snapshots consultables (listar, detalle, comparar contra
-- vivo). Corresponde a docs/BDSecurity_Documento_Maestro.md, Fase 2 / 2.2.
--
-- congelar_ranking (Sprint 2 / Bloque E) ya crea snapshots pero era la
-- "función fantasma" del hallazgo E2E: nada los lista ni los compara. Se
-- enriquece primero (aditivo: una clave más en el jsonb `detalle` que ya
-- arma) para que cada resultado congelado también guarde su desglose por
-- categoría (detalle_categorias, agregado en este mismo sprint) — sin eso,
-- comparar_snapshot_vivo no tendría con qué comparar el delta por categoría
-- contra el ranking vivo actual.
-- =============================================================================

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
  order by r.puntaje_ponderado desc, r.codigo_display asc;

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
  'Congela el ranking vivo (Sprint 5: posición y orden alineados a puntaje desc, codigo_display asc — mismo tie-break fix que el ranking operativo; detalle ahora incluye categorias además de metricas). Solo admin.';

revoke all on function congelar_ranking(text, uuid, uuid) from public, anon;
grant execute on function congelar_ranking(text, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Listar snapshots de un cruce o especie.
-- ---------------------------------------------------------------------------
create or replace function listar_snapshots_ranking(
  p_planta_id uuid default null,
  p_especie_id uuid default null,
  p_limite integer default 25,
  p_offset integer default 0
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
  if (p_planta_id is null) = (p_especie_id is null) then
    raise exception 'Indica exactamente un cruce o una especie' using errcode = '22023';
  end if;
  if p_limite < 1 or p_limite > 100 or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode = '22023';
  end if;

  with base as materialized (
    select
      rs.id,
      rs.nombre,
      rs.alcance,
      rs.scoring_version_id,
      sv.nombre as scoring_version_nombre,
      rs.especie_id,
      rs.planta_id,
      rs.poblacion_comparada,
      rs.criterios,
      rs.created_by,
      rs.created_at
    from ranking_snapshot rs
    join scoring_version sv on sv.id = rs.scoring_version_id
    where (p_planta_id is not null and rs.planta_id = p_planta_id)
       or (p_especie_id is not null and rs.especie_id = p_especie_id and rs.alcance = 'especie')
  ), pagina as (
    select * from base
    order by created_at desc
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(pagina)) from pagina), '[]'::jsonb),
    'total', (select count(*) from base),
    'limite', p_limite,
    'offset', p_offset
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function listar_snapshots_ranking(uuid, uuid, integer, integer) is
  'Lista cabeceras de snapshots de ranking de un cruce o una especie (Sprint 5, cierra la "función fantasma" del hallazgo E2E).';

revoke all on function listar_snapshots_ranking(uuid, uuid, integer, integer) from public, anon;
grant execute on function listar_snapshots_ranking(uuid, uuid, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Detalle de un snapshot: cabecera + resultados congelados.
-- ---------------------------------------------------------------------------
create or replace function obtener_detalle_snapshot(p_snapshot_id uuid)
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
  if not exists (select 1 from ranking_snapshot where id = p_snapshot_id) then
    raise exception 'Snapshot no encontrado' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'snapshot', (
      select jsonb_build_object(
        'id', rs.id, 'nombre', rs.nombre, 'alcance', rs.alcance,
        'scoring_version_id', rs.scoring_version_id, 'scoring_version_nombre', sv.nombre,
        'especie_id', rs.especie_id, 'planta_id', rs.planta_id,
        'poblacion_comparada', rs.poblacion_comparada, 'criterios', rs.criterios,
        'created_by', rs.created_by, 'created_at', rs.created_at
      )
      from ranking_snapshot rs
      join scoring_version sv on sv.id = rs.scoring_version_id
      where rs.id = p_snapshot_id
    ),
    'resultados', coalesce((
      select jsonb_agg(jsonb_build_object(
        'individuo_id', rsr.individuo_id,
        'codigo_display', rsr.codigo_display,
        'evaluacion_id', rsr.evaluacion_id,
        'posicion', rsr.posicion,
        'puntaje', rsr.puntaje,
        'detalle', rsr.detalle
      ) order by rsr.posicion)
      from ranking_snapshot_resultado rsr
      where rsr.snapshot_id = p_snapshot_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function obtener_detalle_snapshot(uuid) is
  'Cabecera + resultados de un snapshot de ranking (Sprint 5, cierra la "función fantasma" del hallazgo E2E).';

revoke all on function obtener_detalle_snapshot(uuid) from public, anon;
grant execute on function obtener_detalle_snapshot(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Comparar un snapshot contra el ranking vivo actual. El ranking vivo se
-- calcula resolviendo la scoring_version ACTIVA hoy (misma resolución que
-- obtener_ranking_operativo) — puede ser la misma versión con la que se
-- congeló el snapshot, o una distinta si cambió la configuración entre
-- medio; ambos casos son información válida para el usuario ("¿cómo cambió
-- desde que congelé esto", incluyendo si cambió el propio criterio). Los
-- umbrales de etiqueta usados son los de la versión ACTIVA hoy (config
-- vigente), no los que tenía la versión congelada.
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
    -- Se descartan individuos que ni estaban en el snapshot ni son
    -- elegibles hoy: existen en calcular_ranking_operativo (todo individuo
    -- vivo del cruce) pero nunca tuvieron puntaje en ninguno de los dos
    -- lados, y no aportan nada a "qué cambió desde que congelé esto".
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
      ) order by cm.codigo_display)
      from comparado cm
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function comparar_snapshot_vivo(uuid) is
  'Compara un snapshot congelado contra el ranking vivo actual (Sprint 5, 2.2 del documento maestro). Incluye individuos que salieron/entraron del ranking desde que se congeló (full outer join). Usa la scoring_version activa HOY para resolver el vivo y sus umbrales de etiqueta.';

revoke all on function comparar_snapshot_vivo(uuid) from public, anon;
grant execute on function comparar_snapshot_vivo(uuid) to authenticated, service_role;
