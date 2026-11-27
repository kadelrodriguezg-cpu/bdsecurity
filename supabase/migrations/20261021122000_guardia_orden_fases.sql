-- =============================================================================
-- MIGRACIÓN 20261021122000 — GUARDIA DEL ORDEN DE FASES EN LA BASE (brecha B4)
--
-- Problema que cierra: el orden del pipeline de un cruce (enum estado_planta)
-- solo lo controlaba la interfaz (AvanzarEstado.tsx: avanzar una fase, o
-- retroceder una si el cruce no tiene individuos). Un UPDATE directo por la
-- API podía saltar fases o retroceder dejando individuos en una fase que el
-- cruce ya no tiene.
--
-- Regla (propuesta del plan de brechas; pregunta 2 de la auditoría):
--   - Cualquier usuario autenticado puede mantener la fase, avanzar UNA fase,
--     o retroceder UNA fase si el cruce no tiene individuos.
--   - Cualquier otro movimiento (saltar fases, retroceder con individuos) solo
--     lo puede hacer un admin. Ese cambio ya queda auditado como cambio_estado
--     por la migración 007, igual que todos.
--   - Los contextos administrativos sin usuario (service_role, Studio, psql)
--     no se restringen: ya saltean el RLS por diseño.
--
-- El orden se toma de la posición en el enum (enum_range), que coincide con
-- ESTADOS_ORDEN del frontend (frontend/src/types/domain.ts), incluidas
-- crecimiento y evaluacion_anual, agregadas después con ALTER TYPE ... AFTER.
--
-- reiniciar_cruzamiento sigue funcionando: vuelve a sin_empezar desde
-- cualquier fase, pero exige admin, y dentro de esa función SECURITY DEFINER
-- auth.uid() sigue siendo el admin que la llamó.
--
-- Código de error 55000 (object_not_in_prerequisite_state): el frontend lo
-- trata como mensaje de negocio y lo muestra tal cual (api/client.ts).
-- =============================================================================

create or replace function validar_orden_fases()
returns trigger
language plpgsql
security definer            -- lee individuos aunque el RLS de un usuario futuro
set search_path = public    -- no le muestre todos los individuos del cruce
as $$
declare
  v_orden    estado_planta[] := enum_range(null::estado_planta);
  v_desde    int := array_position(v_orden, old.estado);
  v_hasta    int := array_position(v_orden, new.estado);
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  -- Contexto administrativo: service_role, o sin JWT (Studio, psql,
  -- migraciones). anon no entra acá: cae en la regla general.
  if auth.role() is null or auth.role() = 'service_role' then
    return new;
  end if;

  if es_admin() then
    return new;
  end if;

  if v_hasta = v_desde + 1 then
    return new;
  end if;

  if v_hasta = v_desde - 1 then
    if exists (select 1 from individuos where planta_id = new.id) then
      raise exception 'No se puede retroceder de fase: este cruce ya tiene individuos creados. Solo un admin puede hacerlo.'
        using errcode = '55000';
    end if;
    return new;
  end if;

  raise exception 'Solo se puede avanzar o retroceder una fase a la vez (de % a %). Saltar fases requiere un admin.',
    old.estado, new.estado
    using errcode = '55000';
end;
$$;

comment on function validar_orden_fases is
  'Guardia del pipeline de un cruce: un no-admin solo avanza una fase o retrocede una sin individuos. Los saltos quedan para el admin (auditados por la migración 007).';

create trigger trg_plantas_orden_fases
  before update of estado on plantas
  for each row execute function validar_orden_fases();
