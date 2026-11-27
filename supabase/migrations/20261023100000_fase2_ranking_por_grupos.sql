-- Fase 2, Sprint 1 — ranking por grupos de categorías (decisiones de Kadel,
-- 22-10-2026; docs/plan_fase2.md y docs/diseno_sprint1.md).
--
-- 1. configuracion_ranking: mínimo de evaluaciones por grupo (inicial 5) y
--    umbral de advertencia de cobertura (0,5). Solo admin la cambia.
-- 2. calcular_ranking_base: el motor de siempre (texto vivo de
--    calcular_ranking_operativo, migración 20261021142000) sin la compuerta de
--    elegibilidad, más es_prueba, cobertura por categoría y grupo.
-- 3. calcular_ranking_operativo pasa a envolver la base con la compuerta de
--    siempre (las 20 métricas): SALIDA IDÉNTICA, verificada por huella.
-- 4. calcular_ranking_grupos / obtener_ranking_por_grupos: el grupo de
--    comparación es la combinación de categorías con datos; posición solo
--    dentro del grupo; grupos chicos sin puesto; cuenta completa de la
--    población; cruces de prueba fuera por defecto (A1-070); una sola regla de
--    desempate, declarada tal cual se aplica (A1-073).
-- 5. Snapshots: ranking_snapshot_resultado guarda grupo, cobertura y posición
--    en el grupo; congelar_ranking_grupos los escribe. congelar_ranking no cambia.
--
-- El puntaje (pesos, normalización, renormalización por categorías) es el de
-- la versión de scoring activa, sin cambios.

-- 1. Configuración ---------------------------------------------------------

create table public.configuracion_ranking (
  id smallint primary key default 1 check (id = 1),
  minimo_evaluaciones_grupo integer not null default 5 check (minimo_evaluaciones_grupo between 1 and 1000),
  cobertura_advertencia numeric not null default 0.5 check (cobertura_advertencia > 0 and cobertura_advertencia <= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.perfiles(id) on delete set null
);
insert into public.configuracion_ranking (id) values (1);

alter table public.configuracion_ranking enable row level security;
create policy configuracion_ranking_select_autenticados on public.configuracion_ranking
  for select to authenticated using (auth.uid() is not null);
create policy configuracion_ranking_admin_actualiza on public.configuracion_ranking
  for update to authenticated using (es_admin()) with check (es_admin());
revoke all on public.configuracion_ranking from anon, authenticated;
grant select on public.configuracion_ranking to authenticated;
grant update (minimo_evaluaciones_grupo, cobertura_advertencia) on public.configuracion_ranking to authenticated;

create function public.auditar_configuracion_ranking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (auth.uid(), null, 'cambio_configuracion_ranking',
    array['minimo_evaluaciones_grupo', 'cobertura_advertencia'],
    jsonb_build_object(
      'anterior', jsonb_build_object('minimo_evaluaciones_grupo', old.minimo_evaluaciones_grupo, 'cobertura_advertencia', old.cobertura_advertencia),
      'nuevo', jsonb_build_object('minimo_evaluaciones_grupo', new.minimo_evaluaciones_grupo, 'cobertura_advertencia', new.cobertura_advertencia)));
  return new;
end;
$$;
revoke all on function public.auditar_configuracion_ranking() from public, anon, authenticated;
create trigger configuracion_ranking_auditar before update on public.configuracion_ranking
for each row execute function public.auditar_configuracion_ranking();

comment on table public.configuracion_ranking is
  'Fase 2: parámetros del ranking por grupos. Fuera de scoring_version porque una versión en uso es inmutable (A1-071).';

-- 2. Motor base ------------------------------------------------------------

create function public.calcular_ranking_base(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_por_ronda boolean DEFAULT false)
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
  ), ultima_ronda as (
    select distinct on (r.individuo_id)
      r.individuo_id,
      r.id as ronda_id,
      r.numero_ronda,
      r.scoring_version_id as ronda_scoring_version_id
    from ronda_evaluacion_anual r
    join alcance a on a.individuo_id = r.individuo_id
    where r.tipo_ronda = 'anual'
    order by r.individuo_id, r.numero_ronda desc, r.created_at desc, r.id desc
  ), base as (
    select
      a.*,
      ur.numero_ronda,
      e.id as evaluacion_id,
      e.fecha as fecha_evaluacion,
      e.updated_at as evaluacion_updated_at,
      e.estado as estado_evaluacion,
      e.requiere_revision,
      e.no_comparable,
      e as evaluacion_unificada,
      proc.descriptores_con_revision,
      proc.descriptores_no_comparables,
      sv.id as scoring_version_id,
      sv.nombre as scoring_version_nombre
    from alcance a
    left join ultima_ronda ur on ur.individuo_id = a.individuo_id
    left join lateral unificar_evaluacion_ronda(ur.ronda_id) e on true
    left join lateral obtener_procedencia_calidad_ronda(ur.ronda_id) proc on true
    -- B6: con p_por_ronda, cada ronda se calcula con la versión con que se
    -- cerró; p_scoring_version_id solo cubre las rondas sin cerrar. Sin
    -- p_por_ronda, todas con p_scoring_version_id (versión elegida).
    left join scoring_version sv on sv.id = case
      when p_por_ronda then coalesce(ur.ronda_scoring_version_id, p_scoring_version_id)
      else p_scoring_version_id
    end
  ), calculado as (
    select
      b.*,
      metricas.configuradas,
      metricas.disponibles,
      metricas.puntaje,
      metricas.detalle,
      metricas.detalle_categorias,
      metricas.tiene_metrica_marcada,
      metricas.cobertura,
      metricas.grupo
    from base b
    left join lateral (
      with m as (
        select
          sm.id,
          sm.metrica,
          sm.categoria,
          sm.peso,
          extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) as valor,
          normalizar_metrica_scoring(
            extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica),
            coalesce(rr.minimo_esperado, sm.minimo_normalizacion),
            coalesce(rr.maximo_esperado, sm.maximo_normalizacion),
            sm.direccion_favorable
          ) as normalizado,
          case
            when rr.maximo_esperado is not null and extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) is not null
              then extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) > rr.maximo_esperado
            else null
          end as fuera_rango_superior,
          case
            when rr.minimo_esperado is not null and extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) is not null
              then extraer_metrica_evaluacion(b.evaluacion_unificada, sm.metrica) < rr.minimo_esperado
            else null
          end as fuera_rango_inferior,
          (
            sm.metrica = any(coalesce(b.descriptores_con_revision, '{}'::text[]))
            or sm.metrica = any(coalesce(b.descriptores_no_comparables, '{}'::text[]))
          ) as marcada
        from scoring_metrica sm
        left join rango_referencia rr on rr.id = sm.rango_referencia_id
        where sm.scoring_version_id = b.scoring_version_id
      ), cat as (
        select
          todas.categoria,
          c.subpuntaje
        from unnest(enum_range(null::categoria_scoring)) as todas(categoria)
        left join (
          select
            m.categoria,
            case
              when sum(m.peso) filter (where m.valor is not null) > 0 then
                sum(m.normalizado * m.peso) filter (where m.valor is not null)
                / sum(m.peso) filter (where m.valor is not null)
              else null
            end as subpuntaje
          from m
          group by m.categoria
        ) c on c.categoria = todas.categoria
      )
      select
        (select count(*) from m)::integer as configuradas,
        (select count(*) from m where valor is not null)::integer as disponibles,
        (
          select case
            when exists (
              select 1 from scoring_categoria_peso scp0
              where scp0.scoring_version_id = b.scoring_version_id
            ) then (
              select case
                when sum(scp.peso) filter (where cat.subpuntaje is not null) > 0 then
                  sum(cat.subpuntaje * scp.peso) filter (where cat.subpuntaje is not null)
                  / sum(scp.peso) filter (where cat.subpuntaje is not null)
                else null
              end
              from cat
              join scoring_categoria_peso scp
                on scp.categoria = cat.categoria
               and scp.scoring_version_id = b.scoring_version_id
            )
            else (
              select case
                when sum(peso) filter (where valor is not null) > 0 then
                  sum(normalizado * peso) filter (where valor is not null)
                  / sum(peso) filter (where valor is not null)
                else null
              end
              from m
            )
          end
        ) as puntaje,
        (
          select coalesce(
            jsonb_object_agg(
              metrica,
              jsonb_build_object(
                'valor', valor,
                'peso', peso,
                'normalizado', normalizado,
                'fuera_rango_superior', fuera_rango_superior,
                'fuera_rango_inferior', fuera_rango_inferior
              )
            ) filter (where id is not null),
            '{}'::jsonb
          )
          from m
        ) as detalle,
        (
          select coalesce(jsonb_object_agg(cat.categoria, cat.subpuntaje), '{}'::jsonb)
          from cat
        ) as detalle_categorias,
        coalesce((select bool_or(marcada) from m), false) as tiene_metrica_marcada,
        -- Fase 2: cobertura por categoría (métricas con valor / métricas de la versión)
        (
          select coalesce(jsonb_object_agg(x.categoria, jsonb_build_object('con_valor', x.con_valor, 'total', x.total)), '{}'::jsonb)
          from (
            select m.categoria, count(*) filter (where m.valor is not null) as con_valor, count(*) as total
            from m
            group by m.categoria
          ) x
        ) as cobertura,
        -- Fase 2: grupo = categorías con subpuntaje (al menos una métrica válida), en orden del enum
        array(select cat.categoria::text from cat where cat.subpuntaje is not null order by cat.categoria) as grupo
    ) metricas on true
  )
  select
    c.individuo_id,
    c.codigo_display,
    c.planta_id,
    c.codigo_sistema,
    c.especie_id,
    c.es_prueba,
    c.evaluacion_id,
    c.fecha_evaluacion,
    c.evaluacion_updated_at,
    c.numero_ronda,
    c.estado_evaluacion,
    c.requiere_revision,
    c.no_comparable,
    c.scoring_version_id,
    c.scoring_version_nombre,
    c.configuradas,
    c.disponibles,
    c.puntaje,
    c.tiene_metrica_marcada,
    c.detalle,
    c.detalle_categorias,
    c.cobertura,
    c.grupo
  from calculado c;
$function$;

comment on function public.calcular_ranking_base(uuid, uuid, uuid, boolean) is
  'Fase 2: motor de scoring sin compuerta de elegibilidad. Lo envuelven calcular_ranking_operativo (compuerta de las 20 métricas) y calcular_ranking_grupos (grupos de categorías).';
revoke all on function public.calcular_ranking_base(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.calcular_ranking_base(uuid, uuid, uuid, boolean) to authenticated, service_role;

-- 3. Ranking operativo: misma firma y misma salida -------------------------

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
  from calcular_ranking_base(p_scoring_version_id, p_planta_id, p_especie_id, p_por_ronda) c;
$function$;

-- 4. Ranking por grupos ----------------------------------------------------

create function public.calcular_ranking_grupos(
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
    from calcular_ranking_base(p_scoring_version_id, p_planta_id, p_especie_id, p_por_ronda) b
    -- A1-070: los cruces de prueba no entran a la población, salvo que se
    -- pida ese cruce puntual o se incluyan a propósito.
    where p_planta_id is not null or p_incluir_pruebas or not coalesce(b.es_prueba, false)
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

comment on function public.calcular_ranking_grupos(uuid, uuid, uuid, boolean, boolean, integer) is
  'Fase 2: ranking por grupos de categorías del motor. estado_ranking: comparable | pocas_plantas | excluida_revision | no_comparable | sin_datos | sin_evaluacion | sin_ronda | sin_version. Posición solo dentro del grupo y solo si el grupo alcanza el mínimo; el mismo puntaje comparte posición (1, 2, 2, 4).';
revoke all on function public.calcular_ranking_grupos(uuid, uuid, uuid, boolean, boolean, integer) from public, anon;
grant execute on function public.calcular_ranking_grupos(uuid, uuid, uuid, boolean, boolean, integer) to authenticated, service_role;

create function public.obtener_ranking_por_grupos(
  p_planta_id uuid default null,
  p_especie_id uuid default null,
  p_incluir_pruebas boolean default false
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_especie_id uuid := p_especie_id;
  v_version_id uuid;
  v_version_nombre text;
  v_config configuracion_ranking;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if (p_planta_id is null) = (p_especie_id is null) then
    raise exception 'Indica exactamente un cruce o una especie' using errcode = '22023';
  end if;
  if p_planta_id is not null then
    select especie_id into v_especie_id from plantas where id = p_planta_id and eliminado_at is null;
    if not found then
      raise exception 'Cruce no encontrado' using errcode = 'P0002';
    end if;
  end if;

  select * into v_config from configuracion_ranking where id = 1;
  v_version_id := resolver_scoring_version(v_especie_id, 'evaluacion_anual', current_date);
  select nombre into v_version_nombre from scoring_version where id = v_version_id;

  with filas as materialized (
    select *
    from calcular_ranking_grupos(v_version_id, p_planta_id, p_especie_id, false, p_incluir_pruebas, v_config.minimo_evaluaciones_grupo)
  ), grupos as (
    select grupo, count(*)::integer as n, bool_and(posicion_grupo is not null) as con_posicion
    from filas
    where estado_ranking in ('comparable', 'pocas_plantas')
    group by grupo
  )
  select jsonb_build_object(
    'scoring_version_id', v_version_id,
    'scoring_version_nombre', v_version_nombre,
    'minimo_evaluaciones_grupo', v_config.minimo_evaluaciones_grupo,
    'cobertura_advertencia', v_config.cobertura_advertencia,
    'criterios', jsonb_build_object(
      'alcance', case when p_planta_id is null then 'especie' else 'cruzamiento' end,
      'grupo', 'combinacion de categorias del motor con al menos una metrica con valor',
      'seleccion_evaluacion', 'evaluacion unificada de la ronda anual mas reciente',
      'orden', jsonb_build_array('puntaje_desc'),
      'empates', 'mismo puntaje (4 decimales) comparte posicion; ranking de competencia 1, 2, 2, 4; sin desempate por codigo',
      'incluye_pruebas', p_planta_id is not null or p_incluir_pruebas
    ),
    -- A1-077: conteos del universo completo, no de una página.
    'poblacion', jsonb_build_object(
      'total', (select count(*) from filas),
      'comparables', (select count(*) from filas where estado_ranking in ('comparable', 'pocas_plantas')),
      'con_posicion', (select count(*) from filas where posicion_grupo is not null),
      'pocas_plantas', (select count(*) from filas where estado_ranking = 'pocas_plantas'),
      'excluidas_revision', (select count(*) from filas where estado_ranking = 'excluida_revision'),
      'no_comparables', (select count(*) from filas where estado_ranking = 'no_comparable'),
      'sin_datos', (select count(*) from filas where estado_ranking = 'sin_datos'),
      'sin_evaluacion', (select count(*) from filas where estado_ranking in ('sin_evaluacion', 'sin_ronda')),
      'sin_version', (select count(*) from filas where estado_ranking = 'sin_version')
    ),
    'grupos', coalesce((
      select jsonb_agg(jsonb_build_object('categorias', g.grupo, 'n', g.n, 'con_posicion', g.con_posicion)
        order by g.n desc, cardinality(g.grupo) desc, array_to_string(g.grupo, ','))
      from grupos g), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(to_jsonb(f) - 'detalle_metricas'
        order by f.grupo, f.posicion_grupo nulls last, f.puntaje desc nulls last,
          codigo_display_numero(f.codigo_display) nulls last, f.codigo_display)
      from filas f), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function public.obtener_ranking_por_grupos(uuid, uuid, boolean) is
  'Fase 2: ranking por grupos de categorías para la UI v2 (versión activa, mínimo configurable, cuenta completa de la población). Nunca expone linaje.';
revoke all on function public.obtener_ranking_por_grupos(uuid, uuid, boolean) from public, anon;
grant execute on function public.obtener_ranking_por_grupos(uuid, uuid, boolean) to authenticated;

-- 5. Snapshots con grupo y cobertura ---------------------------------------

alter table public.ranking_snapshot_resultado
  add column grupo text[],
  add column cobertura jsonb,
  add column posicion_grupo integer check (posicion_grupo is null or posicion_grupo > 0);

comment on column public.ranking_snapshot_resultado.grupo is
  'Fase 2: grupo de categorías con que compitió (nulo en snapshots anteriores).';

create function public.congelar_ranking_grupos(p_nombre text, p_planta_id uuid default null, p_especie_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_especie_id uuid := p_especie_id;
  v_version_id uuid;
  v_version_nombre text;
  v_minimo integer;
  v_snapshot_id uuid;
  v_poblacion integer;
  v_resultados jsonb;
  v_coincidencias integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede congelar un ranking' using errcode = '42501';
  end if;
  if (p_planta_id is null) = (p_especie_id is null) then
    raise exception 'Indica exactamente un cruce o una especie' using errcode = '22023';
  end if;
  if coalesce(btrim(p_nombre), '') = '' then
    raise exception 'El snapshot requiere nombre' using errcode = '23514';
  end if;
  if p_planta_id is not null then
    select especie_id into v_especie_id from plantas where id = p_planta_id and eliminado_at is null;
    if not found then
      raise exception 'Cruce no encontrado' using errcode = 'P0002';
    end if;
  end if;

  -- A1-147: el nombre identifica el snapshot dentro de su alcance (mismo lock que congelar_ranking).
  perform pg_advisory_xact_lock(hashtextextended(
    'snapshot:' || coalesce(p_planta_id::text, 'especie:' || v_especie_id::text) || ':' || lower(btrim(p_nombre)), 0));
  select count(*)::integer, min(id::text)::uuid into v_coincidencias, v_snapshot_id
  from ranking_snapshot
  where planta_id is not distinct from p_planta_id
    and especie_id = v_especie_id and lower(btrim(nombre)) = lower(btrim(p_nombre));
  if v_coincidencias > 1 then
    raise exception 'Hay snapshots históricos con ese nombre. Usa un nombre distinto para identificar el nuevo snapshot.' using errcode = '23505';
  end if;
  if v_coincidencias = 1 then return v_snapshot_id; end if;

  v_version_id := resolver_scoring_version(v_especie_id, 'evaluacion_anual', current_date);
  if v_version_id is null then
    raise exception 'No hay versión activa de scoring para este alcance' using errcode = '23514';
  end if;
  select nombre into v_version_nombre from scoring_version where id = v_version_id;
  select minimo_evaluaciones_grupo into v_minimo from configuracion_ranking where id = 1;

  -- A1-152: una sola lectura del ranking; cuenta y detalle salen del mismo conjunto.
  select coalesce(jsonb_agg(to_jsonb(fila) order by fila.posicion), '[]'::jsonb) into v_resultados
  from (
    select r.individuo_id, r.codigo_display, r.evaluacion_id,
      (row_number() over (order by r.grupo, r.posicion_grupo))::integer as posicion,
      r.posicion_grupo, r.grupo, r.cobertura,
      r.puntaje,
      jsonb_build_object('fecha_evaluacion', r.fecha_evaluacion,
        'numero_ronda', r.numero_ronda, 'estado_evaluacion', r.estado_evaluacion,
        'scoring_version_id', r.scoring_version_id, 'scoring_version_nombre', r.scoring_version_nombre,
        'metricas', r.detalle_metricas, 'categorias', r.detalle_categorias,
        'tamano_grupo', r.tamano_grupo) as detalle
    from calcular_ranking_grupos(v_version_id, p_planta_id, p_especie_id, true, false, v_minimo) r
    where r.posicion_grupo is not null
  ) fila;
  v_poblacion := jsonb_array_length(v_resultados);

  if v_poblacion = 0 then
    raise exception 'No hay grupos con posición para congelar' using errcode = '23514';
  end if;

  insert into ranking_snapshot (
    nombre, alcance, scoring_version_id, especie_id, planta_id, poblacion_comparada, criterios, created_by
  ) values (
    btrim(p_nombre),
    case when p_planta_id is null then 'especie'::alcance_ranking_snapshot else 'cruzamiento'::alcance_ranking_snapshot end,
    v_version_id, v_especie_id, p_planta_id, v_poblacion,
    jsonb_build_object(
      'modo', 'grupos',
      'scoring_version_nombre', v_version_nombre,
      'grupo', 'combinacion de categorias del motor con al menos una metrica con valor',
      'minimo_evaluaciones_grupo', v_minimo,
      'seleccion_evaluacion', 'evaluacion unificada de la ronda anual mas reciente',
      'exclusiones', jsonb_build_array('borrador', 'anulada', 'excluida_revision', 'no_comparable', 'sin_datos', 'pocas_plantas', 'es_prueba'),
      'orden', jsonb_build_array('puntaje_desc'),
      'empates', 'mismo puntaje (4 decimales) comparte posicion en el grupo; sin desempate por codigo'
    ),
    v_uid
  ) returning id into v_snapshot_id;

  insert into ranking_snapshot_resultado (
    snapshot_id, individuo_id, codigo_display, evaluacion_id, posicion, puntaje, detalle, grupo, cobertura, posicion_grupo
  )
  select v_snapshot_id, r.individuo_id, r.codigo_display, r.evaluacion_id, r.posicion, r.puntaje, r.detalle, r.grupo, r.cobertura, r.posicion_grupo
  from jsonb_to_recordset(v_resultados) as r(
    individuo_id uuid, codigo_display text, evaluacion_id uuid, posicion integer, puntaje numeric, detalle jsonb,
    grupo text[], cobertura jsonb, posicion_grupo integer
  );

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'congelacion_ranking',
    array['scoring_version_id', 'evaluacion_id', 'puntaje', 'grupo'],
    jsonb_build_object('snapshot_id', v_snapshot_id, 'especie_id', v_especie_id, 'poblacion', v_poblacion,
      'scoring_version_id', v_version_id, 'modo', 'grupos'));

  return v_snapshot_id;
end;
$$;

comment on function public.congelar_ranking_grupos(text, uuid, uuid) is
  'Fase 2: congela el ranking por grupos (solo filas con posición en su grupo) guardando grupo, cobertura y posición en el grupo. Solo admin.';
revoke all on function public.congelar_ranking_grupos(text, uuid, uuid) from public, anon;
grant execute on function public.congelar_ranking_grupos(text, uuid, uuid) to authenticated;


-- 6. Lectura de snapshots por grupos (22-10-2026) ------------------------------
-- El detalle devuelve grupo y posición en el grupo; la comparación con el vivo
-- usa el ranking por grupos cuando el snapshot se congeló por grupos. Así el
-- snapshot y el ranking que se muestra dicen lo mismo.

CREATE OR REPLACE FUNCTION public.obtener_detalle_snapshot(p_snapshot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not exists (select 1 from ranking_snapshot where id = p_snapshot_id) then
    raise exception 'Snapshot no encontrado' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'snapshot', (
      select jsonb_build_object(
        'id', rs.id, 'nombre', rs.nombre, 'alcance', rs.alcance,
        'scoring_version_id', rs.scoring_version_id, 'scoring_version_nombre', sv.nombre,
        'especie_id', rs.especie_id, 'planta_id', rs.planta_id,
        'poblacion_comparada', rs.poblacion_comparada, 'criterios', rs.criterios,
        'created_by', rs.created_by, 'created_at', rs.created_at
      )
      from ranking_snapshot rs
      join scoring_version sv on sv.id = rs.scoring_version_id
      where rs.id = p_snapshot_id
    ),
    'resultados', coalesce((
      select jsonb_agg(jsonb_build_object(
        'individuo_id', rsr.individuo_id,
        'codigo_display', rsr.codigo_display,
        'evaluacion_id', rsr.evaluacion_id,
        'posicion', rsr.posicion,
        'posicion_grupo', rsr.posicion_grupo,
        'grupo', rsr.grupo,
        'puntaje', rsr.puntaje,
        'detalle', rsr.detalle
      ) order by rsr.posicion)
      from ranking_snapshot_resultado rsr
      where rsr.snapshot_id = p_snapshot_id
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$function$;

CREATE OR REPLACE FUNCTION public.comparar_snapshot_vivo(p_snapshot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_snapshot ranking_snapshot%rowtype;
  v_version_viva_id uuid;
  v_umbral_leve numeric;
  v_umbral_marcado numeric;
  v_resultado jsonb;
  v_grupos boolean;
  v_minimo integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select * into v_snapshot from ranking_snapshot where id = p_snapshot_id;
  if not found then
    raise exception 'Snapshot no encontrado' using errcode = 'P0002';
  end if;

  -- Un snapshot por grupos se compara con el ranking por grupos vivo (mismo
  -- mínimo vigente): «en vivo» = con posición en su grupo.
  v_grupos := coalesce(v_snapshot.criterios ->> 'modo', '') = 'grupos';
  select minimo_evaluaciones_grupo into v_minimo from configuracion_ranking where id = 1;

  v_version_viva_id := resolver_scoring_version(v_snapshot.especie_id, 'evaluacion_anual', current_date);
  select umbral_delta_leve, umbral_delta_marcado
    into v_umbral_leve, v_umbral_marcado
  from scoring_version where id = v_version_viva_id;

  with congelado as materialized (
    select
      rsr.individuo_id, rsr.codigo_display, rsr.puntaje,
      rsr.detalle -> 'categorias' as categorias
    from ranking_snapshot_resultado rsr
    where rsr.snapshot_id = p_snapshot_id
  ), vivo as materialized (
    select
      r.individuo_id, r.codigo_display, r.puntaje_ponderado as puntaje,
      r.detalle_categorias as categorias, r.elegible
    from calcular_ranking_operativo(v_version_viva_id, v_snapshot.planta_id, v_snapshot.especie_id, p_por_ronda => true) r
    where not v_grupos
    union all
    select
      g.individuo_id, g.codigo_display, g.puntaje,
      g.detalle_categorias, g.posicion_grupo is not null
    from calcular_ranking_grupos(v_version_viva_id, v_snapshot.planta_id, v_snapshot.especie_id, true, false, v_minimo) g
    where v_grupos
  ), comparado as (
    select
      coalesce(c.individuo_id, v.individuo_id) as individuo_id,
      coalesce(c.codigo_display, v.codigo_display) as codigo_display,
      c.puntaje as puntaje_snapshot,
      case when v.elegible then v.puntaje else null end as puntaje_vivo,
      (case when v.elegible then v.puntaje else null end) - c.puntaje as delta,
      etiquetar_delta(
        (case when v.elegible then v.puntaje else null end) - c.puntaje,
        v_umbral_leve, v_umbral_marcado
      ) as etiqueta,
      c.categorias as categorias_snapshot,
      v.categorias as categorias_vivo,
      (c.individuo_id is not null) as estaba_en_snapshot,
      (v.individuo_id is not null and v.elegible) as esta_en_vivo
    from congelado c
    full outer join vivo v on v.individuo_id = c.individuo_id
    where c.individuo_id is not null or v.elegible
  )
  select jsonb_build_object(
    'snapshot_id', p_snapshot_id,
    'scoring_version_snapshot_id', v_snapshot.scoring_version_id,
    'scoring_version_viva_id', v_version_viva_id,
    'version_cambio', v_snapshot.scoring_version_id is distinct from v_version_viva_id,
    'umbrales', jsonb_build_object('leve', v_umbral_leve, 'marcado', v_umbral_marcado),
    'individuos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'individuo_id', cm.individuo_id,
        'codigo_display', cm.codigo_display,
        'estaba_en_snapshot', cm.estaba_en_snapshot,
        'esta_en_vivo', cm.esta_en_vivo,
        'puntaje_snapshot', cm.puntaje_snapshot,
        'puntaje_vivo', cm.puntaje_vivo,
        'delta', cm.delta,
        'etiqueta', cm.etiqueta,
        'categorias_snapshot', cm.categorias_snapshot,
        'categorias_vivo', cm.categorias_vivo
      ) order by codigo_display_numero(cm.codigo_display), cm.codigo_display)
      from comparado cm
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$function$;
