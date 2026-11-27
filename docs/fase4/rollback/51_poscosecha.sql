-- Rollback del paso 51 (poscosecha). Se niega si ya hay lecturas cargadas (sería perder datos de terreno) o protocolos que las pidan.
DO $rb$
BEGIN
  IF EXISTS (SELECT 1 FROM public.evaluaciones WHERE pct_buen_estado_15d IS NOT NULL OR pct_buen_estado_30d IS NOT NULL OR pct_buen_estado_45d IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: rollback 51: ya hay lecturas de poscosecha cargadas; no se borran las columnas';
  END IF;
  IF EXISTS (SELECT 1 FROM public.protocolo_ronda WHERE descriptores ?| array['pct_buen_estado_15d', 'pct_buen_estado_30d', 'pct_buen_estado_45d']) THEN
    RAISE EXCEPTION 'FAIL: rollback 51: hay protocolos de ronda que piden lecturas de poscosecha';
  END IF;
  IF EXISTS (SELECT 1 FROM public.esquema_campo_especie WHERE clave LIKE 'pct_buen_estado_%') THEN
    RAISE EXCEPTION 'FAIL: rollback 51: hay configuración por especie de las lecturas de poscosecha';
  END IF;
END;
$rb$;
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
      'peso_promedio_g', m.peso_promedio_g
    )
  )
  from representante rep
  cross join descriptores d
  left join muestra m on true;
$function$
;
DELETE FROM public.esquema_fase_campo WHERE fase = 'evaluacion_anual' AND clave IN ('pct_buen_estado_15d', 'pct_buen_estado_30d', 'pct_buen_estado_45d');
UPDATE public.esquema_fase_campo SET rol = 'descriptor' WHERE fase = 'evaluacion_anual' AND clave = 'pct_fruta_exportable';
UPDATE public.esquema_fase_campo SET orden = orden + 1000 WHERE fase = 'evaluacion_anual' AND orden >= 32;
UPDATE public.esquema_fase_campo SET orden = orden - 1003 WHERE fase = 'evaluacion_anual' AND orden >= 1032;
COMMENT ON COLUMN public.evaluaciones.pct_fruta_exportable IS NULL;
ALTER TABLE public.evaluaciones DROP COLUMN pct_buen_estado_15d, DROP COLUMN pct_buen_estado_30d, DROP COLUMN pct_buen_estado_45d;
-- El comentario de la función también vuelve al de antes (CREATE OR REPLACE no lo restaura).
comment on function public.unificar_evaluacion_ronda(uuid) is 'Fotografia unificada de una ronda: cada descriptor usa el valor no NULL mas reciente por fecha/capturada_at/id DESC (A1-105: una correccion no reordena las visitas). Los porcentajes generados conservan numerador y denominador de una misma visita. La tripleta cantidad/peso/promedio tambien es atomica.';
