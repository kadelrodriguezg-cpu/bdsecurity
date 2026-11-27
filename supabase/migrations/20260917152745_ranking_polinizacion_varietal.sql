-- =============================================================================
-- MIGRACIÓN 20260917152745 — Ranking de priorización varietal por polinización
--
-- Fuente de verdad: polinizacion_evento. No leer
-- plantas.n_flores_cruzadas/fecha_polinizacion: son columnas legacy del
-- dual-write, pendientes de retiro con autorización separada.
--
-- La función agrega por variedad de mamá o papá sin exponer el cruce ni el
-- rol por fila. Requiere SECURITY DEFINER porque mama_id/papa_id no tienen
-- SELECT directo para authenticated; autoriza explícitamente solo a admins.
-- =============================================================================

create or replace function public.obtener_ranking_polinizacion_varietal(
  p_especie_id uuid
)
returns table (
  variedad_id uuid,
  variedad_nombre text,
  flores_totales bigint,
  sesiones_polinizacion bigint,
  cruces_distintos bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if not public.es_admin() then
    raise exception 'Solo un admin puede consultar el ranking varietal de polinización'
      using errcode = '42501';
  end if;

  if p_especie_id is null then
    raise exception 'Selecciona una especie antes de consultar el ranking varietal de polinización'
      using errcode = '22023';
  end if;

  -- Una auditoría agregada por consulta conserva trazabilidad sin convertir
  -- este ranking en decenas de lecturas auditadas de fichas individuales.
  insert into public.audit_log (usuario_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    'lectura_ranking_polinizacion_varietal',
    array['variedad_nombre', 'flores_totales', 'sesiones_polinizacion', 'cruces_distintos'],
    jsonb_build_object('especie_id', p_especie_id)
  );

  return query
  with participaciones as (
    -- UNION deduplica el caso excepcional de autopolinización: una sesión de
    -- un mismo cruce no debe contarse dos veces si la variedad es mamá y papá.
    select p.id as planta_id, p.mama_id as variedad_id
    from public.plantas p
    where p.especie_id = p_especie_id
      and p.eliminado_at is null
      and p.mama_id is not null

    union

    select p.id as planta_id, p.papa_id as variedad_id
    from public.plantas p
    where p.especie_id = p_especie_id
      and p.eliminado_at is null
      and p.papa_id is not null
  )
  select
    participaciones.variedad_id,
    v.nombre,
    coalesce(sum(pe.n_flores_cruzadas), 0)::bigint as flores_totales,
    count(pe.id)::bigint as sesiones_polinizacion,
    count(distinct participaciones.planta_id)::bigint as cruces_distintos
  from participaciones
  join public.variedades v on v.id = participaciones.variedad_id
  left join public.polinizacion_evento pe on pe.planta_id = participaciones.planta_id
  group by participaciones.variedad_id, v.nombre
  order by flores_totales desc, v.nombre asc;
end;
$$;

comment on function public.obtener_ranking_polinizacion_varietal(uuid) is
  'Ranking admin-only de actividad de polinización por variedad parental. Agrega mamá y papá sin exponer cruces ni roles individuales; fuente exclusiva: polinizacion_evento. Audita una vez por consulta.';

revoke all on function public.obtener_ranking_polinizacion_varietal(uuid) from public, anon;
grant execute on function public.obtener_ranking_polinizacion_varietal(uuid) to authenticated, service_role;
