-- =============================================================================
-- RPC — obtener_scoring_planta: scoring de TODOS los individuos de un cruce,
-- sin el techo de 100 que tiene obtener_ranking_operativo.
--
-- Motivo (Bloque 2, Parte 2 de la auditoría de UX): el Explorador de
-- individuos (EvaluacionAnualWorkspace) usa listarScoringDePlanta(), que
-- hoy llama a obtener_ranking_operativo con limite=100. Esa RPC rechaza
-- limite > 100 (paginación pensada para la tabla de Ranking, con su propio
-- selector de página). Con más de 100 individuos vivos en un cruce, los que
-- quedan fuera del top 100 por código nunca reciben puntaje en el
-- Explorador, y se cuentan como "pendientes de evaluación" aunque ya estén
-- evaluados.
--
-- Esta RPC reutiliza calcular_ranking_operativo (la función de cálculo,
-- SIN el límite de paginación de su wrapper) para un único cruce, y agrega
-- la posición dentro del ranking con el mismo criterio de desempate que
-- obtener_ranking_operativo (puntaje desc, código asc) para mantener el
-- resultado consistente con lo que la tabla de Ranking ya muestra. El orden
-- final de las filas es numérico por codigo_display (codigo_display_numero,
-- migración 20260902001000), no alfabético.
-- =============================================================================

create or replace function obtener_scoring_planta(p_planta_id uuid)
returns table (
  individuo_id uuid,
  codigo_display text,
  planta_id uuid,
  codigo_sistema text,
  especie_id uuid,
  evaluacion_id uuid,
  fecha_evaluacion date,
  evaluacion_updated_at timestamptz,
  numero_ronda smallint,
  estado_evaluacion estado_evaluacion,
  requiere_revision boolean,
  no_comparable boolean,
  scoring_version_id uuid,
  scoring_version_nombre text,
  puntaje_ponderado numeric,
  elegible boolean,
  motivo_exclusion text,
  detalle_metricas jsonb,
  posicion bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_especie_id uuid;
  v_version_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select p.especie_id into v_especie_id
  from plantas p
  where p.id = p_planta_id and p.eliminado_at is null;
  if not found then
    raise exception 'Cruce no encontrado' using errcode = 'P0002';
  end if;

  v_version_id := resolver_scoring_version(v_especie_id, 'evaluacion_anual', current_date);

  return query
  with base as materialized (
    select *
    from calcular_ranking_operativo(v_version_id, p_planta_id, null)
  ), posicionado as (
    select
      b.*,
      case when b.elegible then row_number() over (
        partition by b.elegible
        order by b.puntaje_ponderado desc nulls last,
                 b.codigo_display asc
      ) end as posicion
    from base b
  )
  select
    p2.individuo_id, p2.codigo_display, p2.planta_id, p2.codigo_sistema, p2.especie_id,
    p2.evaluacion_id, p2.fecha_evaluacion, p2.evaluacion_updated_at, p2.numero_ronda,
    p2.estado_evaluacion, p2.requiere_revision, p2.no_comparable,
    p2.scoring_version_id, p2.scoring_version_nombre, p2.puntaje_ponderado, p2.elegible,
    p2.motivo_exclusion, p2.detalle_metricas, p2.posicion
  from posicionado p2
  order by codigo_display_numero(p2.codigo_display) nulls last, p2.codigo_display asc;
end;
$$;

comment on function obtener_scoring_planta(uuid) is
  'Scoring de TODOS los individuos vivos de un cruce (sin techo de 100). Reusa calcular_ranking_operativo; para tablas paginadas con selector de página, usar obtener_ranking_operativo.';

revoke all on function obtener_scoring_planta(uuid) from public, anon;
grant execute on function obtener_scoring_planta(uuid) to authenticated, service_role;
