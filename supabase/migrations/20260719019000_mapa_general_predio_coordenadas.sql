-- =============================================================================
-- MID-FIX Sprint 7.5, Parte D — el mapa general de /visualizaciones nunca
-- podía mostrar pines: consultar_mapa_viewport (admin) solo leía
-- emplazamiento_coordenada, que en producción tiene 0 filas — la UI de
-- traslado (MultisitioForm.tsx) nunca captura ni envía p_latitud/p_longitud
-- a registrar_traslado_individuo. No es un bug de invalidación de caché
-- (patrón "linaje no refresca tras guardar"): es que el RPC apunta a un
-- modelo de coordenada (override fino por emplazamiento, Sprint 5/6) que la
-- geolocalización de predios (Sprint 4, poblada de verdad recién en este
-- mid-fix vía el selector de mapa de Catálogos) nunca alimentó ni iba a
-- alimentar. obtener_mapa_cruce (Sprint 5/7) ya resuelve esto bien para UN
-- cruce, usando predio.latitud/longitud como fuente; se aplica el mismo
-- criterio acá para el mapa general.
--
-- Ambas RPC se extienden (decisión confirmada, no ambas es la opción menor):
--
-- 1) obtener_resumen_mapa_territorial (agregado, cualquier autenticado, sin
--    coordenadas por diseño original): se agrega predio.latitud/longitud +
--    tiene_coordenada por cluster. Sigue sin exponer emplazamiento_
--    coordenada (fino, admin-only) — la coordenada de predio no es dato de
--    precisión sensible, es la misma que ya expone obtener_mapa_cruce a
--    cualquier autenticado para un cruce puntual.
-- 2) consultar_mapa_viewport (admin, "coordenadas exactas"): pasa a hacer
--    LEFT JOIN contra emplazamiento_coordenada y usar COALESCE(fino, predio)
--    — un punto aparece si tiene CUALQUIERA de las dos fuentes. Se agrega
--    `fuente` ('exacta'|'predio') por punto para que quien consuma el dato
--    pueda distinguir precisión si lo necesita. El label de `precision` se
--    corrige de 'exacta_admin' a 'exacta_o_predio_admin' para no mentir
--    sobre qué garantiza la respuesta ahora.
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

  with clusters as (
    select
      si.id as sitio_id,
      si.nombre as sitio_nombre,
      p.id as predio_id,
      p.nombre as predio_nombre,
      p.latitud,
      p.longitud,
      (p.latitud is not null) as tiene_coordenada,
      s.id as sector_id,
      s.nombre as sector_nombre,
      count(ei.id)::integer as individuos,
      count(ei.id) filter (where i.estado_vital = 'vivo')::integer as individuos_vivos
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
    group by si.id, si.nombre, p.id, p.nombre, p.latitud, p.longitud, s.id, s.nombre
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
  'Mapa territorial agregado para cualquier usuario autenticado. Desde el mid-fix de Sprint 7.5 incluye latitud/longitud del PREDIO por cluster (mismo dato que obtener_mapa_cruce, no sensible) — nunca expone emplazamiento_coordenada (fino, admin-only) ni referencias operativas.';

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
  'Consulta paginada de coordenadas por viewport, admin-only. Desde el mid-fix de Sprint 7.5 usa COALESCE(emplazamiento_coordenada, predio.latitud/longitud) — antes solo leía la coordenada fina, que en la práctica nunca se captura desde la UI de traslado actual, así que el mapa quedaba siempre vacío. `fuente` por punto indica cuál de las dos se usó.';

revoke all on function consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer) from public, anon;
grant execute on function consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer) to authenticated, service_role;
