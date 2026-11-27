-- Fase 2, Sprint 2 (S2-5) — rendimiento del ranking, SIN cambiar ningún resultado.
--
-- Medido en producción (23-10-2026): el ranking general de la especie tardaba
-- 2,2–2,9 s con 1.313 individuos vivos y casi sin evaluaciones. Causas halladas
-- en el motor (calcular_ranking_base, migraciones 20261021142000 y
-- 20261023100000), medidas en local con volumen parecido al de producción:
--
--   1. Por CADA individuo, aunque no tenga evaluación, el motor reconstruía en un
--      lateral las 20 métricas de la versión, las 4 categorías, la cobertura y el
--      grupo: ~0,5 ms por individuo para obtener siempre el mismo resultado vacío.
--   2. Con evaluación, cada métrica llamaba hasta 6 veces a
--      extraer_metrica_evaluacion, y cada llamada convertía la evaluación entera
--      (49 columnas) a jsonb: ~120 conversiones por individuo.
--   3. obtener_procedencia_calidad_ronda consultaba information_schema.columns
--      (vista pesada) en cada llamada, y se llamaba también para rondas sin
--      evaluación.
--   4. El ranking operativo pagaba la cobertura y el grupo, que solo usa el
--      ranking por grupos; el ranking por grupos filtraba los cruces de prueba
--      después de calcularlos.
--
-- Cambios (solo internos; ninguna firma, columna, grant ni SECURITY cambia):
--
--   a. calcular_ranking_nucleo (NUEVA, interna): el motor reescrito por
--      conjuntos. La evaluación se pasa a jsonb una sola vez por individuo; las
--      métricas, categorías, puntaje, cobertura y grupo se calculan en una sola
--      pasada agregada; los individuos sin evaluación comparten un resultado
--      «vacío» por versión de scoring (se calcula con las MISMAS expresiones,
--      con una evaluación vacía, una vez por versión y no una vez por
--      individuo); la cobertura y el grupo solo se calculan si se piden
--      (p_con_grupo); los cruces de prueba se filtran en el alcance.
--   b. calcular_ranking_base: misma firma y salida; pasa a delegar en el núcleo
--      (con cobertura y grupo).
--   c. calcular_ranking_operativo: misma firma y salida; usa el núcleo sin
--      cobertura ni grupo.
--   d. calcular_ranking_grupos: misma firma y salida; usa el núcleo con
--      cobertura y grupo, filtrando los cruces de prueba en el alcance.
--   e. obtener_procedencia_calidad_ronda: misma firma y salida; las columnas de
--      evaluaciones salen de pg_attribute (con el mismo orden «C» que tenía
--      sql_identifier) en lugar de information_schema.columns.
--
-- El puntaje, la normalización, los pesos, las compuertas y el orden de las
-- filas no cambian: se verifica con una huella md5 de todas las filas antes y
-- después (ver docs/evidencia_sprint2.md, S2-5).

-- e. Procedencia de calidad ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.obtener_procedencia_calidad_ronda(p_ronda_id uuid)
 RETURNS TABLE(descriptores_con_revision text[], descriptores_no_comparables text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with cerradas as materialized (
    select e.*
    from evaluaciones e
    where e.ronda_id = p_ronda_id
      and e.estado in ('completa', 'corregida')
  ), columnas_descriptor as (
    -- Toda columna de evaluaciones que no sea metadata de la fila ni la
    -- tripleta cantidad/peso/promedio (que tiene su propia regla de
    -- atomicidad, resuelta abajo por separado). S2-5: desde pg_attribute y no
    -- desde information_schema.columns (misma lista; la vista cuesta ~0,3 ms
    -- por llamada). El tipo name conserva el orden «C» de sql_identifier.
    select a.attname as column_name
    from pg_attribute a
    where a.attrelid = 'public.evaluaciones'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname not in (
        'id', 'ronda_id', 'estado', 'fecha', 'anio', 'evaluador', 'observaciones',
        'sin_muestra', 'requiere_revision', 'no_comparable', 'motivo_cambio',
        'created_by', 'created_at', 'updated_at', 'idempotency_key', 'predio_id',
        'capturada_at', 'protocolo_id',
        'cantidad_frutos', 'peso_total_g', 'peso_promedio_g'
      )
  ), desplegado as (
    -- S2-5: la visita se convierte a jsonb UNA vez y se recorren sus pares
    -- clave/valor (antes se convertía de nuevo por cada columna: ~45 veces).
    select
      c.id, c.fecha, c.capturada_at, c.requiere_revision, c.no_comparable,
      kv.key as descriptor,
      kv.value as valor
    from cerradas c
    cross join lateral jsonb_each(to_jsonb(c)) kv
    where kv.key in (select cd.column_name::text from columnas_descriptor cd)
  ), ganador_por_descriptor as (
    -- Mismo criterio de desempate que el array_agg(...)[1] de
    -- unificar_evaluacion_ronda: entre las visitas donde ESE descriptor
    -- tiene valor, la mas reciente por fecha/capturada_at/id (A1-105).
    -- «Tiene valor» = el valor jsonb no es null (antes: valor_texto is not null).
    select distinct on (descriptor)
      descriptor, requiere_revision, no_comparable
    from desplegado
    where valor <> 'null'::jsonb
    order by descriptor, fecha desc, capturada_at desc, id desc
  ), ganador_muestra as (
    -- Misma regla que la CTE "muestra" de unificar_evaluacion_ronda: la
    -- tripleta viaja junta desde una sola visita, su bandera es la de esa
    -- visita, no la de cada columna por separado.
    select 'cantidad_frutos'::text as descriptor, e.requiere_revision, e.no_comparable
    from cerradas e
    where e.cantidad_frutos is not null and e.peso_total_g is not null
    order by e.fecha desc, e.capturada_at desc, e.id desc
    limit 1
  ), todos as (
    select descriptor::text as descriptor, requiere_revision, no_comparable from ganador_por_descriptor
    union all
    select * from ganador_muestra
  )
  select
    coalesce(array_agg(descriptor order by descriptor collate "C") filter (where requiere_revision), '{}'::text[]),
    coalesce(array_agg(descriptor order by descriptor collate "C") filter (where no_comparable), '{}'::text[])
  from todos;
$function$;

-- a. Núcleo del motor ------------------------------------------------------------

create function public.calcular_ranking_nucleo(
  p_scoring_version_id uuid,
  p_planta_id uuid DEFAULT NULL::uuid,
  p_especie_id uuid DEFAULT NULL::uuid,
  p_por_ronda boolean DEFAULT false,
  p_incluir_pruebas boolean DEFAULT true,
  p_con_grupo boolean DEFAULT true
)
 RETURNS TABLE(individuo_id uuid, codigo_display text, planta_id uuid, codigo_sistema text, especie_id uuid, es_prueba boolean, evaluacion_id uuid, fecha_evaluacion date, evaluacion_updated_at timestamp with time zone, numero_ronda smallint, estado_evaluacion estado_evaluacion, requiere_revision boolean, no_comparable boolean, scoring_version_id uuid, scoring_version_nombre text, configuradas integer, disponibles integer, puntaje_bruto numeric, tiene_metrica_marcada boolean, detalle_metricas jsonb, detalle_categorias jsonb, cobertura jsonb, grupo text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with alcance as (
    select
      i.id as individuo_id,
      i.codigo_display,
      i.planta_id,
      p.codigo_sistema,
      p.especie_id,
      p.es_prueba
    from individuos i
    join plantas p on p.id = i.planta_id
    where i.estado_vital = 'vivo'
      and p.eliminado_at is null
      and (p_planta_id is null or p.id = p_planta_id)
      and (p_especie_id is null or p.especie_id = p_especie_id)
      and (p_incluir_pruebas or not p.es_prueba)
  ), ultima_ronda as (
    select distinct on (r.individuo_id)
      r.individuo_id,
      r.id as ronda_id,
      r.numero_ronda,
      r.scoring_version_id as ronda_scoring_version_id,
      -- Misma condición con que unificar_evaluacion_ronda y
      -- obtener_procedencia_calidad_ronda eligen las visitas cerradas.
      exists (
        select 1 from evaluaciones ev
        where ev.ronda_id = r.id and ev.estado in ('completa', 'corregida')
      ) as con_cerrada
    from ronda_evaluacion_anual r
    join alcance a on a.individuo_id = r.individuo_id
    where r.tipo_ronda = 'anual'
    order by r.individuo_id, r.numero_ronda desc, r.created_at desc, r.id desc
  ), con_evaluacion as (
    -- Solo estas rondas pagan la unificación de visitas y la procedencia.
    select
      a.*,
      ur.numero_ronda,
      ur.ronda_scoring_version_id,
      e.id as evaluacion_id,
      e.fecha as fecha_evaluacion,
      e.updated_at as evaluacion_updated_at,
      e.estado as estado_evaluacion,
      e.requiere_revision,
      e.no_comparable,
      to_jsonb(e) as evaluacion_json,
      proc.descriptores_con_revision,
      proc.descriptores_no_comparables
    from alcance a
    join ultima_ronda ur on ur.individuo_id = a.individuo_id and ur.con_cerrada
    cross join lateral unificar_evaluacion_ronda(ur.ronda_id) e
    cross join lateral obtener_procedencia_calidad_ronda(ur.ronda_id) proc
  ), sin_evaluacion as (
    -- Sin ronda, o con la ronda más reciente sin visita completa/corregida:
    -- sin evaluación y sin descriptores marcados.
    select
      a.*,
      ur.numero_ronda,
      ur.ronda_scoring_version_id,
      null::uuid as evaluacion_id,
      null::date as fecha_evaluacion,
      null::timestamptz as evaluacion_updated_at,
      null::estado_evaluacion as estado_evaluacion,
      null::boolean as requiere_revision,
      null::boolean as no_comparable,
      null::jsonb as evaluacion_json,
      null::text[] as descriptores_con_revision,
      null::text[] as descriptores_no_comparables
    from alcance a
    left join ultima_ronda ur on ur.individuo_id = a.individuo_id
    where ur.individuo_id is null or not ur.con_cerrada
  ), base as (
    select
      b0.*,
      sv.id as scoring_version_id,
      sv.nombre as scoring_version_nombre
    from (
      select * from con_evaluacion
      union all
      select * from sin_evaluacion
    ) b0
    -- B6: con p_por_ronda, cada ronda se calcula con la versión con que se
    -- cerró; p_scoring_version_id solo cubre las rondas sin cerrar. Sin
    -- p_por_ronda, todas con p_scoring_version_id (versión elegida).
    left join scoring_version sv on sv.id = case
      when p_por_ronda then coalesce(b0.ronda_scoring_version_id, p_scoring_version_id)
      else p_scoring_version_id
    end
  ), entradas as (
    -- Una entrada por individuo con evaluación, más UNA «vacía» por versión de
    -- scoring para los individuos sin evaluación: su resultado depende solo de
    -- la versión (todas las métricas sin valor, sin descriptores marcados).
    select
      b.individuo_id::text as clave,
      b.scoring_version_id,
      b.evaluacion_json as ej,
      coalesce(b.descriptores_con_revision, '{}'::text[]) as con_revision,
      coalesce(b.descriptores_no_comparables, '{}'::text[]) as no_comparables
    from base b
    where b.evaluacion_id is not null
    union all
    select
      'v:' || coalesce(v.scoring_version_id::text, ''),
      v.scoring_version_id,
      null::jsonb,
      '{}'::text[],
      '{}'::text[]
    from (select distinct b.scoring_version_id from base b where b.evaluacion_id is null) v
  ), con_clave as (
    select row_number() over () as k, e.* from entradas e
  ), met0 as materialized (
    select
      c.k,
      sm.id as metrica_id,
      sm.metrica,
      sm.categoria,
      sm.peso,
      sm.direccion_favorable,
      coalesce(rr.minimo_esperado, sm.minimo_normalizacion) as minimo,
      coalesce(rr.maximo_esperado, sm.maximo_normalizacion) as maximo,
      rr.minimo_esperado as rr_minimo,
      rr.maximo_esperado as rr_maximo,
      -- Equivale a extraer_metrica_evaluacion(evaluacion, metrica), con la
      -- evaluación ya convertida a jsonb una sola vez.
      (c.ej ->> sm.metrica)::numeric as valor,
      (
        sm.metrica = any(c.con_revision)
        or sm.metrica = any(c.no_comparables)
      ) as marcada
    from con_clave c
    join scoring_metrica sm on sm.scoring_version_id = c.scoring_version_id
    left join rango_referencia rr on rr.id = sm.rango_referencia_id
  ), m as (
    select
      m0.*,
      normalizar_metrica_scoring(m0.valor, m0.minimo, m0.maximo, m0.direccion_favorable) as normalizado,
      case
        when m0.rr_maximo is not null and m0.valor is not null then m0.valor > m0.rr_maximo
        else null
      end as fuera_rango_superior,
      case
        when m0.rr_minimo is not null and m0.valor is not null then m0.valor < m0.rr_minimo
        else null
      end as fuera_rango_inferior
    from met0 m0
  ), por_cat as (
    select
      m.k,
      m.categoria,
      case
        when sum(m.peso) filter (where m.valor is not null) > 0 then
          sum(m.normalizado * m.peso) filter (where m.valor is not null)
          / sum(m.peso) filter (where m.valor is not null)
        else null
      end as subpuntaje,
      count(*) filter (where m.valor is not null) as con_valor,
      count(*) as total
    from m
    group by m.k, m.categoria
  ), cat as (
    -- Las cuatro categorías para cada entrada, con o sin métricas.
    select c.k, c.scoring_version_id, todas.categoria, pc.subpuntaje
    from con_clave c
    cross join unnest(enum_range(null::categoria_scoring)) as todas(categoria)
    left join por_cat pc on pc.k = c.k and pc.categoria = todas.categoria
  ), puntaje_categorias as (
    select
      cat.k,
      case
        when sum(scp.peso) filter (where cat.subpuntaje is not null) > 0 then
          sum(cat.subpuntaje * scp.peso) filter (where cat.subpuntaje is not null)
          / sum(scp.peso) filter (where cat.subpuntaje is not null)
        else null
      end as puntaje
    from cat
    join scoring_categoria_peso scp
      on scp.categoria = cat.categoria
     and scp.scoring_version_id = cat.scoring_version_id
    group by cat.k
  ), puntaje_metricas as (
    select
      m.k,
      case
        when sum(m.peso) filter (where m.valor is not null) > 0 then
          sum(m.normalizado * m.peso) filter (where m.valor is not null)
          / sum(m.peso) filter (where m.valor is not null)
        else null
      end as puntaje
    from m
    group by m.k
  ), agregado_metricas as (
    select
      m.k,
      count(*)::integer as configuradas,
      (count(*) filter (where m.valor is not null))::integer as disponibles,
      jsonb_object_agg(
        m.metrica,
        jsonb_build_object(
          'valor', m.valor,
          'peso', m.peso,
          'normalizado', m.normalizado,
          'fuera_rango_superior', m.fuera_rango_superior,
          'fuera_rango_inferior', m.fuera_rango_inferior
        )
      ) as detalle,
      bool_or(m.marcada) as marcada
    from m
    group by m.k
  ), agregado_categorias as (
    select cat.k, jsonb_object_agg(cat.categoria, cat.subpuntaje) as detalle_categorias
    from cat
    group by cat.k
  ), agregado_grupo as (
    -- Fase 2: cobertura por categoría (métricas con valor / métricas de la
    -- versión) y grupo = categorías con subpuntaje, en orden del enum. Solo si se piden.
    select
      pc.k,
      jsonb_object_agg(pc.categoria, jsonb_build_object('con_valor', pc.con_valor, 'total', pc.total)) as cobertura,
      coalesce(
        array_agg(pc.categoria::text order by pc.categoria) filter (where pc.subpuntaje is not null),
        '{}'::text[]
      ) as grupo
    from por_cat pc
    where p_con_grupo
    group by pc.k
  ), resultado as (
    select
      c.clave,
      coalesce(am.configuradas, 0) as configuradas,
      coalesce(am.disponibles, 0) as disponibles,
      case
        when exists (
          select 1 from scoring_categoria_peso scp0
          where scp0.scoring_version_id = c.scoring_version_id
        ) then pcat.puntaje
        else pmet.puntaje
      end as puntaje,
      coalesce(am.detalle, '{}'::jsonb) as detalle,
      coalesce(ac.detalle_categorias, '{}'::jsonb) as detalle_categorias,
      coalesce(am.marcada, false) as tiene_metrica_marcada,
      case when p_con_grupo then coalesce(ag.cobertura, '{}'::jsonb) end as cobertura,
      case when p_con_grupo then coalesce(ag.grupo, '{}'::text[]) end as grupo
    from con_clave c
    left join agregado_metricas am on am.k = c.k
    left join agregado_categorias ac on ac.k = c.k
    left join puntaje_categorias pcat on pcat.k = c.k
    left join puntaje_metricas pmet on pmet.k = c.k
    left join agregado_grupo ag on ag.k = c.k
  )
  select
    b.individuo_id,
    b.codigo_display,
    b.planta_id,
    b.codigo_sistema,
    b.especie_id,
    b.es_prueba,
    b.evaluacion_id,
    b.fecha_evaluacion,
    b.evaluacion_updated_at,
    b.numero_ronda,
    b.estado_evaluacion,
    b.requiere_revision,
    b.no_comparable,
    b.scoring_version_id,
    b.scoring_version_nombre,
    r.configuradas,
    r.disponibles,
    r.puntaje,
    r.tiene_metrica_marcada,
    r.detalle,
    r.detalle_categorias,
    r.cobertura,
    r.grupo
  from base b
  left join resultado r on r.clave = case
    when b.evaluacion_id is not null then b.individuo_id::text
    else 'v:' || coalesce(b.scoring_version_id::text, '')
  end;
$function$;

comment on function public.calcular_ranking_nucleo(uuid, uuid, uuid, boolean, boolean, boolean) is
  'Fase 2 (S2-5): motor de scoring por conjuntos, sin compuerta de elegibilidad. p_incluir_pruebas=false deja fuera los cruces de prueba; p_con_grupo=false omite cobertura y grupo (nulos). Lo envuelven calcular_ranking_base, calcular_ranking_operativo y calcular_ranking_grupos.';
revoke all on function public.calcular_ranking_nucleo(uuid, uuid, uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.calcular_ranking_nucleo(uuid, uuid, uuid, boolean, boolean, boolean) to authenticated, service_role;

-- b. Base: misma firma y salida -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.calcular_ranking_base(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_por_ronda boolean DEFAULT false)
 RETURNS TABLE(individuo_id uuid, codigo_display text, planta_id uuid, codigo_sistema text, especie_id uuid, es_prueba boolean, evaluacion_id uuid, fecha_evaluacion date, evaluacion_updated_at timestamp with time zone, numero_ronda smallint, estado_evaluacion estado_evaluacion, requiere_revision boolean, no_comparable boolean, scoring_version_id uuid, scoring_version_nombre text, configuradas integer, disponibles integer, puntaje_bruto numeric, tiene_metrica_marcada boolean, detalle_metricas jsonb, detalle_categorias jsonb, cobertura jsonb, grupo text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select * from calcular_ranking_nucleo(p_scoring_version_id, p_planta_id, p_especie_id, p_por_ronda, true, true);
$function$;

-- c. Ranking operativo: misma firma y misma salida, sin cobertura ni grupo -------------

CREATE OR REPLACE FUNCTION public.calcular_ranking_operativo(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_por_ronda boolean DEFAULT false)
 RETURNS TABLE(individuo_id uuid, codigo_display text, planta_id uuid, codigo_sistema text, especie_id uuid, evaluacion_id uuid, fecha_evaluacion date, evaluacion_updated_at timestamp with time zone, numero_ronda smallint, estado_evaluacion estado_evaluacion, requiere_revision boolean, no_comparable boolean, scoring_version_id uuid, scoring_version_nombre text, puntaje_ponderado numeric, elegible boolean, motivo_exclusion text, detalle_metricas jsonb, detalle_categorias jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    c.individuo_id,
    c.codigo_display,
    c.planta_id,
    c.codigo_sistema,
    c.especie_id,
    c.evaluacion_id,
    c.fecha_evaluacion,
    c.evaluacion_updated_at,
    c.numero_ronda,
    c.estado_evaluacion,
    coalesce(c.requiere_revision, false),
    coalesce(c.no_comparable, false),
    c.scoring_version_id,
    c.scoring_version_nombre,
    case
      when c.evaluacion_id is not null
        and not coalesce(c.tiene_metrica_marcada, false)
        and not coalesce(c.requiere_revision, false)
        and not coalesce(c.no_comparable, false)
        and c.configuradas > 0
        and c.disponibles = c.configuradas
      then round(c.puntaje_bruto, 4)
      else null
    end,
    c.evaluacion_id is not null
      and not coalesce(c.tiene_metrica_marcada, false)
      and not coalesce(c.requiere_revision, false)
      and not coalesce(c.no_comparable, false)
      and c.configuradas > 0
      and c.disponibles = c.configuradas,
    case
      when c.numero_ronda is null then 'sin_ronda'
      when c.evaluacion_id is null then 'sin_evaluacion_completa_en_ronda_actual'
      when c.requiere_revision then 'requiere_revision'
      when c.no_comparable then 'no_comparable'
      when coalesce(c.tiene_metrica_marcada, false) then 'contiene_metrica_marcada'
      when c.scoring_version_id is null then 'sin_version_scoring'
      when c.configuradas = 0 then 'version_sin_metricas'
      when c.disponibles < c.configuradas then 'evaluacion_parcial_en_curso'
      else null
    end,
    coalesce(c.detalle_metricas, '{}'::jsonb),
    coalesce(c.detalle_categorias, '{}'::jsonb)
  from calcular_ranking_nucleo(p_scoring_version_id, p_planta_id, p_especie_id, p_por_ronda, true, false) c;
$function$;

-- d. Ranking por grupos: misma firma y salida, pruebas filtradas en el alcance ----------

CREATE OR REPLACE FUNCTION public.calcular_ranking_grupos(
  p_scoring_version_id uuid,
  p_planta_id uuid default null,
  p_especie_id uuid default null,
  p_por_ronda boolean default false,
  p_incluir_pruebas boolean default false,
  p_minimo integer default null
)
returns table(
  individuo_id uuid, codigo_display text, planta_id uuid, codigo_sistema text, especie_id uuid, es_prueba boolean,
  evaluacion_id uuid, fecha_evaluacion date, numero_ronda smallint, estado_evaluacion estado_evaluacion,
  scoring_version_id uuid, scoring_version_nombre text,
  requiere_revision boolean, no_comparable boolean, tiene_metrica_marcada boolean,
  puntaje numeric, grupo text[], cobertura jsonb, detalle_categorias jsonb, detalle_metricas jsonb,
  estado_ranking text, tamano_grupo integer, posicion_grupo integer
)
language sql
stable
set search_path = public
as $$
  with base as materialized (
    select b.*
    -- A1-070: los cruces de prueba no entran a la población, salvo que se
    -- pida ese cruce puntual o se incluyan a propósito (el núcleo los filtra
    -- en el alcance, antes de calcular nada).
    from calcular_ranking_nucleo(p_scoring_version_id, p_planta_id, p_especie_id, p_por_ronda,
      p_planta_id is not null or p_incluir_pruebas, true) b
  ), minimo as (
    select coalesce(p_minimo, (select minimo_evaluaciones_grupo from configuracion_ranking where id = 1), 5) as valor
  ), clasificado as (
    select
      b.*,
      case
        when b.numero_ronda is null then 'sin_ronda'
        when b.evaluacion_id is null then 'sin_evaluacion'
        -- Mismo orden que motivo_exclusion del ranking de siempre.
        when coalesce(b.requiere_revision, false) then 'excluida_revision'
        when coalesce(b.no_comparable, false) then 'no_comparable'
        when coalesce(b.tiene_metrica_marcada, false) then 'excluida_revision'
        when b.scoring_version_id is null or b.configuradas = 0 then 'sin_version'
        when cardinality(b.grupo) = 0 then 'sin_datos'
        else 'comparable'
      end as clase
    from base b
  ), con_tamano as (
    select
      c.*,
      case when c.clase = 'comparable'
        then (count(*) filter (where c.clase = 'comparable') over (partition by c.grupo))::integer
      end as tamano
    from clasificado c
  )
  select
    t.individuo_id, t.codigo_display, t.planta_id, t.codigo_sistema, t.especie_id, coalesce(t.es_prueba, false),
    t.evaluacion_id, t.fecha_evaluacion, t.numero_ronda, t.estado_evaluacion,
    t.scoring_version_id, t.scoring_version_nombre,
    coalesce(t.requiere_revision, false), coalesce(t.no_comparable, false), coalesce(t.tiene_metrica_marcada, false),
    case when t.clase = 'comparable' then round(t.puntaje_bruto, 4) end,
    t.grupo,
    coalesce(t.cobertura, '{}'::jsonb),
    coalesce(t.detalle_categorias, '{}'::jsonb),
    coalesce(t.detalle_metricas, '{}'::jsonb),
    case when t.clase = 'comparable' and t.tamano < (select valor from minimo) then 'pocas_plantas' else t.clase end,
    t.tamano,
    -- Empates (Kadel, 22-10-2026): el mismo puntaje publicado comparte posición
    -- (ranking de competencia: 1, 2, 2, 4). No se desempata por código ni por
    -- texto. «Mismo puntaje» = mismo valor redondeado a 4 decimales, el que se
    -- muestra (A1-073: la regla aplicada es la declarada en criterios).
    case when t.clase = 'comparable' and t.tamano >= (select valor from minimo) then
      (rank() over (
        partition by t.clase = 'comparable', t.grupo
        order by round(t.puntaje_bruto, 4) desc nulls last
      ))::integer
    end
  from con_tamano t;
$$;
