-- =============================================================================
-- MIGRACIÓN 20260917172253 — resumen real en ranking de polinización
--
-- Entrega en la misma RPC el ranking por variedad y un único resumen de flores
-- físicas de campo. El resumen no suma filas parentales: cada evento cuenta
-- una vez, aun cuando el cruce tenga mamá y papá distintos.
-- =============================================================================

drop function if exists public.obtener_ranking_polinizacion_varietal(uuid, text);

create function public.obtener_ranking_polinizacion_varietal(
  p_especie_id uuid,
  p_rol text default 'ambos'
)
returns table (
  tipo_fila text,
  variedad_id uuid,
  variedad_nombre text,
  flores_totales bigint,
  sesiones_polinizacion bigint,
  cruces_distintos bigint,
  flores_reales bigint
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

  if p_rol is null or p_rol not in ('ambos', 'mama', 'papa') then
    raise exception 'p_rol debe ser ambos, mama o papa'
      using errcode = '22023';
  end if;

  -- Una auditoría cubre tanto filas por variedad como resumen, sin convertir
  -- la vista en lecturas auditadas de fichas individuales.
  insert into public.audit_log (usuario_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    'lectura_ranking_polinizacion_varietal',
    array[
      'variedad_nombre',
      'flores_totales',
      'sesiones_polinizacion',
      'cruces_distintos',
      'flores_reales'
    ],
    jsonb_build_object('especie_id', p_especie_id, 'participacion_parental', p_rol)
  );

  return query
  with participaciones as (
    -- UNION (no UNION ALL) deduplica autopolinización para las filas del
    -- ranking. No afecta el resumen, que parte de eventos por cruce.
    select p.id as planta_id, p.mama_id as variedad_id
    from public.plantas p
    where p.especie_id = p_especie_id
      and p.eliminado_at is null
      and p.mama_id is not null
      and p_rol in ('ambos', 'mama')

    union

    select p.id as planta_id, p.papa_id as variedad_id
    from public.plantas p
    where p.especie_id = p_especie_id
      and p.eliminado_at is null
      and p.papa_id is not null
      and p_rol in ('ambos', 'papa')
  ),
  ranking_varietal as (
    select
      participaciones.variedad_id,
      v.nombre as variedad_nombre,
      coalesce(sum(pe.n_flores_cruzadas), 0)::bigint as flores_totales,
      count(pe.id)::bigint as sesiones_polinizacion,
      count(distinct participaciones.planta_id)::bigint as cruces_distintos
    from participaciones
    join public.variedades v on v.id = participaciones.variedad_id
    left join public.polinizacion_evento pe on pe.planta_id = participaciones.planta_id
    group by participaciones.variedad_id, v.nombre
  ),
  resumen_campo as (
    -- No filtra por p_rol: mamá/papá es una lente de distribución, mientras
    -- este total responde cuántas flores se polinizaron realmente en campo.
    select coalesce(sum(pe.n_flores_cruzadas), 0)::bigint as flores_reales
    from public.plantas p
    left join public.polinizacion_evento pe on pe.planta_id = p.id
    where p.especie_id = p_especie_id
      and p.eliminado_at is null
  )
  select
    resultado.tipo_fila,
    resultado.variedad_id,
    resultado.variedad_nombre,
    resultado.flores_totales,
    resultado.sesiones_polinizacion,
    resultado.cruces_distintos,
    resultado.flores_reales
  from (
    select
      'variedad'::text as tipo_fila,
      rv.variedad_id,
      rv.variedad_nombre,
      rv.flores_totales,
      rv.sesiones_polinizacion,
      rv.cruces_distintos,
      null::bigint as flores_reales
    from ranking_varietal rv

    union all

    select
      'resumen'::text as tipo_fila,
      null::uuid as variedad_id,
      null::text as variedad_nombre,
      null::bigint as flores_totales,
      null::bigint as sesiones_polinizacion,
      null::bigint as cruces_distintos,
      rc.flores_reales
    from resumen_campo rc
  ) resultado
  order by
    (resultado.tipo_fila = 'resumen'),
    resultado.flores_totales desc nulls last,
    resultado.variedad_nombre asc nulls last;
end;
$$;

comment on function public.obtener_ranking_polinizacion_varietal(uuid, text) is
  'Ranking admin-only de polinización por variedad parental y rol, más resumen de flores reales por especie. Agrega sin exponer cruces ni roles individuales; fuente exclusiva: polinizacion_evento. Audita una vez por consulta.';

revoke all on function public.obtener_ranking_polinizacion_varietal(uuid, text) from public, anon;
grant execute on function public.obtener_ranking_polinizacion_varietal(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
