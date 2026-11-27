-- =============================================================================
-- Endurecimiento post-auditoría (04-10-2026): quitar a `anon` todo acceso a
-- objetos de `public`.
--
-- Contexto (auditoría de main e0cdc14, hallazgos R-02, M-01 y N-01): la
-- migración 009 supone que Supabase no concede DML por defecto. En un stack
-- reciente (el local, PostgreSQL 17) la ACL por defecto del rol postgres da
-- `anon=arwd` en tablas y `anon=X` en funciones, así que `anon` podía
-- ejecutar 13 funciones SECURITY DEFINER (entre ellas
-- procesar_respuesta_clima_predio, sin guardia de rol) y tenía
-- SELECT/INSERT/UPDATE/DELETE en 41 tablas y vistas, incluidas las columnas
-- de linaje de `plantas`. RLS lo bloqueaba, pero quedaba como única capa.
--
-- La aplicación no usa `anon` contra PostgREST: todas las rutas salvo /login
-- exigen sesión, y el login va a la API de Auth, no a `public`.
--
-- Qué NO cambia: el acceso efectivo de `authenticated`. Antes de revocar a
-- PUBLIC se concede explícitamente a `authenticated` (y `service_role`) cada
-- función que HOY ya puede ejecutar, así esta migración es neutra para la
-- app aunque en producción esos permisos vengan de PUBLIC y no de un grant
-- explícito. El recorte de `authenticated` queda como propuesta aparte.
--
-- Idempotente: REVOKE/GRANT repetidos no fallan ni cambian el resultado.
-- =============================================================================

-- 1) Funciones de public (no de trigger): preservar authenticated/service_role
--    y quitar PUBLIC y anon.
do $migracion$
declare
  v_funcion record;
begin
  for v_funcion in
    select p.oid::regprocedure as firma,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_ejecuta,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_ejecuta
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
  loop
    if v_funcion.authenticated_ejecuta then
      execute format('grant execute on function %s to authenticated', v_funcion.firma);
    end if;
    if v_funcion.service_role_ejecuta then
      execute format('grant execute on function %s to service_role', v_funcion.firma);
    end if;
    execute format('revoke execute on function %s from public, anon', v_funcion.firma);
  end loop;
end;
$migracion$;

-- 2) Tablas, vistas y secuencias: anon no tiene ningún uso legítimo.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 3) Objetos futuros creados por postgres en public: sin nada para anon.
--    (Solo FOR ROLE postgres: es el rol que ejecuta las migraciones.)
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

notify pgrst, 'reload schema';
