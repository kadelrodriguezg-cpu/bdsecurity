-- =============================================================================
-- MIGRACIÓN 20260713000001 — SOFT-DELETE Y AUDITORÍA DE registros_evento
--
-- Hasta ahora no existía forma de editar/borrar un registro de evento desde
-- la app. Se agrega:
--   1) Soft-delete: en vez de DELETE físico, se marca eliminado_at. El dato
--      queda recuperable en la base (igual que audit_log es append-only).
--   2) Refuerzo de política: aunque la policy de UPDATE (migración 003)
--      permite al autor editar su propio registro, Postgres no filtra
--      columnas en RLS — así que un trigger BEFORE UPDATE bloquea que un
--      no-admin toque eliminado_at, igual que bloquear_autoascenso (006)
--      bloquea que un no-admin se autoascienda.
--   3) Auditoría de escrituras: hoy audit_log solo cubre lecturas
--      (obtener_planta) y cambios de estado de planta (auditar_cambio_estado,
--      007). Se agrega un trigger AFTER UPDATE que dispara el mismo patrón
--      para ediciones y (soft-)borrados de registros_evento.
-- =============================================================================


-- =============================================================================
-- 1) COLUMNA eliminado_at
-- =============================================================================
alter table registros_evento
  add column if not exists eliminado_at timestamptz;

comment on column registros_evento.eliminado_at is
  'Soft-delete: NULL = activo. No NULL = borrado desde la app pero recuperable en la base (nunca se hace DELETE físico).';


-- =============================================================================
-- 2) POLICY DE SELECT — ocultar filas borradas de las vistas normales
-- Un admin puede seguir viendo las filas borradas (recuperación futura); un
-- operario ya no las ve ni siquiera con una consulta directa a la tabla.
-- =============================================================================
drop policy if exists registros_select_autenticados on registros_evento;

create policy registros_select_autenticados
  on registros_evento for select
  using (auth.uid() is not null and (eliminado_at is null or es_admin()));


-- =============================================================================
-- 3) TRIGGER — bloquear que un no-admin borre (cambie eliminado_at)
-- La policy registros_update_autor_o_admin (003) permite al AUTOR editar su
-- propio registro completo. Sin este trigger, esa misma vía de UPDATE le
-- permitiría también auto-"borrar" su registro, lo cual contradice la
-- política confirmada: solo un admin puede borrar.
-- =============================================================================
create or replace function bloquear_borrado_no_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.eliminado_at is distinct from old.eliminado_at and not es_admin() then
    raise exception 'Solo un administrador puede eliminar un registro de evento' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function bloquear_borrado_no_admin is
  'Bloquea que un no-admin cambie eliminado_at vía UPDATE, aunque la policy de edición lo deje tocar el resto de la fila.';

create trigger trg_registros_evento_bloquear_borrado
  before update on registros_evento
  for each row execute function bloquear_borrado_no_admin();


-- =============================================================================
-- 4) TRIGGER — auditar ediciones y borrados en audit_log
-- Mismo patrón que auditar_cambio_estado (migración 007): un UPDATE dispara
-- triggers nativamente, así que ningún camino de escritura puede saltear el
-- registro. Corre DESPUÉS del trigger de bloqueo: si el bloqueo rechaza la
-- operación, esta auditoría ni se ejecuta (no hay UPDATE que registrar).
-- =============================================================================
create or replace function auditar_escritura_evento()
returns trigger
language plpgsql
security definer            -- audit_log es append-only vía funciones, sin policy de INSERT abierta
set search_path = public
as $$
begin
  if new.eliminado_at is not null and old.eliminado_at is null then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      old.planta_id,
      'eliminacion_evento',
      array['eliminado_at'],
      jsonb_build_object('registro_id', old.id, 'tipo_evento', old.tipo_evento, 'fecha', old.fecha)
    );
  elsif old.tipo_evento is distinct from new.tipo_evento
     or old.fecha        is distinct from new.fecha
     or old.notas        is distinct from new.notas
     or old.datos        is distinct from new.datos then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      new.planta_id,
      'edicion_evento',
      array['tipo_evento', 'fecha', 'notas', 'datos'],
      jsonb_build_object(
        'registro_id', new.id,
        'anterior', jsonb_build_object('tipo_evento', old.tipo_evento, 'fecha', old.fecha, 'notas', old.notas, 'datos', old.datos),
        'nuevo',     jsonb_build_object('tipo_evento', new.tipo_evento, 'fecha', new.fecha, 'notas', new.notas, 'datos', new.datos)
      )
    );
  end if;
  return new;
end;
$$;

comment on function auditar_escritura_evento is
  'Registra en audit_log cada edición o (soft-)borrado de un registro de evento (quién, qué cambió).';

create trigger trg_registros_evento_auditoria
  after update on registros_evento
  for each row execute function auditar_escritura_evento();
