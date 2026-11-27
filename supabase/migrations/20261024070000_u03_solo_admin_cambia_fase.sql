-- =============================================================================
-- MIGRACIÓN 20261024070000 — SOLO UN ADMIN CAMBIA LA FASE DE UN CRUCE (U-03, decisión N6)
--
-- Antes (migración 20261021122000, brecha B4): cualquier usuario autenticado
-- podía avanzar UNA fase, o retroceder una si el cruce no tenía individuos. La
-- interfaz mostraba «Avanzar a…» y «Retroceder» a todos los roles.
--
-- Ahora: `plantas.estado` solo lo cambia un admin (puede avanzar, retroceder y
-- saltar fases, como antes) o un contexto administrativo sin usuario
-- (service_role, o sin JWT: Studio, psql, migraciones). Cualquier otro intento
-- se rechaza con «Solo un admin puede cambiar la fase de un cruce.» (42501, que
-- el frontend muestra tal cual). El resto de las columnas de `plantas` sigue
-- editable como hoy (la policy `plantas_update_autenticados` no cambia): el
-- trigger solo corre en `UPDATE OF estado` y deja pasar si la fase no cambia.
--
-- Inventario de los caminos que cambian `plantas.estado` (24-10-2026):
--   - frontend: `actualizarEstado` (botón «Avanzar/Retroceder» de la ficha):
--     UPDATE directo; a partir de aquí, solo admin.
--   - `reiniciar_cruzamiento` (SECURITY DEFINER): ya exigía es_admin(); dentro
--     de la función auth.uid() sigue siendo el admin que la llama, así que pasa.
--   - `restaurar_cruzamiento`, `revertir_importacion`, `borrar_cruzamiento`:
--     ya exigían es_admin().
--   - `confirmar_importacion_cruces`: INSERT (no UPDATE) y ya exigía es_admin();
--     el INSERT de `plantas` además exige admin por RLS (`plantas_insert_admin`).
--   - `guardar_siembra`, `guardar_cosecha`, individualización, evaluaciones:
--     no tocan `estado`.
--
-- Rollback: docs/migraciones_pendientes/rollback_u03_solo_admin_cambia_fase.sql
-- (restaura la regla de B4). Paso de despliegue: docs/paquete_u03_produccion.md
-- (paso 40).
-- =============================================================================

create or replace function public.validar_orden_fases()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  -- Contexto administrativo: service_role, o sin JWT (Studio, psql,
  -- migraciones). anon no entra acá: cae en el rechazo.
  if auth.role() is null or auth.role() = 'service_role' then
    return new;
  end if;

  -- El admin puede avanzar, retroceder y saltar fases (queda auditado por la
  -- migración 007, trigger trg_plantas_audit_estado).
  if es_admin() then
    return new;
  end if;

  raise exception 'Solo un admin puede cambiar la fase de un cruce.'
    using errcode = '42501';
end;
$$;

comment on function public.validar_orden_fases() is
  'Guardia del pipeline de un cruce (U-03): solo un admin, o un contexto administrativo sin usuario, cambia plantas.estado. Los cambios quedan auditados por la migración 007.';
