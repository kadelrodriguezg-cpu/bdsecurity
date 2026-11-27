-- Fase 4, paso 49 — la especie como espacio de trabajo: panorama por especie y estado operativo de cada cruce.
--
-- Lo piden el selector de especie del encabezado, «Todas las especies» (una tarjeta por especie) y la tabla nueva de Cruces
-- (franja de fases, ronda actual, pendientes y quién hizo lo último). Las cifras se cuentan como la planilla (E15, N26):
-- «sin evaluación cerrada» = individuos vivos sin evaluación cerrada (completa o corregida) en la ronda actual del cruce
-- (anual en Evaluación anual, multisitio en Multisitio; quien no tiene ronda también cuenta).
--
-- 1. `ultima_accion_auditada_cruce(planta)` (SECURITY DEFINER): fecha y autor de la última acción de trabajo auditada del cruce
--    (cambio de fase, alta, individuos, rondas, evaluaciones, procedimientos). El operario no lee `audit_log`; esta función le
--    entrega solo la fecha y el id de quien actuó (el nombre lo da `nombres_de_usuarios`, N15), nunca el detalle. Las acciones de
--    linaje y las lecturas quedan fuera a propósito.
-- 2. `estado_operativo_cruce(planta)`: vivos, ronda actual (tipo, número y año), cerradas, sin evaluación cerrada y la última
--    actividad con su autor. Corre con los permisos de quien llama (RLS).
-- 3. `panorama_especies(especie, incluir_pruebas)`: una fila por especie (también las que no tienen cruces) con cruces activos,
--    individuos vivos, sin evaluación cerrada, evaluaciones cerradas, cruces por fase, fases con pendientes y última actividad.
--    Los cruces de prueba quedan fuera salvo que un admin los pida (N25).
-- 4. `listar_cruces_analiticos`: misma firma; cada fila trae además `ronda_actual`, `sin_evaluacion_cerrada` y
--    `ultima_actividad_por`, y la última actividad sale de la misma regla (incluye las acciones auditadas). La app anterior ignora
--    las claves nuevas.
--
-- Rollback: docs/fase4/rollback/49_panorama_especies.sql (restaura listar_cruces_analiticos de 20261024090000 y borra lo nuevo).

create or replace function public.ultima_accion_auditada_cruce(p_planta_id uuid)
returns table(ocurrido_en timestamptz, usuario_id uuid)
language sql
stable
security definer
set search_path = public
as $function$
  select a.ocurrido_en, a.usuario_id
  from audit_log a
  where auth.uid() is not null
    and a.planta_id = p_planta_id
    and a.accion = any (array[
      'alta_cruce', 'cambio_estado', 'escritura_fase', 'creacion_individuo', 'edicion_individuo', 'individualizacion',
      'baja_lote', 'traslado_individuo', 'creacion_ronda_evaluacion_anual', 'creacion_evaluacion', 'edicion_evaluacion',
      'cambio_estado_evaluacion', 'correccion_evaluacion', 'creacion_evaluacion_reducida', 'creacion_procedimiento',
      'registro_emplazamiento'
    ])
    -- Solo de un cruce que quien llama puede ver: activo y, si es de prueba, solo para un admin.
    and exists (
      select 1 from plantas p
      where p.id = p_planta_id and p.eliminado_at is null and (not p.es_prueba or es_admin())
    )
  order by a.ocurrido_en desc, a.id desc
  limit 1;
$function$;

comment on function public.ultima_accion_auditada_cruce(uuid) is
  'Fase 4: fecha y autor (id) de la última acción de trabajo auditada de un cruce visible. Sin detalle, sin linaje ni lecturas.';
revoke all on function public.ultima_accion_auditada_cruce(uuid) from public, anon;
grant execute on function public.ultima_accion_auditada_cruce(uuid) to authenticated, service_role;

create or replace function public.estado_operativo_cruce(p_planta_id uuid)
returns table(
  individuos_vivos integer,
  ronda_tipo tipo_ronda,
  ronda_numero smallint,
  ronda_anio integer,
  evaluaciones_cerradas integer,
  sin_evaluacion_cerrada integer,
  ultima_actividad timestamptz,
  ultima_actividad_por uuid
)
language sql
stable
set search_path = public
as $function$
  with cruce as (
    select p.id, p.estado, p.updated_at, p.fecha_cambio_estado,
      case when p.estado = 'traslado_destino' then 'multisitio'::tipo_ronda else 'anual'::tipo_ronda end as tipo,
      p.estado in ('evaluacion_anual', 'traslado_destino') as en_evaluacion
    from plantas_operativas p
    where p.id = p_planta_id
  ), vivos as (
    select count(*)::integer as n from individuos i where i.planta_id = p_planta_id and i.estado_vital = 'vivo'
  ), ronda as (
    -- Ronda actual del cruce: el número de ronda más alto entre sus individuos (como la planilla y el panel).
    select r.numero_ronda as numero, max(r.anio)::integer as anio
    from cruce c
    join individuos ri on ri.planta_id = c.id
    join ronda_evaluacion_anual r on r.individuo_id = ri.id and r.tipo_ronda = c.tipo
    where c.en_evaluacion
    group by r.numero_ronda
    order by r.numero_ronda desc
    limit 1
  ), cerradas as (
    select count(*)::integer as n
    from cruce c
    cross join ronda ra
    join individuos i on i.planta_id = c.id and i.estado_vital = 'vivo'
    where exists (
      select 1
      from ronda_evaluacion_anual r
      join evaluaciones e on e.ronda_id = r.id
      where r.individuo_id = i.id and r.tipo_ronda = c.tipo and r.numero_ronda = ra.numero
        and e.estado in ('completa', 'corregida')
    )
  ), actividad as (
    select x.fecha, x.usuario_id
    from cruce c
    cross join lateral (
      select c.updated_at as fecha, null::uuid as usuario_id
      union all select c.fecha_cambio_estado, null::uuid
      union all select a.ocurrido_en, a.usuario_id from ultima_accion_auditada_cruce(c.id) a
      union all (select r.created_at, r.created_by from registros_evento r where r.planta_id = c.id order by r.created_at desc limit 1)
      union all (
        select e.updated_at, e.created_by
        from evaluaciones e
        join ronda_evaluacion_anual rr on rr.id = e.ronda_id
        join individuos i on i.id = rr.individuo_id
        where i.planta_id = c.id
        order by e.updated_at desc
        limit 1
      )
      union all (
        select pr.updated_at, pr.created_by
        from procedimientos pr
        join procedimiento_objetivos po on po.procedimiento_id = pr.id
        left join individuos oi on oi.id = po.individuo_id
        where po.planta_id = c.id or oi.planta_id = c.id
        order by pr.updated_at desc
        limit 1
      )
    ) x
    where x.fecha is not null
    -- A igual fecha gana la fila que sabe quién actuó.
    order by x.fecha desc, (x.usuario_id is null)
    limit 1
  )
  select
    v.n,
    case when ra.numero is not null then c.tipo end,
    ra.numero,
    ra.anio,
    coalesce(ce.n, 0),
    case when c.en_evaluacion then v.n - coalesce(ce.n, 0) else 0 end,
    a.fecha,
    a.usuario_id
  from cruce c
  cross join vivos v
  left join ronda ra on true
  left join cerradas ce on true
  left join actividad a on true;
$function$;

comment on function public.estado_operativo_cruce(uuid) is
  'Fase 4: estado operativo de un cruce (vivos, ronda actual, cerradas, sin evaluación cerrada como la planilla, última actividad y autor). Con los permisos de quien llama.';
revoke all on function public.estado_operativo_cruce(uuid) from public, anon;
grant execute on function public.estado_operativo_cruce(uuid) to authenticated, service_role;

create or replace function public.panorama_especies(p_especie_id uuid default null, p_incluir_pruebas boolean default false)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  with cruces as materialized (
    select p.id, p.especie_id, p.estado, eo.*
    from plantas_operativas p
    cross join lateral estado_operativo_cruce(p.id) eo
    where (p_especie_id is null or p.especie_id = p_especie_id)
      and (not p.es_prueba or (p_incluir_pruebas and es_admin()))
  ), ultimo as (
    select distinct on (c.especie_id) c.especie_id, c.ultima_actividad, c.ultima_actividad_por
    from cruces c
    where c.ultima_actividad is not null
    order by c.especie_id, c.ultima_actividad desc, (c.ultima_actividad_por is null)
  ), por_especie as (
    select
      e.id,
      e.nombre,
      count(c.id)::integer as cruces,
      (count(c.id) filter (where c.estado not in ('sin_empezar', 'proceso_finalizado')))::integer as cruces_activos,
      coalesce(sum(c.individuos_vivos), 0)::integer as individuos_vivos,
      coalesce(sum(c.sin_evaluacion_cerrada), 0)::integer as sin_evaluacion_cerrada,
      coalesce(sum(c.evaluaciones_cerradas), 0)::integer as evaluaciones_cerradas,
      (count(c.id) filter (where c.sin_evaluacion_cerrada > 0))::integer as cruces_con_pendientes,
      coalesce((
        select jsonb_object_agg(f.estado, f.n)
        from (select c2.estado, count(*)::integer as n from cruces c2 where c2.especie_id = e.id group by c2.estado) f
      ), '{}'::jsonb) as cruces_por_fase,
      coalesce((
        select jsonb_object_agg(f.estado, f.n)
        from (
          select c2.estado, count(*)::integer as n from cruces c2
          where c2.especie_id = e.id and c2.sin_evaluacion_cerrada > 0 group by c2.estado
        ) f
      ), '{}'::jsonb) as fases_con_pendientes
    from especies e
    left join cruces c on c.especie_id = e.id
    where p_especie_id is null or e.id = p_especie_id
    group by e.id, e.nombre
  )
  select coalesce(jsonb_agg(
    to_jsonb(pe) || jsonb_build_object('ultima_actividad', u.ultima_actividad, 'ultima_actividad_por', u.ultima_actividad_por)
    order by pe.nombre
  ), '[]'::jsonb)
  into v_resultado
  from por_especie pe
  left join ultimo u on u.especie_id = pe.id;

  return v_resultado;
end;
$function$;

comment on function public.panorama_especies(uuid, boolean) is
  'Fase 4: una fila por especie con cruces activos, individuos vivos, sin evaluación cerrada (como la planilla), evaluaciones cerradas, cruces por fase, fases con pendientes y última actividad. Sin cruces de prueba salvo que un admin los pida.';
revoke all on function public.panorama_especies(uuid, boolean) from public, anon;
grant execute on function public.panorama_especies(uuid, boolean) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.listar_cruces_analiticos(p_especie_id uuid DEFAULT NULL::uuid, p_estado estado_planta DEFAULT NULL::estado_planta, p_busqueda text DEFAULT NULL::text, p_orden text DEFAULT 'actividad_desc'::text, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0, p_incluir_pruebas boolean DEFAULT false, p_solo_pendientes boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      -- v3: la marca va en cada fila para que el admin que incluye las pruebas las distinga.
      p.es_prueba,
      eo.individuos_vivos,
      -- Fase 4: la última actividad incluye las acciones auditadas y trae su autor (estado_operativo_cruce).
      eo.ultima_actividad,
      eo.ultima_actividad_por,
      eo.sin_evaluacion_cerrada,
      case when eo.ronda_numero is null then null else jsonb_build_object(
        'tipo', eo.ronda_tipo, 'numero', eo.ronda_numero, 'anio', eo.ronda_anio,
        'cerradas', eo.evaluaciones_cerradas, 'vivos', eo.individuos_vivos
      ) end as ronda_actual,
      resolver_scoring_version(p.especie_id, 'evaluacion_anual', current_date) as scoring_version_id
    from plantas_operativas p
    cross join lateral estado_operativo_cruce(p.id) eo
    where (p_especie_id is null or p.especie_id = p_especie_id)
      and (p_estado is null or p.estado = p_estado)
      and (nullif(btrim(p_busqueda), '') is null or p.codigo_sistema ilike '%' || btrim(p_busqueda) || '%')
      -- v3 (N4): los cruces de prueba quedan fuera salvo que se pidan; solo un admin puede pedirlos.
      and (not p.es_prueba or (p_incluir_pruebas and es_admin()))
      -- v3 paso 7: solo cruces con individuos vivos sin evaluación cerrada en la última ronda (misma regla que los
      -- pendientes de obtener_dashboard_cientifico y que la planilla).
      and (not p_solo_pendientes or eo.sin_evaluacion_cerrada > 0)
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
$function$;

comment on function public.listar_cruces_analiticos(uuid, estado_planta, text, text, integer, integer, boolean, boolean) is 'Tabla comparativa de cruces con filtros, orden y paginación en backend; usa solo datos operativos sin linaje. v3 (20261024090000): excluye los cruces de prueba salvo p_incluir_pruebas, y solo para un admin; cada fila trae es_prueba; p_solo_pendientes deja solo los cruces con individuos sin evaluación cerrada en la última ronda. Fase 4 (20261026110000): cada fila trae ronda_actual, sin_evaluacion_cerrada y ultima_actividad_por (estado_operativo_cruce).';
