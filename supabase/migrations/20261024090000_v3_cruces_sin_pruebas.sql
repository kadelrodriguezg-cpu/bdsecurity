-- =============================================================================
-- MIGRACIÓN 20261024090000 — CRUCES DE PRUEBA FUERA DE LA LISTA DE CRUCES Y DEL PANEL (v3, N4; docs/rediseno_v3/inicio_cruces.md)
--
-- Antes: `listar_cruces_analiticos` (lista de Cruces) y `obtener_dashboard_cientifico` (Panel científico, y
-- desde v3 también Inicio) devolvían los cruces de prueba (`es_prueba = true`) a todos; solo
-- `conteo_cruces_por_estado` los excluía.
-- Ahora: las dos reciben `p_incluir_pruebas boolean default false`. Por defecto los cruces de prueba quedan fuera
-- para todos; con `true`, un admin los ve (un operario nunca). La firma vieja se reemplaza (DROP + CREATE) y se
-- vuelven a dar los mismos permisos (EXECUTE a authenticated y service_role). La app anterior sigue funcionando:
-- llama sin el parámetro y recibe la lista sin pruebas.
-- Además (v3 paso 6): la lista devuelve `es_prueba` en cada fila, y los «pendientes» del panel (Actividad
-- pendiente de Inicio) se cuentan como la planilla: individuos vivos sin evaluación cerrada en la última ronda
-- (antes, los no elegibles del ranking antiguo, que exige todas las métricas).
-- Y (v3 paso 7): la lista acepta `p_solo_pendientes` (por defecto false) para mostrar solo los cruces con individuos
-- pendientes, con la misma regla; es el destino de «Ver todo» de Actividad pendiente en Inicio.
--
-- Paquete: parte del despliegue de v3 (docs/rediseno_v3/paquete_v3.md). No se aplica sola.
-- =============================================================================

drop function if exists public.listar_cruces_analiticos(uuid, estado_planta, text, text, integer, integer);
-- Firma intermedia de esta misma migración (solo existió en bases locales de desarrollo).
drop function if exists public.listar_cruces_analiticos(uuid, estado_planta, text, text, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.listar_cruces_analiticos(p_especie_id uuid DEFAULT NULL::uuid, p_estado estado_planta DEFAULT NULL::estado_planta, p_busqueda text DEFAULT NULL::text, p_orden text DEFAULT 'actividad_desc'::text, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0, p_incluir_pruebas boolean DEFAULT false, p_solo_pendientes boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if p_limite < 1 or p_limite > 100 or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode = '22023';
  end if;
  if p_orden not in ('actividad_desc', 'codigo_asc', 'estado_asc', 'especie_asc', 'vivos_desc', 'scoring_desc') then
    raise exception 'Orden no permitido' using errcode = '22023';
  end if;

  with base as materialized (
    select
      p.id,
      p.codigo_sistema,
      p.especie_id,
      p.especie_nombre,
      p.estado,
      -- v3: la marca va en cada fila para que el admin que incluye las pruebas las distinga.
      p.es_prueba,
      (select count(*)::integer from individuos i where i.planta_id = p.id and i.estado_vital = 'vivo') as individuos_vivos,
      greatest(
        p.updated_at,
        p.fecha_cambio_estado,
        coalesce((select max(r.created_at) from registros_evento r where r.planta_id = p.id), '-infinity'::timestamptz),
        coalesce((
          select max(e.updated_at)
          from evaluaciones e
          join ronda_evaluacion_anual rr on rr.id = e.ronda_id
          join individuos i on i.id = rr.individuo_id
          where i.planta_id = p.id
        ), '-infinity'::timestamptz),
        coalesce((
          select max(pr.updated_at)
          from procedimientos pr
          join procedimiento_objetivos po on po.procedimiento_id = pr.id
          left join individuos oi on oi.id = po.individuo_id
          where po.planta_id = p.id or oi.planta_id = p.id
        ), '-infinity'::timestamptz)
      ) as ultima_actividad,
      resolver_scoring_version(p.especie_id, 'evaluacion_anual', current_date) as scoring_version_id
    from plantas_operativas p
    where (p_especie_id is null or p.especie_id = p_especie_id)
      and (p_estado is null or p.estado = p_estado)
      and (nullif(btrim(p_busqueda), '') is null or p.codigo_sistema ilike '%' || btrim(p_busqueda) || '%')
      -- v3 (N4): los cruces de prueba quedan fuera salvo que se pidan; solo un admin puede pedirlos.
      and (not p.es_prueba or (p_incluir_pruebas and es_admin()))
      -- v3 paso 7: solo cruces con individuos vivos sin evaluación cerrada en la última ronda (misma regla que los
      -- pendientes de obtener_dashboard_cientifico y que la planilla).
      and (not p_solo_pendientes or (
        p.estado in ('evaluacion_anual', 'traslado_destino')
        and exists (
          select 1
          from individuos iv
          where iv.planta_id = p.id and iv.estado_vital = 'vivo'
            and not exists (
              select 1
              from ronda_evaluacion_anual r
              join evaluaciones e on e.ronda_id = r.id
              where r.individuo_id = iv.id
                and r.tipo_ronda = case when p.estado = 'traslado_destino' then 'multisitio'::tipo_ronda else 'anual'::tipo_ronda end
                and r.numero_ronda = (
                  select max(r2.numero_ronda)
                  from ronda_evaluacion_anual r2
                  join individuos i2 on i2.id = r2.individuo_id
                  where i2.planta_id = p.id
                    and r2.tipo_ronda = case when p.estado = 'traslado_destino' then 'multisitio'::tipo_ronda else 'anual'::tipo_ronda end
                )
                and e.estado in ('completa', 'corregida')
            )
        )
      ))
  ), enriquecido as materialized (
    select
      b.*,
      sv.nombre as scoring_version_nombre,
      coalesce(rank.individuos_elegibles, 0) as individuos_elegibles,
      rank.mejor_puntaje
    from base b
    left join scoring_version sv on sv.id = b.scoring_version_id
    left join lateral (
      select
        count(*) filter (where r.elegible)::integer as individuos_elegibles,
        max(r.puntaje_ponderado) filter (where r.elegible) as mejor_puntaje
      from calcular_ranking_operativo(b.scoring_version_id, b.id, null) r
    ) rank on b.scoring_version_id is not null
  ), pagina as (
    select *
    from enriquecido
    order by
      case when p_orden = 'actividad_desc' then ultima_actividad end desc nulls last,
      case when p_orden = 'codigo_asc' then codigo_sistema end asc,
      case when p_orden = 'estado_asc' then estado::text end asc,
      case when p_orden = 'especie_asc' then especie_nombre end asc,
      case when p_orden = 'vivos_desc' then individuos_vivos end desc,
      case when p_orden = 'scoring_desc' then mejor_puntaje end desc nulls last,
      codigo_sistema asc
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(pagina)) from pagina), '[]'::jsonb),
    'total', (select count(*) from enriquecido),
    'limite', p_limite,
    'offset', p_offset,
    'orden', p_orden
  ) into v_resultado;

  return v_resultado;
end;
$function$;

comment on function public.listar_cruces_analiticos(uuid, estado_planta, text, text, integer, integer, boolean, boolean) is 'Tabla comparativa de cruces con filtros, orden y paginación en backend; usa solo datos operativos sin linaje. v3 (20261024090000): excluye los cruces de prueba salvo p_incluir_pruebas, y solo para un admin; cada fila trae es_prueba; p_solo_pendientes deja solo los cruces con individuos sin evaluación cerrada en la última ronda.';
revoke all on function public.listar_cruces_analiticos(uuid, estado_planta, text, text, integer, integer, boolean, boolean) from public, anon;
grant execute on function public.listar_cruces_analiticos(uuid, estado_planta, text, text, integer, integer, boolean, boolean) to authenticated, service_role;

drop function if exists public.obtener_dashboard_cientifico(uuid, integer);

CREATE OR REPLACE FUNCTION public.obtener_dashboard_cientifico(p_especie_id uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 8, p_incluir_pruebas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_resultado jsonb;
  v_version_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if p_limite < 1 or p_limite > 25 then
    raise exception 'Límite inválido' using errcode = '22023';
  end if;

  if p_especie_id is not null then
    v_version_id := resolver_scoring_version(p_especie_id, 'evaluacion_anual', current_date);
  end if;

  with plantas_alcance as materialized (
    select p.id, p.codigo_sistema, p.especie_id, p.especie_nombre, p.estado, p.updated_at, p.fecha_cambio_estado
    from plantas_operativas p
    where (p_especie_id is null or p.especie_id = p_especie_id)
      -- v3 (N4): los cruces de prueba quedan fuera salvo que se pidan; solo un admin puede pedirlos.
      and (not p.es_prueba or (p_incluir_pruebas and es_admin()))
  ), actividad as materialized (
    select p.id as planta_id, p.codigo_sistema, p.especie_nombre, p.estado,
           p.fecha_cambio_estado as fecha, 'cambio_etapa'::text as tipo
    from plantas_alcance p
    union all
    select p.id, p.codigo_sistema, p.especie_nombre, p.estado,
           r.created_at, 'registro_campo'
    from plantas_alcance p
    join registros_evento r on r.planta_id = p.id
    union all
    select p.id, p.codigo_sistema, p.especie_nombre, p.estado,
           e.updated_at, 'evaluacion'
    from plantas_alcance p
    join individuos i on i.planta_id = p.id
    join ronda_evaluacion_anual rr on rr.individuo_id = i.id
    join evaluaciones e on e.ronda_id = rr.id
    where e.estado in ('completa', 'corregida')
  ), ultimo_cambio as materialized (
    select distinct on (a.planta_id)
      a.planta_id, a.codigo_sistema, a.especie_nombre, a.estado, a.fecha, a.tipo
    from actividad a
    order by a.planta_id, a.fecha desc, a.tipo
  ), pendientes as materialized (
    -- v3 (N26): se cuenta como la planilla (obtener_planilla_ronda): individuos vivos sin evaluación cerrada
    -- (completa o corregida) en la última ronda del cruce; anual en Evaluación anual, multisitio en Multisitio.
    -- Antes contaba los no elegibles de calcular_ranking_operativo (exigía todas las métricas del scoring).
    select
      p.id as planta_id,
      p.codigo_sistema,
      p.estado,
      count(*)::integer as individuos_pendientes
    from plantas_alcance p
    cross join lateral (
      select case when p.estado = 'traslado_destino' then 'multisitio'::tipo_ronda else 'anual'::tipo_ronda end as tipo
    ) t
    cross join lateral (
      select max(r.numero_ronda) as numero
      from ronda_evaluacion_anual r
      join individuos ri on ri.id = r.individuo_id
      where ri.planta_id = p.id and r.tipo_ronda = t.tipo
    ) ra
    join individuos i on i.planta_id = p.id and i.estado_vital = 'vivo'
    where p.estado in ('evaluacion_anual', 'traslado_destino')
      and not exists (
        select 1
        from ronda_evaluacion_anual r
        join evaluaciones e on e.ronda_id = r.id
        where r.individuo_id = i.id and r.tipo_ronda = t.tipo and r.numero_ronda = ra.numero
          and e.estado in ('completa', 'corregida')
      )
    group by p.id, p.codigo_sistema, p.estado
  ), destacados as materialized (
    select r.*
    from calcular_ranking_operativo(v_version_id, null, p_especie_id) r
    where p_especie_id is not null and r.elegible
    order by r.puntaje_ponderado desc, r.fecha_evaluacion desc,
             r.evaluacion_updated_at desc, r.codigo_display asc
    limit p_limite
  )
  select jsonb_build_object(
    'generado_at', now(),
    'especie_id', p_especie_id,
    'resumen', jsonb_build_object(
      'cruces_activos', (select count(*) from plantas_alcance),
      'individuos_vivos', (
        select count(*) from individuos i join plantas_alcance p on p.id = i.planta_id where i.estado_vital = 'vivo'
      ),
      'evaluaciones_ultimos_30_dias', (
        select count(*)
        from evaluaciones e
        join ronda_evaluacion_anual rr on rr.id = e.ronda_id
        join individuos i on i.id = rr.individuo_id
        join plantas_alcance p on p.id = i.planta_id
        where e.estado in ('completa', 'corregida') and e.updated_at >= now() - interval '30 days'
      ),
      'procedimientos_pendientes', (
        select count(distinct pr.id)
        from procedimientos pr
        join procedimiento_objetivos po on po.procedimiento_id = pr.id
        left join individuos oi on oi.id = po.individuo_id
        join plantas_alcance p on p.id = po.planta_id or p.id = oi.planta_id
        where pr.estado in ('planificado', 'en_curso')
      ),
      'cruces_con_pendientes', (select count(*) from pendientes)
    ),
    'cambios_recientes', coalesce((
      select jsonb_agg(to_jsonb(cambio))
      from (
        select * from ultimo_cambio order by fecha desc limit p_limite
      ) cambio
    ), '[]'::jsonb),
    'destacados', coalesce((select jsonb_agg(to_jsonb(destacados)) from destacados), '[]'::jsonb),
    'pendientes', coalesce((
      select jsonb_agg(to_jsonb(pendiente))
      from (
        select * from pendientes order by individuos_pendientes desc, codigo_sistema limit p_limite
      ) pendiente
    ), '[]'::jsonb),
    'scoring_version_id', v_version_id,
    'scoring_version_nombre', (select nombre from scoring_version where id = v_version_id)
  ) into v_resultado;

  return v_resultado;
end;
$function$;

comment on function public.obtener_dashboard_cientifico(uuid, integer, boolean) is 'Dashboard de ranking/actividad. El feed de actividad (rama evaluacion) filtra completa/corregida desde esta migración -- antes mezclaba borradores y anuladas con evaluaciones reales, igual que el contador de 30 días de la misma función. v3 (20261024090000): excluye los cruces de prueba salvo p_incluir_pruebas, y solo para un admin; pendientes = individuos vivos sin evaluación cerrada en la última ronda, como la planilla.';
revoke all on function public.obtener_dashboard_cientifico(uuid, integer, boolean) from public, anon;
grant execute on function public.obtener_dashboard_cientifico(uuid, integer, boolean) to authenticated, service_role;

-- =============================================================================
-- v3 paso 8 (25-10-2026), en esta misma migración (sigue sin aplicarse en producción):
--   - N35: el mapa territorial (obtener_resumen_mapa_territorial y consultar_mapa_viewport) excluye los cruces de
--     prueba salvo p_incluir_pruebas, y solo para un admin.
--   - N38: el ranking por grupos se puede pedir para una temporada (p_numero_ronda en calcular_ranking_nucleo,
--     calcular_ranking_grupos y obtener_ranking_por_grupos; por defecto null = la última ronda de cada individuo,
--     como antes). obtener_ranking_por_grupos devuelve además las rondas del alcance para elegir la temporada.
--   Las firmas viejas se reemplazan (DROP + CREATE) con los mismos dueños, permisos y seguridad; quien llama sin el
--   parámetro nuevo recibe lo mismo que antes (salvo el mapa, que deja de mostrar los cruces de prueba).
-- =============================================================================

drop function if exists public.obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.obtener_resumen_mapa_territorial(p_especie_id uuid DEFAULT NULL::uuid, p_predio_id uuid DEFAULT NULL::uuid, p_sector_id uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 100, p_offset integer DEFAULT 0, p_incluir_pruebas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- v3 paso 8 (N35): los cruces de prueba quedan fuera salvo que se pidan; solo un admin puede pedirlos.
      and (not pl.es_prueba or (p_incluir_pruebas and es_admin()))
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
$function$;
comment on function public.obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer, boolean) is 'Mapa territorial agregado para cualquier usuario autenticado. Cada cluster incluye latitud/longitud del PREDIO (no sensible) y un desglose "cruces" (planta_id/codigo_sistema/conteos) de qué cruzamientos tienen individuos en esa ubicación — nunca expone emplazamiento_coordenada (fino, admin-only) ni linaje. v3 (20261024090000): excluye los cruces de prueba salvo p_incluir_pruebas, y solo para un admin.';
revoke all on function public.obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer, boolean) from public, anon;
grant execute on function public.obtener_resumen_mapa_territorial(uuid, uuid, uuid, integer, integer, boolean) to authenticated, service_role;

drop function if exists public.consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.consultar_mapa_viewport(p_latitud_minima numeric, p_latitud_maxima numeric, p_longitud_minima numeric, p_longitud_maxima numeric, p_especie_id uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 250, p_offset integer DEFAULT 0, p_incluir_pruebas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- v3 paso 8 (N35): los cruces de prueba quedan fuera salvo que se pidan (la función ya es solo de admin).
      and (not pl.es_prueba or p_incluir_pruebas)
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
$function$;
comment on function public.consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer, boolean) is 'Consulta paginada de coordenadas por viewport, admin-only. Cada punto ahora incluye planta_id/codigo_sistema (a qué cruzamiento pertenece ese emplazamiento) — antes el mapa agrupaba por sector sin decir de qué cruce era cada pin. Usa COALESCE(emplazamiento_coordenada, predio.latitud/longitud); `fuente` por punto indica cuál de las dos se usó. v3 (20261024090000): excluye los cruces de prueba salvo p_incluir_pruebas.';
revoke all on function public.consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer, boolean) from public, anon;
grant execute on function public.consultar_mapa_viewport(numeric, numeric, numeric, numeric, uuid, integer, integer, boolean) to authenticated, service_role;

drop function if exists public.obtener_ranking_por_grupos(uuid, uuid, boolean);
drop function if exists public.calcular_ranking_grupos(uuid, uuid, uuid, boolean, boolean, integer);
drop function if exists public.calcular_ranking_nucleo(uuid, uuid, uuid, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.calcular_ranking_nucleo(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_por_ronda boolean DEFAULT false, p_incluir_pruebas boolean DEFAULT true, p_con_grupo boolean DEFAULT true, p_numero_ronda smallint DEFAULT NULL::smallint)
 RETURNS TABLE(individuo_id uuid, codigo_display text, planta_id uuid, codigo_sistema text, especie_id uuid, es_prueba boolean, evaluacion_id uuid, fecha_evaluacion date, evaluacion_updated_at timestamp with time zone, numero_ronda smallint, estado_evaluacion estado_evaluacion, requiere_revision boolean, no_comparable boolean, scoring_version_id uuid, scoring_version_nombre text, configuradas integer, disponibles integer, puntaje_bruto numeric, tiene_metrica_marcada boolean, detalle_metricas jsonb, detalle_categorias jsonb, cobertura jsonb, grupo text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with alcance as (
    select
      i.id as individuo_id,
      i.codigo_display,
      i.planta_id,
      p.codigo_sistema,
      p.especie_id,
      p.es_prueba
    from individuos i
    join plantas p on p.id = i.planta_id
    where i.estado_vital = 'vivo'
      and p.eliminado_at is null
      and (p_planta_id is null or p.id = p_planta_id)
      and (p_especie_id is null or p.especie_id = p_especie_id)
      and (p_incluir_pruebas or not p.es_prueba)
  ), ultima_ronda as (
    select distinct on (r.individuo_id)
      r.individuo_id,
      r.id as ronda_id,
      r.numero_ronda,
      r.scoring_version_id as ronda_scoring_version_id,
      -- Misma condición con que unificar_evaluacion_ronda y
      -- obtener_procedencia_calidad_ronda eligen las visitas cerradas.
      exists (
        select 1 from evaluaciones ev
        where ev.ronda_id = r.id and ev.estado in ('completa', 'corregida')
      ) as con_cerrada
    from ronda_evaluacion_anual r
    join alcance a on a.individuo_id = r.individuo_id
    where r.tipo_ronda = 'anual'
      -- v3 paso 8 (N38): con p_numero_ronda se toma la ronda de esa temporada; sin él, la última de cada individuo.
      and (p_numero_ronda is null or r.numero_ronda = p_numero_ronda)
    order by r.individuo_id, r.numero_ronda desc, r.created_at desc, r.id desc
  ), con_evaluacion as (
    -- Solo estas rondas pagan la unificación de visitas y la procedencia.
    select
      a.*,
      ur.numero_ronda,
      ur.ronda_scoring_version_id,
      e.id as evaluacion_id,
      e.fecha as fecha_evaluacion,
      e.updated_at as evaluacion_updated_at,
      e.estado as estado_evaluacion,
      e.requiere_revision,
      e.no_comparable,
      to_jsonb(e) as evaluacion_json,
      proc.descriptores_con_revision,
      proc.descriptores_no_comparables
    from alcance a
    join ultima_ronda ur on ur.individuo_id = a.individuo_id and ur.con_cerrada
    cross join lateral unificar_evaluacion_ronda(ur.ronda_id) e
    cross join lateral obtener_procedencia_calidad_ronda(ur.ronda_id) proc
  ), sin_evaluacion as (
    -- Sin ronda, o con la ronda más reciente sin visita completa/corregida:
    -- sin evaluación y sin descriptores marcados.
    select
      a.*,
      ur.numero_ronda,
      ur.ronda_scoring_version_id,
      null::uuid as evaluacion_id,
      null::date as fecha_evaluacion,
      null::timestamptz as evaluacion_updated_at,
      null::estado_evaluacion as estado_evaluacion,
      null::boolean as requiere_revision,
      null::boolean as no_comparable,
      null::jsonb as evaluacion_json,
      null::text[] as descriptores_con_revision,
      null::text[] as descriptores_no_comparables
    from alcance a
    left join ultima_ronda ur on ur.individuo_id = a.individuo_id
    where ur.individuo_id is null or not ur.con_cerrada
  ), base as (
    select
      b0.*,
      sv.id as scoring_version_id,
      sv.nombre as scoring_version_nombre
    from (
      select * from con_evaluacion
      union all
      select * from sin_evaluacion
    ) b0
    -- B6: con p_por_ronda, cada ronda se calcula con la versión con que se
    -- cerró; p_scoring_version_id solo cubre las rondas sin cerrar. Sin
    -- p_por_ronda, todas con p_scoring_version_id (versión elegida).
    left join scoring_version sv on sv.id = case
      when p_por_ronda then coalesce(b0.ronda_scoring_version_id, p_scoring_version_id)
      else p_scoring_version_id
    end
  ), entradas as (
    -- Una entrada por individuo con evaluación, más UNA «vacía» por versión de
    -- scoring para los individuos sin evaluación: su resultado depende solo de
    -- la versión (todas las métricas sin valor, sin descriptores marcados).
    select
      b.individuo_id::text as clave,
      b.scoring_version_id,
      b.evaluacion_json as ej,
      coalesce(b.descriptores_con_revision, '{}'::text[]) as con_revision,
      coalesce(b.descriptores_no_comparables, '{}'::text[]) as no_comparables
    from base b
    where b.evaluacion_id is not null
    union all
    select
      'v:' || coalesce(v.scoring_version_id::text, ''),
      v.scoring_version_id,
      null::jsonb,
      '{}'::text[],
      '{}'::text[]
    from (select distinct b.scoring_version_id from base b where b.evaluacion_id is null) v
  ), con_clave as (
    select row_number() over () as k, e.* from entradas e
  ), met0 as materialized (
    select
      c.k,
      sm.id as metrica_id,
      sm.metrica,
      sm.categoria,
      sm.peso,
      sm.direccion_favorable,
      coalesce(rr.minimo_esperado, sm.minimo_normalizacion) as minimo,
      coalesce(rr.maximo_esperado, sm.maximo_normalizacion) as maximo,
      rr.minimo_esperado as rr_minimo,
      rr.maximo_esperado as rr_maximo,
      -- Equivale a extraer_metrica_evaluacion(evaluacion, metrica), con la
      -- evaluación ya convertida a jsonb una sola vez.
      (c.ej ->> sm.metrica)::numeric as valor,
      (
        sm.metrica = any(c.con_revision)
        or sm.metrica = any(c.no_comparables)
      ) as marcada
    from con_clave c
    join scoring_metrica sm on sm.scoring_version_id = c.scoring_version_id
    left join rango_referencia rr on rr.id = sm.rango_referencia_id
  ), m as (
    select
      m0.*,
      normalizar_metrica_scoring(m0.valor, m0.minimo, m0.maximo, m0.direccion_favorable) as normalizado,
      case
        when m0.rr_maximo is not null and m0.valor is not null then m0.valor > m0.rr_maximo
        else null
      end as fuera_rango_superior,
      case
        when m0.rr_minimo is not null and m0.valor is not null then m0.valor < m0.rr_minimo
        else null
      end as fuera_rango_inferior
    from met0 m0
  ), por_cat as (
    select
      m.k,
      m.categoria,
      case
        when sum(m.peso) filter (where m.valor is not null) > 0 then
          sum(m.normalizado * m.peso) filter (where m.valor is not null)
          / sum(m.peso) filter (where m.valor is not null)
        else null
      end as subpuntaje,
      count(*) filter (where m.valor is not null) as con_valor,
      count(*) as total
    from m
    group by m.k, m.categoria
  ), cat as (
    -- Las cuatro categorías para cada entrada, con o sin métricas.
    select c.k, c.scoring_version_id, todas.categoria, pc.subpuntaje
    from con_clave c
    cross join unnest(enum_range(null::categoria_scoring)) as todas(categoria)
    left join por_cat pc on pc.k = c.k and pc.categoria = todas.categoria
  ), puntaje_categorias as (
    select
      cat.k,
      case
        when sum(scp.peso) filter (where cat.subpuntaje is not null) > 0 then
          sum(cat.subpuntaje * scp.peso) filter (where cat.subpuntaje is not null)
          / sum(scp.peso) filter (where cat.subpuntaje is not null)
        else null
      end as puntaje
    from cat
    join scoring_categoria_peso scp
      on scp.categoria = cat.categoria
     and scp.scoring_version_id = cat.scoring_version_id
    group by cat.k
  ), puntaje_metricas as (
    select
      m.k,
      case
        when sum(m.peso) filter (where m.valor is not null) > 0 then
          sum(m.normalizado * m.peso) filter (where m.valor is not null)
          / sum(m.peso) filter (where m.valor is not null)
        else null
      end as puntaje
    from m
    group by m.k
  ), agregado_metricas as (
    select
      m.k,
      count(*)::integer as configuradas,
      (count(*) filter (where m.valor is not null))::integer as disponibles,
      jsonb_object_agg(
        m.metrica,
        jsonb_build_object(
          'valor', m.valor,
          'peso', m.peso,
          'normalizado', m.normalizado,
          'fuera_rango_superior', m.fuera_rango_superior,
          'fuera_rango_inferior', m.fuera_rango_inferior
        )
      ) as detalle,
      bool_or(m.marcada) as marcada
    from m
    group by m.k
  ), agregado_categorias as (
    select cat.k, jsonb_object_agg(cat.categoria, cat.subpuntaje) as detalle_categorias
    from cat
    group by cat.k
  ), agregado_grupo as (
    -- Fase 2: cobertura por categoría (métricas con valor / métricas de la
    -- versión) y grupo = categorías con subpuntaje, en orden del enum. Solo si se piden.
    select
      pc.k,
      jsonb_object_agg(pc.categoria, jsonb_build_object('con_valor', pc.con_valor, 'total', pc.total)) as cobertura,
      coalesce(
        array_agg(pc.categoria::text order by pc.categoria) filter (where pc.subpuntaje is not null),
        '{}'::text[]
      ) as grupo
    from por_cat pc
    where p_con_grupo
    group by pc.k
  ), resultado as (
    select
      c.clave,
      coalesce(am.configuradas, 0) as configuradas,
      coalesce(am.disponibles, 0) as disponibles,
      case
        when exists (
          select 1 from scoring_categoria_peso scp0
          where scp0.scoring_version_id = c.scoring_version_id
        ) then pcat.puntaje
        else pmet.puntaje
      end as puntaje,
      coalesce(am.detalle, '{}'::jsonb) as detalle,
      coalesce(ac.detalle_categorias, '{}'::jsonb) as detalle_categorias,
      coalesce(am.marcada, false) as tiene_metrica_marcada,
      case when p_con_grupo then coalesce(ag.cobertura, '{}'::jsonb) end as cobertura,
      case when p_con_grupo then coalesce(ag.grupo, '{}'::text[]) end as grupo
    from con_clave c
    left join agregado_metricas am on am.k = c.k
    left join agregado_categorias ac on ac.k = c.k
    left join puntaje_categorias pcat on pcat.k = c.k
    left join puntaje_metricas pmet on pmet.k = c.k
    left join agregado_grupo ag on ag.k = c.k
  )
  select
    b.individuo_id,
    b.codigo_display,
    b.planta_id,
    b.codigo_sistema,
    b.especie_id,
    b.es_prueba,
    b.evaluacion_id,
    b.fecha_evaluacion,
    b.evaluacion_updated_at,
    b.numero_ronda,
    b.estado_evaluacion,
    b.requiere_revision,
    b.no_comparable,
    b.scoring_version_id,
    b.scoring_version_nombre,
    r.configuradas,
    r.disponibles,
    r.puntaje,
    r.tiene_metrica_marcada,
    r.detalle,
    r.detalle_categorias,
    r.cobertura,
    r.grupo
  from base b
  left join resultado r on r.clave = case
    when b.evaluacion_id is not null then b.individuo_id::text
    else 'v:' || coalesce(b.scoring_version_id::text, '')
  end;
$function$;
comment on function public.calcular_ranking_nucleo(uuid, uuid, uuid, boolean, boolean, boolean, smallint) is 'Fase 2 (S2-5): motor de scoring por conjuntos, sin compuerta de elegibilidad. p_incluir_pruebas=false deja fuera los cruces de prueba; p_con_grupo=false omite cobertura y grupo (nulos). Lo envuelven calcular_ranking_base, calcular_ranking_operativo y calcular_ranking_grupos. v3 (20261024090000): p_numero_ronda toma la ronda anual de esa temporada (null = la última de cada individuo).';
revoke all on function public.calcular_ranking_nucleo(uuid, uuid, uuid, boolean, boolean, boolean, smallint) from public, anon;
grant execute on function public.calcular_ranking_nucleo(uuid, uuid, uuid, boolean, boolean, boolean, smallint) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calcular_ranking_grupos(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_por_ronda boolean DEFAULT false, p_incluir_pruebas boolean DEFAULT false, p_minimo integer DEFAULT NULL::integer, p_numero_ronda smallint DEFAULT NULL::smallint)
 RETURNS TABLE(individuo_id uuid, codigo_display text, planta_id uuid, codigo_sistema text, especie_id uuid, es_prueba boolean, evaluacion_id uuid, fecha_evaluacion date, numero_ronda smallint, estado_evaluacion estado_evaluacion, scoring_version_id uuid, scoring_version_nombre text, requiere_revision boolean, no_comparable boolean, tiene_metrica_marcada boolean, puntaje numeric, grupo text[], cobertura jsonb, detalle_categorias jsonb, detalle_metricas jsonb, estado_ranking text, tamano_grupo integer, posicion_grupo integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as materialized (
    select b.*
    -- A1-070: los cruces de prueba no entran a la población, salvo que se
    -- pida ese cruce puntual o se incluyan a propósito (el núcleo los filtra
    -- en el alcance, antes de calcular nada).
    from calcular_ranking_nucleo(p_scoring_version_id, p_planta_id, p_especie_id, p_por_ronda,
      p_planta_id is not null or p_incluir_pruebas, true, p_numero_ronda) b
  ), minimo as (
    select coalesce(p_minimo, (select minimo_evaluaciones_grupo from configuracion_ranking where id = 1), 5) as valor
  ), clasificado as (
    select
      b.*,
      case
        when b.numero_ronda is null then 'sin_ronda'
        when b.evaluacion_id is null then 'sin_evaluacion'
        -- Mismo orden que motivo_exclusion del ranking de siempre.
        when coalesce(b.requiere_revision, false) then 'excluida_revision'
        when coalesce(b.no_comparable, false) then 'no_comparable'
        when coalesce(b.tiene_metrica_marcada, false) then 'excluida_revision'
        when b.scoring_version_id is null or b.configuradas = 0 then 'sin_version'
        when cardinality(b.grupo) = 0 then 'sin_datos'
        else 'comparable'
      end as clase
    from base b
  ), con_tamano as (
    select
      c.*,
      case when c.clase = 'comparable'
        then (count(*) filter (where c.clase = 'comparable') over (partition by c.grupo))::integer
      end as tamano
    from clasificado c
  )
  select
    t.individuo_id, t.codigo_display, t.planta_id, t.codigo_sistema, t.especie_id, coalesce(t.es_prueba, false),
    t.evaluacion_id, t.fecha_evaluacion, t.numero_ronda, t.estado_evaluacion,
    t.scoring_version_id, t.scoring_version_nombre,
    coalesce(t.requiere_revision, false), coalesce(t.no_comparable, false), coalesce(t.tiene_metrica_marcada, false),
    case when t.clase = 'comparable' then round(t.puntaje_bruto, 4) end,
    t.grupo,
    coalesce(t.cobertura, '{}'::jsonb),
    coalesce(t.detalle_categorias, '{}'::jsonb),
    coalesce(t.detalle_metricas, '{}'::jsonb),
    case when t.clase = 'comparable' and t.tamano < (select valor from minimo) then 'pocas_plantas' else t.clase end,
    t.tamano,
    -- Empates (Kadel, 22-10-2026): el mismo puntaje publicado comparte posición
    -- (ranking de competencia: 1, 2, 2, 4). No se desempata por código ni por
    -- texto. «Mismo puntaje» = mismo valor redondeado a 4 decimales, el que se
    -- muestra (A1-073: la regla aplicada es la declarada en criterios).
    case when t.clase = 'comparable' and t.tamano >= (select valor from minimo) then
      (rank() over (
        partition by t.clase = 'comparable', t.grupo
        order by round(t.puntaje_bruto, 4) desc nulls last
      ))::integer
    end
  from con_tamano t;
$function$;
comment on function public.calcular_ranking_grupos(uuid, uuid, uuid, boolean, boolean, integer, smallint) is 'Fase 2: ranking por grupos de categorías del motor. estado_ranking: comparable | pocas_plantas | excluida_revision | no_comparable | sin_datos | sin_evaluacion | sin_ronda | sin_version. Posición solo dentro del grupo y solo si el grupo alcanza el mínimo; el mismo puntaje comparte posición (1, 2, 2, 4). v3 (20261024090000): p_numero_ronda pide una temporada.';
revoke all on function public.calcular_ranking_grupos(uuid, uuid, uuid, boolean, boolean, integer, smallint) from public, anon;
grant execute on function public.calcular_ranking_grupos(uuid, uuid, uuid, boolean, boolean, integer, smallint) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.obtener_ranking_por_grupos(p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_incluir_pruebas boolean DEFAULT false, p_numero_ronda smallint DEFAULT NULL::smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_especie_id uuid := p_especie_id;
  v_version_id uuid;
  v_version_nombre text;
  v_config configuracion_ranking;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if (p_planta_id is null) = (p_especie_id is null) then
    raise exception 'Indica exactamente un cruce o una especie' using errcode = '22023';
  end if;
  if p_planta_id is not null then
    select especie_id into v_especie_id from plantas where id = p_planta_id and eliminado_at is null;
    if not found then
      raise exception 'Cruce no encontrado' using errcode = 'P0002';
    end if;
  end if;

  if p_numero_ronda is not null and p_numero_ronda < 1 then
    raise exception 'Ronda inválida' using errcode = '22023';
  end if;

  select * into v_config from configuracion_ranking where id = 1;
  v_version_id := resolver_scoring_version(v_especie_id, 'evaluacion_anual', current_date);
  select nombre into v_version_nombre from scoring_version where id = v_version_id;

  with filas as materialized (
    select *
    from calcular_ranking_grupos(v_version_id, p_planta_id, p_especie_id, false, p_incluir_pruebas, v_config.minimo_evaluaciones_grupo, p_numero_ronda)
  ), grupos as (
    select grupo, count(*)::integer as n, bool_and(posicion_grupo is not null) as con_posicion
    from filas
    where estado_ranking in ('comparable', 'pocas_plantas')
    group by grupo
  )
  select jsonb_build_object(
    'scoring_version_id', v_version_id,
    'scoring_version_nombre', v_version_nombre,
    'minimo_evaluaciones_grupo', v_config.minimo_evaluaciones_grupo,
    'cobertura_advertencia', v_config.cobertura_advertencia,
    -- v3 paso 8 (N38): la temporada pedida (null = la última de cada individuo) y, para elegirla, cuántos individuos
    -- vivos del alcance tienen cada ronda anual y cuántos la tienen con una evaluación cerrada.
    'numero_ronda', p_numero_ronda,
    'rondas', coalesce((
      select jsonb_agg(jsonb_build_object('numero', x.numero_ronda, 'individuos', x.individuos, 'con_cerrada', x.con_cerrada) order by x.numero_ronda)
      from (
        select
          r.numero_ronda,
          count(distinct r.individuo_id)::integer as individuos,
          (count(distinct r.individuo_id) filter (where exists (
            select 1 from evaluaciones ev where ev.ronda_id = r.id and ev.estado in ('completa', 'corregida')
          )))::integer as con_cerrada
        from ronda_evaluacion_anual r
        join individuos i on i.id = r.individuo_id and i.estado_vital = 'vivo'
        join plantas pl on pl.id = i.planta_id and pl.eliminado_at is null
        where r.tipo_ronda = 'anual'
          and (p_planta_id is null or pl.id = p_planta_id)
          and (p_planta_id is not null or pl.especie_id = v_especie_id)
          and (p_planta_id is not null or p_incluir_pruebas or not pl.es_prueba)
        group by r.numero_ronda
      ) x
    ), '[]'::jsonb),
    'criterios', jsonb_build_object(
      'alcance', case when p_planta_id is null then 'especie' else 'cruzamiento' end,
      'grupo', 'combinacion de categorias del motor con al menos una metrica con valor',
      'seleccion_evaluacion', 'evaluacion unificada de la ronda anual mas reciente',
      'orden', jsonb_build_array('puntaje_desc'),
      'empates', 'mismo puntaje (4 decimales) comparte posicion; ranking de competencia 1, 2, 2, 4; sin desempate por codigo',
      'incluye_pruebas', p_planta_id is not null or p_incluir_pruebas
    ),
    -- A1-077: conteos del universo completo, no de una página.
    'poblacion', jsonb_build_object(
      'total', (select count(*) from filas),
      'comparables', (select count(*) from filas where estado_ranking in ('comparable', 'pocas_plantas')),
      'con_posicion', (select count(*) from filas where posicion_grupo is not null),
      'pocas_plantas', (select count(*) from filas where estado_ranking = 'pocas_plantas'),
      'excluidas_revision', (select count(*) from filas where estado_ranking = 'excluida_revision'),
      'no_comparables', (select count(*) from filas where estado_ranking = 'no_comparable'),
      'sin_datos', (select count(*) from filas where estado_ranking = 'sin_datos'),
      'sin_evaluacion', (select count(*) from filas where estado_ranking in ('sin_evaluacion', 'sin_ronda')),
      'sin_version', (select count(*) from filas where estado_ranking = 'sin_version')
    ),
    'grupos', coalesce((
      select jsonb_agg(jsonb_build_object('categorias', g.grupo, 'n', g.n, 'con_posicion', g.con_posicion)
        order by g.n desc, cardinality(g.grupo) desc, array_to_string(g.grupo, ','))
      from grupos g), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(to_jsonb(f) - 'detalle_metricas'
        order by f.grupo, f.posicion_grupo nulls last, f.puntaje desc nulls last,
          codigo_display_numero(f.codigo_display) nulls last, f.codigo_display)
      from filas f), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$function$;
comment on function public.obtener_ranking_por_grupos(uuid, uuid, boolean, smallint) is 'Fase 2: ranking por grupos de categorías para la UI v2 (versión activa, mínimo configurable, cuenta completa de la población). Nunca expone linaje. v3 (20261024090000): p_numero_ronda pide una temporada (null = la última de cada individuo) y la respuesta trae las rondas del alcance.';
revoke all on function public.obtener_ranking_por_grupos(uuid, uuid, boolean, smallint) from public, anon;
grant execute on function public.obtener_ranking_por_grupos(uuid, uuid, boolean, smallint) to authenticated;
