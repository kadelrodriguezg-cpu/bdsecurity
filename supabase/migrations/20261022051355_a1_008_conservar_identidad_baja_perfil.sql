-- A1-008: identidad de lecturas y resumen de autoría al eliminar un perfil.
-- Solo actúa ante bajas futuras: no reescribe datos al aplicar la migración,
-- no cambia FK ni modifica ninguna de las tablas científicas.

-- Un enriquecimiento de identidad no debe ejecutar la redacción histórica
-- opcional de A1-004. Los nuevos INSERT y otros cambios de detalle conservan
-- la redacción. Una actualización de FK sin cambiar detalle tampoco lo copia.
create or replace function public.redactar_auditoria_linaje()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if new.detalle is not distinct from old.detalle then return new; end if;
    if new.detalle ? 'usuario_eliminado'
       and (new.detalle - 'usuario_eliminado') is not distinct from (old.detalle - 'usuario_eliminado')
       and jsonb_typeof(new.detalle->'usuario_eliminado') = 'object'
       and ((new.detalle->'usuario_eliminado') - array['id', 'correo', 'nombre']) = '{}'::jsonb then
      return new;
    end if;
  end if;
  new.detalle := public.redactar_texto_linaje(new.detalle);
  return new;
end;
$$;
revoke all on function public.redactar_auditoria_linaje() from public, anon, authenticated;

-- La cascada Auth puede hacer invisible auth.users antes de borrar perfiles.
-- Conservar únicamente el correo en el contexto LOCAL de la transacción,
-- con una clave por usuario (también funciona al borrar varias cuentas).
create or replace function public.recordar_correo_baja_auth()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform set_config('bdsecurity.baja_correo_' || replace(old.id::text, '-', '_'), coalesce(old.email, ''), true);
  return old;
end;
$$;
revoke all on function public.recordar_correo_baja_auth() from public, anon, authenticated;
create trigger auth_recordar_correo_baja before delete on auth.users
for each row execute function public.recordar_correo_baja_auth();

create or replace function public.conservar_identidad_baja_perfil()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_correo text;
  v_identidad jsonb;
  v_conteos jsonb := '{}';
  v_tabla record;
  v_total bigint;
  v_autor uuid := auth.uid();
begin
  select email into v_correo from auth.users where id = old.id;
  if not found then
    v_correo := nullif(current_setting('bdsecurity.baja_correo_' || replace(old.id::text, '-', '_'), true), '');
  end if;
  v_identidad := jsonb_build_object('id', old.id, 'correo', v_correo, 'nombre', old.nombre);

  -- Solo conteos de las FK científicas created_by SET NULL; identificadores
  -- obtenidos del catálogo, entrecomillados, sin SQL aportado por el cliente.
  for v_tabla in
    select t.relname from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.perfiles'::regclass
      and c.confdeltype = 'n' and cardinality(c.conkey) = 1
      and n.nspname = 'public' and a.attname = 'created_by'
    order by t.relname
  loop
    execute format('select count(*) from public.%I where created_by = $1', v_tabla.relname)
      into v_total using old.id;
    v_conteos := v_conteos || jsonb_build_object(v_tabla.relname, v_total);
  end loop;

  if not exists (select 1 from public.perfiles where id = v_autor) then v_autor := null; end if;
  insert into public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_autor, null, 'baja_perfil', array['id', 'correo', 'nombre', 'rol', 'puede_ver_linaje'],
    jsonb_build_object('perfil_id', old.id, 'correo', v_correo, 'nombre', old.nombre,
      'rol', old.rol, 'puede_ver_linaje', old.puede_ver_linaje, 'autoria_cientifica', v_conteos));

  update public.audit_log set detalle = detalle || jsonb_build_object('usuario_eliminado', v_identidad)
    where usuario_id = old.id;
  return old;
end;
$$;
revoke all on function public.conservar_identidad_baja_perfil() from public, anon, authenticated;
create trigger perfiles_conservar_identidad_baja before delete on public.perfiles
for each row execute function public.conservar_identidad_baja_perfil();
