-- Sprint 4: procedimientos operativos con objetivos múltiples y responsable
-- reasignable. `procedimiento_cultivo` se conserva como registro legacy de
-- procedimientos simples a nivel de cruce.

create type estado_procedimiento as enum ('planificado', 'en_curso', 'completado', 'cancelado');
create type tipo_objetivo_procedimiento as enum ('cruzamiento', 'predio', 'individuo');

create table procedimientos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null check (btrim(nombre) <> ''),
  tipo            text not null check (btrim(tipo) <> ''),
  estado          estado_procedimiento not null default 'planificado',
  fecha_inicio    date not null,
  fecha_fin       date,
  notas           text,
  responsable_id  uuid not null references perfiles (id) on delete restrict,
  created_by      uuid not null references perfiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

create table procedimiento_objetivos (
  id                 uuid primary key default gen_random_uuid(),
  procedimiento_id   uuid not null references procedimientos (id) on delete restrict,
  tipo               tipo_objetivo_procedimiento not null,
  planta_id          uuid references plantas (id) on delete restrict,
  predio_id          uuid references predio (id) on delete restrict,
  individuo_id       uuid references individuos (id) on delete restrict,
  created_at         timestamptz not null default now(),
  check (
    (tipo = 'cruzamiento' and planta_id is not null and predio_id is null and individuo_id is null)
    or (tipo = 'predio' and predio_id is not null and planta_id is null and individuo_id is null)
    or (tipo = 'individuo' and individuo_id is not null and planta_id is null and predio_id is null)
  ),
  unique (procedimiento_id, tipo, planta_id),
  unique (procedimiento_id, tipo, predio_id),
  unique (procedimiento_id, tipo, individuo_id)
);

create table procedimiento_insumos (
  id                 uuid primary key default gen_random_uuid(),
  procedimiento_id   uuid not null references procedimientos (id) on delete restrict,
  insumo_id          uuid not null references insumo (id) on delete restrict,
  cantidad           numeric not null check (cantidad > 0),
  unidad             text,
  unique (procedimiento_id, insumo_id)
);

create table procedimiento_reasignaciones (
  id                 uuid primary key default gen_random_uuid(),
  procedimiento_id   uuid not null references procedimientos (id) on delete restrict,
  responsable_anterior_id uuid not null references perfiles (id) on delete restrict,
  responsable_nuevo_id    uuid not null references perfiles (id) on delete restrict,
  reasignado_por_id  uuid not null references perfiles (id) on delete restrict,
  motivo             text,
  created_at         timestamptz not null default now(),
  check (responsable_anterior_id <> responsable_nuevo_id)
);

create index idx_procedimientos_responsable_estado on procedimientos (responsable_id, estado, fecha_inicio desc);
create index idx_procedimiento_objetivos_procedimiento on procedimiento_objetivos (procedimiento_id);
create index idx_procedimiento_objetivos_predio on procedimiento_objetivos (predio_id) where predio_id is not null;
create index idx_procedimiento_objetivos_individuo on procedimiento_objetivos (individuo_id) where individuo_id is not null;

comment on table procedimientos is
  'Entidad operativa con responsable, estado y objetivos múltiples. No reemplaza ni modifica el archivo legacy procedimiento_cultivo.';
comment on table procedimiento_objetivos is
  'Objetivos estructurados: cruzamiento, predio o individuo. Un procedimiento por predio exige contexto multisitio real del cruzamiento objetivo.';
comment on table procedimiento_reasignaciones is
  'Historial append-only de transferencias de responsable, solo iniciadas por admin.';

alter table procedimientos enable row level security;
alter table procedimiento_objetivos enable row level security;
alter table procedimiento_insumos enable row level security;
alter table procedimiento_reasignaciones enable row level security;

create policy procedimientos_select_autenticados on procedimientos
  for select using (auth.uid() is not null);
create policy procedimientos_update_responsable_temprano_o_admin on procedimientos
  for update
  using (es_admin() or (responsable_id = auth.uid() and estado in ('planificado', 'en_curso')))
  with check (es_admin() or (responsable_id = auth.uid() and estado in ('planificado', 'en_curso')));

create policy procedimiento_objetivos_select_autenticados on procedimiento_objetivos
  for select using (auth.uid() is not null);
create policy procedimiento_insumos_select_autenticados on procedimiento_insumos
  for select using (auth.uid() is not null);
create policy procedimiento_reasignaciones_select_admin on procedimiento_reasignaciones
  for select using (es_admin());

grant select, update on procedimientos to authenticated;
grant select on procedimiento_objetivos, procedimiento_insumos, procedimiento_reasignaciones to authenticated;
grant all on procedimientos, procedimiento_objetivos, procedimiento_insumos, procedimiento_reasignaciones to service_role;

create or replace function procedimiento_planta_auditable(p_procedimiento_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select planta_id from procedimiento_objetivos where procedimiento_id = p_procedimiento_id and tipo = 'cruzamiento' limit 1),
    (select i.planta_id from procedimiento_objetivos o join individuos i on i.id = o.individuo_id where o.procedimiento_id = p_procedimiento_id and o.tipo = 'individuo' limit 1)
  )
$$;

create or replace function reemplazar_objetivos_procedimiento(
  p_procedimiento_id uuid,
  p_objetivos jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_objetivo jsonb;
  v_tipo tipo_objetivo_procedimiento;
  v_id uuid;
  v_planta_contexto uuid;
  v_predio_id uuid;
  v_predios_activos integer;
begin
  if jsonb_typeof(p_objetivos) <> 'array' or jsonb_array_length(p_objetivos) = 0 then
    raise exception 'El procedimiento requiere al menos un objetivo' using errcode = '23514';
  end if;

  delete from procedimiento_objetivos where procedimiento_id = p_procedimiento_id;

  for v_objetivo in select value from jsonb_array_elements(p_objetivos)
  loop
    v_tipo := (v_objetivo ->> 'tipo')::tipo_objetivo_procedimiento;
    v_id := (v_objetivo ->> 'id')::uuid;

    if v_tipo = 'cruzamiento' then
      perform 1 from plantas where id = v_id and eliminado_at is null;
      if not found then raise exception 'Cruce objetivo no encontrado' using errcode = '23503'; end if;
      insert into procedimiento_objetivos (procedimiento_id, tipo, planta_id)
      values (p_procedimiento_id, v_tipo, v_id);
    elsif v_tipo = 'predio' then
      perform 1 from predio where id = v_id and activo;
      if not found then raise exception 'Predio objetivo no encontrado o inactivo' using errcode = '23503'; end if;
      insert into procedimiento_objetivos (procedimiento_id, tipo, predio_id)
      values (p_procedimiento_id, v_tipo, v_id);
    else
      perform 1 from individuos where id = v_id;
      if not found then raise exception 'Individuo objetivo no encontrado' using errcode = '23503'; end if;
      insert into procedimiento_objetivos (procedimiento_id, tipo, individuo_id)
      values (p_procedimiento_id, v_tipo, v_id);
    end if;
  end loop;

  if exists (select 1 from procedimiento_objetivos where procedimiento_id = p_procedimiento_id and tipo = 'predio') then
    select planta_id into v_planta_contexto
    from procedimiento_objetivos
    where procedimiento_id = p_procedimiento_id and tipo = 'cruzamiento'
    limit 1;
    if v_planta_contexto is null
       or (select count(*) from procedimiento_objetivos where procedimiento_id = p_procedimiento_id and tipo = 'cruzamiento') <> 1 then
      raise exception 'Un procedimiento por predio requiere exactamente un cruce objetivo' using errcode = '23514';
    end if;

    select count(distinct s.predio_id) into v_predios_activos
    from emplazamiento_individuo e
    join individuos i on i.id = e.individuo_id
    join sector s on s.id = e.sector_id
    where i.planta_id = v_planta_contexto and e.fecha_fin is null;
    if v_predios_activos < 2 then
      raise exception 'El procedimiento por predio requiere un contexto multisitio real' using errcode = '23514';
    end if;

    for v_predio_id in
      select predio_id from procedimiento_objetivos
      where procedimiento_id = p_procedimiento_id and tipo = 'predio'
    loop
      perform 1
      from emplazamiento_individuo e
      join individuos i on i.id = e.individuo_id
      join sector s on s.id = e.sector_id
      where i.planta_id = v_planta_contexto
        and s.predio_id = v_predio_id
        and e.fecha_fin is null;
      if not found then
        raise exception 'El predio objetivo no tiene individuos activos de ese cruce' using errcode = '23514';
      end if;
    end loop;
  end if;
end;
$$;

create or replace function reemplazar_insumos_procedimiento(
  p_procedimiento_id uuid,
  p_insumos jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insumo jsonb;
begin
  if p_insumos is null then p_insumos := '[]'::jsonb; end if;
  if jsonb_typeof(p_insumos) <> 'array' then
    raise exception 'Los insumos deben ser una lista' using errcode = '22023';
  end if;
  delete from procedimiento_insumos where procedimiento_id = p_procedimiento_id;
  for v_insumo in select value from jsonb_array_elements(p_insumos)
  loop
    insert into procedimiento_insumos (procedimiento_id, insumo_id, cantidad, unidad)
    values (
      p_procedimiento_id,
      (v_insumo ->> 'insumo_id')::uuid,
      (v_insumo ->> 'cantidad')::numeric,
      nullif(btrim(v_insumo ->> 'unidad'), '')
    );
  end loop;
end;
$$;

create or replace function crear_procedimiento(
  p_nombre text,
  p_tipo text,
  p_fecha_inicio date,
  p_fecha_fin date default null,
  p_notas text default null,
  p_objetivos jsonb default '[]'::jsonb,
  p_insumos jsonb default '[]'::jsonb,
  p_responsable_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_responsable uuid;
  v_id uuid;
  v_planta_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if coalesce(btrim(p_nombre), '') = '' or coalesce(btrim(p_tipo), '') = '' or p_fecha_inicio is null then
    raise exception 'Nombre, tipo y fecha de inicio son obligatorios' using errcode = '23514';
  end if;
  if p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha de término no puede anteceder al inicio' using errcode = '22007';
  end if;
  if p_responsable_id is not null and p_responsable_id <> v_uid and not es_admin() then
    raise exception 'Solo admin puede asignar un responsable distinto al creador' using errcode = '42501';
  end if;
  v_responsable := coalesce(p_responsable_id, v_uid);
  perform 1 from perfiles where id = v_responsable;
  if not found then raise exception 'Responsable no encontrado' using errcode = '23503'; end if;

  insert into procedimientos (nombre, tipo, fecha_inicio, fecha_fin, notas, responsable_id, created_by)
  values (btrim(p_nombre), btrim(p_tipo), p_fecha_inicio, p_fecha_fin, nullif(btrim(p_notas), ''), v_responsable, v_uid)
  returning id into v_id;
  perform reemplazar_objetivos_procedimiento(v_id, p_objetivos);
  perform reemplazar_insumos_procedimiento(v_id, p_insumos);
  v_planta_id := procedimiento_planta_auditable(v_id);

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, v_planta_id, 'creacion_procedimiento', array['tipo', 'estado', 'responsable_id'],
    jsonb_build_object('procedimiento_id', v_id, 'responsable_id', v_responsable));
  return v_id;
end;
$$;

create or replace function actualizar_procedimiento(
  p_procedimiento_id uuid,
  p_nombre text,
  p_tipo text,
  p_estado estado_procedimiento,
  p_fecha_inicio date,
  p_fecha_fin date default null,
  p_notas text default null,
  p_objetivos jsonb default '[]'::jsonb,
  p_insumos jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_procedimiento procedimientos%rowtype;
  v_planta_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  select * into v_procedimiento from procedimientos where id = p_procedimiento_id for update;
  if not found then raise exception 'Procedimiento no encontrado' using errcode = 'P0002'; end if;
  if not es_admin() and (v_procedimiento.responsable_id <> v_uid or v_procedimiento.estado not in ('planificado', 'en_curso')) then
    raise exception 'Solo el responsable puede editar un procedimiento temprano' using errcode = '42501';
  end if;
  if not es_admin() and p_estado not in ('planificado', 'en_curso') then
    raise exception 'Solo admin puede cerrar o cancelar un procedimiento' using errcode = '42501';
  end if;
  if coalesce(btrim(p_nombre), '') = '' or coalesce(btrim(p_tipo), '') = '' or p_fecha_inicio is null
     or (p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio) then
    raise exception 'Datos de procedimiento inválidos' using errcode = '23514';
  end if;

  update procedimientos
  set nombre = btrim(p_nombre), tipo = btrim(p_tipo), estado = p_estado,
      fecha_inicio = p_fecha_inicio, fecha_fin = p_fecha_fin,
      notas = nullif(btrim(p_notas), ''), updated_at = now()
  where id = p_procedimiento_id;
  perform reemplazar_objetivos_procedimiento(p_procedimiento_id, p_objetivos);
  perform reemplazar_insumos_procedimiento(p_procedimiento_id, p_insumos);
  v_planta_id := procedimiento_planta_auditable(p_procedimiento_id);

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, v_planta_id, 'edicion_procedimiento', array['nombre', 'tipo', 'estado'],
    jsonb_build_object('procedimiento_id', p_procedimiento_id));
end;
$$;

create or replace function reasignar_procedimiento(
  p_procedimiento_id uuid,
  p_responsable_nuevo_id uuid,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_anterior uuid;
  v_planta_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if not es_admin() then raise exception 'Solo admin puede reasignar procedimientos' using errcode = '42501'; end if;
  select responsable_id into v_anterior from procedimientos where id = p_procedimiento_id for update;
  if not found then raise exception 'Procedimiento no encontrado' using errcode = 'P0002'; end if;
  if v_anterior = p_responsable_nuevo_id then raise exception 'El responsable ya está asignado' using errcode = '23514'; end if;
  perform 1 from perfiles where id = p_responsable_nuevo_id;
  if not found then raise exception 'Nuevo responsable no encontrado' using errcode = '23503'; end if;

  update procedimientos set responsable_id = p_responsable_nuevo_id, updated_at = now()
  where id = p_procedimiento_id;
  insert into procedimiento_reasignaciones (
    procedimiento_id, responsable_anterior_id, responsable_nuevo_id, reasignado_por_id, motivo
  ) values (
    p_procedimiento_id, v_anterior, p_responsable_nuevo_id, v_uid, nullif(btrim(p_motivo), '')
  );
  v_planta_id := procedimiento_planta_auditable(p_procedimiento_id);
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, v_planta_id, 'reasignacion_procedimiento', array['responsable_id'],
    jsonb_build_object('procedimiento_id', p_procedimiento_id, 'de_responsable_id', v_anterior, 'a_responsable_id', p_responsable_nuevo_id));
end;
$$;

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
  order by i.codigo_display;
end;
$$;

revoke all on function crear_procedimiento(text, text, date, date, text, jsonb, jsonb, uuid) from public, anon;
revoke all on function actualizar_procedimiento(uuid, text, text, estado_procedimiento, date, date, text, jsonb, jsonb) from public, anon;
revoke all on function reasignar_procedimiento(uuid, uuid, text) from public, anon;
revoke all on function listar_individuos_procedimiento_predio(uuid, uuid) from public, anon;
grant execute on function crear_procedimiento(text, text, date, date, text, jsonb, jsonb, uuid) to authenticated, service_role;
grant execute on function actualizar_procedimiento(uuid, text, text, estado_procedimiento, date, date, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function reasignar_procedimiento(uuid, uuid, text) to authenticated, service_role;
grant execute on function listar_individuos_procedimiento_predio(uuid, uuid) to authenticated, service_role;

