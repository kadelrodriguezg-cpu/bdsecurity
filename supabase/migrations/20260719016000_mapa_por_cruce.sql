-- =============================================================================
-- SPRINT 5 (4/5) — Mapa por cruce. Corresponde a docs/BDSecurity_Documento_
-- Maestro.md, Fase 2 / 2.4.4.
--
-- Distinto de obtener_resumen_mapa_territorial (global, sin coordenadas, sin
-- acotar a un cruce) y de consultar_mapa_viewport (admin-only, coordenadas
-- exactas de emplazamiento_coordenada dentro de un viewport). Esta RPC es la
-- que pide 2.4.4: acotada a UN cruce, agregada por predio, usando
-- predio.latitud/longitud (Sprint 4) como fuente del pin — no
-- emplazamiento_coordenada, que es el override de precisión fina, no el
-- requisito. Accesible a cualquier autenticado (mismo criterio que el resto
-- de la ficha del cruce: no expone linaje, solo ubicación operativa).
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
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not exists (select 1 from plantas where id = p_planta_id and eliminado_at is null) then
    raise exception 'Cruce no encontrado' using errcode = 'P0002';
  end if;

  with vigentes as materialized (
    select
      ei.individuo_id,
      s.predio_id
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
      count(*) filter (where i.estado_vital = 'vivo')::integer as individuos_vivos
    from vigentes v
    join predio p on p.id = v.predio_id
    join individuos i on i.id = v.individuo_id
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
        'individuos_vivos', c.individuos_vivos
      ) order by c.predio_nombre)
      from clusters c
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function obtener_mapa_cruce(uuid) is
  'Emplazamientos vigentes de los individuos de UN cruce, agregados por predio (cluster + conteo + coordenada del predio). Fuente de coordenada: predio.latitud/longitud (Sprint 4), no emplazamiento_coordenada. tiene_coordenada=false cuando el predio no fue geolocalizado — el frontend decide si mostrar el cluster sin pin o solo el conteo.';

revoke all on function obtener_mapa_cruce(uuid) from public, anon;
grant execute on function obtener_mapa_cruce(uuid) to authenticated, service_role;
