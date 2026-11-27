-- A1-049: conservar resultado del intento sin cambiar la firma previa.
create function public.individualizar_plantas_una_vez(p_planta_id uuid, p_cantidad integer, p_clave uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_usuario uuid := auth.uid();
  v_previa jsonb;
  v_resultado jsonb;
begin
  if v_usuario is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if p_clave is null then raise exception 'Falta la clave del intento' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('individualizar:' || v_usuario::text || ':' || p_clave::text, 0));
  select detalle into v_previa from public.audit_log
    where usuario_id = v_usuario and accion = 'individualizacion_intento' and detalle->>'clave' = p_clave::text limit 1;
  if found then
    if v_previa->>'planta_id' is distinct from p_planta_id::text
      or (v_previa->>'cantidad')::integer is distinct from p_cantidad then
      raise exception 'El intento pertenece a otra cantidad o cruce. Revisa el envío pendiente antes de crear otro lote.' using errcode = '22023';
    end if;
    return v_previa->'resultado';
  end if;
  v_resultado := public.individualizar_plantas(p_planta_id, p_cantidad);
  insert into public.audit_log(usuario_id, planta_id, accion, campos_expuestos, detalle)
    values(v_usuario, p_planta_id, 'individualizacion_intento', array['codigo_display'],
      jsonb_build_object('clave', p_clave, 'planta_id', p_planta_id, 'cantidad', p_cantidad, 'resultado', v_resultado));
  return v_resultado;
end;
$$;
revoke all on function public.individualizar_plantas_una_vez(uuid,integer,uuid) from public, anon;
grant execute on function public.individualizar_plantas_una_vez(uuid,integer,uuid) to authenticated;
