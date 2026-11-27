-- A1-010: conservar el rastro de renombrar/desactivar o borrar catálogos.
-- BEFORE permite contar referencias antes de las acciones de las FK. Si la
-- operación es rechazada, también se revierte su auditoría.
create or replace function public.auditar_cambio_catalogo_linaje()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_autor uuid := auth.uid();
  v_cruces bigint;
  v_nuevo jsonb;
begin
  if not exists (select 1 from public.perfiles where id = v_autor) then v_autor := null; end if;
  if tg_table_name = 'variedades' then
    select count(*) into v_cruces from public.plantas where mama_id = old.id or papa_id = old.id;
  else
    select count(*) into v_cruces from public.plantas where especie_id = old.id;
  end if;
  if tg_op <> 'DELETE' then v_nuevo := to_jsonb(new); end if;
  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_autor, null, case when tg_table_name = 'variedades' then 'cambio_variedad' else 'cambio_especie' end,
    array['nombre', 'activo'], jsonb_build_object('catalogo', tg_table_name, 'entidad_id', old.id,
      'operacion', tg_op, 'nombre_anterior', old.nombre, 'nombre_nuevo', v_nuevo->'nombre',
      'activo_anterior', to_jsonb(old)->'activo', 'activo_nuevo', v_nuevo->'activo', 'cruces_afectados', v_cruces));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.auditar_cambio_catalogo_linaje() from public, anon, authenticated;
create trigger variedades_auditar_cambios before update or delete on public.variedades
for each row execute function public.auditar_cambio_catalogo_linaje();
create trigger especies_auditar_cambios before update or delete on public.especies
for each row execute function public.auditar_cambio_catalogo_linaje();
