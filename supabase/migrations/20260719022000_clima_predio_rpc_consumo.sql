-- =============================================================================
-- Sprint 7.5.1 (3/4) — Clima histórico por predio: RPC de consumo.
-- Mismo patrón de obtener_mapa_cruce (2.4.4): p_predio_id XOR p_planta_id,
-- agregación por predio vía
-- emplazamiento_individuo/individuos/sector/predio.
--
-- A diferencia de obtener_mapa_cruce (que solo mira emplazamientos
-- VIGENTES porque responde "dónde están ahora"), acá se agregan TODOS los
-- predios donde el cruce tuvo individuos alguna vez, vigentes o no: el
-- objetivo de 2.8 es explicar evaluaciones pasadas ("¿el Brix bajo de este
-- año se explica por menos horas de sol?"), y esas evaluaciones pueden
-- corresponder a una temporada en la que el individuo ya no está en ese
-- predio.
--
-- SECURITY DEFINER (a diferencia de obtener_mapa_cruce, que es invoker):
-- probado en vivo que era necesario — el flag `sincronizando` mira
-- predio_clima_sync_pendiente, tabla interna sin ningún grant para
-- authenticated (deliberado, ver migración de esquema). En vez de abrir esa
-- tabla al cliente, esta RPC controla exactamente qué expone de ella (un
-- booleano, no la fila cruda) — mismo principio que obtener_planta().
-- =============================================================================

create or replace function obtener_clima_predio(p_predio_id uuid default null, p_planta_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if (p_predio_id is null) = (p_planta_id is null) then
    raise exception 'Se debe indicar exactamente uno de predio_id o planta_id.' using errcode = '22023';
  end if;

  if p_planta_id is not null and not exists (select 1 from plantas where id = p_planta_id and eliminado_at is null) then
    raise exception 'Cruce no encontrado' using errcode = 'P0002';
  end if;

  if p_predio_id is not null and not exists (select 1 from predio where id = p_predio_id) then
    raise exception 'Predio no encontrado' using errcode = 'P0002';
  end if;

  with predios_objetivo as (
    select p.id, p.nombre, p.latitud, p.longitud
    from predio p
    where p_predio_id is not null and p.id = p_predio_id
    union
    select distinct p.id, p.nombre, p.latitud, p.longitud
    from emplazamiento_individuo ei
    join individuos i on i.id = ei.individuo_id
    join sector s on s.id = ei.sector_id
    join predio p on p.id = s.predio_id
    where p_planta_id is not null and i.planta_id = p_planta_id
  )
  select jsonb_build_object(
    'predios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'predio_id', po.id,
        'predio_nombre', po.nombre,
        'tiene_coordenada', po.latitud is not null,
        'sincronizando', po.latitud is not null
          and not exists (select 1 from predio_clima_mensual where predio_id = po.id)
          and exists (select 1 from predio_clima_sync_pendiente where predio_id = po.id),
        'meses', coalesce((
          select jsonb_agg(jsonb_build_object(
            'anio', c.anio,
            'mes', c.mes,
            'temp_max_promedio', c.temp_max_promedio,
            'temp_min_promedio', c.temp_min_promedio,
            'horas_sol_acumuladas', c.horas_sol_acumuladas,
            'precipitacion_mm', c.precipitacion_mm,
            'dias_helada', c.dias_helada
          ) order by c.anio, c.mes)
          from predio_clima_mensual c
          where c.predio_id = po.id
        ), '[]'::jsonb)
      ) order by po.nombre)
      from predios_objetivo po
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function obtener_clima_predio(uuid, uuid) is
  'Resumen mensual cacheado de clima (2.8) para un predio (p_predio_id) o agregado sobre todos los predios donde un cruce tuvo individuos alguna vez vía multisitio (p_planta_id), exactamente uno de los dos. sincronizando=true indica que el predio está geolocalizado y tiene una sincronización despachada pero sin datos todavía (el frontend debe mostrar "Sincronizando..." en vez de un bloque vacío sin explicación); tiene_coordenada=false indica que ni siquiera se puede sincronizar (el frontend debe mostrar "Sin datos climáticos todavía", no confundirlo con sincronizando).';

revoke all on function obtener_clima_predio(uuid, uuid) from public, anon;
grant execute on function obtener_clima_predio(uuid, uuid) to authenticated, service_role;
