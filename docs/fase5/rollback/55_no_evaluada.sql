-- Rollback del paso 55 («No evaluada en esta ronda»). Se niega si ya hay rondas marcadas: quitarlo borraría esas marcas y
-- volvería a bloquear la ronda siguiente de esas plantas. Vuelve a las definiciones anteriores de las cuatro funciones y quita
-- las columnas, el disparador y las dos funciones nuevas. Las filas de auditoría se conservan.
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ronda_evaluacion_anual WHERE no_evaluada_motivo IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: rollback 55: ya hay rondas marcadas como No evaluada';
  END IF;
END;
$chk$;

create or replace function public.validar_ronda_anterior_cerrada()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_nombre text;
begin
  if auth.uid() is null then return new; end if;
  if new.numero_ronda <= 1 then return new; end if;
  if not exists (
    select 1
    from public.ronda_evaluacion_anual r
    join public.evaluaciones e on e.ronda_id = r.id
    where r.individuo_id = new.individuo_id
      and r.tipo_ronda = new.tipo_ronda
      and r.numero_ronda = new.numero_ronda - 1
      and e.estado in ('completa', 'corregida')
  ) then
    v_nombre := case when new.tipo_ronda = 'multisitio' then 'ronda multisitio ' else 'ronda ' end || (new.numero_ronda - 1);
    raise exception 'La % todavía no tiene una evaluación completa. Ciérrala antes de iniciar la siguiente.', v_nombre
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.obtener_planilla_ronda(p_planta_id uuid, p_tipo_ronda tipo_ronda DEFAULT 'anual'::tipo_ronda, p_numero_ronda smallint DEFAULT NULL::smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_numero smallint := p_numero_ronda;
  v_protocolo protocolo_ronda;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not exists (select 1 from plantas where id = p_planta_id and eliminado_at is null) then
    raise exception 'Cruce no encontrado' using errcode = 'P0002';
  end if;
  if v_numero is null then
    select max(r.numero_ronda) into v_numero
    from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id
    where i.planta_id = p_planta_id and r.tipo_ronda = p_tipo_ronda;
  end if;

  select * into v_protocolo
  from protocolo_ronda pr
  where pr.planta_id = p_planta_id and pr.tipo_ronda = p_tipo_ronda and pr.numero_ronda = v_numero
  order by pr.version desc
  limit 1;

  with vivos as (
    select i.id, i.codigo_display
    from individuos i
    where i.planta_id = p_planta_id and i.estado_vital = 'vivo'
  ), rondas as (
    select r.individuo_id, r.id as ronda_id
    from ronda_evaluacion_anual r
    join vivos v on v.id = r.individuo_id
    where r.tipo_ronda = p_tipo_ronda and r.numero_ronda = v_numero
  ), elegida as (
    -- A1-144: el avance se mide por evaluación cerrada; si no hay, el borrador.
    select distinct on (e.ronda_id) e.*
    from evaluaciones e
    join rondas ro on ro.ronda_id = e.ronda_id
    where e.estado in ('borrador', 'completa', 'corregida')
    order by e.ronda_id, (e.estado <> 'borrador') desc, e.fecha desc, e.updated_at desc, e.id desc
  ), borradores as (
    -- U-09: un borrador activo (a lo sumo uno por ronda) puede convivir con una evaluación cerrada: una visita nueva.
    -- Solo se expone si existe y si es de quien consulta; nunca su contenido ni quién lo creó.
    select e.ronda_id, bool_or(e.created_by = auth.uid()) as mio
    from evaluaciones e
    join rondas ro on ro.ronda_id = e.ronda_id
    where e.estado = 'borrador'
    group by e.ronda_id
  ), filas as (
    select
      v.id as individuo_id,
      v.codigo_display,
      codigo_display_numero(v.codigo_display) as numero,
      ro.ronda_id,
      case
        when ro.ronda_id is null then 'sin_ronda'
        when e.id is null then 'sin_iniciar'
        when e.estado = 'borrador' then 'borrador'
        else 'completa'
      end as estado,
      e.id as evaluacion_id,
      e.updated_at as evaluacion_updated_at,
      e.fecha,
      e.evaluador,
      e.created_by = auth.uid() as es_mia,
      e.protocolo_id,
      -- Solo si la evaluación tiene protocolo y no es el vigente (las anteriores a los protocolos no cuentan).
      e.protocolo_id is not null and e.protocolo_id is distinct from v_protocolo.id as protocolo_distinto,
      case when e.id is not null then estados_descriptores(e) end as estados,
      b.ronda_id is not null as hay_borrador,
      coalesce(b.mio, false) as borrador_mio
    from vivos v
    left join rondas ro on ro.individuo_id = v.id
    left join elegida e on e.ronda_id = ro.ronda_id
    left join borradores b on b.ronda_id = ro.ronda_id
  )
  select jsonb_build_object(
    'planta_id', p_planta_id,
    'tipo_ronda', p_tipo_ronda,
    'numero_ronda', v_numero,
    'protocolo', case when v_protocolo.id is null then null else jsonb_build_object(
      'id', v_protocolo.id, 'version', v_protocolo.version, 'nombre', v_protocolo.nombre,
      'descriptores', v_protocolo.descriptores, 'created_at', v_protocolo.created_at) end,
    'avance', jsonb_build_object(
      'vivos', (select count(*) from filas),
      'sin_ronda', (select count(*) from filas where estado = 'sin_ronda'),
      'sin_iniciar', (select count(*) from filas where estado = 'sin_iniciar'),
      'borrador', (select count(*) from filas where estado = 'borrador'),
      'completa', (select count(*) from filas where estado = 'completa'),
      -- Filas cerradas que además tienen un borrador de visita nueva (no suma a los demás conteos).
      'con_borrador', (select count(*) from filas where estado = 'completa' and hay_borrador)
    ),
    'individuos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'individuo_id', f.individuo_id, 'codigo_display', f.codigo_display, 'numero', f.numero,
        'ronda_id', f.ronda_id, 'estado', f.estado, 'evaluacion_id', f.evaluacion_id,
        'evaluacion_updated_at', f.evaluacion_updated_at, 'fecha', f.fecha, 'evaluador', f.evaluador,
        'es_mia', coalesce(f.es_mia, false), 'protocolo_id', f.protocolo_id,
        'protocolo_distinto', coalesce(f.protocolo_distinto, false), 'estados', f.estados,
        'conteo', case when f.estados is null then null else (
          select jsonb_build_object(
            'medido', count(*) filter (where x.value #>> '{}' = 'medido'),
            'falto', count(*) filter (where x.value #>> '{}' = 'falto'),
            'no_evaluado', count(*) filter (where x.value #>> '{}' = 'no_evaluado'),
            'marcado', count(*) filter (where x.value #>> '{}' = 'marcado'))
          from jsonb_each(f.estados) x) end,
        'hay_borrador', f.hay_borrador, 'borrador_mio', f.borrador_mio
      ) order by f.numero nulls last, f.codigo_display)
      from filas f), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.obtener_dashboard_cientifico(p_especie_id uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 8, p_incluir_pruebas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    where (p_especie_id is null or p.especie_id = p_especie_id)
      -- v3 (N4): los cruces de prueba quedan fuera salvo que se pidan; solo un admin puede pedirlos.
      and (not p.es_prueba or (p_incluir_pruebas and es_admin()))
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
    where e.estado in ('completa', 'corregida')
  ), ultimo_cambio as materialized (
    select distinct on (a.planta_id)
      a.planta_id, a.codigo_sistema, a.especie_nombre, a.estado, a.fecha, a.tipo
    from actividad a
    order by a.planta_id, a.fecha desc, a.tipo
  ), pendientes as materialized (
    -- v3 (N26): se cuenta como la planilla (obtener_planilla_ronda): individuos vivos sin evaluación cerrada
    -- (completa o corregida) en la última ronda del cruce; anual en Evaluación anual, multisitio en Multisitio.
    -- Antes contaba los no elegibles de calcular_ranking_operativo (exigía todas las métricas del scoring).
    select
      p.id as planta_id,
      p.codigo_sistema,
      p.estado,
      count(*)::integer as individuos_pendientes
    from plantas_alcance p
    cross join lateral (
      select case when p.estado = 'traslado_destino' then 'multisitio'::tipo_ronda else 'anual'::tipo_ronda end as tipo
    ) t
    cross join lateral (
      select max(r.numero_ronda) as numero
      from ronda_evaluacion_anual r
      join individuos ri on ri.id = r.individuo_id
      where ri.planta_id = p.id and r.tipo_ronda = t.tipo
    ) ra
    join individuos i on i.planta_id = p.id and i.estado_vital = 'vivo'
    where p.estado in ('evaluacion_anual', 'traslado_destino')
      and not exists (
        select 1
        from ronda_evaluacion_anual r
        join evaluaciones e on e.ronda_id = r.id
        where r.individuo_id = i.id and r.tipo_ronda = t.tipo and r.numero_ronda = ra.numero
          and e.estado in ('completa', 'corregida')
      )
    group by p.id, p.codigo_sistema, p.estado
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
$function$;

DROP TRIGGER evaluaciones_validar_ronda_no_evaluada ON public.evaluaciones;
DROP FUNCTION public.validar_ronda_no_evaluada();
DROP FUNCTION public.quitar_ronda_no_evaluada(uuid);
DROP FUNCTION public.marcar_ronda_no_evaluada(uuid, text, text);
ALTER TABLE public.ronda_evaluacion_anual
  DROP CONSTRAINT ronda_no_evaluada_coherente_check,
  DROP CONSTRAINT ronda_no_evaluada_motivo_check,
  DROP COLUMN no_evaluada_en,
  DROP COLUMN no_evaluada_por,
  DROP COLUMN no_evaluada_detalle,
  DROP COLUMN no_evaluada_motivo;
