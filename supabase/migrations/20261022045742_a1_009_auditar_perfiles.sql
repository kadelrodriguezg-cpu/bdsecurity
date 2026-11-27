-- A1-009: cambios de identidad y privilegios quedan auditados en la misma
-- transacción. No cambia grants, policies ni el trigger anti-autoascenso.
create or replace function public.auditar_cambio_perfil()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_autor uuid := auth.uid();
  v_antes jsonb;
  v_nuevo jsonb;
begin
  if tg_op <> 'INSERT' then v_antes := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_nuevo := to_jsonb(new); end if;
  -- Una baja de cuenta puede ejecutarse sin actor humano, o sobre el propio
  -- actor. No insertar una FK hacia un perfil que acaba de desaparecer.
  if not exists (select 1 from public.perfiles where id = v_autor) then v_autor := null; end if;
  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_autor, null, 'cambio_perfil', array['nombre', 'rol', 'puede_ver_linaje'],
    jsonb_build_object('perfil_id', coalesce(new.id, old.id), 'operacion', tg_op,
      'anterior', v_antes, 'nuevo', v_nuevo));
  return null;
end;
$$;
revoke all on function public.auditar_cambio_perfil() from public, anon, authenticated;
create trigger perfiles_auditar_cambios after insert or update or delete on public.perfiles
for each row execute function public.auditar_cambio_perfil();
