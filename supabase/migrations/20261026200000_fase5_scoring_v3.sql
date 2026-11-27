-- Fase 5, paso 58 — puntaje v3, creado INACTIVO (estado `borrador`). Decisión G6; Efraín, EF16 y EF17.
--
-- La v3 es igual a la v2 (mismas 19 métricas, mismos pesos, direcciones y categorías) salvo tres métricas:
--   · calibre: 12 mm vale 0 y 25 mm vale 1 (en la v2, 14 a 24 mm);
--   · Brix: 10 °Bx vale 0 y 20 °Bx vale 1 (en la v2, 10 a 18 °Bx);
--   · rendimiento por planta SEGÚN LA EDAD, con edad = número de la temporada de evaluación anual del individuo (ronda anual N = año N):
--     año 1 de 0 a 2 kg; año 2 de 0 a 5 kg [provisional]; año 3 en adelante de 0 a 10 kg (en la v2, 0 a 6 kg para todas las edades).
--   Fuera de esos rangos el valor se acota (0 o 1), como hasta ahora (`normalizar_metrica_scoring`).
--
-- Cómo se modela la edad (opción elegida y por qué):
--   El motor normaliza cada métrica con UN mínimo y UN máximo por versión. Había dos caminos:
--   (a) una «normalización especial» (un método nuevo en el enum `metodo_normalizacion_scoring`, con los kg por edad escritos en el código
--       del motor): obliga a un paso aparte solo para el enum (Postgres no usa un valor nuevo del enum en la misma transacción) y deja los
--       números fuera de la versión, así que cambiarlos cambiaría el puntaje sin versión nueva;
--   (b) RANGOS POR EDAD como datos de la versión: una tabla nueva `scoring_metrica_rango_edad` (métrica de una versión, edad desde la que
--       rige, mínimo y máximo). Desde esa edad, ese rango reemplaza al mínimo y máximo de la métrica; rige hasta la siguiente fila. Sin
--       filas, la métrica se normaliza como siempre (todas las versiones anteriores quedan igual).
--   Se elige (b): los rangos quedan versionados con la versión de puntaje, son inmutables cuando la versión está en uso (igual que sus
--   métricas), `nueva_version_scoring` los copia, y sirve para cualquier otra métrica que algún día dependa de la edad.
--
-- Calibre y Brix: el CHECK de `scoring_metrica` no deja combinar mínimo/máximo propios con un rango de referencia, y el rango de
-- referencia es el que marca «destacado»/«bajo» en el ranking. Para conservar esas marcas con los rangos de Efraín, la v3 usa dos rangos
-- de referencia NUEVOS e INACTIVOS (12–25 mm y 10–20 °Bx): inactivos para que el formulario siga avisando con el rango esperado de hoy
-- (14–24 mm, 10–18 °Bx; A3) hasta que Kadel decida cambiar los avisos.
--
-- Qué hace:
--   1. Tabla `scoring_metrica_rango_edad`, con RLS (la leen los usuarios con sesión; nadie de la app escribe) e inmutable en uso.
--   2. Los dos rangos de referencia de la v3 (inactivos).
--   3. La versión v3 en `borrador`, con sus pesos de categoría, sus 19 métricas y los 3 rangos por edad del rendimiento.
--   4. `calcular_ranking_nucleo` y `calcular_metricas_evaluacion` aplican el rango por edad cuando existe (la edad es el número de la
--      ronda anual que se puntúa). Sin filas en la tabla (todas las versiones de hoy), calculan exactamente lo mismo que antes.
--   5. `nueva_version_scoring` copia también los rangos por edad.
--
-- Esta migración NO cambia ningún ranking: la versión activa sigue siendo la de hoy. La v3 se activa en un paso aparte, después del push
-- del frontend (docs/migraciones_pendientes/scoring_v3_activar.sql). Rollback: docs/fase5/rollback/58_scoring_v3.sql.

-- 1. Rangos por edad --------------------------------------------------------------------------------------------------------------------
create table public.scoring_metrica_rango_edad (
  id                 uuid primary key default gen_random_uuid(),
  scoring_metrica_id uuid not null references public.scoring_metrica (id) on delete cascade,
  edad_desde         smallint not null check (edad_desde >= 1),
  minimo             numeric not null,
  maximo             numeric not null,
  nota               text,
  created_at         timestamptz not null default now(),
  constraint scoring_metrica_rango_edad_rango_check check (maximo > minimo),
  constraint scoring_metrica_rango_edad_unica unique (scoring_metrica_id, edad_desde)
);

comment on table public.scoring_metrica_rango_edad is
  'Rango de normalización de una métrica de una versión de puntaje según la edad del individuo (número de la temporada de evaluación anual). Desde edad_desde reemplaza al mínimo y máximo de la métrica, hasta la siguiente fila. Inmutable cuando la versión está en uso (G6).';

alter table public.scoring_metrica_rango_edad enable row level security;
create policy scoring_metrica_rango_edad_select_autenticados on public.scoring_metrica_rango_edad
  for select using ((select auth.uid()) is not null);
revoke all on public.scoring_metrica_rango_edad from public, anon, authenticated;
grant select on public.scoring_metrica_rango_edad to authenticated;

create function public.bloquear_rango_edad_en_uso()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_version_id uuid;
begin
  for v_version_id in
    select sm.scoring_version_id
    from scoring_metrica sm
    where sm.id in (
      case when tg_op <> 'INSERT' then old.scoring_metrica_id end,
      case when tg_op <> 'DELETE' then new.scoring_metrica_id end
    )
  loop
    if scoring_version_en_uso(v_version_id) then
      raise exception 'Esta versión de scoring ya está en uso (rondas cerradas o rankings congelados): sus rangos por edad no se pueden modificar. Crea una versión nueva con nueva_version_scoring.'
        using errcode = '55000';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

revoke all on function public.bloquear_rango_edad_en_uso() from public, anon, authenticated;

create trigger trg_scoring_metrica_rango_edad_inmutable_en_uso
  before insert or update or delete on public.scoring_metrica_rango_edad
  for each row execute function public.bloquear_rango_edad_en_uso();

-- 2 y 3. Rangos de referencia y versión v3 ---------------------------------------------------------------------------------------------
do $v3$
declare
  v_v2 uuid;
  v_v3 uuid;
  v_calibre uuid;
  v_brix uuid;
  v_rend uuid;
begin
  select id into v_v2 from public.scoring_version where nombre = 'Selección v2 (5 categorías 40-30-15-10-5) provisional';
  if v_v2 is null then
    raise exception 'No existe la versión de scoring v2 que sirve de base' using errcode = 'P0002';
  end if;

  insert into public.rango_referencia (especie_id, metrica, fase, minimo_esperado, maximo_esperado, vigente_desde, activo, nota)
  values (null, 'calibre_mm', 'evaluacion_anual', 12, 25, date '2026-10-26', false,
          'Puntaje v3 (Efraín, 26-10-2026): 12 mm vale 0 y 25 mm vale 1 (bajo < 12 · comercial 12–18 · excepcional 20–25 o más). Inactivo: no cambia los avisos del formulario.')
  returning id into v_calibre;
  insert into public.rango_referencia (especie_id, metrica, fase, minimo_esperado, maximo_esperado, vigente_desde, activo, nota)
  values (null, 'brix', 'evaluacion_anual', 10, 20, date '2026-10-26', false,
          'Puntaje v3 (Efraín, 26-10-2026): 10 °Bx vale 0 y 20 °Bx vale 1 (bajo < 10 · comercial 10–14 · excepcional 16–20). Inactivo: no cambia los avisos del formulario.')
  returning id into v_brix;

  insert into public.scoring_version (
    nombre, especie_id, fase, vigente_desde, estado, criterio_desempate, umbral_delta_leve, umbral_delta_marcado, nota
  )
  select
    'Selección v3 (calibre, Brix y rendimiento por edad) provisional',
    v2.especie_id, v2.fase, v2.vigente_desde, 'borrador', v2.criterio_desempate, v2.umbral_delta_leve, v2.umbral_delta_marcado,
    'Versión v3 (decisión G6, 26-10-2026): igual a la v2 salvo calibre 12–25 mm, Brix 10–20 °Bx y rendimiento por planta según la edad '
    '(año 1: 0–2 kg; año 2: 0–5 kg, provisional; año 3 en adelante: 0–10 kg). Nace inactiva (borrador); la activa un paso aparte del despliegue.'
  from public.scoring_version v2
  where v2.id = v_v2
  returning id into v_v3;

  insert into public.scoring_categoria_peso (scoring_version_id, categoria, peso)
  select v_v3, categoria, peso from public.scoring_categoria_peso where scoring_version_id = v_v2;

  insert into public.scoring_metrica (
    scoring_version_id, categoria, metrica, peso, direccion_favorable, metodo_normalizacion,
    minimo_normalizacion, maximo_normalizacion, rango_referencia_id, tratamiento_nulos, orden
  )
  select
    v_v3, m.categoria, m.metrica, m.peso, m.direccion_favorable,
    case m.metrica when 'calibre_mm' then 'rango_referencia' when 'brix' then 'rango_referencia' when 'rend_kg_planta' then 'escala'
      else m.metodo_normalizacion::text end::public.metodo_normalizacion_scoring,
    case m.metrica when 'calibre_mm' then null when 'brix' then null when 'rend_kg_planta' then 0 else m.minimo_normalizacion end,
    case m.metrica when 'calibre_mm' then null when 'brix' then null when 'rend_kg_planta' then 10 else m.maximo_normalizacion end,
    case m.metrica when 'calibre_mm' then v_calibre when 'brix' then v_brix when 'rend_kg_planta' then null else m.rango_referencia_id end,
    m.tratamiento_nulos, m.orden
  from public.scoring_metrica m
  where m.scoring_version_id = v_v2;

  select id into v_rend from public.scoring_metrica where scoring_version_id = v_v3 and metrica = 'rend_kg_planta';
  insert into public.scoring_metrica_rango_edad (scoring_metrica_id, edad_desde, minimo, maximo, nota) values
    (v_rend, 1, 0, 2,  'Año 1: una buena planta da 1–2 kg (Efraín, 26-10-2026).'),
    (v_rend, 2, 0, 5,  'Año 2: una buena planta da 3–4 kg (Efraín). El techo de 5 kg es provisional (Kadel, G6).'),
    (v_rend, 3, 0, 10, 'Año 3 en adelante: una buena planta da 6–8 kg; con 10 kg o más es excepcional (Efraín).');

  if (select count(*) from public.scoring_metrica where scoring_version_id = v_v3) <> 19 then
    raise exception 'La versión v3 debe tener 19 métricas' using errcode = '23514';
  end if;
end;
$v3$;

-- 4. El motor aplica el rango por edad ---------------------------------------------------------------------------------------------------
create or replace function public.calcular_ranking_nucleo(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_por_ronda boolean DEFAULT false, p_incluir_pruebas boolean DEFAULT true, p_con_grupo boolean DEFAULT true, p_numero_ronda smallint DEFAULT NULL::smallint)
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
      -- v3 paso 8 (N38): con p_numero_ronda se toma la ronda de esa temporada; sin él, la última de cada individuo.
      and (p_numero_ronda is null or r.numero_ronda = p_numero_ronda)
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
      b.especie_id,
      -- Fase 5 (G6): edad del individuo = número de la ronda anual que se puntúa (para los rangos por edad).
      b.numero_ronda as edad,
      b.evaluacion_json as ej,
      coalesce(b.descriptores_con_revision, '{}'::text[]) as con_revision,
      coalesce(b.descriptores_no_comparables, '{}'::text[]) as no_comparables
    from base b
    where b.evaluacion_id is not null
    union all
    select
      -- Fase 4: la entrada vacía también es por especie (cada especie puede no usar algunos descriptores).
      'v:' || coalesce(v.scoring_version_id::text, '') || ':' || v.especie_id::text,
      v.scoring_version_id,
      v.especie_id,
      null::smallint,
      null::jsonb,
      '{}'::text[],
      '{}'::text[]
    from (select distinct b.scoring_version_id, b.especie_id from base b where b.evaluacion_id is null) v
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
      -- Fase 5 (G6): un rango por edad de la versión (si lo hay para esa edad) reemplaza al mínimo y máximo de la métrica.
      coalesce(re.minimo, rr.minimo_esperado, sm.minimo_normalizacion) as minimo,
      coalesce(re.maximo, rr.maximo_esperado, sm.maximo_normalizacion) as maximo,
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
    left join lateral (
      select r.minimo, r.maximo
      from scoring_metrica_rango_edad r
      where r.scoring_metrica_id = sm.id and r.edad_desde <= c.edad
      order by r.edad_desde desc
      limit 1
    ) re on true
    -- Fase 4: un descriptor que la especie no usa no entra a su puntaje ni a su cobertura (los pesos se reparten entre los demás).
    where not exists (
      select 1 from esquema_campo_especie ece
      where ece.fase = 'evaluacion_anual' and ece.clave = sm.metrica and ece.especie_id = c.especie_id and not ece.activo
    )
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
    else 'v:' || coalesce(b.scoring_version_id::text, '') || ':' || b.especie_id::text
  end;
$function$;

create or replace function public.calcular_metricas_evaluacion(p_evaluacion evaluaciones, p_scoring_version_id uuid)
 RETURNS TABLE(metrica text, categoria categoria_scoring, peso numeric, valor numeric, normalizado numeric)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  select
    sm.metrica,
    sm.categoria,
    sm.peso,
    extraer_metrica_evaluacion(p_evaluacion, sm.metrica) as valor,
    normalizar_metrica_scoring(
      extraer_metrica_evaluacion(p_evaluacion, sm.metrica),
      coalesce(re.minimo, rr.minimo_esperado, sm.minimo_normalizacion),
      coalesce(re.maximo, rr.maximo_esperado, sm.maximo_normalizacion),
      sm.direccion_favorable
    ) as normalizado
  from scoring_metrica sm
  left join rango_referencia rr on rr.id = sm.rango_referencia_id
  -- Fase 5 (G6): la edad es el número de la ronda anual de la evaluación; su rango por edad (si lo hay) manda.
  left join lateral (
    select r.minimo, r.maximo
    from scoring_metrica_rango_edad r
    where r.scoring_metrica_id = sm.id
      and r.edad_desde <= (select ra.numero_ronda from ronda_evaluacion_anual ra where ra.id = p_evaluacion.ronda_id)
    order by r.edad_desde desc
    limit 1
  ) re on true
  where sm.scoring_version_id = p_scoring_version_id;
$function$;

comment on function public.calcular_metricas_evaluacion(evaluaciones, uuid) is
  'Valor + normalizado por métrica configurada, para UNA evaluación puntual (extracción genérica vía extraer_metrica_evaluacion). Fase 5 (G6): aplica el rango por edad de la versión según el número de la ronda anual de la evaluación. Reutilizado por obtener_comparacion_rondas, obtener_series_historicas_cientificas y comparar snapshots.';

-- 5. nueva_version_scoring copia también los rangos por edad.
create or replace function public.nueva_version_scoring(p_version_base_id uuid, p_nombre text, p_vigente_desde date, p_nota text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_base  scoring_version;
  v_nueva uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede crear versiones de scoring' using errcode = '42501';
  end if;
  if coalesce(btrim(p_nombre), '') = '' then
    raise exception 'La versión nueva requiere nombre' using errcode = '23514';
  end if;
  if p_vigente_desde is null then
    raise exception 'La versión nueva requiere fecha de vigencia' using errcode = '23514';
  end if;

  select * into v_base from scoring_version where id = p_version_base_id;
  if not found then
    raise exception 'Versión de scoring no encontrada' using errcode = 'P0002';
  end if;

  insert into scoring_version (
    nombre, especie_id, fase, vigente_desde, estado, criterio_desempate, nota,
    umbral_delta_leve, umbral_delta_marcado, created_by
  ) values (
    btrim(p_nombre), v_base.especie_id, v_base.fase, p_vigente_desde, 'borrador', v_base.criterio_desempate,
    coalesce(p_nota, v_base.nota), v_base.umbral_delta_leve, v_base.umbral_delta_marcado, v_uid
  ) returning id into v_nueva;

  insert into scoring_categoria_peso (scoring_version_id, categoria, peso)
  select v_nueva, categoria, peso
    from scoring_categoria_peso
   where scoring_version_id = p_version_base_id;

  insert into scoring_metrica (
    scoring_version_id, metrica, peso, direccion_favorable, metodo_normalizacion,
    minimo_normalizacion, maximo_normalizacion, rango_referencia_id, tratamiento_nulos,
    orden, categoria
  )
  select v_nueva, metrica, peso, direccion_favorable, metodo_normalizacion,
         minimo_normalizacion, maximo_normalizacion, rango_referencia_id, tratamiento_nulos,
         orden, categoria
    from scoring_metrica
   where scoring_version_id = p_version_base_id;

  -- Fase 5 (G6): también los rangos por edad de cada métrica.
  insert into scoring_metrica_rango_edad (scoring_metrica_id, edad_desde, minimo, maximo, nota)
  select nueva.id, r.edad_desde, r.minimo, r.maximo, r.nota
    from scoring_metrica_rango_edad r
    join scoring_metrica base on base.id = r.scoring_metrica_id and base.scoring_version_id = p_version_base_id
    join scoring_metrica nueva on nueva.scoring_version_id = v_nueva and nueva.metrica = base.metrica;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, null, 'nueva_version_scoring', array['scoring_version_id'],
          jsonb_build_object('version_base_id', p_version_base_id, 'version_nueva_id', v_nueva, 'nombre', btrim(p_nombre)));

  return v_nueva;
end;
$function$;

comment on function public.nueva_version_scoring(uuid, text, date, text) is
  'Solo admin. Copia una versión de scoring (métricas, pesos y rangos por edad) como borrador editable. Único camino para cambiar la configuración de una versión en uso.';
