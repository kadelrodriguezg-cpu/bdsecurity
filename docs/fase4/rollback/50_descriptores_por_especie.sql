-- Rollback del paso 50 (descriptores por especie). Se niega si ya hay configuración guardada: revertirlo la perdería.
-- Restaura definir_protocolo_ronda (20261023110000), estados_descriptores (20261025110000) y calcular_ranking_nucleo (20261024090000)
-- tal como estaban, y borra la tabla y las funciones nuevas. Los valores de las evaluaciones no se tocan.
DO $rb$
BEGIN
  IF EXISTS (SELECT 1 FROM public.esquema_campo_especie) THEN
    RAISE EXCEPTION 'FAIL: rollback 50: hay descriptores configurados por especie; vuelve a activarlos (o borra esas filas) antes de revertir';
  END IF;
END;
$rb$;
create or replace function public.definir_protocolo_ronda(
  p_planta_id uuid,
  p_tipo_ronda public.tipo_ronda,
  p_numero_ronda smallint,
  p_nombre text,
  p_descriptores jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_motivo text;
  v_version integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin define el protocolo de una ronda' using errcode = '42501';
  end if;
  if p_numero_ronda is null or p_numero_ronda not between 1 and 3 then
    raise exception 'Número de ronda inválido' using errcode = '22023';
  end if;
  if coalesce(btrim(p_nombre), '') = '' then
    raise exception 'El protocolo requiere nombre' using errcode = '23514';
  end if;
  if not exists (select 1 from plantas where id = p_planta_id and eliminado_at is null) then
    raise exception 'Cruce no encontrado o archivado' using errcode = 'P0002';
  end if;
  v_motivo := validar_descriptores_protocolo(p_descriptores);
  if v_motivo is not null then
    raise exception '%', v_motivo using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('protocolo:' || p_planta_id::text || ':' || p_tipo_ronda::text || ':' || p_numero_ronda::text, 0));
  select coalesce(max(version), 0) + 1 into v_version
  from protocolo_ronda
  where planta_id = p_planta_id and tipo_ronda = p_tipo_ronda and numero_ronda = p_numero_ronda;

  insert into protocolo_ronda (planta_id, tipo_ronda, numero_ronda, version, nombre, descriptores, created_by)
  values (p_planta_id, p_tipo_ronda, p_numero_ronda, v_version, btrim(p_nombre), p_descriptores, v_uid)
  returning id into v_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'definicion_protocolo_ronda', array['descriptores'],
    jsonb_build_object('protocolo_id', v_id, 'tipo_ronda', p_tipo_ronda, 'numero_ronda', p_numero_ronda,
      'version', v_version, 'nombre', btrim(p_nombre), 'descriptores', p_descriptores));

  return v_id;
end;
$$;
create or replace function public.estados_descriptores(p_evaluacion evaluaciones)
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
  where c.fase = 'evaluacion_anual' and c.rol in ('descriptor', 'muestra')
    and (c.activo or ((to_jsonb(p_evaluacion) -> c.clave) is not null and (to_jsonb(p_evaluacion) -> c.clave) <> 'null'::jsonb));
$function$
;
CREATE OR REPLACE FUNCTION public.calcular_ranking_nucleo(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid, p_por_ronda boolean DEFAULT false, p_incluir_pruebas boolean DEFAULT true, p_con_grupo boolean DEFAULT true, p_numero_ronda smallint DEFAULT NULL::smallint)
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
DROP FUNCTION public.contar_valores_descriptor(uuid, text);
DROP TABLE public.esquema_campo_especie;
DROP FUNCTION public.validar_auditar_campo_especie();
DROP FUNCTION public.descriptor_activo_en_especie(text, text, uuid);
