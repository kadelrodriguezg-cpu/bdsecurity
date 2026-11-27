-- =============================================================================
-- Mid-fix (punto 1) — obtener_mapa_cruce agrega los códigos de individuo por
-- cluster. Hoy el popup del pin solo mostraba el conteo ("2 vivo(s) / 2
-- emplazado(s)"), sin decir CUÁLES individuos — se agrega el código corto
-- (el sufijo "P01"/"P02", sin repetir el código del cruce, que ya es
-- redundante dentro de un mapa acotado a un solo cruce).
-- =============================================================================

create or replace function obtener_mapa_cruce(p_planta_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_resultado jsonb;
  v_codigo_sistema text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  select codigo_sistema into v_codigo_sistema from plantas where id = p_planta_id and eliminado_at is null;
  if not found then
    raise exception 'Cruce no encontrado' using errcode = 'P0002';
  end if;

  with vigentes as materialized (
    select
      ei.individuo_id,
      s.predio_id,
      i.estado_vital,
      substring(i.codigo_display from length(v_codigo_sistema) + 2) as codigo_corto
    from emplazamiento_individuo ei
    join individuos i on i.id = ei.individuo_id
    join sector s on s.id = ei.sector_id
    where ei.fecha_fin is null
      and i.planta_id = p_planta_id
  ), clusters as (
    select
      p.id as predio_id,
      p.nombre as predio_nombre,
      p.latitud,
      p.longitud,
      count(*)::integer as individuos,
      count(*) filter (where v.estado_vital = 'vivo')::integer as individuos_vivos,
      jsonb_agg(jsonb_build_object('codigo_corto', v.codigo_corto, 'vivo', v.estado_vital = 'vivo') order by v.codigo_corto) as codigos
    from vigentes v
    join predio p on p.id = v.predio_id
    group by p.id, p.nombre, p.latitud, p.longitud
  )
  select jsonb_build_object(
    'planta_id', p_planta_id,
    'total_individuos_emplazados', (select count(*) from vigentes),
    'clusters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'predio_id', c.predio_id,
        'predio_nombre', c.predio_nombre,
        'latitud', c.latitud,
        'longitud', c.longitud,
        'tiene_coordenada', c.latitud is not null,
        'individuos', c.individuos,
        'individuos_vivos', c.individuos_vivos,
        'codigos_individuos', c.codigos
      ) order by c.predio_nombre)
      from clusters c
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function obtener_mapa_cruce(uuid) is
  'Emplazamientos vigentes de los individuos de UN cruce, agregados por predio (cluster + conteo + coordenada del predio + código corto de cada individuo emplazado ahí, ej. "P01"). Fuente de coordenada: predio.latitud/longitud (Sprint 4), no emplazamiento_coordenada. tiene_coordenada=false cuando el predio no fue geolocalizado.';
