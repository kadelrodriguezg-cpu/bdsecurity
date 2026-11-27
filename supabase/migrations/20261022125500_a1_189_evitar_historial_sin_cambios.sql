-- A1-189: no duplicar bitacora de siembra/cosecha si no hay cambios reales.
-- A1-023: columnas, materiales e historial se guardan en una transacción.
-- INVOKER conserva exactamente los grants y RLS de las escrituras anteriores.
create or replace function public.guardar_siembra(
  p_planta_id uuid, p_cambios jsonb, p_insumo_ids uuid[], p_sustratos jsonb,
  p_nota text, p_fecha date
) returns uuid language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_usuario uuid := auth.uid();
  v_registro uuid;
  v_nota text;
  v_columnas jsonb;
  v_insumos jsonb;
  v_sustratos jsonb;
begin
  if v_usuario is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object'
    or p_sustratos is null or jsonb_typeof(p_sustratos) <> 'array'
    or p_insumo_ids is null or p_fecha is null then
    raise exception 'Datos de siembra incompletos' using errcode = '22023';
  end if;
  perform id from public.plantas where id = p_planta_id for update;
  if not found then raise exception 'Planta inexistente o sin acceso' using errcode = 'P0002'; end if;
  -- A1-189: sin cambios reales se devuelve el último evento, sin escribir.
  -- Un archivo nuevo sí necesita un evento al que vincularse.
  select jsonb_build_object('escarificacion_subtipo', escarificacion_subtipo,
    'escarificacion_duracion_dias', escarificacion_duracion_dias,
    'contenedor_id', contenedor_id, 'semillas_sembradas', semillas_sembradas)
  into v_columnas from public.plantas where id = p_planta_id;
  select coalesce(jsonb_agg(insumo_id order by insumo_id), '[]'::jsonb) into v_insumos
    from public.plantas_insumo where planta_id = p_planta_id;
  select coalesce(jsonb_agg(jsonb_build_object('sustrato_id', sustrato_id, 'porcentaje', porcentaje) order by sustrato_id), '[]'::jsonb) into v_sustratos
    from public.plantas_sustrato where planta_id = p_planta_id;
  select id, notas into v_registro, v_nota from public.registros_evento
    where planta_id = p_planta_id and tipo_evento = 'siembra_semilla' and eliminado_at is null
    order by created_at desc, id desc limit 1;
  if found and not coalesce((p_cambios->>'registrar_archivo')::boolean, false)
    and v_nota is not distinct from nullif(p_nota, '')
    and v_columnas = jsonb_build_object('escarificacion_subtipo', (p_cambios->>'escarificacion_subtipo')::public.escarificacion_subtipo,
      'escarificacion_duracion_dias', (p_cambios->>'escarificacion_duracion_dias')::integer,
      'contenedor_id', (p_cambios->>'contenedor_id')::uuid, 'semillas_sembradas', (p_cambios->>'semillas_sembradas')::integer)
    and v_insumos = (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(p_insumo_ids) x)
    and v_sustratos = (select coalesce(jsonb_agg(jsonb_build_object('sustrato_id', sustrato_id, 'porcentaje', porcentaje) order by sustrato_id), '[]'::jsonb)
      from jsonb_to_recordset(p_sustratos) as x(sustrato_id uuid, porcentaje numeric))
  then return v_registro; end if;

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

create function public.guardar_cosecha(
  p_planta_id uuid, p_cambios jsonb,
  p_fecha_historial date, p_registrar_archivo boolean default false
) returns uuid language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_usuario uuid := auth.uid();
  v_fecha date;
  v_semillas integer;
  v_registro uuid;
  v_fecha_nueva date := (p_cambios->>'fecha_cosecha')::date;
  v_semillas_nuevas integer := (p_cambios->>'n_semillas')::integer;
begin
  if v_usuario is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  select fecha_cosecha, n_semillas into v_fecha, v_semillas
    from public.plantas where id = p_planta_id for update;
  if not found then raise exception 'Planta inexistente o sin acceso' using errcode = 'P0002'; end if;
  if not coalesce(p_registrar_archivo, false)
    and v_fecha is not distinct from v_fecha_nueva
    and v_semillas is not distinct from v_semillas_nuevas then
    select id into v_registro from public.registros_evento
      where planta_id = p_planta_id and tipo_evento = 'cosecha' and eliminado_at is null
      order by created_at desc, id desc limit 1;
    if found then return v_registro; end if;
  end if;
  update public.plantas set fecha_cosecha = v_fecha_nueva, n_semillas = v_semillas_nuevas where id = p_planta_id;
  if not found then raise exception 'No se pudo actualizar la planta' using errcode = '42501'; end if;
  insert into public.registros_evento(planta_id, tipo_evento, fecha, datos, created_by)
    values (p_planta_id, 'cosecha', p_fecha_historial,
      jsonb_build_object('fecha_cosecha', v_fecha_nueva, 'n_semillas', v_semillas_nuevas), v_usuario)
    returning id into v_registro;
  return v_registro;
end;
$$;
revoke all on function public.guardar_cosecha(uuid,jsonb,date,boolean) from public, anon;
grant execute on function public.guardar_cosecha(uuid,jsonb,date,boolean) to authenticated;
