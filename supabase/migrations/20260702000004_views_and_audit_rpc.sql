-- =============================================================================
-- MIGRACIÓN 004 — VISTA OPERATIVA (SIN LINAJE) + RPC DE LECTURA AUDITADA
--
-- Dos piezas centrales de seguridad:
--   1) plantas_operativas: vista que expone la ficha SIN cruzamiento/mama/papa.
--      Es lo que consume el operario. Ocultar columnas se hace acá, NO en el
--      frontend (requisito no negociable #3).
--   2) obtener_planta(id): función RPC que devuelve la ficha COMPLETA solo si el
--      usuario tiene permiso, y SIEMPRE escribe en audit_log qué campos expuso.
--      Reemplaza al imposible "trigger ON SELECT" (Postgres no lo soporta).
-- =============================================================================


-- =============================================================================
-- VISTA: plantas_operativas
-- La ficha "de campo": todo lo operativo, cero linaje genético.
--
-- security_invoker = on  ← CRÍTICO.
-- Por default una vista corre con permisos de quien la creó (el dueño), lo que
-- SALTEA el RLS de la tabla base. Con security_invoker = on, la vista respeta
-- el RLS y los permisos del usuario que la consulta. Requiere Postgres 15+
-- (Supabase lo soporta). Sin este flag, la vista sería un agujero de seguridad.
-- =============================================================================
create view plantas_operativas
  with (security_invoker = on)
as
  select
    p.id,
    p.codigo_sistema,
    p.especie_id,
    e.nombre       as especie_nombre,
    p.estado,
    p.created_at,
    p.updated_at
    -- OJO: cruzamiento, mama y papa NO se seleccionan. No existen en esta vista.
  from plantas p
  join especies e on e.id = p.especie_id;

comment on view plantas_operativas is 'Ficha operativa SIN linaje genético. Consumo del rol operario. security_invoker=on respeta el RLS.';

-- Damos acceso de lectura a los usuarios autenticados sobre la vista.
grant select on plantas_operativas to authenticated;


-- =============================================================================
-- FUNCIÓN RPC: obtener_planta(p_planta_id uuid)
-- Punto de entrada AUDITADO para leer una ficha de planta.
--
-- Comportamiento:
--   - Siempre escribe una fila en audit_log (quién, qué planta, cuándo, qué campos).
--   - Si el usuario puede ver linaje → devuelve la ficha completa y registra
--     accion 'lectura_linaje' con los campos sensibles incluidos.
--   - Si no → devuelve la ficha sin linaje y registra accion 'lectura_ficha'.
--
-- SECURITY DEFINER: corre con permisos del dueño para poder (a) insertar en el
-- audit_log inmutable y (b) leer las columnas sensibles cuando corresponde,
-- aunque el rol authenticated tenga revocado el SELECT directo sobre ellas.
--
-- Devuelve JSONB en vez de una fila tipada porque la forma cambia según el
-- permiso (con o sin campos de linaje). Es más simple de consumir desde la app.
-- =============================================================================
create or replace function obtener_planta(p_planta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_ve_linaje  boolean := puede_ver_linaje_actual();
  v_planta     plantas;
  v_resultado  jsonb;
  v_campos     text[];
  v_accion     text;
begin
  -- 0) Debe haber un usuario autenticado.
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  -- 1) Traemos la fila completa (la función tiene permiso para leer todo).
  select * into v_planta from plantas where id = p_planta_id;

  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  -- 2) Armamos la respuesta según el permiso de linaje.
  if v_ve_linaje then
    v_accion := 'lectura_linaje';
    v_campos := array['codigo_sistema','especie_id','estado','cruzamiento','mama','papa'];
    v_resultado := jsonb_build_object(
      'id',             v_planta.id,
      'codigo_sistema', v_planta.codigo_sistema,
      'especie_id',     v_planta.especie_id,
      'estado',         v_planta.estado,
      'cruzamiento',    v_planta.cruzamiento,
      'mama',           v_planta.mama,
      'papa',           v_planta.papa,
      'created_at',     v_planta.created_at,
      'updated_at',     v_planta.updated_at
    );
  else
    v_accion := 'lectura_ficha';
    v_campos := array['codigo_sistema','especie_id','estado'];
    v_resultado := jsonb_build_object(
      'id',             v_planta.id,
      'codigo_sistema', v_planta.codigo_sistema,
      'especie_id',     v_planta.especie_id,
      'estado',         v_planta.estado,
      'created_at',     v_planta.created_at,
      'updated_at',     v_planta.updated_at
    );
  end if;

  -- 3) AUDITORÍA: registramos la lectura ANTES de devolver los datos.
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos)
  values (v_uid, p_planta_id, v_accion, v_campos);

  return v_resultado;
end;
$$;

comment on function obtener_planta is 'Lectura auditada de una planta. Registra en audit_log y expone linaje solo si el usuario tiene permiso.';

-- Permitimos que los usuarios autenticados llamen a la función RPC.
grant execute on function obtener_planta(uuid) to authenticated;
