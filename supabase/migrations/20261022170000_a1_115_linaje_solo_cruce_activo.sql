-- A1-115: mismo contrato y ACL; solo cruces activos, bloqueados hasta finalizar la escritura.
create or replace function actualizar_linaje(
  p_planta_id   uuid,
  p_cruzamiento text,
  p_mama_id     uuid,
  p_papa_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_antes   plantas;
  v_count   int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if not es_admin() then
    raise exception 'Solo un admin puede modificar el linaje genético'
      using errcode = '42501';
  end if;

  select count(*) into v_count
  from audit_log
  where usuario_id = v_uid
    and accion = 'escritura_linaje'
    and ocurrido_en > now() - interval '60 seconds';

  if v_count >= 10 then
    raise exception 'Rate limit excedido: máximo 10 escrituras de linaje por minuto por usuario'
      using errcode = '58503';
  end if;

  select * into v_antes from plantas where id = p_planta_id and eliminado_at is null for update;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  update plantas
  set cruzamiento = p_cruzamiento,
      mama_id     = p_mama_id,
      papa_id     = p_papa_id
  where id = p_planta_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    p_planta_id,
    'escritura_linaje',
    array['cruzamiento', 'mama_id', 'papa_id'],
    jsonb_build_object(
      'anterior', jsonb_build_object('cruzamiento', v_antes.cruzamiento, 'mama_id', v_antes.mama_id, 'papa_id', v_antes.papa_id),
      'nuevo',    jsonb_build_object('cruzamiento', p_cruzamiento, 'mama_id', p_mama_id, 'papa_id', p_papa_id)
    )
  );

  return jsonb_build_object('id', p_planta_id, 'cruzamiento', p_cruzamiento, 'mama_id', p_mama_id, 'papa_id', p_papa_id);
end;
$$;

