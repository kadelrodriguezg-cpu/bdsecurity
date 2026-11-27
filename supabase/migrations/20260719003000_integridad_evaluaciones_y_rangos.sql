-- =============================================================================
-- Sprint 1 / Bloques B-C-D: integridad de individuos y evaluaciones, y rangos
-- agronomicos configurables. No incluye scoring ni ranking (checkpoint).
--
-- Produccion no contiene aun estas tablas satelite. Esta migracion es aditiva
-- respecto del historial local para que la cadena completa pueda aplicarse sin
-- reescribir migraciones anteriores ni tocar datos reales de plantas.
-- =============================================================================

create type estado_evaluacion as enum ('borrador', 'completa', 'corregida', 'anulada');

-- La fecha de individualizacion pertenece a la identidad cientifica y no se
-- deduce de created_at. La FK al cruce y el codigo estable quedan inmutables.
alter table individuos
  add column fecha_individualizacion date not null default current_date;

create or replace function proteger_identidad_individuo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.planta_id is distinct from old.planta_id then
    raise exception 'El cruce de origen de un individuo es inmutable' using errcode = '23514';
  end if;
  if new.codigo_display is distinct from old.codigo_display then
    raise exception 'El codigo de un individuo es inmutable' using errcode = '23514';
  end if;
  if new.fecha_individualizacion is distinct from old.fecha_individualizacion then
    raise exception 'La fecha de individualizacion es inmutable' using errcode = '23514';
  end if;
  if new.clon_de_id = new.id then
    raise exception 'Un individuo no puede ser clon de si mismo' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_individuos_proteger_identidad
  before update on individuos
  for each row execute function proteger_identidad_individuo();

comment on column individuos.fecha_individualizacion is
  'Fecha efectiva en que la planta fisica recibe identidad individual. Inmutable.';

-- Los rangos agronomicos dejan de ser limites fisicos rigidos. Los checks
-- nuevos solo rechazan datos tecnicamente invalidos.
alter table evaluaciones drop constraint if exists evaluaciones_calibre_mm_check;
alter table evaluaciones drop constraint if exists evaluaciones_brix_check;

alter table evaluaciones
  add column estado estado_evaluacion not null default 'borrador',
  add column sin_muestra boolean not null default false,
  add column requiere_revision boolean not null default false,
  add column no_comparable boolean not null default false,
  add column cantidad_frutos integer,
  add column peso_total_g numeric,
  add column peso_promedio_g numeric generated always as (
    case
      when cantidad_frutos > 0 and peso_total_g is not null
        then peso_total_g / cantidad_frutos
      else null
    end
  ) stored,
  add column motivo_cambio text,
  add column updated_at timestamptz not null default now();

alter table evaluaciones
  add constraint evaluaciones_calibre_tecnico_check
    check (calibre_mm is null or (
      calibre_mm >= 0
      and calibre_mm not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    )),
  add constraint evaluaciones_brix_tecnico_check
    check (brix is null or (
      brix >= 0
      and brix not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    )),
  add constraint evaluaciones_rend_kg_tecnico_check
    check (rend_kg_planta is null or (
      rend_kg_planta >= 0
      and rend_kg_planta not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    )),
  add constraint evaluaciones_rend_tha_tecnico_check
    check (rend_t_ha is null or (
      rend_t_ha >= 0
      and rend_t_ha not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    )),
  add constraint evaluaciones_cantidad_frutos_check
    check (cantidad_frutos is null or cantidad_frutos >= 0),
  add constraint evaluaciones_peso_total_check
    check (peso_total_g is null or (
      peso_total_g >= 0
      and peso_total_g not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    ));

comment on column evaluaciones.anio is
  'Derivado siempre de evaluaciones.fecha por trigger; el cliente no lo decide.';
comment on column evaluaciones.peso_promedio_g is
  'Columna generada: peso_total_g / cantidad_frutos cuando cantidad_frutos > 0.';
comment on column evaluaciones.requiere_revision is
  'Derivado de limites de revision vigentes en rango_referencia.';

-- El historial local eventualmente existente queda preservado, pero no gana
-- comparabilidad cientifica por el solo hecho de aplicar esta migracion.
update evaluaciones
set estado = 'borrador', no_comparable = true, updated_at = created_at;

create table rango_referencia (
  id                         uuid primary key default gen_random_uuid(),
  especie_id                 uuid references especies (id) on delete restrict,
  metrica                    text not null check (btrim(metrica) <> ''),
  fase                       estado_planta,
  minimo_esperado            numeric,
  maximo_esperado            numeric,
  limite_revision_inferior   numeric,
  limite_revision_superior   numeric,
  vigente_desde              date not null,
  vigente_hasta              date,
  activo                     boolean not null default true,
  nota                       text,
  created_by                 uuid references perfiles (id) on delete set null,
  updated_by                 uuid references perfiles (id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (minimo_esperado is null or maximo_esperado is null or minimo_esperado <= maximo_esperado),
  check (limite_revision_inferior is null or minimo_esperado is null or limite_revision_inferior <= minimo_esperado),
  check (limite_revision_superior is null or maximo_esperado is null or limite_revision_superior >= maximo_esperado),
  check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);

comment on table rango_referencia is
  'Rangos agronomicos versionables. Informan esperado/alto/bajo y revision; no bloquean observaciones excepcionales.';

create index idx_rango_referencia_busqueda
  on rango_referencia (metrica, especie_id, fase, vigente_desde desc)
  where activo;

create unique index rango_referencia_vigencia_unica
  on rango_referencia (metrica, especie_id, fase, vigente_desde)
  nulls not distinct;

create or replace function mantener_rango_referencia()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.metrica := lower(btrim(new.metrica));
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_rango_referencia_metadata
  before insert or update on rango_referencia
  for each row execute function mantener_rango_referencia();

alter table rango_referencia enable row level security;

create policy rango_referencia_select_autenticados on rango_referencia
  for select using (auth.uid() is not null);

create policy rango_referencia_admin_inserta on rango_referencia
  for insert with check (es_admin());

create policy rango_referencia_admin_actualiza on rango_referencia
  for update using (es_admin()) with check (es_admin());

-- No se habilita DELETE: la vigencia y activo preservan trazabilidad.
grant select, insert, update on rango_referencia to authenticated;
grant all on rango_referencia to service_role;

-- El umbral provisional de 40 mm vive unicamente en este registro. No se
-- replica en triggers, RPC ni React.
insert into rango_referencia (
  especie_id, metrica, fase, minimo_esperado, maximo_esperado,
  limite_revision_superior, vigente_desde, activo, nota
) values
  (
    null, 'brix', 'evaluacion_anual', 10, 18,
    null, date '2026-01-01', true, null
  ),
  (
    null, 'calibre_mm', 'evaluacion_anual', 14, 24,
    40, date '2026-01-01', true,
    'Valor provisional pendiente de validación científica por Efraín'
  );

create or replace function evaluacion_tiene_descriptores_completos(p evaluaciones)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    p.brotacion is not null
    and p.floracion is not null
    and p.cuaja is not null
    and p.concentracion_cosecha is not null
    and p.calibre_mm is not null
    and p.firmeza is not null
    and p.color is not null
    and p.bloom is not null
    and p.brix is not null
    and p.rend_kg_planta is not null
    and p.rend_t_ha is not null
    and p.pct_fruta_exportable is not null
    and p.dano_calor is not null
    and p.golpe_sol is not null
    and p.caida_fruto is not null;
$$;

create or replace function validar_evaluacion_integridad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_especie_id uuid;
  v_revision boolean := false;
  v_rango rango_referencia;
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
       and not es_admin() then
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

  if new.estado in ('completa', 'corregida') then
    if new.sin_muestra then
      raise exception 'Una evaluacion sin muestra solo puede guardarse como borrador' using errcode = '23514';
    end if;
    if not evaluacion_tiene_descriptores_completos(new) then
      raise exception 'Faltan descriptores cientificos obligatorios para finalizar' using errcode = '23514';
    end if;
    if coalesce(new.cantidad_frutos, 0) <= 0 then
      raise exception 'Cantidad de frutos debe ser mayor que cero para finalizar' using errcode = '23514';
    end if;
    if coalesce(new.peso_total_g, 0) <= 0 then
      raise exception 'Peso total debe ser mayor que cero para finalizar' using errcode = '23514';
    end if;
  end if;

  select p.especie_id into v_especie_id
  from ronda_evaluacion_anual r
  join individuos i on i.id = r.individuo_id
  join plantas p on p.id = i.planta_id
  where r.id = new.ronda_id;

  for v_rango in
    select distinct on (rr.metrica) rr.*
    from rango_referencia rr
    where rr.activo
      and rr.metrica in ('brix', 'calibre_mm')
      and (rr.especie_id = v_especie_id or rr.especie_id is null)
      and (rr.fase = 'evaluacion_anual' or rr.fase is null)
      and rr.vigente_desde <= new.fecha
      and (rr.vigente_hasta is null or rr.vigente_hasta >= new.fecha)
    order by
      rr.metrica,
      (rr.especie_id is not null) desc,
      (rr.fase is not null) desc,
      rr.vigente_desde desc,
      rr.created_at desc
  loop
    if v_rango.metrica = 'brix' and new.brix is not null then
      v_revision := v_revision
        or (v_rango.limite_revision_inferior is not null and new.brix <= v_rango.limite_revision_inferior)
        or (v_rango.limite_revision_superior is not null and new.brix >= v_rango.limite_revision_superior);
    elsif v_rango.metrica = 'calibre_mm' and new.calibre_mm is not null then
      v_revision := v_revision
        or (v_rango.limite_revision_inferior is not null and new.calibre_mm <= v_rango.limite_revision_inferior)
        or (v_rango.limite_revision_superior is not null and new.calibre_mm >= v_rango.limite_revision_superior);
    end if;
  end loop;

  new.requiere_revision := v_revision;
  return new;
end;
$$;

create trigger trg_evaluaciones_integridad
  before insert or update on evaluaciones
  for each row execute function validar_evaluacion_integridad();

-- El autor puede completar su propio borrador. Una vez cerrada, cualquier
-- edicion, correccion, anulacion o reapertura queda exclusivamente en admin.
drop policy if exists evaluaciones_update_admin on evaluaciones;

create policy evaluaciones_update_borrador_o_admin on evaluaciones
  for update
  using (es_admin() or (created_by = auth.uid() and estado = 'borrador'))
  with check (es_admin() or (created_by = auth.uid() and estado in ('borrador', 'completa')));

create or replace function auditar_estado_evaluacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planta_id uuid;
begin
  if new.estado is not distinct from old.estado
     and new.requiere_revision is not distinct from old.requiere_revision
     and new.no_comparable is not distinct from old.no_comparable then
    return new;
  end if;

  select i.planta_id into v_planta_id
  from ronda_evaluacion_anual r
  join individuos i on i.id = r.individuo_id
  where r.id = new.ronda_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    auth.uid(),
    v_planta_id,
    'cambio_estado_evaluacion',
    array['estado', 'requiere_revision', 'no_comparable'],
    jsonb_build_object(
      'evaluacion_id', new.id,
      'estado_anterior', old.estado,
      'estado_nuevo', new.estado,
      'requiere_revision', new.requiere_revision,
      'no_comparable', new.no_comparable,
      'motivo', new.motivo_cambio
    )
  );
  return new;
end;
$$;

create trigger trg_evaluaciones_auditar_estado
  after update on evaluaciones
  for each row execute function auditar_estado_evaluacion();

-- Contrato de lectura de referencias para el formulario. No expone linaje y
-- elige por fecha efectiva, especie y fase con fallback global.
create or replace function obtener_referencias_evaluacion(
  p_ronda_id uuid,
  p_fecha date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with contexto as (
    select p.especie_id
    from ronda_evaluacion_anual r
    join individuos i on i.id = r.individuo_id
    join plantas p on p.id = i.planta_id
    where r.id = p_ronda_id
  ), elegidos as (
    select distinct on (rr.metrica) rr.*
    from rango_referencia rr, contexto c
    where rr.activo
      and (rr.especie_id = c.especie_id or rr.especie_id is null)
      and (rr.fase = 'evaluacion_anual' or rr.fase is null)
      and rr.vigente_desde <= p_fecha
      and (rr.vigente_hasta is null or rr.vigente_hasta >= p_fecha)
    order by
      rr.metrica,
      (rr.especie_id is not null) desc,
      (rr.fase is not null) desc,
      rr.vigente_desde desc,
      rr.created_at desc
  )
  select coalesce(
    jsonb_object_agg(
      metrica,
      to_jsonb(elegidos) - 'created_by' - 'updated_by'
    ),
    '{}'::jsonb
  )
  from elegidos;
$$;

revoke all on function obtener_referencias_evaluacion(uuid, date) from public, anon;
grant execute on function obtener_referencias_evaluacion(uuid, date) to authenticated, service_role;
