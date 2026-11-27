-- =============================================================================
-- MIGRACIÓN 20260714020000 — TABLA individuos (satélite de plantas)
--
-- Implementa la sección 2.2 del North Star (docs/BDSecurity_Arquitectura_
-- Definitiva_NorthStar.md): `individuos` nace en la fase Trasplante, cuelga de
-- `plantas` con FK obligatoria e inmutable, y nunca es un segundo agregado raíz.
--
-- Puntos de diseño:
--   - planta_id ON DELETE RESTRICT: un individuo nunca puede quedar huérfano
--     por el borrado de su cruce (que hoy además ya es admin-only por RLS).
--   - codigo_display se genera SIEMPRE en el backend (trigger BEFORE INSERT),
--     nunca en el frontend: evita colisiones y evita que un cliente falsifique
--     el correlativo. El trigger toma un advisory lock por planta_id para
--     serializar inserts concurrentes del mismo cruce (dos "individualizar"
--     simultáneas no pueden generar el mismo -P{nn}).
--   - Nunca hay DELETE físico desde la app: la policy de DELETE es explícita
--     con `using (false)` (no solo "ausencia de policy") para que la intención
--     quede legible en pg_policies, y además no se concede el GRANT DELETE a
--     `authenticated` (doble cerrojo, mismo criterio de defensa en profundidad
--     que el resto del proyecto).
-- =============================================================================


-- =============================================================================
-- TIPO: estado_vital
-- =============================================================================
create type estado_vital as enum ('vivo', 'descartado', 'muerto');


-- =============================================================================
-- TABLA: individuos
-- =============================================================================
create table individuos (
  id              uuid primary key default gen_random_uuid(),
  planta_id       uuid not null references plantas (id) on delete restrict,
  -- Generado por trigger (ver más abajo). NOT NULL + UNIQUE, pero el valor que
  -- llegue en el INSERT (si llega alguno) se pisa siempre en el trigger.
  codigo_display  text not null unique,
  -- Autorreferencia para clonación (sección 2.3 del North Star): un individuo
  -- puede ser clon de otro. ON DELETE RESTRICT: nunca se pierde la trazabilidad
  -- hacia el individuo de origen (tampoco hay DELETE físico posible, en la
  -- práctica, pero la FK deja la intención explícita en el schema).
  clon_de_id      uuid references individuos (id) on delete restrict,
  estado_vital    estado_vital not null default 'vivo',
  fecha_baja      date,
  created_by      uuid not null references perfiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table individuos is 'Satélite de plantas: plantas físicas individuales con identidad propia, nacidas en la fase Trasplante. Nunca es un segundo agregado raíz (ver North Star sección 2.2).';
comment on column individuos.planta_id is 'FK obligatoria e inmutable al cruce de origen. ON DELETE RESTRICT: un individuo nunca queda huérfano.';
comment on column individuos.codigo_display is 'Formato {codigo_sistema}-P{nn}, correlativo por planta_id. SIEMPRE generado por el trigger trg_individuos_codigo_display, nunca por el cliente.';
comment on column individuos.clon_de_id is 'Autorreferencia: individuo de origen si esta fila nació de una clonación (ronda "selección secundaria").';
comment on column individuos.estado_vital is 'vivo / descartado / muerto. Nunca hay DELETE físico: la baja es un cambio de estado.';

create index idx_individuos_planta on individuos (planta_id);
create index idx_individuos_clon_de on individuos (clon_de_id);

create trigger trg_individuos_updated_at
  before update on individuos
  for each row execute function set_updated_at();


-- =============================================================================
-- TRIGGER: generar_codigo_individuo()
-- Calcula el correlativo {codigo_sistema}-P{nn} ANTES del insert (BEFORE
-- INSERT), así que corre tanto si el alta viene de la RPC individualizar_plantas
-- (migración siguiente) como de un INSERT directo. pg_advisory_xact_lock
-- serializa dos inserts concurrentes del mismo planta_id: sin este lock, dos
-- transacciones podrían leer el mismo count(*) y generar el mismo -P{nn}.
-- El lock se libera solo al terminar la transacción (xact), no la función.
-- =============================================================================
create or replace function generar_codigo_individuo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo_sistema text;
  v_siguiente      int;
begin
  perform pg_advisory_xact_lock(hashtext(new.planta_id::text));

  select codigo_sistema into v_codigo_sistema from plantas where id = new.planta_id;
  if not found then
    raise exception 'Planta % no encontrada', new.planta_id using errcode = 'P0002';
  end if;

  select count(*) + 1 into v_siguiente from individuos where planta_id = new.planta_id;

  new.codigo_display := v_codigo_sistema || '-P' || lpad(v_siguiente::text, 2, '0');
  return new;
end;
$$;

comment on function generar_codigo_individuo is 'Genera codigo_display = {codigo_sistema}-P{nn} correlativo por planta_id. Serializado con advisory lock para evitar colisiones entre inserts concurrentes.';

create trigger trg_individuos_codigo_display
  before insert on individuos
  for each row execute function generar_codigo_individuo();


-- =============================================================================
-- RLS
-- =============================================================================
alter table individuos enable row level security;

-- Cualquier autenticado puede leer los individuos (mismo criterio que plantas:
-- la ficha del cruce y su sección de individuos son visibles para todo el equipo).
create policy individuos_select_autenticados
  on individuos for select
  using (auth.uid() is not null);

-- Cualquier autenticado puede crear individuos (vía la RPC individualizar_plantas
-- o, si hiciera falta, un INSERT directo), a su propio nombre.
create policy individuos_insert_autenticados
  on individuos for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- Solo el autor o un admin puede actualizar (necesario para poder marcar baja:
-- estado_vital/fecha_baja). Igual que registros_evento, Postgres no filtra
-- columnas en RLS, así que "solo puede tocar estado_vital/fecha_baja" queda
-- como convención de la capa de app, no como restricción de policy.
create policy individuos_update_autor_o_admin
  on individuos for update
  using (created_by = auth.uid() or es_admin())
  with check (created_by = auth.uid() or es_admin());

-- DELETE explícitamente prohibido para TODOS los roles vía RLS (defensa en
-- profundidad: además de esto, no se concede el GRANT DELETE a authenticated
-- más abajo). Un individuo nunca se hard-elimina (North Star sección 2.2).
create policy individuos_delete_nadie
  on individuos for delete
  using (false);

comment on policy individuos_delete_nadie on individuos is 'Ningún rol de la API puede hacer DELETE físico. La baja es estado_vital, nunca borrado.';


-- =============================================================================
-- GRANTS EXPLÍCITOS (mismo motivo que la migración 009: Supabase no concede
-- privilegios DML por default sobre tablas nuevas al rol authenticated).
-- Sin GRANT DELETE a propósito: doble cerrojo junto con la policy de arriba.
-- =============================================================================
grant select, insert, update on individuos to authenticated;


-- =============================================================================
-- AUDITORÍA: extiende el patrón de auditar_cambio_estado (007) y
-- auditar_escritura_evento (013) a individuos. audit_log ya tiene columna
-- planta_id: se usa individuos.planta_id (el cruce de origen), no hace falta
-- extender el schema de audit_log.
-- =============================================================================
create or replace function auditar_escritura_individuo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      new.planta_id,
      'creacion_individuo',
      array['codigo_display', 'estado_vital'],
      jsonb_build_object(
        'individuo_id',   new.id,
        'codigo_display', new.codigo_display,
        'clon_de_id',     new.clon_de_id
      )
    );
  elsif tg_op = 'UPDATE' and (
        new.estado_vital is distinct from old.estado_vital
     or new.fecha_baja    is distinct from old.fecha_baja
  ) then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      new.planta_id,
      'edicion_individuo',
      array['estado_vital', 'fecha_baja'],
      jsonb_build_object(
        'individuo_id', new.id,
        'anterior', jsonb_build_object('estado_vital', old.estado_vital, 'fecha_baja', old.fecha_baja),
        'nuevo',     jsonb_build_object('estado_vital', new.estado_vital, 'fecha_baja', new.fecha_baja)
      )
    );
  end if;
  return new;
end;
$$;

comment on function auditar_escritura_individuo is 'Registra en audit_log cada alta y cada cambio de estado_vital/fecha_baja de un individuo.';

create trigger trg_individuos_auditoria
  after insert or update on individuos
  for each row execute function auditar_escritura_individuo();
