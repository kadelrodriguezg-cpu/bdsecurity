-- Rollback del paso 45 (descriptor «Distribución de flores y frutos en la vara»).
-- Se niega a borrar la columna si ya hay valores cargados (sería perder datos).
DO $rb$
BEGIN
  IF EXISTS (SELECT 1 FROM public.evaluaciones WHERE distribucion_flores_frutos IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: rollback 45: ya hay evaluaciones con distribución de flores y frutos; no se borra la columna (datos de terreno)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.protocolo_ronda WHERE descriptores ? 'distribucion_flores_frutos') THEN
    RAISE EXCEPTION 'FAIL: rollback 45: hay protocolos de ronda que incluyen la distribución de flores y frutos';
  END IF;
END;
$rb$;
CREATE OR REPLACE FUNCTION public.unificar_evaluacion_ronda(p_ronda_id uuid)
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
CREATE OR REPLACE FUNCTION public.validar_descriptores_protocolo(p_descriptores jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- null si es válido; si no, el motivo.
  select case
    when p_descriptores is null or jsonb_typeof(p_descriptores) <> 'object' then 'El protocolo debe ser un objeto clave -> obligatorio | opcional'
    when not exists (select 1 from jsonb_each_text(p_descriptores)) then 'El protocolo no incluye ningún descriptor'
    when exists (
      select 1 from jsonb_each(p_descriptores) d
      where jsonb_typeof(d.value) <> 'string' or d.value #>> '{}' not in ('obligatorio', 'opcional')
    ) then 'Cada descriptor del protocolo debe ser obligatorio u opcional'
    when exists (
      select 1 from jsonb_object_keys(p_descriptores) k
      where not exists (
        select 1 from esquema_fase_campo c
        where c.fase = 'evaluacion_anual' and c.clave = k and c.rol in ('descriptor', 'muestra')
      )
    ) then 'El protocolo incluye claves que no son descriptores del esquema: ' || (
      select string_agg(k, ', ' order by k) from jsonb_object_keys(p_descriptores) k
      where not exists (
        select 1 from esquema_fase_campo c
        where c.fase = 'evaluacion_anual' and c.clave = k and c.rol in ('descriptor', 'muestra')
      ))
    else null
  end;
$function$
;
CREATE OR REPLACE FUNCTION public.estados_descriptores(p_evaluacion evaluaciones)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with proto as (
    select pr.descriptores from protocolo_ronda pr where pr.id = p_evaluacion.protocolo_id
  ), marcados as (
    select descriptores_fuera_de_revision(p_evaluacion) as claves
  )
  select coalesce(jsonb_object_agg(c.clave,
    case
      when (to_jsonb(p_evaluacion) -> c.clave) is not null and (to_jsonb(p_evaluacion) -> c.clave) <> 'null'::jsonb then
        case when c.clave = any(m.claves) then 'marcado' else 'medido' end
      when exists (select 1 from proto where proto.descriptores ->> c.clave = 'obligatorio') then 'falto'
      else 'no_evaluado'
    end
    order by c.orden), '{}'::jsonb)
  from esquema_fase_campo c
  cross join marcados m
  where c.fase = 'evaluacion_anual' and c.rol in ('descriptor', 'muestra');
$function$
;
DELETE FROM public.esquema_fase_campo WHERE fase = 'evaluacion_anual' AND clave = 'distribucion_flores_frutos';
UPDATE public.esquema_fase_campo SET orden = orden + 1000 WHERE fase = 'evaluacion_anual' AND orden >= 17;
UPDATE public.esquema_fase_campo SET orden = orden - 1001 WHERE fase = 'evaluacion_anual' AND orden >= 1017;
ALTER TABLE public.evaluaciones DROP COLUMN distribucion_flores_frutos;
ALTER TABLE public.esquema_fase_campo DROP COLUMN activo;
ALTER TABLE public.esquema_fase_campo DROP CONSTRAINT esquema_fase_campo_etiquetas_nivel_check;
ALTER TABLE public.esquema_fase_campo DROP COLUMN etiquetas_nivel;
