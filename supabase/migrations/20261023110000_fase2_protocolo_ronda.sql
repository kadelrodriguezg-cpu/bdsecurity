-- Fase 2, Sprint 1 — protocolo de ronda y 4 estados por descriptor.
--
-- El admin define qué se evalúa en la ronda N de un cruce: cada campo del
-- esquema de fase es «obligatorio», «opcional» o (ausente) «no se evalúa».
-- Cada definición es una versión nueva e inmutable. Cada evaluación queda
-- ligada a la versión vigente cuando se creó: protocolo congelado por
-- evaluación (si el protocolo cambia a mitad de ronda, lo ya guardado conserva
-- el anterior). Lo obligatorio que falta avisa y no bloquea: solo la regla de
-- frutos bloquea el cierre.
--
-- Estados por descriptor: medido (con valor) · falto (obligatorio en el
-- protocolo, sin valor) · no_evaluado (opcional sin valor, fuera del
-- protocolo, o evaluación sin protocolo y sin valor) · marcado (con valor fuera de los límites de revisión de su rango de
-- referencia).
--
-- De paso (revisión C3): A1-058, ronda_id y protocolo_id inmutables; A1-066,
-- los límites de revisión valen para todo campo numérico del esquema con rango
-- de referencia (hoy solo brix y calibre tienen rango: resultado idéntico).
-- Compatible con el frontend desplegado: no envía protocolo_id y el trigger lo
-- completa.

-- 1. Protocolo -------------------------------------------------------------

create table public.protocolo_ronda (
  id uuid primary key default gen_random_uuid(),
  planta_id uuid not null references public.plantas(id) on delete restrict,
  tipo_ronda public.tipo_ronda not null,
  numero_ronda smallint not null check (numero_ronda between 1 and 3),
  version integer not null check (version >= 1),
  nombre text not null check (btrim(nombre) <> ''),
  descriptores jsonb not null check (jsonb_typeof(descriptores) = 'object'),
  created_by uuid not null references public.perfiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (planta_id, tipo_ronda, numero_ronda, version)
);

alter table public.protocolo_ronda enable row level security;
create policy protocolo_ronda_select_autenticados on public.protocolo_ronda
  for select to authenticated using (auth.uid() is not null);
revoke all on public.protocolo_ronda from anon, authenticated;
grant select on public.protocolo_ronda to authenticated;

comment on table public.protocolo_ronda is
  'Fase 2: protocolo de una ronda de un cruce (clave del esquema de fase -> obligatorio | opcional; ausente = no se evalúa). Versiones inmutables; solo por definir_protocolo_ronda.';

create function public.proteger_protocolo_inmutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Un protocolo de ronda no se modifica ni se borra: define una versión nueva' using errcode = '55000';
end;
$$;
revoke all on function public.proteger_protocolo_inmutable() from public, anon, authenticated;
create trigger protocolo_ronda_inmutable before update or delete on public.protocolo_ronda
for each row execute function public.proteger_protocolo_inmutable();

create function public.validar_descriptores_protocolo(p_descriptores jsonb)
returns text
language sql
stable
set search_path = public
as $$
  -- null si es válido; si no, el motivo.
  select case
    when p_descriptores is null or jsonb_typeof(p_descriptores) <> 'object' then 'El protocolo debe ser un objeto clave -> obligatorio | opcional'
    when not exists (select 1 from jsonb_each_text(p_descriptores)) then 'El protocolo no incluye ningún descriptor'
    when exists (
      select 1 from jsonb_each(p_descriptores) d
      where jsonb_typeof(d.value) <> 'string' or d.value #>> '{}' not in ('obligatorio', 'opcional')
    ) then 'Cada descriptor del protocolo debe ser obligatorio u opcional'
    when exists (
      select 1 from jsonb_object_keys(p_descriptores) k
      where not exists (
        select 1 from esquema_fase_campo c
        where c.fase = 'evaluacion_anual' and c.clave = k and c.rol in ('descriptor', 'muestra')
      )
    ) then 'El protocolo incluye claves que no son descriptores del esquema: ' || (
      select string_agg(k, ', ' order by k) from jsonb_object_keys(p_descriptores) k
      where not exists (
        select 1 from esquema_fase_campo c
        where c.fase = 'evaluacion_anual' and c.clave = k and c.rol in ('descriptor', 'muestra')
      ))
    else null
  end;
$$;
revoke all on function public.validar_descriptores_protocolo(jsonb) from public, anon, authenticated;

create function public.definir_protocolo_ronda(
  p_planta_id uuid,
  p_tipo_ronda public.tipo_ronda,
  p_numero_ronda smallint,
  p_nombre text,
  p_descriptores jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_motivo text;
  v_version integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin define el protocolo de una ronda' using errcode = '42501';
  end if;
  if p_numero_ronda is null or p_numero_ronda not between 1 and 3 then
    raise exception 'Número de ronda inválido' using errcode = '22023';
  end if;
  if coalesce(btrim(p_nombre), '') = '' then
    raise exception 'El protocolo requiere nombre' using errcode = '23514';
  end if;
  if not exists (select 1 from plantas where id = p_planta_id and eliminado_at is null) then
    raise exception 'Cruce no encontrado o archivado' using errcode = 'P0002';
  end if;
  v_motivo := validar_descriptores_protocolo(p_descriptores);
  if v_motivo is not null then
    raise exception '%', v_motivo using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('protocolo:' || p_planta_id::text || ':' || p_tipo_ronda::text || ':' || p_numero_ronda::text, 0));
  select coalesce(max(version), 0) + 1 into v_version
  from protocolo_ronda
  where planta_id = p_planta_id and tipo_ronda = p_tipo_ronda and numero_ronda = p_numero_ronda;

  insert into protocolo_ronda (planta_id, tipo_ronda, numero_ronda, version, nombre, descriptores, created_by)
  values (p_planta_id, p_tipo_ronda, p_numero_ronda, v_version, btrim(p_nombre), p_descriptores, v_uid)
  returning id into v_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'definicion_protocolo_ronda', array['descriptores'],
    jsonb_build_object('protocolo_id', v_id, 'tipo_ronda', p_tipo_ronda, 'numero_ronda', p_numero_ronda,
      'version', v_version, 'nombre', btrim(p_nombre), 'descriptores', p_descriptores));

  return v_id;
end;
$$;
revoke all on function public.definir_protocolo_ronda(uuid, public.tipo_ronda, smallint, text, jsonb) from public, anon;
grant execute on function public.definir_protocolo_ronda(uuid, public.tipo_ronda, smallint, text, jsonb) to authenticated;

-- 2. Protocolo congelado por evaluación ------------------------------------

alter table public.evaluaciones
  add column protocolo_id uuid references public.protocolo_ronda(id) on delete restrict;
create index evaluaciones_protocolo_idx on public.evaluaciones (protocolo_id) where protocolo_id is not null;
comment on column public.evaluaciones.protocolo_id is
  'Fase 2: versión del protocolo vigente cuando se creó la evaluación (la fija un trigger; inmutable).';

create function public.congelar_protocolo_evaluacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planta uuid;
  v_tipo tipo_ronda;
  v_numero smallint;
begin
  if tg_op = 'UPDATE' then
    -- A1-058: una evaluación no cambia de ronda (ni de protocolo).
    if new.ronda_id is distinct from old.ronda_id then
      raise exception 'Una evaluación no se mueve a otra ronda' using errcode = '23514';
    end if;
    if new.protocolo_id is distinct from old.protocolo_id then
      raise exception 'El protocolo de una evaluación no cambia después de creada' using errcode = '23514';
    end if;
    return new;
  end if;

  select i.planta_id, r.tipo_ronda, r.numero_ronda into v_planta, v_tipo, v_numero
  from ronda_evaluacion_anual r
  join individuos i on i.id = r.individuo_id
  where r.id = new.ronda_id;

  if new.protocolo_id is null then
    select pr.id into new.protocolo_id
    from protocolo_ronda pr
    where pr.planta_id = v_planta and pr.tipo_ronda = v_tipo and pr.numero_ronda = v_numero
    order by pr.version desc
    limit 1;
  elsif not exists (
    select 1 from protocolo_ronda pr
    where pr.id = new.protocolo_id and pr.planta_id = v_planta and pr.tipo_ronda = v_tipo and pr.numero_ronda = v_numero
  ) then
    raise exception 'El protocolo no corresponde a la ronda de la evaluación' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.congelar_protocolo_evaluacion() from public, anon, authenticated;
create trigger evaluaciones_congelar_protocolo before insert or update on public.evaluaciones
for each row execute function public.congelar_protocolo_evaluacion();

-- 3. Límites de revisión para todo campo numérico del esquema (A1-066) -----

create function public.descriptores_fuera_de_revision(p_evaluacion public.evaluaciones)
returns text[]
language sql
stable
set search_path = public
as $$
  with especie as (
    select p.especie_id
    from ronda_evaluacion_anual r
    join individuos i on i.id = r.individuo_id
    join plantas p on p.id = i.planta_id
    where r.id = p_evaluacion.ronda_id
  ), rango as (
    select distinct on (rr.metrica) rr.*
    from rango_referencia rr
    where rr.activo
      and rr.metrica in (
        select c.clave from esquema_fase_campo c
        where c.fase = 'evaluacion_anual' and c.tipo in ('numero', 'entero') and c.rol in ('descriptor', 'muestra')
      )
      and (rr.especie_id = (select especie_id from especie) or rr.especie_id is null)
      and (rr.fase = 'evaluacion_anual' or rr.fase is null)
      and rr.vigente_desde <= p_evaluacion.fecha
      and (rr.vigente_hasta is null or rr.vigente_hasta >= p_evaluacion.fecha)
    order by rr.metrica, (rr.especie_id is not null) desc, (rr.fase is not null) desc, rr.vigente_desde desc, rr.created_at desc
  ), valores as (
    select r.metrica, r.limite_revision_inferior, r.limite_revision_superior,
      (to_jsonb(p_evaluacion) ->> r.metrica)::numeric as valor
    from rango r
  )
  select coalesce(array_agg(v.metrica order by v.metrica), '{}'::text[])
  from valores v
  where v.valor is not null
    and ((v.limite_revision_inferior is not null and v.valor <= v.limite_revision_inferior)
      or (v.limite_revision_superior is not null and v.valor >= v.limite_revision_superior));
$$;
revoke all on function public.descriptores_fuera_de_revision(public.evaluaciones) from public, anon;
grant execute on function public.descriptores_fuera_de_revision(public.evaluaciones) to authenticated;

create or replace function public.validar_evaluacion_integridad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fuente temporal unica: fecha efectiva.
  new.anio := extract(year from new.fecha)::integer;
  new.updated_at := now();

  if tg_op = 'INSERT' and new.estado in ('corregida', 'anulada') and not es_admin() then
    raise exception 'Solo un admin puede crear una correccion o anulacion' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if old.estado in ('completa', 'corregida', 'anulada') and not es_admin() then
      raise exception 'Solo un admin puede modificar una evaluacion cerrada' using errcode = '42501';
    end if;
    if new.estado in ('corregida', 'anulada')
       and new.estado is distinct from old.estado
       and not es_admin()
       and not (new.estado = 'anulada' and old.estado = 'borrador' and old.created_by = auth.uid()) then
      raise exception 'Solo un admin puede corregir o anular una evaluacion' using errcode = '42501';
    end if;
    if old.estado in ('completa', 'corregida')
       and new.estado = 'borrador'
       and not es_admin() then
      raise exception 'Solo un admin puede reabrir una evaluacion' using errcode = '42501';
    end if;
  end if;

  if new.estado in ('corregida', 'anulada')
     and coalesce(btrim(new.motivo_cambio), '') = '' then
    raise exception 'Una correccion o anulacion requiere motivo' using errcode = '23514';
  end if;

  -- Regla de frutos: solo con datos de fruta o de muestra (lista en esquema_fase_campo).
  if new.estado in ('completa', 'corregida') and evaluacion_exige_muestra(new) then
    if coalesce(new.cantidad_frutos, 0) <= 0 then
      raise exception 'Hay datos de fruta o de muestra: cantidad de frutos debe ser mayor que cero para finalizar. Si no se tomo muestra, marca Sin muestra de frutos'
        using errcode = '23514';
    end if;
    if coalesce(new.peso_total_g, 0) <= 0 then
      raise exception 'Hay datos de fruta o de muestra: peso total debe ser mayor que cero para finalizar. Si no se tomo muestra, marca Sin muestra de frutos'
        using errcode = '23514';
    end if;
  end if;

  -- Límites de revisión: todo campo numérico del esquema con rango (A1-066).
  new.requiere_revision := cardinality(descriptores_fuera_de_revision(new)) > 0;
  return new;
end;
$$;

-- 4. Estados por descriptor ------------------------------------------------

create function public.estados_descriptores(p_evaluacion public.evaluaciones)
returns jsonb
language sql
stable
set search_path = public
as $$
  with proto as (
    select pr.descriptores from protocolo_ronda pr where pr.id = p_evaluacion.protocolo_id
  ), marcados as (
    select descriptores_fuera_de_revision(p_evaluacion) as claves
  )
  select coalesce(jsonb_object_agg(c.clave,
    case
      when (to_jsonb(p_evaluacion) -> c.clave) is not null and (to_jsonb(p_evaluacion) -> c.clave) <> 'null'::jsonb then
        case when c.clave = any(m.claves) then 'marcado' else 'medido' end
      when exists (select 1 from proto where proto.descriptores ->> c.clave = 'obligatorio') then 'falto'
      else 'no_evaluado'
    end
    order by c.orden), '{}'::jsonb)
  from esquema_fase_campo c
  cross join marcados m
  where c.fase = 'evaluacion_anual' and c.rol in ('descriptor', 'muestra');
$$;
revoke all on function public.estados_descriptores(public.evaluaciones) from public, anon;
grant execute on function public.estados_descriptores(public.evaluaciones) to authenticated;
comment on function public.estados_descriptores(public.evaluaciones) is
  'Fase 2: estado de cada descriptor de la evaluación: medido | falto | no_evaluado | marcado (según su protocolo congelado y los límites de revisión).';

-- 5. Planilla de ronda -----------------------------------------------------

create function public.obtener_planilla_ronda(
  p_planta_id uuid,
  p_tipo_ronda public.tipo_ronda default 'anual',
  p_numero_ronda smallint default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
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
      case when e.id is not null then estados_descriptores(e) end as estados
    from vivos v
    left join rondas ro on ro.individuo_id = v.id
    left join elegida e on e.ronda_id = ro.ronda_id
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
      'completa', (select count(*) from filas where estado = 'completa')
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
          from jsonb_each(f.estados) x) end
      ) order by f.numero nulls last, f.codigo_display)
      from filas f), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;
revoke all on function public.obtener_planilla_ronda(uuid, public.tipo_ronda, smallint) from public, anon;
grant execute on function public.obtener_planilla_ronda(uuid, public.tipo_ronda, smallint) to authenticated;
comment on function public.obtener_planilla_ronda(uuid, public.tipo_ronda, smallint) is
  'Fase 2: planilla de la ronda de un cruce: protocolo vigente, avance (por evaluación cerrada, A1-144) y una fila por individuo vivo con el estado de cada descriptor. Recorrido por número de planta.';
