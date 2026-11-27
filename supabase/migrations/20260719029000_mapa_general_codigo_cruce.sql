-- =============================================================================
-- Mid-fix (punto 2) — el mapa territorial general no decía a qué cruzamiento
-- pertenecía cada pin/cluster, solo un conteo agregado ("4 emplazamientos
-- con coordenadas en el área visible"). Este mapa es de CRUZAMIENTOS con
-- emplazamientos, no de individuos sueltos.
--
-- Se mantiene el agrupamiento físico por sector (un pin = una ubicación
-- real, evita pines superpuestos si dos cruces comparten sector) y se
-- enriquece cada cluster/punto con el desglose por cruce dentro de esa
-- ubicación — "un pin con el código del cruce y el conteo" cuando el pin
-- corresponde a un solo cruce, y una lista de cruces cuando varios
-- comparten la misma ubicación.
-- =============================================================================

create or replace function obtener_resumen_mapa_territorial(
  p_especie_id uuid default null,
  p_predio_id uuid default null,
  p_sector_id uuid default null,
  p_limite integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if p_limite < 1 or p_limite > 500 or p_offset < 0 then
    raise exception 'Paginación territorial inválida' using errcode = '22023';
  end if;

  with base as materialized (
    select
      si.id as sitio_id, si.nombre as sitio_nombre,
      p.id as predio_id, p.nombre as predio_nombre, p.latitud, p.longitud,
      s.id as sector_id, s.nombre as sector_nombre,
      pl.id as planta_id, pl.codigo_sistema,
      i.estado_vital
    from emplazamiento_individuo ei
    join individuos i on i.id = ei.individuo_id
    join plantas pl on pl.id = i.planta_id
    join sector s on s.id = ei.sector_id
    join predio p on p.id = s.predio_id
    join sitio si on si.id = p.sitio_id
    where ei.fecha_fin is null
      and pl.eliminado_at is null
      and (p_especie_id is null or pl.especie_id = p_especie_id)
      and (p_predio_id is null or p.id = p_predio_id)
      and (p_sector_id is null or s.id = p_sector_id)
  ), por_cruce as (
    select
      sitio_id, sitio_nombre, predio_id, predio_nombre, latitud, longitud, sector_id, sector_nombre,
      planta_id, codigo_sistema,
      count(*)::integer as individuos,
      count(*) filter (where estado_vital = 'vivo')::integer as individuos_vivos
    from base
    group by sitio_id, sitio_nombre, predio_id, predio_nombre, latitud, longitud, sector_id, sector_nombre, planta_id, codigo_sistema
  ), clusters as (
    select
      sitio_id, sitio_nombre, predio_id, predio_nombre, latitud, longitud,
      (latitud is not null) as tiene_coordenada,
      sector_id, sector_nombre,
      sum(individuos)::integer as individuos,
      sum(individuos_vivos)::integer as individuos_vivos,
      jsonb_agg(jsonb_build_object(
        'planta_id', planta_id, 'codigo_sistema', codigo_sistema,
        'individuos', individuos, 'individuos_vivos', individuos_vivos
      ) order by codigo_sistema) as cruces
    from por_cruce
    group by sitio_id, sitio_nombre, predio_id, predio_nombre, latitud, longitud, sector_id, sector_nombre
  ), pagina as (
    select * from clusters
    order by sitio_nombre, predio_nombre, sector_nombre
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'precision', 'agregada',
    'total', (select count(*) from clusters),
    'limite', p_limite,
    'offset', p_offset,
    'clusters', coalesce((select jsonb_agg(to_jsonb(pagina) order by sitio_nombre, predio_nombre, sector_nombre) from pagina), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer) is
  'Mapa territorial agregado para cualquier usuario autenticado. Cada cluster incluye latitud/longitud del PREDIO (no sensible) y un desglose "cruces" (planta_id/codigo_sistema/conteos) de qué cruzamientos tienen individuos en esa ubicación — nunca expone emplazamiento_coordenada (fino, admin-only) ni linaje.';

revoke all on function obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer) to authenticated, service_role;


create or replace function consultar_mapa_viewport(
  p_latitud_minima numeric,
  p_latitud_maxima numeric,
  p_longitud_minima numeric,
  p_longitud_maxima numeric,
  p_especie_id uuid default null,
  p_limite integer default 250,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede consultar coordenadas por viewport'
      using errcode = '42501';
  end if;
  if p_latitud_minima is null or p_latitud_maxima is null
     or p_longitud_minima is null or p_longitud_maxima is null
     or p_latitud_minima >= p_latitud_maxima
     or p_longitud_minima >= p_longitud_maxima
     or p_latitud_minima < -90 or p_latitud_maxima > 90
     or p_longitud_minima < -180 or p_longitud_maxima > 180 then
    raise exception 'Viewport geográfico inválido' using errcode = '22023';
  end if;
  if p_limite < 1 or p_limite > 500 or p_offset < 0 then
    raise exception 'Paginación de viewport inválida' using errcode = '22023';
  end if;

  with puntos as (
    select
      ei.id as emplazamiento_id,
      s.id as sector_id,
      s.nombre as sector_nombre,
      p.id as predio_id,
      p.nombre as predio_nombre,
      si.id as sitio_id,
      si.nombre as sitio_nombre,
      pl.id as planta_id,
      pl.codigo_sistema,
      coalesce(ec.latitud, p.latitud) as latitud,
      coalesce(ec.longitud, p.longitud) as longitud,
      ec.precision_metros,
      case when ec.emplazamiento_id is not null then 'exacta' else 'predio' end as fuente
    from emplazamiento_individuo ei
    join individuos i on i.id = ei.individuo_id
    join plantas pl on pl.id = i.planta_id and pl.eliminado_at is null
    join sector s on s.id = ei.sector_id
    join predio p on p.id = s.predio_id
    join sitio si on si.id = p.sitio_id
    left join emplazamiento_coordenada ec on ec.emplazamiento_id = ei.id
    where ei.fecha_fin is null
      and coalesce(ec.latitud, p.latitud) is not null
      and coalesce(ec.longitud, p.longitud) is not null
      and coalesce(ec.latitud, p.latitud) between p_latitud_minima and p_latitud_maxima
      and coalesce(ec.longitud, p.longitud) between p_longitud_minima and p_longitud_maxima
      and (p_especie_id is null or pl.especie_id = p_especie_id)
  ), pagina as (
    select * from puntos
    order by sitio_nombre, predio_nombre, sector_nombre, latitud, longitud
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'precision', 'exacta_o_predio_admin',
    'total', (select count(*) from puntos),
    'limite', p_limite,
    'offset', p_offset,
    'puntos', coalesce((select jsonb_agg(to_jsonb(pagina) order by sitio_nombre, predio_nombre, sector_nombre, latitud, longitud) from pagina), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer) is
  'Consulta paginada de coordenadas por viewport, admin-only. Cada punto ahora incluye planta_id/codigo_sistema (a qué cruzamiento pertenece ese emplazamiento) — antes el mapa agrupaba por sector sin decir de qué cruce era cada pin. Usa COALESCE(emplazamiento_coordenada, predio.latitud/longitud); `fuente` por punto indica cuál de las dos se usó.';

revoke all on function consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer) from public, anon;
grant execute on function consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer) to authenticated, service_role;
