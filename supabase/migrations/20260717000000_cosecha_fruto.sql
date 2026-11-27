-- =============================================================================
-- MIGRACIÓN 20260717000000 — cosecha_fruto (Prompt 7, Parte A)
--
-- Confirmado por Efraín (North Star v4, sección 6): "F1"/"F2" en Cosecha son
-- Fruto 1 / Fruto 2 (frutos cosechados con su cantidad de semillas), no
-- generaciones genéticas. plantas.conteo_f1/conteo_f2 (Prompt 6) no alcanzan
-- porque son 2 campos fijos; hace falta N frutos por cosecha.
--
-- numero_fruto correlativo por planta_id, generado por trigger con advisory
-- lock — mismo patrón que individuos.codigo_display (migración
-- 20260714020000), pero con su propio namespace de lock ('cosecha_fruto:' +
-- planta_id) para no contender con el lock de individualización del mismo cruce.
-- =============================================================================

create table cosecha_fruto (
  id                 uuid primary key default gen_random_uuid(),
  planta_id          uuid not null references plantas (id) on delete restrict,
  numero_fruto       integer not null,
  cantidad_semillas  integer not null check (cantidad_semillas >= 0),
  created_by         uuid references perfiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (planta_id, numero_fruto)
);

comment on table cosecha_fruto is 'N frutos por cosecha (cruce), cada uno con su cantidad de semillas. Reemplaza plantas.conteo_f1/conteo_f2 (Prompt 6), que asumían exactamente 2 frutos fijos.';

create index idx_cosecha_fruto_planta on cosecha_fruto (planta_id, numero_fruto);

create or replace function generar_numero_fruto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_siguiente int;
begin
  perform pg_advisory_xact_lock(hashtext('cosecha_fruto:' || new.planta_id::text));
  select count(*) + 1 into v_siguiente from cosecha_fruto where planta_id = new.planta_id;
  new.numero_fruto := v_siguiente;
  return new;
end;
$$;

comment on function generar_numero_fruto is 'Genera numero_fruto correlativo por planta_id. Serializado con advisory lock (mismo patrón que generar_codigo_individuo).';

create trigger trg_cosecha_fruto_numero
  before insert on cosecha_fruto
  for each row execute function generar_numero_fruto();

alter table cosecha_fruto enable row level security;

create policy cosecha_fruto_select_autenticados on cosecha_fruto for select using (auth.uid() is not null);
create policy cosecha_fruto_insert_autenticados on cosecha_fruto for insert with check (auth.uid() is not null and created_by = auth.uid());
create policy cosecha_fruto_delete_autor_o_admin on cosecha_fruto for delete using (created_by = auth.uid() or es_admin());
-- Sin UPDATE: "editar" un fruto es borrar el último (delete) y volver a
-- cargar (insert), como pidió Efraín ("sin reconstruir todo el registro").

grant select, insert, delete on cosecha_fruto to authenticated;
grant all on cosecha_fruto to service_role;

create or replace function auditar_cosecha_fruto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (auth.uid(), new.planta_id, 'creacion_cosecha_fruto', array['numero_fruto', 'cantidad_semillas'],
      jsonb_build_object('fruto_id', new.id, 'numero_fruto', new.numero_fruto, 'cantidad_semillas', new.cantidad_semillas));
  elsif tg_op = 'DELETE' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (auth.uid(), old.planta_id, 'eliminacion_cosecha_fruto', array['numero_fruto', 'cantidad_semillas'],
      jsonb_build_object('fruto_id', old.id, 'numero_fruto', old.numero_fruto, 'cantidad_semillas', old.cantidad_semillas));
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_cosecha_fruto_auditoria
  after insert or delete on cosecha_fruto
  for each row execute function auditar_cosecha_fruto();


-- =============================================================================
-- MIGRACIÓN DE DATOS: plantas.conteo_f1/conteo_f2 -> cosecha_fruto
-- Se migra CUALQUIER fila que tenga datos cargados (de prueba o reales, no se
-- distingue: migrar es gratis y no pierde nada). fruto 1 = conteo_f1,
-- fruto 2 = conteo_f2 (dos INSERT...SELECT separados para que el trigger
-- asigne numero_fruto=1 y luego =2, en ese orden, por cruce).
-- =============================================================================
insert into cosecha_fruto (planta_id, cantidad_semillas)
select id, conteo_f1 from plantas where conteo_f1 is not null;

insert into cosecha_fruto (planta_id, cantidad_semillas)
select id, conteo_f2 from plantas where conteo_f2 is not null;

alter table plantas drop column conteo_f1;
alter table plantas drop column conteo_f2;

-- auditar_escritura_fase (migración 20260716000500) referenciaba
-- conteo_f1/conteo_f2: se redefine sin esas dos columnas.
create or replace function auditar_escritura_fase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fecha_polinizacion            is distinct from old.fecha_polinizacion
  or new.n_flores_cruzadas             is distinct from old.n_flores_cruzadas
  or new.fecha_cosecha                 is distinct from old.fecha_cosecha
  or new.n_semillas                    is distinct from old.n_semillas
  or new.escarificacion_subtipo        is distinct from old.escarificacion_subtipo
  or new.escarificacion_duracion_dias  is distinct from old.escarificacion_duracion_dias
  or new.contenedor_id                 is distinct from old.contenedor_id
  or new.predio_id                     is distinct from old.predio_id
  then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      new.id,
      'escritura_fase',
      array['fecha_polinizacion','n_flores_cruzadas','fecha_cosecha','n_semillas','escarificacion_subtipo','escarificacion_duracion_dias','contenedor_id','predio_id'],
      jsonb_build_object(
        'anterior', jsonb_build_object(
          'fecha_polinizacion', old.fecha_polinizacion, 'n_flores_cruzadas', old.n_flores_cruzadas,
          'fecha_cosecha', old.fecha_cosecha, 'n_semillas', old.n_semillas,
          'escarificacion_subtipo', old.escarificacion_subtipo, 'escarificacion_duracion_dias', old.escarificacion_duracion_dias,
          'contenedor_id', old.contenedor_id, 'predio_id', old.predio_id
        ),
        'nuevo', jsonb_build_object(
          'fecha_polinizacion', new.fecha_polinizacion, 'n_flores_cruzadas', new.n_flores_cruzadas,
          'fecha_cosecha', new.fecha_cosecha, 'n_semillas', new.n_semillas,
          'escarificacion_subtipo', new.escarificacion_subtipo, 'escarificacion_duracion_dias', new.escarificacion_duracion_dias,
          'contenedor_id', new.contenedor_id, 'predio_id', new.predio_id
        )
      )
    );
  end if;
  return new;
end;
$$;
