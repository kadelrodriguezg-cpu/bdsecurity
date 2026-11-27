-- =============================================================================
-- Fix (Problema 2 del arreglo post-Fase 5) -- PARTE 1: exponer la procedencia
-- de calidad, sin decidir todavia que hace el ranking con ella.
--
-- unificar_evaluacion_ronda toma, por cada descriptor, el valor no-nulo mas
-- reciente. Pero requiere_revision/no_comparable viajan pegados a la FILA
-- representante (la visita mas reciente en general), no al valor individual
-- que efectivamente gano. Caso real: una visita de noviembre mide calibre
-- 45mm (fuera de rango, requiere_revision=true). Una visita de diciembre no
-- vuelve a medir calibre. La ronda unificada usa el calibre de noviembre
-- (45mm) pero hereda requiere_revision de la visita de diciembre (false,
-- porque diciembre no toco nada fuera de rango). El calibre marcado para
-- revision entra al ranking como si estuviera validado -- exactamente lo
-- que la interfaz promete que no pasa.
--
-- Esta migracion agrega una funcion nueva que responde, por ronda, que
-- descriptores tienen su valor ganador proveniente de una visita marcada
-- requiere_revision y/o no_comparable. NO se conecta todavia a
-- calcular_ranking_operativo ni a ningun WHERE/trigger de elegibilidad --
-- eso depende de una decision de producto pendiente (¿se descarta la ronda
-- completa, o solo esa metrica puntual, cuando algo viene marcado?) que
-- todavia no esta confirmada. Esta funcion es la pieza de datos necesaria
-- para cualquiera de las dos respuestas; no asume cual se va a elegir.
--
-- Genericidad: descubre los descriptores por introspeccion de
-- information_schema, no por una lista de nombres a mano -- mismo criterio
-- que extraer_metrica_evaluacion (fix anterior de esta misma rama). Un
-- descriptor nuevo en evaluaciones queda cubierto automaticamente. La unica
-- lista explicita es la de columnas que NO son descriptores (metadata de la
-- fila) y la tripleta cantidad_frutos/peso_total_g/peso_promedio_g, que se
-- trata aparte porque unificar_evaluacion_ronda ya la trata aparte (viaja
-- atomica desde una sola visita, nunca se parte entre columnas).
-- =============================================================================

create or replace function public.obtener_procedencia_calidad_ronda(p_ronda_id uuid)
returns table (
  descriptores_con_revision text[],
  descriptores_no_comparables text[]
)
language sql
stable
set search_path = public
as $$
  with cerradas as materialized (
    select e.*
    from evaluaciones e
    where e.ronda_id = p_ronda_id
      and e.estado in ('completa', 'corregida')
  ), columnas_descriptor as (
    -- Toda columna de evaluaciones que no sea metadata de la fila ni la
    -- tripleta cantidad/peso/promedio (que tiene su propia regla de
    -- atomicidad, resuelta abajo por separado).
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'evaluaciones'
      and column_name not in (
        'id', 'ronda_id', 'estado', 'fecha', 'anio', 'evaluador', 'observaciones',
        'sin_muestra', 'requiere_revision', 'no_comparable', 'motivo_cambio',
        'created_by', 'created_at', 'updated_at', 'idempotency_key', 'predio_id',
        'cantidad_frutos', 'peso_total_g', 'peso_promedio_g'
      )
  ), desplegado as (
    select
      c.id, c.fecha, c.updated_at, c.requiere_revision, c.no_comparable,
      cd.column_name as descriptor,
      (to_jsonb(c) ->> cd.column_name) as valor_texto
    from cerradas c
    cross join columnas_descriptor cd
  ), ganador_por_descriptor as (
    -- Mismo criterio de desempate que el array_agg(...)[1] de
    -- unificar_evaluacion_ronda: entre las visitas donde ESE descriptor
    -- tiene valor, la mas reciente por fecha/updated_at/id.
    select distinct on (descriptor)
      descriptor, requiere_revision, no_comparable
    from desplegado
    where valor_texto is not null
    order by descriptor, fecha desc, updated_at desc, id desc
  ), ganador_muestra as (
    -- Misma regla que la CTE "muestra" de unificar_evaluacion_ronda: la
    -- tripleta viaja junta desde una sola visita, su bandera es la de esa
    -- visita, no la de cada columna por separado.
    select 'cantidad_frutos'::text as descriptor, e.requiere_revision, e.no_comparable
    from cerradas e
    where e.cantidad_frutos is not null and e.peso_total_g is not null
    order by e.fecha desc, e.updated_at desc, e.id desc
    limit 1
  ), todos as (
    select * from ganador_por_descriptor
    union all
    select * from ganador_muestra
  )
  select
    coalesce(array_agg(descriptor order by descriptor) filter (where requiere_revision), '{}'::text[]),
    coalesce(array_agg(descriptor order by descriptor) filter (where no_comparable), '{}'::text[])
  from todos;
$$;

comment on function public.obtener_procedencia_calidad_ronda(uuid) is
  'Por ronda: nombres de descriptores cuyo valor unificado (el que devuelve unificar_evaluacion_ronda) proviene de una visita marcada requiere_revision o no_comparable -- la bandera de esa visita puntual, no la de la visita mas reciente de la ronda en general. NO conectada todavia a calcular_ranking_operativo: pendiente decision de producto sobre si una metrica marcada descarta la ronda completa o solo esa metrica. Ver docs/pendientes.md.';

revoke all on function public.obtener_procedencia_calidad_ronda(uuid) from public, anon;
grant execute on function public.obtener_procedencia_calidad_ronda(uuid) to authenticated, service_role;
