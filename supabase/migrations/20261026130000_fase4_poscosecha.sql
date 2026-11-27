-- Fase 4, paso 51 — poscosecha: tres lecturas quincenales y el % de fruta exportable calculado (EF13; decisiones 5 y 6 de Kadel,
-- 25-10-2026; opción A1 de docs/diseno_poscosecha.md).
--
-- 1. Tres descriptores nuevos en Producción, «% de frutos en buen estado» a los 15, 30 y 45 días de refrigerador (0 a 100):
--    columnas `evaluaciones.pct_buen_estado_15d`, `_30d` y `_45d` y sus campos en el esquema (rol descriptor, opcionales en el
--    protocolo como cualquier otro). Existen desde el 26-10-2026 (`vigente_desde`): una evaluación anterior no los cuenta.
-- 2. `pct_fruta_exportable` pasa a CALCULADO (rol derivado en el esquema): ya no se escribe en el formulario ni se pide en
--    protocolos nuevos. La columna y sus valores históricos se conservan (hoy no hay ninguno en producción).
-- 3. `unificar_evaluacion_ronda` (la fotografía de la ronda, que leen el puntaje, el ranking y la ficha) junta las lecturas de todas
--    las visitas cerradas (cada una toma el valor no nulo más reciente, como los demás descriptores) y calcula el exportable con la
--    regla de la decisión 5:
--      - si alguna lectura anterior (15 o 30 días) dio 0 %, el exportable es 0;
--      - si no, es el valor a los 45 días;
--      - si falta la lectura de 45 días, queda SIN DATO (nulo, no 0): no castiga a una planta cuya poscosecha aún no termina;
--      - sin ninguna lectura de poscosecha, se conserva el valor que se haya escrito a mano antes (compatibilidad con lo histórico).
--    El puntaje usa ese valor calculado (la métrica `pct_fruta_exportable` de la versión de puntaje no cambia).
--
-- La app anterior sigue funcionando: no conoce las columnas nuevas y, si escribe el exportable a mano, ese valor cuenta mientras
-- la ronda no tenga lecturas de poscosecha. Rollback: docs/fase4/rollback/51_poscosecha.sql (se niega si ya hay lecturas).

alter table public.evaluaciones
  add column pct_buen_estado_15d numeric,
  add column pct_buen_estado_30d numeric,
  add column pct_buen_estado_45d numeric,
  add constraint evaluaciones_pct_buen_estado_15d_check check (pct_buen_estado_15d is null or (pct_buen_estado_15d >= 0 and pct_buen_estado_15d <= 100)),
  add constraint evaluaciones_pct_buen_estado_30d_check check (pct_buen_estado_30d is null or (pct_buen_estado_30d >= 0 and pct_buen_estado_30d <= 100)),
  add constraint evaluaciones_pct_buen_estado_45d_check check (pct_buen_estado_45d is null or (pct_buen_estado_45d >= 0 and pct_buen_estado_45d <= 100));

comment on column public.evaluaciones.pct_buen_estado_15d is 'Poscosecha: % de frutos en buen estado a los 15 días de refrigerador (0 a 100).';
comment on column public.evaluaciones.pct_buen_estado_30d is 'Poscosecha: % de frutos en buen estado a los 30 días de refrigerador (0 a 100).';
comment on column public.evaluaciones.pct_buen_estado_45d is 'Poscosecha: % de frutos en buen estado a los 45 días de refrigerador (0 a 100).';
comment on column public.evaluaciones.pct_fruta_exportable is
  'Histórico: % de fruta exportable escrito a mano. Desde la fase 4 se calcula en unificar_evaluacion_ronda a partir de la poscosecha.';

-- orden es único por fase: los campos desde el exportable se corren tres lugares, en dos pasos para no chocar con la restricción.
update public.esquema_fase_campo set orden = orden + 1000 where fase = 'evaluacion_anual' and orden >= 29;
update public.esquema_fase_campo set orden = orden - 997 where fase = 'evaluacion_anual' and orden >= 1029;

insert into public.esquema_fase_campo
  (fase, clave, seccion, etiqueta, orden, rol, tipo, unidad, exige_muestra, vigente_desde)
values
  ('evaluacion_anual', 'pct_buen_estado_15d', 'produccion', 'Buen estado a los 15 días', 29, 'descriptor', 'numero', '%', false, date '2026-10-26'),
  ('evaluacion_anual', 'pct_buen_estado_30d', 'produccion', 'Buen estado a los 30 días', 30, 'descriptor', 'numero', '%', false, date '2026-10-26'),
  ('evaluacion_anual', 'pct_buen_estado_45d', 'produccion', 'Buen estado a los 45 días', 31, 'descriptor', 'numero', '%', false, date '2026-10-26');

update public.esquema_fase_campo set rol = 'derivado' where fase = 'evaluacion_anual' and clave = 'pct_fruta_exportable';

do $verificar$
begin
  if (select string_agg(clave, ',' order by orden) from public.esquema_fase_campo where fase = 'evaluacion_anual' and seccion = 'produccion')
     <> 'pct_flores,pct_frutos,rend_kg_planta,rend_t_ha,pct_buen_estado_15d,pct_buen_estado_30d,pct_buen_estado_45d,pct_fruta_exportable' then
    raise exception 'poscosecha: orden de Producción inesperado';
  end if;
end;
$verificar$;

-- unificar_evaluacion_ronda: igual que la de 20261025110000, más las tres lecturas y el exportable calculado.
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
$function$
;
comment on function public.unificar_evaluacion_ronda(uuid) is
  'Fotografia unificada de una ronda: cada descriptor usa el valor no NULL mas reciente por fecha/capturada_at/id DESC (A1-105: una correccion no reordena las visitas). Los porcentajes generados conservan numerador y denominador de una misma visita. La tripleta cantidad/peso/promedio tambien es atomica. Fase 4: pct_fruta_exportable se calcula con las lecturas de poscosecha (15, 30 y 45 dias).';

