-- =============================================================================
-- MIGRACIÓN 20260917164630 — selector de rol parental en ranking de polinización
--
-- Conserva `ambos` como lectura predeterminada y agrega dos lentes analíticos:
-- `mama` y `papa`. No expone cruces ni roles por fila; el rol solo filtra el
-- agregado que una RPC admin-only devuelve. Reemplaza la firma anterior de un
-- argumento para evitar sobrecargas ambiguas en PostgREST.
-- =============================================================================

drop function if exists public.obtener_ranking_polinizacion_varietal(uuid);

create function public.obtener_ranking_polinizacion_varietal(
  p_especie_id uuid,
  p_rol text default 'ambos'
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

  if p_rol is null or p_rol not in ('ambos', 'mama', 'papa') then
    raise exception 'p_rol debe ser ambos, mama o papa'
      using errcode = '22023';
  end if;

  -- Una auditoría agregada por consulta conserva trazabilidad sin convertir
  -- este ranking en lecturas auditadas de fichas individuales.
  insert into public.audit_log (usuario_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    'lectura_ranking_polinizacion_varietal',
    array['variedad_nombre', 'flores_totales', 'sesiones_polinizacion', 'cruces_distintos'],
    jsonb_build_object('especie_id', p_especie_id, 'participacion_parental', p_rol)
  );

  return query
  with participaciones as (
    -- UNION (no UNION ALL) deduplica una autopolinización cuando se consulta
    -- ambos roles: la sesión se atribuye una vez a esa variedad y cruce.
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

comment on function public.obtener_ranking_polinizacion_varietal(uuid, text) is
  'Ranking admin-only de polinización por variedad parental y rol (ambos, mama o papa). Agrega sin exponer cruces ni roles individuales; fuente exclusiva: polinizacion_evento. Audita una vez por consulta.';

revoke all on function public.obtener_ranking_polinizacion_varietal(uuid, text) from public, anon;
grant execute on function public.obtener_ranking_polinizacion_varietal(uuid, text) to authenticated, service_role;

-- PostgREST conserva un caché de firmas RPC. La notificación se entrega al
-- confirmar la transacción, por lo que la nueva firma queda disponible sin
-- intervención manual tras aplicar la migración.
notify pgrst, 'reload schema';
