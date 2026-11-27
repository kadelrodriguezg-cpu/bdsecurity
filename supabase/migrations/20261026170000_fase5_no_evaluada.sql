-- =============================================================================
-- MIGRACIÓN 20261026170000 — FASE 5, PASO 55: «NO EVALUADA EN ESTA RONDA» Y PLANTAS ATRASADAS (decisión G3)
--
-- Hallazgo 3 de la guía del administrador. Una planta que no se evaluó en la ronda N (no alcanzó, sin fruto u otro
-- motivo) bloqueaba para siempre su ronda N+1 (R3), y en cuanto otra planta del cruce abría la ronda N+1 la planilla
-- dejaba la ronda N en solo lectura.
--
-- Decisión G3 (Kadel, 26-10-2026): una planta puede quedar «No evaluada en esta ronda» con un motivo obligatorio
-- (No alcanzó · Sin fruto · Otro + texto). Queda auditado, no cuenta en el ranking de esa ronda (no tiene evaluación
-- cerrada), deja de contarse como pendiente y le permite entrar a la ronda siguiente.
--
--   ronda_evaluacion_anual.no_evaluada_*   motivo, detalle, quién y cuándo (todo nulo = no marcada).
--   marcar_ronda_no_evaluada(ronda, motivo, detalle)   solo admin [provisional · agente]; se niega si la ronda ya
--                                          tiene una evaluación cerrada o un borrador sin terminar.
--   quitar_ronda_no_evaluada(ronda)        solo admin; se niega si la planta ya empezó la ronda siguiente.
--   evaluaciones_validar_ronda_no_evaluada (trigger) una ronda marcada no recibe evaluaciones nuevas.
--   validar_ronda_anterior_cerrada (R3)    la ronda N cuenta como cerrada también si está marcada «No evaluada».
--   obtener_planilla_ronda                 estado «no_evaluada» por fila y en el avance; cada fila trae «anterior»
--                                          (el estado de su ronda N-1) para la sección «Pendientes de la ronda anterior».
--   estado_operativo_cruce, obtener_dashboard_cientifico   una planta «No evaluada» deja de contarse como pendiente.
-- Las firmas, el lenguaje, la volatilidad, la seguridad, el dueño, los permisos y los comentarios de las cuatro
-- funciones existentes no cambian (create or replace). La app anterior no conoce el estado «no_evaluada», pero solo la
-- app nueva puede marcar una ronda.
-- Rollback: docs/fase5/rollback/55_no_evaluada.sql (se niega si ya hay rondas marcadas).
-- =============================================================================

alter table public.ronda_evaluacion_anual
  add column no_evaluada_motivo text,
  add column no_evaluada_detalle text,
  add column no_evaluada_por uuid references public.perfiles(id) on delete set null,
  add column no_evaluada_en timestamptz,
  add constraint ronda_no_evaluada_motivo_check check (no_evaluada_motivo in ('no_alcanzo', 'sin_fruto', 'otro')),
  add constraint ronda_no_evaluada_coherente_check check (
    (no_evaluada_motivo is null and no_evaluada_detalle is null and no_evaluada_en is null)
    or (no_evaluada_motivo is not null and no_evaluada_en is not null
        and (no_evaluada_motivo <> 'otro' or length(btrim(coalesce(no_evaluada_detalle, ''))) > 0)
        and length(coalesce(no_evaluada_detalle, '')) <= 300)
  );

comment on column public.ronda_evaluacion_anual.no_evaluada_motivo is
  'Fase 5 (G3): la planta quedó «No evaluada en esta ronda»: no_alcanzo, sin_fruto u otro (con detalle). Nulo = no marcada.';

grant select (no_evaluada_motivo, no_evaluada_detalle, no_evaluada_por, no_evaluada_en) on public.ronda_evaluacion_anual to authenticated;

create function public.marcar_ronda_no_evaluada(p_ronda_id uuid, p_motivo text, p_detalle text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ronda record;
  v_detalle text := nullif(btrim(coalesce(p_detalle, '')), '');
begin
  if not es_admin() then
    raise exception 'Solo un admin puede marcar una ronda como «No evaluada».' using errcode = '42501';
  end if;
  if p_motivo is null or p_motivo not in ('no_alcanzo', 'sin_fruto', 'otro') then
    raise exception 'Elige el motivo: No alcanzó, Sin fruto u Otro.' using errcode = '22023';
  end if;
  if p_motivo = 'otro' and v_detalle is null then
    raise exception 'Con «Otro», escribe el motivo.' using errcode = '22023';
  end if;
  if length(coalesce(v_detalle, '')) > 300 then
    raise exception 'El motivo puede tener hasta 300 caracteres.' using errcode = '22023';
  end if;

  select r.id, r.numero_ronda, r.tipo_ronda, r.no_evaluada_motivo, i.id as individuo_id, i.estado_vital, i.planta_id, p.estado, p.eliminado_at
    into v_ronda
  from ronda_evaluacion_anual r
  join individuos i on i.id = r.individuo_id
  join plantas p on p.id = i.planta_id
  where r.id = p_ronda_id
  for update of r;
  if not found then
    raise exception 'La ronda no existe.' using errcode = 'P0002';
  end if;
  if v_ronda.eliminado_at is not null then
    raise exception 'El cruce está archivado.' using errcode = '23514';
  end if;
  if v_ronda.estado_vital <> 'vivo' then
    raise exception 'La planta está dada de baja.' using errcode = '23514';
  end if;
  if v_ronda.no_evaluada_motivo is not null then
    raise exception 'Esta ronda ya está marcada como «No evaluada».' using errcode = '23514';
  end if;
  if exists (select 1 from evaluaciones e where e.ronda_id = p_ronda_id and e.estado in ('completa', 'corregida')) then
    raise exception 'Esta ronda ya tiene una evaluación cerrada: no se puede marcar como «No evaluada».' using errcode = '23514';
  end if;
  if exists (select 1 from evaluaciones e where e.ronda_id = p_ronda_id and e.estado = 'borrador') then
    raise exception 'Esta ronda tiene un borrador sin terminar: termínalo o descártalo antes de marcarla como «No evaluada».' using errcode = '23514';
  end if;

  update ronda_evaluacion_anual
     set no_evaluada_motivo = p_motivo, no_evaluada_detalle = v_detalle, no_evaluada_por = auth.uid(), no_evaluada_en = now()
   where id = p_ronda_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (auth.uid(), v_ronda.planta_id, 'ronda_no_evaluada', array['no_evaluada_motivo'],
          jsonb_build_object('ronda_id', p_ronda_id, 'individuo_id', v_ronda.individuo_id, 'numero_ronda', v_ronda.numero_ronda,
                             'tipo_ronda', v_ronda.tipo_ronda, 'motivo', p_motivo, 'detalle', v_detalle));
end;
$$;
comment on function public.marcar_ronda_no_evaluada(uuid, text, text) is
  'Fase 5 (G3): marca la ronda de una planta como «No evaluada en esta ronda» con motivo; cuenta como cerrada para abrir la siguiente y deja de ser pendiente. Solo admin. Audita «ronda_no_evaluada».';
revoke all on function public.marcar_ronda_no_evaluada(uuid, text, text) from public, anon;
grant execute on function public.marcar_ronda_no_evaluada(uuid, text, text) to authenticated;

create function public.quitar_ronda_no_evaluada(p_ronda_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ronda record;
begin
  if not es_admin() then
    raise exception 'Solo un admin puede quitar la marca «No evaluada».' using errcode = '42501';
  end if;
  select r.id, r.individuo_id, r.numero_ronda, r.tipo_ronda, r.no_evaluada_motivo, i.planta_id
    into v_ronda
  from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id
  where r.id = p_ronda_id
  for update of r;
  if not found then
    raise exception 'La ronda no existe.' using errcode = 'P0002';
  end if;
  if v_ronda.no_evaluada_motivo is null then
    raise exception 'Esta ronda no está marcada como «No evaluada».' using errcode = '23514';
  end if;
  if exists (select 1 from ronda_evaluacion_anual r where r.individuo_id = v_ronda.individuo_id and r.tipo_ronda = v_ronda.tipo_ronda and r.numero_ronda > v_ronda.numero_ronda) then
    raise exception 'La planta ya empezó la ronda siguiente: la marca «No evaluada» ya no se puede quitar.' using errcode = '23514';
  end if;

  update ronda_evaluacion_anual
     set no_evaluada_motivo = null, no_evaluada_detalle = null, no_evaluada_por = null, no_evaluada_en = null
   where id = p_ronda_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (auth.uid(), v_ronda.planta_id, 'ronda_no_evaluada_quitada', array['no_evaluada_motivo'],
          jsonb_build_object('ronda_id', p_ronda_id, 'individuo_id', v_ronda.individuo_id, 'numero_ronda', v_ronda.numero_ronda,
                             'tipo_ronda', v_ronda.tipo_ronda, 'motivo_anterior', v_ronda.no_evaluada_motivo));
end;
$$;
comment on function public.quitar_ronda_no_evaluada(uuid) is
  'Fase 5 (G3): quita la marca «No evaluada» de una ronda si la planta no empezó la siguiente. Solo admin. Audita «ronda_no_evaluada_quitada».';
revoke all on function public.quitar_ronda_no_evaluada(uuid) from public, anon;
grant execute on function public.quitar_ronda_no_evaluada(uuid) to authenticated;

create function public.validar_ronda_no_evaluada()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if exists (select 1 from public.ronda_evaluacion_anual r where r.id = new.ronda_id and r.no_evaluada_motivo is not null) then
    raise exception 'Esta ronda quedó como «No evaluada» para esta planta. Quita esa marca antes de evaluarla.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_ronda_no_evaluada() from public, anon, authenticated;
comment on function public.validar_ronda_no_evaluada() is
  'Fase 5 (G3): una ronda marcada «No evaluada» no recibe evaluaciones nuevas.';
create trigger evaluaciones_validar_ronda_no_evaluada before insert on public.evaluaciones
for each row execute function public.validar_ronda_no_evaluada();

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
  ) and not exists (
    -- Fase 5 (G3): la ronda N marcada «No evaluada» también cuenta como cerrada.
    select 1
    from public.ronda_evaluacion_anual r
    where r.individuo_id = new.individuo_id
      and r.tipo_ronda = new.tipo_ronda
      and r.numero_ronda = new.numero_ronda - 1
      and r.no_evaluada_motivo is not null
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
    select r.individuo_id, r.id as ronda_id, r.no_evaluada_motivo, r.no_evaluada_detalle
    from ronda_evaluacion_anual r
    join vivos v on v.id = r.individuo_id
    where r.tipo_ronda = p_tipo_ronda and r.numero_ronda = v_numero
  ), anterior as (
    -- Fase 5 (G3): estado de la ronda N-1 de cada planta, para «Pendientes de la ronda anterior».
    select r.individuo_id, r.id as ronda_id,
      case
        when exists (select 1 from evaluaciones e where e.ronda_id = r.id and e.estado in ('completa', 'corregida')) then 'completa'
        when r.no_evaluada_motivo is not null then 'no_evaluada'
        when exists (select 1 from evaluaciones e where e.ronda_id = r.id and e.estado = 'borrador') then 'borrador'
        else 'sin_iniciar'
      end as estado
    from ronda_evaluacion_anual r
    join vivos v on v.id = r.individuo_id
    where v_numero > 1 and r.tipo_ronda = p_tipo_ronda and r.numero_ronda = v_numero - 1
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
        when e.id is null and ro.no_evaluada_motivo is not null then 'no_evaluada'
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
      coalesce(b.mio, false) as borrador_mio,
      case when ro.no_evaluada_motivo is not null then jsonb_build_object('motivo', ro.no_evaluada_motivo, 'detalle', ro.no_evaluada_detalle) end as no_evaluada,
      case when an.ronda_id is not null then jsonb_build_object('ronda_id', an.ronda_id, 'numero', v_numero - 1, 'estado', an.estado) end as anterior
    from vivos v
    left join rondas ro on ro.individuo_id = v.id
    left join anterior an on an.individuo_id = v.id
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
      'no_evaluada', (select count(*) from filas where estado = 'no_evaluada'),
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
        'hay_borrador', f.hay_borrador, 'borrador_mio', f.borrador_mio,
        'no_evaluada', f.no_evaluada, 'anterior', f.anterior
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
  ), no_evaluadas as (
    -- Fase 5 (G3): plantas vivas marcadas «No evaluada» en la ronda actual: no son pendientes.
    select count(*)::integer as n
    from cruce c
    cross join ronda ra
    join individuos i on i.planta_id = c.id and i.estado_vital = 'vivo'
    where exists (
      select 1 from ronda_evaluacion_anual r
      where r.individuo_id = i.id and r.tipo_ronda = c.tipo and r.numero_ronda = ra.numero and r.no_evaluada_motivo is not null
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
    case when c.en_evaluacion then v.n - coalesce(ce.n, 0) - coalesce(ne.n, 0) else 0 end,
    a.fecha,
    a.usuario_id
  from cruce c
  cross join vivos v
  left join ronda ra on true
  left join cerradas ce on true
  left join no_evaluadas ne on true
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
      -- Fase 5 (G3): una planta marcada «No evaluada» en esa ronda tampoco es pendiente.
      and not exists (
        select 1
        from ronda_evaluacion_anual r
        where r.individuo_id = i.id and r.tipo_ronda = t.tipo and r.numero_ronda = ra.numero
          and r.no_evaluada_motivo is not null
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
