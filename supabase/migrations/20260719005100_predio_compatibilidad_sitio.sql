-- Compatibilidad temporal para consumidores legacy que todavía crean predios
-- enviando solo nombre/activo. Sprint 4 podrá hacer explícito el selector de
-- sitio sin romper mientras tanto la administración existente del catálogo.

create or replace function completar_sitio_predio_legacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sitio_id is null then
    select id into new.sitio_id
    from sitio
    where nombre = 'Sitio legado sin clasificar';
  end if;
  return new;
end;
$$;

create trigger trg_predio_sitio_compatibilidad
  before insert on predio
  for each row execute function completar_sitio_predio_legacy();

comment on function completar_sitio_predio_legacy is
  'Compatibilidad temporal: asigna el sitio neutro si un consumidor anterior no envía sitio_id.';

