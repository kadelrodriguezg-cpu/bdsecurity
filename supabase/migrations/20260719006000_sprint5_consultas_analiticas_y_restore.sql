-- =============================================================================
-- Sprint 5: contratos de consulta para UX analítica y restauración de soft delete.
--
-- No modifica el modelo científico ni los snapshots. Las consultas devuelven
-- únicamente identificadores y datos operativos; nunca linaje.
-- =============================================================================

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
                 f.fecha_evaluacion desc nulls last,
                 f.evaluacion_updated_at desc nulls last,
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

comment on function obtener_ranking_global_filtrado is
  'Ranking global paginado y filtrado en backend. Exige especie y nunca mezcla especies; no expone linaje.';


create or replace function listar_cruces_analiticos(
  p_especie_id uuid default null,
  p_estado estado_planta default null,
  p_busqueda text default null,
  p_orden text default 'actividad_desc',
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
  if p_limite < 1 or p_limite > 100 or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode = '22023';
  end if;
  if p_orden not in ('actividad_desc', 'codigo_asc', 'estado_asc', 'especie_asc', 'vivos_desc', 'scoring_desc') then
    raise exception 'Orden no permitido' using errcode = '22023';
  end if;

  with base as materialized (
    select
      p.id,
      p.codigo_sistema,
      p.especie_id,
      p.especie_nombre,
      p.estado,
      (select count(*)::integer from individuos i where i.planta_id = p.id and i.estado_vital = 'vivo') as individuos_vivos,
      greatest(
        p.updated_at,
        p.fecha_cambio_estado,
        coalesce((select max(r.created_at) from registros_evento r where r.planta_id = p.id), '-infinity'::timestamptz),
        coalesce((
          select max(e.updated_at)
          from evaluaciones e
          join ronda_evaluacion_anual rr on rr.id = e.ronda_id
          join individuos i on i.id = rr.individuo_id
          where i.planta_id = p.id
        ), '-infinity'::timestamptz),
        coalesce((
          select max(pr.updated_at)
          from procedimientos pr
          join procedimiento_objetivos po on po.procedimiento_id = pr.id
          left join individuos oi on oi.id = po.individuo_id
          where po.planta_id = p.id or oi.planta_id = p.id
        ), '-infinity'::timestamptz)
      ) as ultima_actividad,
      resolver_scoring_version(p.especie_id, 'evaluacion_anual', current_date) as scoring_version_id
    from plantas_operativas p
    where (p_especie_id is null or p.especie_id = p_especie_id)
      and (p_estado is null or p.estado = p_estado)
      and (nullif(btrim(p_busqueda), '') is null or p.codigo_sistema ilike '%' || btrim(p_busqueda) || '%')
  ), enriquecido as materialized (
    select
      b.*,
      sv.nombre as scoring_version_nombre,
      coalesce(rank.individuos_elegibles, 0) as individuos_elegibles,
      rank.mejor_puntaje
    from base b
    left join scoring_version sv on sv.id = b.scoring_version_id
    left join lateral (
      select
        count(*) filter (where r.elegible)::integer as individuos_elegibles,
        max(r.puntaje_ponderado) filter (where r.elegible) as mejor_puntaje
      from calcular_ranking_operativo(b.scoring_version_id, b.id, null) r
    ) rank on b.scoring_version_id is not null
  ), pagina as (
    select *
    from enriquecido
    order by
      case when p_orden = 'actividad_desc' then ultima_actividad end desc nulls last,
      case when p_orden = 'codigo_asc' then codigo_sistema end asc,
      case when p_orden = 'estado_asc' then estado::text end asc,
      case when p_orden = 'especie_asc' then especie_nombre end asc,
      case when p_orden = 'vivos_desc' then individuos_vivos end desc,
      case when p_orden = 'scoring_desc' then mejor_puntaje end desc nulls last,
      codigo_sistema asc
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(pagina)) from pagina), '[]'::jsonb),
    'total', (select count(*) from enriquecido),
    'limite', p_limite,
    'offset', p_offset,
    'orden', p_orden
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function listar_cruces_analiticos(uuid, estado_planta, text, text, integer, integer)
  from public, anon;
grant execute on function listar_cruces_analiticos(uuid, estado_planta, text, text, integer, integer)
  to authenticated, service_role;

comment on function listar_cruces_analiticos is
  'Tabla comparativa de cruces con filtros, orden y paginación en backend; usa solo datos operativos sin linaje.';


create or replace function obtener_dashboard_cientifico(
  p_especie_id uuid default null,
  p_limite integer default 8
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
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
$$;

revoke all on function obtener_dashboard_cientifico(uuid, integer) from public, anon;
grant execute on function obtener_dashboard_cientifico(uuid, integer) to authenticated, service_role;

comment on function obtener_dashboard_cientifico is
  'Agregación backend para dashboard: cambios, destacados y pendientes. No expone linaje ni realiza agregación en cliente.';


create or replace function restaurar_cruzamiento(p_planta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_planta plantas%rowtype;
  v_resultado jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede restaurar un cruzamiento' using errcode = '42501';
  end if;

  select * into v_planta
  from plantas
  where id = p_planta_id
  for update;

  if not found then
    raise exception 'Cruce no encontrado' using errcode = 'P0002';
  end if;
  if v_planta.eliminado_at is null then
    raise exception 'El cruce no está eliminado' using errcode = '23514';
  end if;

  v_resultado := jsonb_build_object(
    'planta_id', v_planta.id,
    'codigo_sistema', v_planta.codigo_sistema,
    'eliminado_at_anterior', v_planta.eliminado_at,
    'n_individuos', (select count(*) from individuos where planta_id = v_planta.id),
    'n_evaluaciones', (
      select count(*)
      from evaluaciones e
      join ronda_evaluacion_anual rr on rr.id = e.ronda_id
      join individuos i on i.id = rr.individuo_id
      where i.planta_id = v_planta.id
    ),
    'n_emplazamientos', (
      select count(*)
      from emplazamiento_individuo em
      join individuos i on i.id = em.individuo_id
      where i.planta_id = v_planta.id
    ),
    'restaurado_at', now()
  );

  update plantas
  set eliminado_at = null,
      updated_at = now()
  where id = p_planta_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'restauracion_cruzamiento', array['eliminado_at'], v_resultado);

  return v_resultado;
end;
$$;

revoke all on function restaurar_cruzamiento(uuid) from public, anon;
grant execute on function restaurar_cruzamiento(uuid) to authenticated, service_role;

comment on function restaurar_cruzamiento is
  'Solo admin. Revierte exclusivamente eliminado_at y audita la restauración; las relaciones históricas permanecen intactas.';
