-- El default hace que los tipos generados mantengan `sitio_id` opcional para
-- consumidores legacy. El trigger de la migración anterior sigue siendo una
-- segunda defensa para inserts SQL que envíen NULL explícitamente.

create or replace function sitio_predeterminado_legacy()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from sitio
  where nombre = 'Sitio legado sin clasificar'
  limit 1
$$;

alter table predio
  alter column sitio_id set default sitio_predeterminado_legacy();

revoke all on function sitio_predeterminado_legacy() from public, anon;
grant execute on function sitio_predeterminado_legacy() to authenticated, service_role;

