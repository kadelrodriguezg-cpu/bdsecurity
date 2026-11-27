-- =============================================================================
-- Sprint 3: jerarquía territorial e historial append-only de emplazamientos.
--
-- Compatibilidad:
-- - `predio`, `plantas.predio_id` y `multisitio` se conservan sin borrar datos.
-- - Los predios existentes se adscriben a un sitio neutro de compatibilidad.
-- - Los registros legacy de multisitio con predio se copian al historial nuevo.
-- - La ubicación exacta vive en una tabla separada con lectura solo admin.
-- =============================================================================

create table sitio (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (btrim(nombre) <> ''),
  activo      boolean not null default true,
  created_by  uuid references perfiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (nombre)
);

comment on table sitio is
  'Nivel territorial superior. Los nombres deben ser operativos y nunca describir genética, variedades ni linaje.';

insert into sitio (nombre)
values ('Sitio legado sin clasificar')
on conflict (nombre) do nothing;

alter table predio add column sitio_id uuid;

update predio
set sitio_id = (select id from sitio where nombre = 'Sitio legado sin clasificar')
where sitio_id is null;

alter table predio
  alter column sitio_id set not null,
  add constraint predio_sitio_id_fkey
    foreign key (sitio_id) references sitio (id) on delete restrict;

create index idx_predio_sitio on predio (sitio_id, activo, nombre);

comment on column predio.sitio_id is
  'Sitio territorial al que pertenece el predio. Los registros anteriores se adscriben al sitio neutro de compatibilidad.';

create table sector (
  id          uuid primary key default gen_random_uuid(),
  predio_id   uuid not null references predio (id) on delete restrict,
  nombre      text not null check (btrim(nombre) <> ''),
  activo      boolean not null default true,
  created_by  uuid references perfiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (predio_id, nombre)
);

comment on table sector is
  'Subdivisión operativa de un predio. El nombre no debe contener información genética o de linaje.';

insert into sector (predio_id, nombre)
select p.id, 'Sector legado sin clasificar'
from predio p
on conflict (predio_id, nombre) do nothing;

create table emplazamiento_individuo (
  id                    uuid primary key default gen_random_uuid(),
  individuo_id          uuid not null references individuos (id) on delete restrict,
  sector_id             uuid not null references sector (id) on delete restrict,
  fecha_inicio          date not null,
  fecha_fin             date,
  referencia_operativa  text,
  created_by            uuid references perfiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

create unique index emplazamiento_individuo_un_activo
  on emplazamiento_individuo (individuo_id)
  where fecha_fin is null;

create index idx_emplazamiento_individuo_historial
  on emplazamiento_individuo (individuo_id, fecha_inicio desc, created_at desc);

create index idx_emplazamiento_sector_activo
  on emplazamiento_individuo (sector_id, individuo_id)
  where fecha_fin is null;

comment on table emplazamiento_individuo is
  'Historial territorial append-only. Trasladar cierra el registro activo y crea otro; nunca se reutiliza una fila anterior.';
comment on column emplazamiento_individuo.referencia_operativa is
  'Referencia agregada apta para operarios. No almacenar aquí coordenadas ni indicaciones exactas.';

create table emplazamiento_coordenada (
  emplazamiento_id   uuid primary key references emplazamiento_individuo (id) on delete restrict,
  latitud            numeric,
  longitud           numeric,
  precision_metros   numeric,
  ubicacion_exacta   text,
  created_by         uuid references perfiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  check ((latitud is null) = (longitud is null)),
  check (latitud is null or latitud between -90 and 90),
  check (longitud is null or longitud between -180 and 180),
  check (precision_metros is null or precision_metros > 0),
  check (latitud is not null or nullif(btrim(ubicacion_exacta), '') is not null)
);

comment on table emplazamiento_coordenada is
  'Ubicación territorial exacta separada por mínimo privilegio. Solo admin puede leerla; nunca se expone en consultas operativas.';

-- Backfill no destructivo desde el registro mutable legacy. Los registros sin
-- predio no se inventan: permanecen en `multisitio` hasta poder clasificarlos.
insert into emplazamiento_individuo (
  individuo_id, sector_id, fecha_inicio, referencia_operativa,
  created_by, created_at
)
select
  m.individuo_id,
  s.id,
  coalesce(m.fecha_traslado, m.created_at::date),
  nullif(btrim(concat_ws(' · ', m.destino, m.observaciones)), ''),
  m.created_by,
  m.created_at
from multisitio m
join sector s
  on s.predio_id = m.predio_id
 and s.nombre = 'Sector legado sin clasificar'
where m.predio_id is not null
  and not exists (
    select 1
    from emplazamiento_individuo e
    where e.individuo_id = m.individuo_id
  );

create or replace function validar_cierre_emplazamiento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.fecha_fin is not null
     or new.fecha_fin is null
     or new.fecha_fin < old.fecha_inicio
     or new.id is distinct from old.id
     or new.individuo_id is distinct from old.individuo_id
     or new.sector_id is distinct from old.sector_id
     or new.fecha_inicio is distinct from old.fecha_inicio
     or new.referencia_operativa is distinct from old.referencia_operativa
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'El historial de emplazamientos es append-only; solo puede cerrarse el registro activo'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function bloquear_borrado_emplazamiento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Los emplazamientos no se eliminan' using errcode = '55000';
end;
$$;

create trigger trg_emplazamiento_solo_cierre
  before update on emplazamiento_individuo
  for each row execute function validar_cierre_emplazamiento();

create trigger trg_emplazamiento_sin_borrado
  before delete on emplazamiento_individuo
  for each row execute function bloquear_borrado_emplazamiento();

alter table sitio enable row level security;
alter table sector enable row level security;
alter table emplazamiento_individuo enable row level security;
alter table emplazamiento_coordenada enable row level security;

create policy sitio_select_autenticados on sitio
  for select using (auth.uid() is not null);
create policy sitio_admin_inserta on sitio
  for insert with check (es_admin());
create policy sitio_admin_actualiza on sitio
  for update using (es_admin()) with check (es_admin());

create policy sector_select_autenticados on sector
  for select using (auth.uid() is not null);
create policy sector_admin_inserta on sector
  for insert with check (es_admin());
create policy sector_admin_actualiza on sector
  for update using (es_admin()) with check (es_admin());

create policy emplazamiento_select_autenticados on emplazamiento_individuo
  for select using (auth.uid() is not null);

create policy emplazamiento_coordenada_select_admin on emplazamiento_coordenada
  for select using (es_admin());

grant select, insert, update on sitio, sector to authenticated;
grant select on emplazamiento_individuo, emplazamiento_coordenada to authenticated;
grant all on sitio, sector, emplazamiento_individuo, emplazamiento_coordenada to service_role;

create or replace function registrar_traslado_individuo(
  p_individuo_id uuid,
  p_sector_id uuid,
  p_fecha_inicio date,
  p_referencia_operativa text default null,
  p_latitud numeric default null,
  p_longitud numeric default null,
  p_precision_metros numeric default null,
  p_ubicacion_exacta text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_planta_id uuid;
  v_estado_vital estado_vital;
  v_anterior emplazamiento_individuo%rowtype;
  v_nuevo_id uuid;
  v_predio_id uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede registrar traslados territoriales'
      using errcode = '42501';
  end if;
  if p_fecha_inicio is null then
    raise exception 'La fecha de inicio es obligatoria' using errcode = '23502';
  end if;

  select i.planta_id, i.estado_vital
    into v_planta_id, v_estado_vital
  from individuos i
  where i.id = p_individuo_id;
  if not found then
    raise exception 'Individuo no encontrado' using errcode = 'P0002';
  end if;
  if v_estado_vital <> 'vivo' then
    raise exception 'No se puede trasladar un individuo que no está vivo'
      using errcode = '23514';
  end if;

  select s.predio_id into v_predio_id
  from sector s
  join predio p on p.id = s.predio_id and p.activo
  join sitio si on si.id = p.sitio_id and si.activo
  where s.id = p_sector_id and s.activo;
  if not found then
    raise exception 'El sector, predio o sitio no existe o está inactivo'
      using errcode = '23503';
  end if;

  select * into v_anterior
  from emplazamiento_individuo
  where individuo_id = p_individuo_id and fecha_fin is null
  for update;

  if found then
    if p_fecha_inicio < v_anterior.fecha_inicio then
      raise exception 'La fecha del traslado no puede anteceder al emplazamiento activo'
        using errcode = '22007';
    end if;
    update emplazamiento_individuo
    set fecha_fin = p_fecha_inicio
    where id = v_anterior.id;
  end if;

  insert into emplazamiento_individuo (
    individuo_id, sector_id, fecha_inicio, referencia_operativa, created_by
  ) values (
    p_individuo_id, p_sector_id, p_fecha_inicio,
    nullif(btrim(p_referencia_operativa), ''), v_uid
  ) returning id into v_nuevo_id;

  if p_latitud is not null
     or p_longitud is not null
     or p_precision_metros is not null
     or nullif(btrim(p_ubicacion_exacta), '') is not null then
    insert into emplazamiento_coordenada (
      emplazamiento_id, latitud, longitud, precision_metros,
      ubicacion_exacta, created_by
    ) values (
      v_nuevo_id, p_latitud, p_longitud, p_precision_metros,
      nullif(btrim(p_ubicacion_exacta), ''), v_uid
    );
  end if;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    v_planta_id,
    case when v_anterior.id is null then 'registro_emplazamiento' else 'traslado_individuo' end,
    array['individuo_id', 'sector_id', 'fecha_inicio', 'fecha_fin'],
    jsonb_build_object(
      'individuo_id', p_individuo_id,
      'emplazamiento_anterior_id', v_anterior.id,
      'sector_anterior_id', v_anterior.sector_id,
      'emplazamiento_nuevo_id', v_nuevo_id,
      'sector_nuevo_id', p_sector_id,
      'predio_nuevo_id', v_predio_id,
      'fecha_traslado', p_fecha_inicio
    )
  );

  return v_nuevo_id;
end;
$$;

revoke all on function registrar_traslado_individuo(uuid, uuid, date, text, numeric, numeric, numeric, text)
  from public, anon;
grant execute on function registrar_traslado_individuo(uuid, uuid, date, text, numeric, numeric, numeric, text)
  to authenticated, service_role;
