-- Fase 5, paso 60 — orden natural de los códigos en la tabla de Cruces (decisión G16).
--
-- La app ordena los códigos en orden natural con una sola función (frontend/src/lib/ordenNatural.ts): 02-001 < 02-002 < 02-080,
-- P2 < P10 < P100. Casi todas las listas ordenan en el cliente, pero la tabla de Cruces ordena y pagina en el servidor
-- (`listar_cruces_analiticos`): ahí el orden natural tiene que estar en la base, o la página 1 traería 02-1, 02-10, 02-100…
--
-- Qué hace:
--   1. `codigo_natural(text)`: una clave de orden que rellena cada número del código a 10 dígitos («02-10» → «0000000002-0000000010»),
--      así el texto ordena como números. Inmutable, sin efectos; no cambia ningún dato.
--   2. `listar_cruces_analiticos`: igual que la vigente (fase 4, 20261026110000), salvo el orden «Código» y el desempate final, que
--      usan la clave natural (el código sigue de último desempate: es único y el orden queda total para paginar).
--
-- La app de hoy llama a la misma función con los mismos argumentos y recibe lo mismo, solo en otro orden dentro del orden «Código»
-- o de los empates. Rollback: docs/fase5/rollback/60_orden_natural.sql.

create function public.codigo_natural(p_codigo text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select string_agg(case when t.parte ~ '^[0-9]+$' then lpad(t.parte, 10, '0') else lower(t.parte) end, '' order by t.n)
  from regexp_matches(coalesce(p_codigo, ''), '([0-9]+|[^0-9]+)', 'g') with ordinality as m(partes, n)
  cross join lateral (select m.partes[1] as parte, m.n) t;
$$;
comment on function public.codigo_natural(text) is
  'Fase 5 (G16): clave de orden natural de un código (cada número relleno a 10 dígitos, el resto en minúsculas): 02-2 < 02-10 < 02-100.';
revoke all on function public.codigo_natural(text) from public, anon;
grant execute on function public.codigo_natural(text) to authenticated, service_role;

-- 2. listar_cruces_analiticos con la clave natural en el orden «Código» y en el desempate.
create or replace function public.listar_cruces_analiticos(p_especie_id uuid DEFAULT NULL::uuid, p_estado estado_planta DEFAULT NULL::estado_planta, p_busqueda text DEFAULT NULL::text, p_orden text DEFAULT 'actividad_desc'::text, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0, p_incluir_pruebas boolean DEFAULT false, p_solo_pendientes boolean DEFAULT false)
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
      eo.individuos_vivos,
      -- Fase 4: la última actividad incluye las acciones auditadas y trae su autor (estado_operativo_cruce).
      eo.ultima_actividad,
      eo.ultima_actividad_por,
      eo.sin_evaluacion_cerrada,
      case when eo.ronda_numero is null then null else jsonb_build_object(
        'tipo', eo.ronda_tipo, 'numero', eo.ronda_numero, 'anio', eo.ronda_anio,
        'cerradas', eo.evaluaciones_cerradas, 'vivos', eo.individuos_vivos
      ) end as ronda_actual,
      resolver_scoring_version(p.especie_id, 'evaluacion_anual', current_date) as scoring_version_id
    from plantas_operativas p
    cross join lateral estado_operativo_cruce(p.id) eo
    where (p_especie_id is null or p.especie_id = p_especie_id)
      and (p_estado is null or p.estado = p_estado)
      and (nullif(btrim(p_busqueda), '') is null or p.codigo_sistema ilike '%' || btrim(p_busqueda) || '%')
      -- v3 (N4): los cruces de prueba quedan fuera salvo que se pidan; solo un admin puede pedirlos.
      and (not p.es_prueba or (p_incluir_pruebas and es_admin()))
      -- v3 paso 7: solo cruces con individuos vivos sin evaluación cerrada en la última ronda (misma regla que los
      -- pendientes de obtener_dashboard_cientifico y que la planilla).
      and (not p_solo_pendientes or eo.sin_evaluacion_cerrada > 0)
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
      case when p_orden = 'codigo_asc' then codigo_natural(codigo_sistema) end asc,
      case when p_orden = 'estado_asc' then estado::text end asc,
      case when p_orden = 'especie_asc' then especie_nombre end asc,
      case when p_orden = 'vivos_desc' then individuos_vivos end desc,
      case when p_orden = 'scoring_desc' then mejor_puntaje end desc nulls last,
      -- Fase 5 (G16): desempate en orden natural (02-2 antes que 02-10); el código es único, así que el orden es total.
      codigo_natural(codigo_sistema) asc,
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
