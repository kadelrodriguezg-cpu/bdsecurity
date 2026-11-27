-- =============================================================================
-- MIGRACIÓN 008 — RPC actualizar_linaje: ÚNICO camino de escritura del linaje
--
-- Contexto: la migración 003 revocó el UPDATE directo de cruzamiento/mama/papa
-- para TODOS los usuarios de la API (en Supabase todos comparten el rol de
-- Postgres 'authenticated', así que el grant no puede distinguir admin de
-- operario). Resultado buscado: nadie edita linaje por UPDATE directo; el único
-- camino legítimo es esta función, que valida permisos de NEGOCIO y audita.
--
-- DECISIÓN: exige es_admin(), NO puede_ver_linaje_actual().
-- puede_ver_linaje es un permiso de LECTURA para operarios de confianza.
-- Escribir el linaje modifica el activo crítico del negocio: criterio más
-- estricto. Si en el futuro se decide que quien ve también edita, basta
-- cambiar es_admin() por puede_ver_linaje_actual() en el IF de abajo.
-- =============================================================================

create or replace function actualizar_linaje(
  p_planta_id   uuid,
  p_cruzamiento text,
  p_mama        text,
  p_papa        text
)
returns jsonb
language plpgsql
security definer            -- corre con permisos del dueño: puede escribir las
set search_path = public    -- columnas revocadas y y insertar en audit_log
as $$
declare
  v_uid     uuid := auth.uid();
  v_antes   plantas;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  -- Permiso de NEGOCIO: solo admin escribe linaje (ver decisión arriba).
  if not es_admin() then
    raise exception 'Solo un admin puede modificar el linaje genético'
      using errcode = '42501';
  end if;

  -- Capturamos los valores anteriores para el registro de auditoría.
  select * into v_antes from plantas where id = p_planta_id;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  update plantas
  set cruzamiento = p_cruzamiento,
      mama        = p_mama,
      papa        = p_papa
  where id = p_planta_id;

  -- AUDITORÍA: acción propia de escritura, con valores anteriores y nuevos en
  -- detalle (jsonb). El schema existente de audit_log alcanza sin cambios.
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    p_planta_id,
    'escritura_linaje',
    array['cruzamiento','mama','papa'],
    jsonb_build_object(
      'anterior', jsonb_build_object(
        'cruzamiento', v_antes.cruzamiento,
        'mama',        v_antes.mama,
        'papa',        v_antes.papa),
      'nuevo', jsonb_build_object(
        'cruzamiento', p_cruzamiento,
        'mama',        p_mama,
        'papa',        p_papa)
    )
  );

  return jsonb_build_object(
    'id',          p_planta_id,
    'cruzamiento', p_cruzamiento,
    'mama',        p_mama,
    'papa',        p_papa
  );
end;
$$;

comment on function actualizar_linaje is 'Único camino de escritura del linaje. Solo admin. Audita valores anteriores y nuevos.';

grant execute on function actualizar_linaje(uuid, text, text, text) to authenticated;
