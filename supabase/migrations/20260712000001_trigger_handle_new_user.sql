-- =============================================================================
-- MIGRACIÓN 012 — TRIGGER handle_new_user: crea el perfil automáticamente
--
-- Problema que cierra: no existía ningún trigger sobre auth.users, así que cada
-- usuario nuevo requería un INSERT manual en perfiles (paso que se saltó/perdió
-- en el incidente de producción y tuvo que reconstruirse a mano). Sin fila en
-- perfiles, es_admin()/puede_ver_linaje_actual() devuelven false y el usuario
-- queda sin acceso funcional aunque exista en Auth.
--
-- rol arranca en 'operario' (default de la tabla, menor privilegio) y
-- puede_ver_linaje en false. Ascender a admin sigue siendo un paso manual
-- deliberado (protegido además por el trigger anti-autoascenso, migración 006):
-- ningún usuario nuevo debe quedar admin por default.
--
-- nombre es NOT NULL sin default en perfiles: se completa con el metadata de
-- signup si vino (raw_user_meta_data->>'nombre'), si no con la parte local del
-- email, para no romper el INSERT por una columna obligatoria sin valor.
-- =============================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer            -- necesario: debe poder insertar en public.perfiles
set search_path = public    -- aunque el trigger corre en el schema auth
as $$
begin
  insert into public.perfiles (id, nombre)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nombre',
      split_part(new.email, '@', 1),
      'Sin nombre'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function handle_new_user is
  'Crea automáticamente la fila en perfiles al registrarse un usuario nuevo en auth.users. rol/puede_ver_linaje quedan en su default (operario/false); ascender a admin sigue siendo manual.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
