-- A1-006: límite duro por llamada; no cambia las demás reglas ni privilegios.
create or replace function individualizar_plantas(
  p_planta_id uuid,
  p_cantidad  int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_estado  estado_planta;
  v_codigos text[] := '{}';
  v_id      uuid;
  v_codigo  text;
  i         int;
  v_max_por_llamada constant integer := 1000; -- Decisión 3; al cambiar, alinear constante UX de Fase B.
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if p_cantidad is null or p_cantidad < 1 then
    raise exception 'La cantidad a individualizar debe ser al menos 1' using errcode = '22023';
  end if;

  if p_cantidad > v_max_por_llamada then
    raise exception 'Máximo % individuos por llamada. Divide la cantidad en varios lotes.', v_max_por_llamada using errcode = '22023';
  end if;
  select estado into v_estado from plantas where id = p_planta_id;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  -- Único punto de individualización: la fase Trasplante (North Star, principio 3).
  if v_estado <> 'trasplante' then
    raise exception 'Solo se pueden individualizar plantas en estado trasplante (estado actual: %)', v_estado
      using errcode = '42501';
  end if;

  -- Inserta una fila por unidad. codigo_display lo calcula el trigger
  -- trg_individuos_codigo_display (correlativo, serializado con advisory lock).
  for i in 1..p_cantidad loop
    insert into individuos (planta_id, created_by)
    values (p_planta_id, v_uid)
    returning id, codigo_display into v_id, v_codigo;
    v_codigos := array_append(v_codigos, v_codigo);
  end loop;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    p_planta_id,
    'individualizacion',
    array['codigo_display'],
    jsonb_build_object('cantidad', p_cantidad, 'codigos', to_jsonb(v_codigos))
  );

  return jsonb_build_object('cantidad', p_cantidad, 'codigos', to_jsonb(v_codigos));
end;
$$;

comment on function individualizar_plantas is 'Crea entre 1 y 1000 individuos por llamada para una planta en estado trasplante. Único camino de individualización. Audita cantidad y códigos generados.';

grant execute on function individualizar_plantas(uuid, int) to authenticated;
