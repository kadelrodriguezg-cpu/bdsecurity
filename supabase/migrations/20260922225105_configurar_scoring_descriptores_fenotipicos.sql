-- DEFAULT PROVISIONAL, NO VALIDADO AGRONOMICAMENTE.
--
-- Redistribuye Fenologia (0.20), Produccion (0.30) y Estres (0.10) sin
-- cambiar el peso global de cada categoria. Tambien corrige un bug de Fase 1:
-- pct_fruta_exportable se captura y valida como porcentaje 0-100, pero habia
-- quedado normalizada 1-5, saturando en el maximo todo valor superior a 5%.
--
-- rend_kg_planta y rend_t_ha permanecen provisionalmente en 1-5: su dominio
-- real no tiene maximo validado y no se inventa uno en esta migracion. Ademas
-- miden esencialmente la misma senal en unidades distintas; ambas limitaciones
-- quedan registradas en docs/pendientes.md.

-- La fotografia unificada incorpora los trece campos nuevos. Los porcentajes
-- se toman de una sola visita ya calculados por PostgreSQL; no se divide un
-- numerador de una visita por el denominador de otra.
create or replace function public.unificar_evaluacion_ronda(p_ronda_id uuid)
returns setof public.evaluaciones
language sql
stable
security invoker
set search_path = public
as $$
  with cerradas as materialized (
    select e.*
    from evaluaciones e
    where e.ronda_id = p_ronda_id
      and e.estado in ('completa', 'corregida')
  ), representante as (
    select e as evaluacion
    from cerradas e
    order by e.fecha desc, e.updated_at desc, e.id desc
    limit 1
  ), descriptores as (
    select
      (array_agg(e.brotacion order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.brotacion is not null))[1] as brotacion,
      (array_agg(e.floracion order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.floracion is not null))[1] as floracion,
      (array_agg(e.cuaja order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.cuaja is not null))[1] as cuaja,
      (array_agg(e.concentracion_cosecha order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.concentracion_cosecha is not null))[1] as concentracion_cosecha,
      (array_agg(e.calibre_mm order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.calibre_mm is not null))[1] as calibre_mm,
      (array_agg(e.firmeza order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.firmeza is not null))[1] as firmeza,
      (array_agg(e.color order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.color is not null))[1] as color,
      (array_agg(e.bloom order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.bloom is not null))[1] as bloom,
      (array_agg(e.brix order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.brix is not null))[1] as brix,
      (array_agg(e.rend_kg_planta order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.rend_kg_planta is not null))[1] as rend_kg_planta,
      (array_agg(e.rend_t_ha order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.rend_t_ha is not null))[1] as rend_t_ha,
      (array_agg(e.pct_fruta_exportable order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.pct_fruta_exportable is not null))[1] as pct_fruta_exportable,
      (array_agg(e.dano_calor order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.dano_calor is not null))[1] as dano_calor,
      (array_agg(e.golpe_sol order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.golpe_sol is not null))[1] as golpe_sol,
      (array_agg(e.caida_fruto order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.caida_fruto is not null))[1] as caida_fruto,
      (array_agg(e.n_varas_basales order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.n_varas_basales is not null))[1] as n_varas_basales,
      (array_agg(e.n_varas_con_flor order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.n_varas_con_flor is not null))[1] as n_varas_con_flor,
      (array_agg(e.n_flores_varas_basales order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.n_flores_varas_basales is not null))[1] as n_flores_varas_basales,
      (array_agg(e.n_frutos_varas_basales order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.n_frutos_varas_basales is not null))[1] as n_frutos_varas_basales,
      (array_agg(e.altura_brote_mm order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.altura_brote_mm is not null))[1] as altura_brote_mm,
      (array_agg(e.diametro_brote_mm order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.diametro_brote_mm is not null))[1] as diametro_brote_mm,
      (array_agg(e.vigor_vegetativo order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.vigor_vegetativo is not null))[1] as vigor_vegetativo,
      (array_agg(e.color_follaje order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.color_follaje is not null))[1] as color_follaje,
      (array_agg(e.presencia_yemas_florales order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.presencia_yemas_florales is not null))[1] as presencia_yemas_florales,
      (array_agg(e.fecha_inicio_floracion order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.fecha_inicio_floracion is not null))[1] as fecha_inicio_floracion,
      (array_agg(e.precocidad order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.precocidad is not null))[1] as precocidad,
      (array_agg(e.pct_flores order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.pct_flores is not null))[1] as pct_flores,
      (array_agg(e.pct_frutos order by e.fecha desc, e.updated_at desc, e.id desc)
        filter (where e.pct_frutos is not null))[1] as pct_frutos
    from cerradas e
  ), muestra as (
    select e.cantidad_frutos, e.peso_total_g, e.peso_promedio_g
    from cerradas e
    where e.cantidad_frutos is not null
      and e.peso_total_g is not null
    order by e.fecha desc, e.updated_at desc, e.id desc
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
$$;

revoke all on function public.unificar_evaluacion_ronda(uuid) from public, anon;
grant execute on function public.unificar_evaluacion_ronda(uuid) to authenticated, service_role;

comment on function public.unificar_evaluacion_ronda(uuid) is
  'Fotografia unificada de una ronda: cada descriptor usa el valor no NULL mas reciente por fecha/updated_at/id DESC. Los porcentajes generados conservan numerador y denominador de una misma visita. La tripleta cantidad/peso/promedio tambien es atomica.';

-- Propagar las seis metricas nuevas al unico motor canonico. Los reemplazos
-- son deliberadamente estrictos: si la funcion cambia, la migracion falla en
-- vez de dejar configuracion que el motor no sabe leer.
do $migration$
declare
  v_definicion text;
  v_base_anterior constant text := $old$      e.rend_kg_planta, e.rend_t_ha, e.pct_fruta_exportable,
      e.dano_calor, e.golpe_sol, e.caida_fruto,$old$;
  v_base_nueva constant text := $new$      e.rend_kg_planta, e.rend_t_ha, e.pct_fruta_exportable,
      e.pct_flores, e.pct_frutos,
      e.dano_calor, e.golpe_sol, e.caida_fruto,
      e.vigor_vegetativo, e.color_follaje,
      e.presencia_yemas_florales, e.precocidad,$new$;
  v_case_anterior constant text := $old$            when 'pct_fruta_exportable' then b.pct_fruta_exportable
            when 'dano_calor' then b.dano_calor::numeric$old$;
  v_case_nueva constant text := $new$            when 'pct_fruta_exportable' then b.pct_fruta_exportable
            when 'pct_flores' then b.pct_flores
            when 'pct_frutos' then b.pct_frutos
            when 'dano_calor' then b.dano_calor::numeric$new$;
  v_estres_anterior constant text := $old$            when 'caida_fruto' then b.caida_fruto::numeric
            else null$old$;
  v_estres_nueva constant text := $new$            when 'caida_fruto' then b.caida_fruto::numeric
            when 'vigor_vegetativo' then b.vigor_vegetativo::numeric
            when 'color_follaje' then b.color_follaje::numeric
            when 'presencia_yemas_florales' then b.presencia_yemas_florales::numeric
            when 'precocidad' then b.precocidad::numeric
            else null$new$;
begin
  select pg_get_functiondef(
    'public.calcular_ranking_operativo(uuid,uuid,uuid)'::regprocedure
  ) into v_definicion;

  if position(v_base_anterior in v_definicion) = 0
    or position(v_case_anterior in v_definicion) = 0
    or position(v_estres_anterior in v_definicion) = 0 then
    raise exception 'No se encontro la estructura esperada de calcular_ranking_operativo';
  end if;

  v_definicion := replace(v_definicion, v_base_anterior, v_base_nueva);
  v_definicion := replace(v_definicion, v_case_anterior, v_case_nueva);
  v_definicion := replace(v_definicion, v_estres_anterior, v_estres_nueva);
  execute v_definicion;
end;
$migration$;

do $migration$
declare
  v_scoring_version_id uuid;
  v_actualizadas integer;
begin
  select sv.id
    into strict v_scoring_version_id
  from public.scoring_version sv
  where sv.estado = 'activa'
    and sv.especie_id is null
    and sv.fase = 'evaluacion_anual'
    and sv.vigente_desde <= current_date
    and (sv.vigente_hasta is null or sv.vigente_hasta >= current_date);

  update public.scoring_metrica sm
  set peso = v.peso,
      minimo_normalizacion = v.minimo,
      maximo_normalizacion = v.maximo
  from (values
    ('brotacion'::text,             0.034::numeric, 1::numeric, 5::numeric),
    ('floracion'::text,             0.034::numeric, 1::numeric, 5::numeric),
    ('cuaja'::text,                 0.033::numeric, 1::numeric, 5::numeric),
    ('concentracion_cosecha'::text, 0.033::numeric, 1::numeric, 5::numeric),
    ('rend_kg_planta'::text,        0.060::numeric, 1::numeric, 5::numeric),
    ('rend_t_ha'::text,             0.060::numeric, 1::numeric, 5::numeric),
    ('pct_fruta_exportable'::text,  0.060::numeric, 0::numeric, 100::numeric),
    ('dano_calor'::text,            0.020::numeric, 1::numeric, 5::numeric),
    ('golpe_sol'::text,             0.020::numeric, 1::numeric, 5::numeric),
    ('caida_fruto'::text,           0.020::numeric, 1::numeric, 5::numeric)
  ) as v(metrica, peso, minimo, maximo)
  where sm.scoring_version_id = v_scoring_version_id
    and sm.metrica = v.metrica;

  get diagnostics v_actualizadas = row_count;
  if v_actualizadas <> 10 then
    raise exception 'Se esperaban 10 metricas de Fase 1; se actualizaron %', v_actualizadas;
  end if;

  insert into public.scoring_metrica (
    scoring_version_id, categoria, metrica, peso, direccion_favorable,
    metodo_normalizacion, minimo_normalizacion, maximo_normalizacion,
    rango_referencia_id, tratamiento_nulos, orden
  ) values
    (v_scoring_version_id, 'fenologia', 'presencia_yemas_florales', 0.033, 'mayor', 'escala', 0, 5, null, 'excluir_evaluacion', 15),
    (v_scoring_version_id, 'fenologia', 'precocidad', 0.033, 'mayor', 'escala', 1, 5, null, 'excluir_evaluacion', 16),
    (v_scoring_version_id, 'estres', 'vigor_vegetativo', 0.020, 'mayor', 'escala', 1, 5, null, 'excluir_evaluacion', 17),
    (v_scoring_version_id, 'estres', 'color_follaje', 0.020, 'mayor', 'escala', 1, 5, null, 'excluir_evaluacion', 18),
    (v_scoring_version_id, 'produccion', 'pct_flores', 0.060, 'mayor', 'escala', 0, 100, null, 'excluir_evaluacion', 19),
    (v_scoring_version_id, 'produccion', 'pct_frutos', 0.060, 'mayor', 'escala', 0, 100, null, 'excluir_evaluacion', 20);

  if exists (
    select 1
    from public.scoring_categoria_peso scp
    left join lateral (
      select sum(sm.peso) as peso_metricas
      from public.scoring_metrica sm
      where sm.scoring_version_id = scp.scoring_version_id
        and sm.categoria = scp.categoria
    ) total on true
    where scp.scoring_version_id = v_scoring_version_id
      and scp.categoria in ('fenologia', 'produccion', 'estres')
      and total.peso_metricas is distinct from scp.peso
  ) then
    raise exception 'La redistribucion no conserva el peso total de alguna categoria';
  end if;
exception
  when no_data_found then
    raise exception 'No existe una version global activa y vigente de scoring para evaluacion_anual'
      using errcode = 'P0002';
  when too_many_rows then
    raise exception 'Existe mas de una version global activa y vigente de scoring para evaluacion_anual'
      using errcode = 'P0003';
end;
$migration$;

comment on function public.calcular_ranking_operativo(uuid, uuid, uuid) is
  'Motor canonico de ranking. Unifica la ronda por descriptor, incluye los seis descriptores Fase 5 configurados, conserva el gate de cobertura completa y clasifica cobertura incompleta como evaluacion_parcial_en_curso.';
