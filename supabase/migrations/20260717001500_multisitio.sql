-- =============================================================================
-- MIGRACIÓN 20260717001500 — multisitio (Prompt 7, Parte D)
--
-- North Star v4: "Ensayos multisitio" (antes "Traslado") — la planta ya
-- evaluada se lleva a terreno. 1 registro por individuo (decidido, no
-- soporta múltiples predios todavía — ver pregunta abierta resuelta en el
-- North Star sección 11).
-- =============================================================================

create table multisitio (
  id              uuid primary key default gen_random_uuid(),
  individuo_id    uuid not null unique references individuos (id) on delete restrict,
  fecha_traslado  date,
  destino         text,
  predio_id       uuid references predio (id) on delete restrict,
  observaciones   text,
  created_by      uuid references perfiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table multisitio is '1 registro por individuo (UNIQUE individuo_id): traslado a terreno para ensayo multisitio, ex-"Traslado" (North Star v4). No soporta múltiples predios por individuo todavía.';

alter table multisitio enable row level security;

create policy multisitio_select_autenticados on multisitio for select using (auth.uid() is not null);
create policy multisitio_insert_autenticados on multisitio for insert with check (auth.uid() is not null and created_by = auth.uid());
create policy multisitio_update_autor_o_admin on multisitio for update using (created_by = auth.uid() or es_admin()) with check (created_by = auth.uid() or es_admin());

grant select, insert, update on multisitio to authenticated;
grant all on multisitio to service_role;

create or replace function auditar_escritura_multisitio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planta_id uuid;
begin
  select planta_id into v_planta_id from individuos where id = new.individuo_id;
  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (auth.uid(), v_planta_id, 'creacion_multisitio', array['fecha_traslado', 'destino', 'predio_id'],
      jsonb_build_object('multisitio_id', new.id, 'individuo_id', new.individuo_id, 'predio_id', new.predio_id));
  elsif tg_op = 'UPDATE' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (auth.uid(), v_planta_id, 'edicion_multisitio', array['fecha_traslado', 'destino', 'predio_id'],
      jsonb_build_object('multisitio_id', new.id, 'individuo_id', new.individuo_id));
  end if;
  return new;
end;
$$;

create trigger trg_multisitio_auditoria
  after insert or update on multisitio
  for each row execute function auditar_escritura_multisitio();
