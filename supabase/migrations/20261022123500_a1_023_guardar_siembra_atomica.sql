-- A1-023: columnas, materiales e historial se guardan en una transacción.
-- INVOKER conserva exactamente los grants y RLS de las escrituras anteriores.
create or replace function public.guardar_siembra(
  p_planta_id uuid, p_cambios jsonb, p_insumo_ids uuid[], p_sustratos jsonb,
  p_nota text, p_fecha date
) returns uuid language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_usuario uuid := auth.uid();
  v_registro uuid;
begin
  if v_usuario is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object'
    or p_sustratos is null or jsonb_typeof(p_sustratos) <> 'array'
    or p_insumo_ids is null or p_fecha is null then
    raise exception 'Datos de siembra incompletos' using errcode = '22023';
  end if;
  perform id from public.plantas where id = p_planta_id for update;
  if not found then raise exception 'Planta inexistente o sin acceso' using errcode = 'P0002'; end if;
  update public.plantas set
    escarificacion_subtipo = (p_cambios->>'escarificacion_subtipo')::public.escarificacion_subtipo,
    escarificacion_duracion_dias = (p_cambios->>'escarificacion_duracion_dias')::integer,
    contenedor_id = (p_cambios->>'contenedor_id')::uuid,
    semillas_sembradas = (p_cambios->>'semillas_sembradas')::integer
  where id = p_planta_id;
  if not found then raise exception 'No se pudo actualizar la planta' using errcode = '42501'; end if;
  delete from public.plantas_insumo where planta_id = p_planta_id;
  insert into public.plantas_insumo(planta_id, insumo_id)
    select p_planta_id, x from unnest(p_insumo_ids) x;
  delete from public.plantas_sustrato where planta_id = p_planta_id;
  insert into public.plantas_sustrato(planta_id, sustrato_id, porcentaje)
    select p_planta_id, x.sustrato_id, x.porcentaje
    from jsonb_to_recordset(p_sustratos) as x(sustrato_id uuid, porcentaje numeric);
  insert into public.registros_evento(planta_id, tipo_evento, fecha, datos, created_by, notas)
  values (p_planta_id, 'siembra_semilla', p_fecha,
    jsonb_build_object('escarificacion_subtipo', p_cambios->'escarificacion_subtipo',
      'escarificacion_duracion_dias', p_cambios->'escarificacion_duracion_dias',
      'contenedor_id', p_cambios->'contenedor_id', 'semillas_sembradas', p_cambios->'semillas_sembradas',
      'insumo_ids', to_jsonb(p_insumo_ids), 'sustratos', p_sustratos), v_usuario, nullif(p_nota, ''))
  returning id into v_registro;
  return v_registro;
end;
$$;
revoke all on function public.guardar_siembra(uuid,jsonb,uuid[],jsonb,text,date) from public, anon;
grant execute on function public.guardar_siembra(uuid,jsonb,uuid[],jsonb,text,date) to authenticated;
