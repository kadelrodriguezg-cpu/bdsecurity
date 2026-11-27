-- =============================================================================
-- MIGRACIÓN 007 — AUDITORÍA DE ESCRITURAS: CAMBIOS DE ESTADO EN PLANTAS
--
-- Problema que cierra: audit_log solo registraba LECTURAS (vía obtener_planta).
-- Un UPDATE plantas SET estado = ... no dejaba rastro. Este trigger AFTER UPDATE
-- registra cada cambio de estado con quién, qué planta, valor anterior y nuevo.
--
-- A diferencia de las lecturas (donde el trigger ON SELECT no existe y hubo que
-- usar una RPC), acá el trigger SÍ es el mecanismo correcto: UPDATE dispara
-- triggers nativamente, y así NINGÚN camino de escritura (app, SQL directo,
-- futura RPC) puede saltear el registro.
--
-- El schema existente de audit_log ALCANZA sin cambios: valor anterior y nuevo
-- van en la columna detalle (jsonb), que existía justo para esto.
-- =============================================================================

create or replace function auditar_cambio_estado()
returns trigger
language plpgsql
security definer            -- necesario: audit_log no tiene policy de INSERT
set search_path = public    -- (es append-only vía funciones), así que el insert
as $$                       -- debe correr con permisos del dueño de la función
begin
  -- Solo registramos si el estado realmente cambió (un UPDATE que toca otra
  -- columna sin mover el estado no genera ruido en el log).
  if new.estado is distinct from old.estado then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),           -- null si el cambio vino de un contexto administrativo
                            -- (Studio/service_role); la fila se registra igual
      new.id,
      'cambio_estado',
      array['estado'],
      jsonb_build_object(
        'estado_anterior', old.estado,
        'estado_nuevo',    new.estado
      )
    );
  end if;
  return new;
end;
$$;

comment on function auditar_cambio_estado is 'Registra en audit_log cada cambio de estado de una planta (quién, anterior, nuevo).';

create trigger trg_plantas_audit_estado
  after update on plantas
  for each row execute function auditar_cambio_estado();
