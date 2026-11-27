-- D4: cobertura incompleta es un estado normal de una ronda que se construye
-- en varias visitas, no un error generico de configuracion. Se conserva el gate
-- de elegibilidad (100% de metricas); solo cambia la explicacion de negocio.
do $migration$
declare
  v_definicion text;
  v_anterior constant text := 'when c.disponibles < c.configuradas then ''faltan_metricas_scoring''';
  v_nueva constant text := 'when c.disponibles < c.configuradas then ''evaluacion_parcial_en_curso''';
begin
  select pg_get_functiondef('public.calcular_ranking_operativo(uuid,uuid,uuid)'::regprocedure)
    into v_definicion;
  if position(v_anterior in v_definicion) = 0 then
    raise exception 'No se encontro el CASE esperado de metricas incompletas en calcular_ranking_operativo';
  end if;
  execute replace(v_definicion, v_anterior, v_nueva);
end;
$migration$;

comment on function public.calcular_ranking_operativo(uuid, uuid, uuid) is
  'Motor canonico de ranking. Unifica la ronda anual por descriptor, conserva '
  'el gate de cobertura completa y clasifica cobertura incompleta como '
  'evaluacion_parcial_en_curso para separarla visualmente de errores o bloqueos.';

-- Mantener coherente la metadata descriptiva de las dos RPC de consulta.
do $migration$
declare
  v_regprocedure regprocedure;
  v_definicion text;
begin
  foreach v_regprocedure in array array[
    'public.obtener_ranking_operativo(uuid,uuid,integer,integer,text)'::regprocedure,
    'public.obtener_ranking_global_filtrado(uuid,uuid,date,date,estado_vital,integer,integer,text)'::regprocedure
  ] loop
    select pg_get_functiondef(v_regprocedure) into v_definicion;
    if position('metricas_incompletas' in v_definicion) = 0 then
      raise exception 'No se encontro la metadata esperada en %', v_regprocedure;
    end if;
    execute replace(v_definicion, 'metricas_incompletas', 'evaluacion_parcial_en_curso');
  end loop;
end;
$migration$;
