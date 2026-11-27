-- =============================================================================
-- MIGRACIÓN 20260917000100 — reiniciar_cruzamiento también limpia
-- polinizacion_evento (dual-write, Paso A)
--
-- Mientras plantas.fecha_polinizacion/n_flores_cruzadas sigan existiendo
-- (Paso B pendiente, ver 20260917000000), reiniciar_cruzamiento debe borrar
-- AMBOS caminos del dato de polinización para no dejar filas huérfanas en
-- polinizacion_evento después de un reinicio. Redefine la función completa
-- (mismo cuerpo que 20260717002000_reiniciar_borrar_cruzamiento.sql) sumando
-- el borrado de polinizacion_evento al resto de los satélites y agregando su
-- conteo al snapshot auditado.
-- =============================================================================

create or replace function reiniciar_cruzamiento(p_planta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_planta      plantas;
  v_n_individuos int;
  v_snapshot    jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede reiniciar un cruzamiento' using errcode = '42501';
  end if;

  select * into v_planta from plantas where id = p_planta_id;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  select count(*) into v_n_individuos from individuos where planta_id = p_planta_id;

  v_snapshot := jsonb_build_object(
    'estado_anterior', v_planta.estado,
    'fecha_polinizacion', v_planta.fecha_polinizacion,
    'n_flores_cruzadas', v_planta.n_flores_cruzadas,
    'fecha_cosecha', v_planta.fecha_cosecha,
    'n_semillas', v_planta.n_semillas,
    'escarificacion_subtipo', v_planta.escarificacion_subtipo,
    'escarificacion_duracion_dias', v_planta.escarificacion_duracion_dias,
    'contenedor_id', v_planta.contenedor_id,
    'predio_id', v_planta.predio_id,
    'n_individuos_preexistentes', v_n_individuos,
    'n_registros_evento', (select count(*) from registros_evento where planta_id = p_planta_id),
    'n_germinacion_eventos', (select count(*) from germinacion_evento where planta_id = p_planta_id),
    'n_cosecha_frutos', (select count(*) from cosecha_fruto where planta_id = p_planta_id),
    'n_polinizacion_eventos', (select count(*) from polinizacion_evento where planta_id = p_planta_id),
    'n_insumos', (select count(*) from plantas_insumo where planta_id = p_planta_id)
  );

  delete from registros_evento where planta_id = p_planta_id;
  delete from germinacion_evento where planta_id = p_planta_id;
  delete from cosecha_fruto where planta_id = p_planta_id;
  delete from polinizacion_evento where planta_id = p_planta_id;
  delete from plantas_insumo where planta_id = p_planta_id;

  update plantas set
    estado = 'sin_empezar',
    fecha_polinizacion = null,
    n_flores_cruzadas = null,
    fecha_cosecha = null,
    n_semillas = null,
    escarificacion_subtipo = null,
    escarificacion_duracion_dias = null,
    contenedor_id = null,
    predio_id = null
  where id = p_planta_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'reinicio_cruzamiento', array['*'], v_snapshot);

  return jsonb_build_object('planta_id', p_planta_id, 'snapshot', v_snapshot, 'n_individuos_preexistentes', v_n_individuos);
end;
$$;

comment on function reiniciar_cruzamiento is 'Solo admin. Vuelve plantas.estado a sin_empezar y borra datos de fase del cruce (no toca individuos), incluyendo polinizacion_evento mientras dure el dual-write del Paso A. Audita snapshot completo antes de borrar.';
