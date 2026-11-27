-- =============================================================================
-- MIGRACIÓN 20260719001000 — procedimiento_cultivo (podas/fertilizaciones/
-- aplicaciones), North Star v5 sección 2.3/4.
--
-- Diseño confirmado explícitamente con Kadel (no existía en ningún prompt
-- anterior, ni en el v4 viejo): tabla única a nivel de CRUCE (no de
-- individuo — "afectan a todos por igual", sección 4), con columna `tipo`
-- en vez de 3 tablas separadas, repetible en el tiempo (mismo patrón que
-- germinacion_evento/cosecha_fruto). `insumo_id` reusa el catálogo `insumo`
-- ya existente (migración 20260716000000) en vez de duplicar un catálogo de
-- productos. Visible desde Crecimiento y Evaluación anual por igual.
-- =============================================================================

create type tipo_procedimiento_cultivo as enum ('poda', 'fertilizacion', 'aplicacion');

create table procedimiento_cultivo (
  id          uuid primary key default gen_random_uuid(),
  planta_id   uuid not null references plantas (id) on delete restrict,
  tipo        tipo_procedimiento_cultivo not null,
  fecha       date not null,
  insumo_id   uuid references insumo (id) on delete restrict,
  cantidad    numeric check (cantidad > 0),
  notas       text,
  created_by  uuid references perfiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table procedimiento_cultivo is 'Podas/fertilizaciones/aplicaciones del CRUCE (no del individuo — North Star v5 sección 4). Repetible en el tiempo. insumo_id reusa el catálogo insumo ya existente; poda normalmente no lleva insumo ni cantidad.';
comment on column procedimiento_cultivo.cantidad is 'Dosis/cantidad aplicada (litros, kg, gramos — unidad libre, se anota en notas). No aplica a poda.';

create index idx_procedimiento_cultivo_planta on procedimiento_cultivo (planta_id, fecha desc);

alter table procedimiento_cultivo enable row level security;

create policy procedimiento_cultivo_select_autenticados on procedimiento_cultivo for select using (auth.uid() is not null);
create policy procedimiento_cultivo_insert_autenticados on procedimiento_cultivo for insert with check (auth.uid() is not null and created_by = auth.uid());
-- Sin UPDATE/DELETE: mismo criterio que ronda_evaluacion_anual — un registro
-- cargado no se edita ni se borra; corregir un error de carga es un caso de
-- admin vía Studio, no un flujo de la app.

grant select, insert on procedimiento_cultivo to authenticated;
grant all on procedimiento_cultivo to service_role;

create or replace function auditar_creacion_procedimiento_cultivo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    auth.uid(), new.planta_id, 'creacion_procedimiento_cultivo',
    array['tipo', 'fecha', 'insumo_id', 'cantidad'],
    jsonb_build_object('procedimiento_id', new.id, 'tipo', new.tipo, 'fecha', new.fecha, 'insumo_id', new.insumo_id, 'cantidad', new.cantidad)
  );
  return new;
end;
$$;

create trigger trg_procedimiento_cultivo_auditoria
  after insert on procedimiento_cultivo
  for each row execute function auditar_creacion_procedimiento_cultivo();
