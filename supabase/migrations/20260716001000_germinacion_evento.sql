-- =============================================================================
-- MIGRACIÓN 20260716001000 — germinacion_evento (serie temporal, a nivel cruce)
--
-- Verificado antes de crear: no existía en el schema (la tabla
-- `germinacion_eventos`, en plural, pertenecía al pipeline paralelo
-- descartado en el Prompt 1 — nunca llegó a producción). Esta es una tabla
-- nueva genuina, no trabajo pendiente del Prompt 2 que se hubiera pasado
-- por alto.
--
-- A nivel de `plantas` (cruce), no de `individuos`: la germinación es
-- agregada y ocurre ANTES de Trasplante (que es cuando nace `individuos`).
-- cantidad_nueva es el conteo de plántulas NUEVAS ese día, no un acumulado.
-- =============================================================================

create table germinacion_evento (
  id              uuid primary key default gen_random_uuid(),
  planta_id       uuid not null references plantas (id) on delete restrict,
  fecha           date not null,
  cantidad_nueva  integer not null check (cantidad_nueva >= 0),
  created_by      uuid references perfiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table germinacion_evento is 'Serie temporal de eventos de germinación por cruce (plantas). cantidad_nueva = plántulas nuevas ESE día, no acumulado.';

create index idx_germinacion_evento_planta on germinacion_evento (planta_id, fecha);

alter table germinacion_evento enable row level security;

-- Mismo patrón que registros_evento: cualquier autenticado lee y crea a su
-- propio nombre. Sin UPDATE/DELETE en esta pasada (no se pidió edición).
create policy germinacion_evento_select_autenticados
  on germinacion_evento for select
  using (auth.uid() is not null);

create policy germinacion_evento_insert_autenticados
  on germinacion_evento for insert
  with check (auth.uid() is not null and created_by = auth.uid());

grant select, insert on germinacion_evento to authenticated;
grant all on germinacion_evento to service_role;


-- =============================================================================
-- AUDITORÍA: un evento de germinación por INSERT (no hay UPDATE/DELETE que auditar).
-- =============================================================================
create or replace function auditar_creacion_germinacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    auth.uid(),
    new.planta_id,
    'creacion_evento_germinacion',
    array['fecha', 'cantidad_nueva'],
    jsonb_build_object('evento_id', new.id, 'fecha', new.fecha, 'cantidad_nueva', new.cantidad_nueva)
  );
  return new;
end;
$$;

comment on function auditar_creacion_germinacion is 'Registra en audit_log cada evento de germinación cargado.';

create trigger trg_germinacion_evento_auditoria
  after insert on germinacion_evento
  for each row execute function auditar_creacion_germinacion();
