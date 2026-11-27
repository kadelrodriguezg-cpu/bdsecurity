-- =============================================================================
-- MIGRACIÓN 20260714022000 — VISTA individuos_scoring (Prompt 4, Parte A)
--
-- Implementa la fórmula de scoring del documento de arquitectura de datos
-- (sección 4.3) y North Star sección 9 ("Scoring fenotípico... Vista de
-- selección final: ranking... filtrado por estado_vital='vivo' — output, no
-- formulario").
--
--   puntaje_ponderado = (prom_fenologia × 0.20) + (prom_fruto_calidad × 0.40)
--                      + (prom_produccion × 0.30) − (prom_estres × 0.10)
--
-- Ponderaciones fijas del Excel de Efraín, no se tocan.
--
-- DECISIONES DE DISEÑO (documentadas porque el Excel no las especifica exacto):
--
-- 1) Normalización a 0-1 antes de promediar dentro de cada categoría.
--    Los 15 descriptores viven en escalas distintas (1-5, mm, °Brix, kg/planta,
--    t/ha, %). Promediarlos crudos sería promediar peras con manzanas dentro de
--    una misma categoría (ej. Fruto/Calidad mezcla firmeza 1-5 con calibre_mm
--    14-24 y brix 10-18). Se normaliza cada descriptor a 0-1 ANTES de promediar:
--      - Escala 1-5 (brotacion, floracion, cuaja, concentracion_cosecha,
--        firmeza, color, bloom, dano_calor, golpe_sol, caida_fruto):
--        (valor - 1) / 4.
--      - calibre_mm: rango fijo del Excel (14-24): (valor - 14) / 10.
--      - brix: rango fijo del Excel (10-18): (valor - 10) / 8.
--      - rend_kg_planta / rend_t_ha / pct_fruta_exportable: SIN rango fijo del
--        Excel (incluso pct_fruta_exportable, aunque ya sea 0-100, se pidió
--        normalizarlo dinámico junto con los otros dos de Producción) →
--        min-max sobre el conjunto de individuos que entran al ranking (ver
--        CTE rangos_produccion). Con <2 valores no-nulos el rango degenera
--        (min=max) y se devuelve NULL en vez de 0 o error.
--
-- 2) Estrés climático: signo invertido POR RESTA, no por inversión de escala.
--    prom_estres queda en su escala normal 0-1 (0=sin estrés, 1=estrés
--    máximo — MAYOR valor = PEOR). La fórmula lo RESTA del total
--    (`− prom_estres × 0.10`), tal como se pidió explícitamente, en vez de
--    invertir el signo del promedio y sumarlo. Ambas formas dan el mismo
--    ranking relativo (difieren en una constante), pero se implementa la
--    resta literal porque así se especificó.
--
-- 3) Última evaluación por individuo, SIN promediar entre años/tipos.
--    Un individuo puede tener varias evaluaciones (primaria/secundaria/
--    multisitio) a lo largo de los años. Promediarlas todas mezclaría
--    mediciones de etapas de madurez distintas del mismo individuo. Se toma
--    la evaluación MÁS RECIENTE por fecha (sin importar el tipo): dado que el
--    orden cronológico natural del PMG es primaria → secundaria → multisitio,
--    la más reciente coincide, en la práctica, con la ronda más madura
--    disponible para ese individuo — que es lo que se quiere rankear.
--
-- 4) NULL propaga: si una categoría no tiene NINGÚN descriptor cargado en la
--    última evaluación, su promedio es NULL, y por lo tanto puntaje_ponderado
--    también queda NULL (no se asume 0 para categorías sin datos — eso
--    penalizaría a individuos con evaluaciones incompletas como si hubieran
--    puntuado peor de lo que en realidad se sabe). Se exponen los promedios
--    por categoría por separado para poder ver CUÁL categoría falta.
--
-- 5) Se incluyen individuos SIN ninguna evaluación cargada (puntaje_ponderado
--    y las 4 categorías en NULL), en vez de excluirlos de la vista. Así el
--    frontend puede mostrar el roster completo de individuos vivos de un
--    cruce con su score (o su ausencia) explícita, en vez de que
--    simplemente "desaparezcan" de la vista.
--
-- 6) Acceso: cualquier autenticado (no admin-only). La vista NO expone
--    columnas de linaje (cruzamiento/mama/papa) — solo codigo_sistema del
--    cruce — así que no hay información sensible en juego. Es una decisión
--    deliberada de ESTE prompt: el pipeline paralelo ya descartado tenía el
--    scoring como admin-only por otro motivo (ranking de cruces enteros); acá
--    la ficha completa, incluida la sección de individuos, ya es visible
--    para cualquier autenticado.
--
-- security_invoker = on: mismo patrón que plantas_operativas (migración 004).
-- Sin este flag, la vista correría con permisos del dueño y saltearía el RLS
-- de las tablas base.
-- =============================================================================

create view individuos_scoring
  with (security_invoker = on)
as
with ultima_evaluacion as (
  -- Evaluación más reciente por individuo (ver decisión 3 arriba).
  select distinct on (e.individuo_id)
    e.individuo_id,
    e.tipo,
    e.fecha,
    e.brotacion, e.floracion, e.cuaja, e.concentracion_cosecha,
    e.firmeza, e.color, e.bloom, e.calibre_mm, e.brix,
    e.rend_kg_planta, e.rend_t_ha, e.pct_fruta_exportable,
    e.dano_calor, e.golpe_sol, e.caida_fruto
  from evaluaciones e
  join individuos i on i.id = e.individuo_id
  where i.estado_vital = 'vivo'
  order by e.individuo_id, e.fecha desc, e.created_at desc, e.id desc
),
rangos_produccion as (
  -- Min/max de Producción SOLO sobre el conjunto que entra al ranking (no
  -- sobre todo el histórico de evaluaciones). Ver decisión 1 arriba.
  select
    min(rend_kg_planta)       as min_kg,  max(rend_kg_planta)       as max_kg,
    min(rend_t_ha)            as min_tha, max(rend_t_ha)            as max_tha,
    min(pct_fruta_exportable) as min_pct, max(pct_fruta_exportable) as max_pct
  from ultima_evaluacion
),
normalizado as (
  select
    ue.individuo_id,

    -- Fenología: escala 1-5 -> 0-1.
    (select avg(v) from unnest(array[
      case when ue.brotacion             is not null then (ue.brotacion - 1) / 4.0 end,
      case when ue.floracion             is not null then (ue.floracion - 1) / 4.0 end,
      case when ue.cuaja                 is not null then (ue.cuaja - 1) / 4.0 end,
      case when ue.concentracion_cosecha is not null then (ue.concentracion_cosecha - 1) / 4.0 end
    ]) as t(v)) as prom_fenologia,

    -- Fruto/Calidad: firmeza/color/bloom (1-5 -> 0-1) + calibre_mm (14-24 ->
    -- 0-1) + brix (10-18 -> 0-1), todos ya en la misma escala 0-1 antes de
    -- promediar (ver decisión 1 arriba).
    (select avg(v) from unnest(array[
      case when ue.firmeza    is not null then (ue.firmeza - 1) / 4.0 end,
      case when ue.color      is not null then (ue.color - 1) / 4.0 end,
      case when ue.bloom      is not null then (ue.bloom - 1) / 4.0 end,
      case when ue.calibre_mm is not null then (ue.calibre_mm - 14) / 10.0 end,
      case when ue.brix       is not null then (ue.brix - 10) / 8.0 end
    ]) as t(v)) as prom_fruto_calidad,

    -- Producción: min-max dinámico sobre rangos_produccion. NULL si el rango
    -- degenera (0 o 1 valor no-nulo en todo el conjunto → max = min o ambos NULL).
    (select avg(v) from unnest(array[
      case when ue.rend_kg_planta is not null and r.max_kg is not null and r.max_kg <> r.min_kg
        then (ue.rend_kg_planta - r.min_kg) / (r.max_kg - r.min_kg) end,
      case when ue.rend_t_ha is not null and r.max_tha is not null and r.max_tha <> r.min_tha
        then (ue.rend_t_ha - r.min_tha) / (r.max_tha - r.min_tha) end,
      case when ue.pct_fruta_exportable is not null and r.max_pct is not null and r.max_pct <> r.min_pct
        then (ue.pct_fruta_exportable - r.min_pct) / (r.max_pct - r.min_pct) end
    ]) as t(v)) as prom_produccion,

    -- Estrés climático: escala 1-5 -> 0-1, SIN invertir (0=sin estrés,
    -- 1=estrés máximo). La fórmula lo resta más abajo (ver decisión 2 arriba).
    (select avg(v) from unnest(array[
      case when ue.dano_calor  is not null then (ue.dano_calor - 1) / 4.0 end,
      case when ue.golpe_sol   is not null then (ue.golpe_sol - 1) / 4.0 end,
      case when ue.caida_fruto is not null then (ue.caida_fruto - 1) / 4.0 end
    ]) as t(v)) as prom_estres

  from ultima_evaluacion ue
  cross join rangos_produccion r
)
select
  i.id           as individuo_id,
  i.codigo_display,
  i.planta_id,
  p.codigo_sistema,
  round(n.prom_fenologia::numeric, 4)     as promedio_fenologia,
  round(n.prom_fruto_calidad::numeric, 4) as promedio_fruto_calidad,
  round(n.prom_produccion::numeric, 4)    as promedio_produccion,
  round(n.prom_estres::numeric, 4)        as promedio_estres,
  round((
    (n.prom_fenologia     * 0.20) +
    (n.prom_fruto_calidad * 0.40) +
    (n.prom_produccion    * 0.30) -
    (n.prom_estres        * 0.10)
  )::numeric, 4) as puntaje_ponderado
from individuos i
join plantas p on p.id = i.planta_id
left join normalizado n on n.individuo_id = i.id
where i.estado_vital = 'vivo';

comment on view individuos_scoring is 'Ranking de individuos vivos por puntaje ponderado (Fenología 20% + Fruto/Calidad 40% + Producción 30% − Estrés 10%). Toma la evaluación más reciente por individuo (sin promediar entre tipos/años). NULL si falta alguna categoría o no hay evaluación. security_invoker=on: hereda RLS de individuos/evaluaciones/plantas.';

grant select on individuos_scoring to authenticated;

-- service_role no hereda grants sobre objetos nuevos automáticamente (mismo
-- hallazgo que la migración 20260714021500 sobre las tablas de individuos):
-- sin esto, ni siquiera un script administrativo puede leer la vista.
grant select on individuos_scoring to service_role;
