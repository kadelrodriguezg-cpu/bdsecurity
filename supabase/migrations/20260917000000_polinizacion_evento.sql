-- =============================================================================
-- MIGRACIÓN 20260917000000 — polinizacion_evento (Paso A, aditivo)
--
-- Corrige el hallazgo de sobrescritura en plantas.n_flores_cruzadas: hoy es
-- una columna única que un UPDATE pisa en cada guardado (fases.ts), así que
-- un cruce con más de una sesión de polinización pierde el conteo de las
-- sesiones previas. Mismo patrón que cosecha_fruto (migración
-- 20260717000000): N filas por cruce, el total se CALCULA sumando filas,
-- nunca se guarda como número fijo.
--
-- Diferencia deliberada con cosecha_fruto: no hay numero_fruto/trigger de
-- correlativo, porque acá el campo natural de orden es `fecha` (cuándo se
-- polinizó), no un contador secuencial arbitrario.
--
-- PASO A / PASO B: esta migración es solo la parte aditiva (crear tabla +
-- backfill). plantas.fecha_polinizacion/n_flores_cruzadas NO se tocan ni se
-- eliminan acá — siguen recibiendo escritura en paralelo (dual-write) desde
-- el frontend mientras el Paso B (DROP COLUMN, migración aparte) no se
-- aplique. Ver docs/BDSecurity_Documento_Maestro.md para la autorización de
-- cada paso.
-- =============================================================================

create table polinizacion_evento (
  id                 uuid primary key default gen_random_uuid(),
  planta_id          uuid not null references plantas (id) on delete restrict,
  fecha              date not null,
  n_flores_cruzadas  integer not null check (n_flores_cruzadas >= 0),
  -- Reservada para un futuro backfill de reconstrucción (cruce con
  -- plantas.n_flores_cruzadas no nulo pero SIN evento reconstruible en
  -- registros_evento). El backfill de esta migración no la usa: se validó
  -- contra producción que ese caso no existe hoy (0 cruces huérfanos), así
  -- que el backfill de acá es de un solo paso. Si aparece un caso futuro, se
  -- puebla con una fila marcada es_reconstruccion=true en vez de mezclarla
  -- con historial real.
  es_reconstruccion  boolean not null default false,
  created_by         uuid references perfiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

comment on table polinizacion_evento is 'N sesiones de polinización por cruce, cada una con su propia fecha y cantidad. Reemplaza plantas.n_flores_cruzadas/fecha_polinizacion (columna única sobrescribible) como fuente de verdad del conteo — el total se calcula sumando filas.';
comment on column polinizacion_evento.es_reconstruccion is 'true = fila reconstruida administrativamente (no es una sesión real registrada por un operario). Reservada; el backfill inicial no la usa (0 casos huérfanos verificados en producción).';

create index idx_polinizacion_evento_planta on polinizacion_evento (planta_id, fecha);

alter table polinizacion_evento enable row level security;

-- Mismo criterio que cosecha_fruto: cualquier autenticado lee/inserta a
-- nombre propio; borra su propia fila o admin; sin UPDATE ("editar" es
-- borrar + reinsertar).
create policy polinizacion_evento_select_autenticados on polinizacion_evento for select using (auth.uid() is not null);
create policy polinizacion_evento_insert_autenticados on polinizacion_evento for insert with check (auth.uid() is not null and created_by = auth.uid());
create policy polinizacion_evento_delete_autor_o_admin on polinizacion_evento for delete using (created_by = auth.uid() or es_admin());

grant select, insert, delete on polinizacion_evento to authenticated;
grant all on polinizacion_evento to service_role;

create or replace function auditar_polinizacion_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (auth.uid(), new.planta_id, 'creacion_polinizacion_evento', array['fecha', 'n_flores_cruzadas'],
      jsonb_build_object('evento_id', new.id, 'fecha', new.fecha, 'n_flores_cruzadas', new.n_flores_cruzadas));
  elsif tg_op = 'DELETE' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (auth.uid(), old.planta_id, 'eliminacion_polinizacion_evento', array['fecha', 'n_flores_cruzadas'],
      jsonb_build_object('evento_id', old.id, 'fecha', old.fecha, 'n_flores_cruzadas', old.n_flores_cruzadas));
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_polinizacion_evento_auditoria
  after insert or delete on polinizacion_evento
  for each row execute function auditar_polinizacion_evento();


-- =============================================================================
-- BACKFILL — un solo paso, sin manejo de huérfanos (validado contra
-- producción: todo cruce con plantas.n_flores_cruzadas no nulo tiene al
-- menos un evento reconstruible en registros_evento; ver Documento Maestro).
--
-- Reconstruye desde registros_evento las filas de tipo_evento='polinizacion'
-- cuyo datos->>'n_flores_cruzadas' exista y sea un entero no negativo. Filas
-- con esa clave en null (ej. un borrador corregido minutos después por otra
-- fila con el valor correcto) quedan excluidas por el propio filtro de
-- regex — no se tocan ni se borran de registros_evento.
-- =============================================================================
insert into polinizacion_evento (planta_id, fecha, n_flores_cruzadas, created_by)
select
  re.planta_id,
  re.fecha,
  (re.datos ->> 'n_flores_cruzadas')::int,
  re.created_by
from registros_evento re
where re.tipo_evento = 'polinizacion'
  and re.eliminado_at is null
  and re.datos ? 'n_flores_cruzadas'
  and re.datos ->> 'n_flores_cruzadas' ~ '^\d+$';
