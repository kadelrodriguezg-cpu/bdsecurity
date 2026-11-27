-- Consulta acotada para el selector de objetivos por predio. Devuelve solo
-- población activa agregada; no expone coordenadas ni referencias precisas.

create or replace function listar_predios_activos_cruzamiento(p_planta_id uuid)
returns table (predio_id uuid, predio_nombre text, individuos_activos bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  return query
  select p.id, p.nombre, count(e.individuo_id)
  from emplazamiento_individuo e
  join individuos i on i.id = e.individuo_id
  join sector s on s.id = e.sector_id
  join predio p on p.id = s.predio_id
  where i.planta_id = p_planta_id
    and e.fecha_fin is null
  group by p.id, p.nombre
  order by p.nombre;
end;
$$;

revoke all on function listar_predios_activos_cruzamiento(uuid) from public, anon;
grant execute on function listar_predios_activos_cruzamiento(uuid) to authenticated, service_role;

