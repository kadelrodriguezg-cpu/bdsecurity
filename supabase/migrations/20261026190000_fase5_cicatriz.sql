-- Fase 5, paso 57 — descriptor «Cicatriz» (decisión G9; Efraín, EF21).
--
-- Efraín dice que la cicatriz del fruto es importante y enviará su escala. Mientras tanto va una escala 1–5 provisional:
--   1 = «Grande, húmeda o desgarrada» … 5 = «Pequeña y seca» (mayor es mejor).
-- Va en Fruto/Calidad, justo después del Brix. Es opcional y NO entra al puntaje (peso 0): `scoring_metrica` exige peso > 0, así que no
-- tiene fila de métrica (igual que la distribución de flores y frutos, EF12). Es un descriptor de fruto: como el calibre, la firmeza, el
-- color, el bloom y el Brix, exige la muestra de frutos para cerrar (regla de frutos, `exige_muestra`).
--
-- Qué hace:
--   1. Columna `evaluaciones.cicatriz` (smallint, 1 a 5, nula) con su restricción con nombre (la app la traduce).
--   2. El campo en el esquema de fase (sección fruto, orden 22; los siguientes se corren un lugar). Existe desde el 26-10-2026
--      (`vigente_desde`): las evaluaciones anteriores lo leen como «No existía en esa fecha» y no cuenta en su «N de M» (F9).
--   3. `unificar_evaluacion_ronda`: igual que la vigente (fase 4, poscosecha), más la cicatriz en la lista de descriptores que toman el
--      valor no nulo más reciente entre las visitas cerradas de la ronda.
--
-- Aditivo. La app que hoy está en producción no lee la columna nueva (pide columnas propias) y sus guardados no la mandan.
-- Rollback: docs/fase5/rollback/57_cicatriz.sql (se niega si ya hay valores cargados).

alter table public.evaluaciones
  add column cicatriz smallint constraint evaluaciones_cicatriz_check check (cicatriz between 1 and 5);

comment on column public.evaluaciones.cicatriz is
  'Cicatriz del fruto, escala provisional 1–5 (1 = grande, húmeda o desgarrada; 5 = pequeña y seca). Peso 0 hasta la escala de Efraín (G9).';

-- orden es único por fase: se corren los campos siguientes en dos pasos para no chocar con la restricción.
update public.esquema_fase_campo set orden = orden + 100 where fase = 'evaluacion_anual' and orden >= 22;
update public.esquema_fase_campo set orden = orden - 99 where fase = 'evaluacion_anual' and orden >= 122;

insert into public.esquema_fase_campo
  (fase, clave, seccion, etiqueta, orden, rol, tipo, unidad, escala_minimo, escala_maximo, etiqueta_minimo, etiqueta_maximo, exige_muestra, vigente_desde)
values
  ('evaluacion_anual', 'cicatriz', 'fruto', 'Cicatriz', 22, 'descriptor', 'escala', null, 1, 5, 'Grande, húmeda o desgarrada', 'Pequeña y seca', true, date '2026-10-26');

-- unificar_evaluacion_ronda: igual que la de 20261026130000 (poscosecha), más la cicatriz.
create or replace function public.unificar_evaluacion_ronda(p_ronda_id uuid)
 RETURNS SETOF evaluaciones
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with cerradas as materialized (
    select e.*
    from evaluaciones e
    where e.ronda_id = p_ronda_id
      and e.estado in ('completa', 'corregida')
  ), representante as (
    select e as evaluacion
    from cerradas e
    order by e.fecha desc, e.capturada_at desc, e.id desc
    limit 1
  ), descriptores as (
    select
      (array_agg(e.brotacion order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.brotacion is not null))[1] as brotacion,
      (array_agg(e.floracion order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.floracion is not null))[1] as floracion,
      (array_agg(e.cuaja order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.cuaja is not null))[1] as cuaja,
      (array_agg(e.concentracion_cosecha order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.concentracion_cosecha is not null))[1] as concentracion_cosecha,
      (array_agg(e.calibre_mm order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.calibre_mm is not null))[1] as calibre_mm,
      (array_agg(e.firmeza order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.firmeza is not null))[1] as firmeza,
      (array_agg(e.color order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.color is not null))[1] as color,
      (array_agg(e.bloom order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.bloom is not null))[1] as bloom,
      (array_agg(e.brix order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.brix is not null))[1] as brix,
      (array_agg(e.cicatriz order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.cicatriz is not null))[1] as cicatriz,
      (array_agg(e.rend_kg_planta order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.rend_kg_planta is not null))[1] as rend_kg_planta,
      (array_agg(e.rend_t_ha order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.rend_t_ha is not null))[1] as rend_t_ha,
      (array_agg(e.pct_fruta_exportable order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_fruta_exportable is not null))[1] as pct_fruta_exportable,
      (array_agg(e.dano_calor order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.dano_calor is not null))[1] as dano_calor,
      (array_agg(e.golpe_sol order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.golpe_sol is not null))[1] as golpe_sol,
      (array_agg(e.caida_fruto order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.caida_fruto is not null))[1] as caida_fruto,
      (array_agg(e.n_varas_basales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_varas_basales is not null))[1] as n_varas_basales,
      (array_agg(e.n_varas_con_flor order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_varas_con_flor is not null))[1] as n_varas_con_flor,
      (array_agg(e.n_flores_varas_basales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_flores_varas_basales is not null))[1] as n_flores_varas_basales,
      (array_agg(e.n_frutos_varas_basales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.n_frutos_varas_basales is not null))[1] as n_frutos_varas_basales,
      (array_agg(e.altura_brote_mm order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.altura_brote_mm is not null))[1] as altura_brote_mm,
      (array_agg(e.diametro_brote_mm order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.diametro_brote_mm is not null))[1] as diametro_brote_mm,
      (array_agg(e.vigor_vegetativo order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.vigor_vegetativo is not null))[1] as vigor_vegetativo,
      (array_agg(e.color_follaje order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.color_follaje is not null))[1] as color_follaje,
      (array_agg(e.presencia_yemas_florales order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.presencia_yemas_florales is not null))[1] as presencia_yemas_florales,
      (array_agg(e.fecha_inicio_floracion order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.fecha_inicio_floracion is not null))[1] as fecha_inicio_floracion,
      (array_agg(e.precocidad order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.precocidad is not null))[1] as precocidad,
      (array_agg(e.distribucion_flores_frutos order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.distribucion_flores_frutos is not null))[1] as distribucion_flores_frutos,
      (array_agg(e.pct_buen_estado_15d order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_buen_estado_15d is not null))[1] as pct_buen_estado_15d,
      (array_agg(e.pct_buen_estado_30d order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_buen_estado_30d is not null))[1] as pct_buen_estado_30d,
      (array_agg(e.pct_buen_estado_45d order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_buen_estado_45d is not null))[1] as pct_buen_estado_45d,
      (array_agg(e.pct_flores order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_flores is not null))[1] as pct_flores,
      (array_agg(e.pct_frutos order by e.fecha desc, e.capturada_at desc, e.id desc)
        filter (where e.pct_frutos is not null))[1] as pct_frutos
    from cerradas e
  ), muestra as (
    select e.cantidad_frutos, e.peso_total_g, e.peso_promedio_g
    from cerradas e
    where e.cantidad_frutos is not null
      and e.peso_total_g is not null
    order by e.fecha desc, e.capturada_at desc, e.id desc
    limit 1
  )
  select jsonb_populate_record(
    null::evaluaciones,
    to_jsonb(rep.evaluacion) || to_jsonb(d) || jsonb_build_object(
      'cantidad_frutos', m.cantidad_frutos,
      'peso_total_g', m.peso_total_g,
      'peso_promedio_g', m.peso_promedio_g,
      -- Fase 4 (decisión 5): exportable = lectura de 45 días; 0 si una lectura anterior dio 0; sin dato si falta la de 45 días.
      -- Sin ninguna lectura de poscosecha se conserva el valor escrito a mano antes (histórico).
      'pct_fruta_exportable', case
        when d.pct_buen_estado_15d is null and d.pct_buen_estado_30d is null and d.pct_buen_estado_45d is null then d.pct_fruta_exportable
        when d.pct_buen_estado_15d = 0 or d.pct_buen_estado_30d = 0 then 0
        else d.pct_buen_estado_45d
      end
    )
  )
  from representante rep
  cross join descriptores d
  left join muestra m on true;
$function$;
