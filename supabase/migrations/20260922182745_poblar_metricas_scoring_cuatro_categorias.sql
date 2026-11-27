-- DEFAULT PROVISIONAL, NO VALIDADO AGRONOMICAMENTE.
--
-- Completa Fenologia, Produccion y Estres en la version global activa y
-- vigente de evaluacion_anual. Los pesos relativos, limites 1-5 y direcciones
-- deben ser revisados por el responsable del programa antes de considerarlos una configuracion
-- cientifica validada.
--
-- Limitacion conocida: rend_kg_planta y rend_t_ha representan esencialmente
-- la misma senal de rendimiento en unidades distintas. Darles el mismo peso
-- puede duplicar esa senal dentro de Produccion. Se conserva exactamente el
-- default solicitado y no se corrige sin validacion agronomica.

do $$
declare
  v_scoring_version_id uuid;
begin
  select sv.id
    into strict v_scoring_version_id
  from scoring_version sv
  where sv.estado = 'activa'
    and sv.especie_id is null
    and sv.fase = 'evaluacion_anual'
    and sv.vigente_desde <= current_date
    and (sv.vigente_hasta is null or sv.vigente_hasta >= current_date);

  insert into scoring_metrica (
    scoring_version_id,
    categoria,
    metrica,
    peso,
    direccion_favorable,
    metodo_normalizacion,
    minimo_normalizacion,
    maximo_normalizacion,
    rango_referencia_id,
    tratamiento_nulos,
    orden
  )
  select
    v_scoring_version_id,
    m.categoria,
    m.metrica,
    m.peso,
    m.direccion_favorable,
    'escala'::metodo_normalizacion_scoring,
    1::numeric,
    5::numeric,
    null::uuid,
    'excluir_evaluacion'::tratamiento_nulos_scoring,
    m.orden
  from (values
    ('fenologia'::categoria_scoring,  'brotacion'::text,              0.05::numeric,  'mayor'::direccion_scoring,  5::smallint),
    ('fenologia'::categoria_scoring,  'floracion'::text,              0.05::numeric,  'mayor'::direccion_scoring,  6::smallint),
    ('fenologia'::categoria_scoring,  'cuaja'::text,                  0.05::numeric,  'mayor'::direccion_scoring,  7::smallint),
    ('fenologia'::categoria_scoring,  'concentracion_cosecha'::text,  0.05::numeric,  'mayor'::direccion_scoring,  8::smallint),
    ('produccion'::categoria_scoring, 'rend_kg_planta'::text,         0.10::numeric,  'mayor'::direccion_scoring,  9::smallint),
    ('produccion'::categoria_scoring, 'rend_t_ha'::text,              0.10::numeric,  'mayor'::direccion_scoring, 10::smallint),
    ('produccion'::categoria_scoring, 'pct_fruta_exportable'::text,   0.10::numeric,  'mayor'::direccion_scoring, 11::smallint),
    ('estres'::categoria_scoring,     'dano_calor'::text,             0.033::numeric, 'menor'::direccion_scoring, 12::smallint),
    ('estres'::categoria_scoring,     'golpe_sol'::text,              0.033::numeric, 'menor'::direccion_scoring, 13::smallint),
    ('estres'::categoria_scoring,     'caida_fruto'::text,            0.033::numeric, 'menor'::direccion_scoring, 14::smallint)
  ) as m(categoria, metrica, peso, direccion_favorable, orden);
exception
  when no_data_found then
    raise exception
      'No existe una version global activa y vigente de scoring para evaluacion_anual'
      using errcode = 'P0002';
  when too_many_rows then
    raise exception
      'Existe mas de una version global activa y vigente de scoring para evaluacion_anual'
      using errcode = 'P0003';
end;
$$;
