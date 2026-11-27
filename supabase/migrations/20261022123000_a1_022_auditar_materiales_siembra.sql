-- A1-022: cada cambio del conjunto de materiales conserva autor y valores.
-- No altera permisos ni convierte en atómica la edición completa (A1-023).
create function public.auditar_material_siembra()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_autor uuid := auth.uid();
  v_antes jsonb;
  v_nuevo jsonb;
  v_planta uuid;
  v_referencia uuid;
begin
  if tg_op <> 'INSERT' then v_antes := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_nuevo := to_jsonb(new); end if;
  v_planta := coalesce(new.planta_id, old.planta_id);
  -- En una baja en cascada, la planta ya puede no existir. Conservar su UUID
  -- en detalle sin intentar insertar una FK hacia la fila eliminada.
  select id into v_referencia from public.plantas where id = v_planta;
  if not exists (select 1 from public.perfiles where id = v_autor) then v_autor := null; end if;
  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_autor, v_referencia, 'cambio_material_siembra',
    case when tg_table_name = 'plantas_insumo' then array['insumo_id'] else array['sustrato_id', 'porcentaje'] end,
    jsonb_build_object('tabla', tg_table_name, 'planta_id', v_planta,
      'operacion', tg_op, 'anterior', v_antes, 'nuevo', v_nuevo));
  return null;
end;
$$;
revoke all on function public.auditar_material_siembra() from public, anon, authenticated;
create trigger plantas_insumo_auditar_cambios after insert or update or delete on public.plantas_insumo
for each row execute function public.auditar_material_siembra();
create trigger plantas_sustrato_auditar_cambios after insert or update or delete on public.plantas_sustrato
for each row execute function public.auditar_material_siembra();
