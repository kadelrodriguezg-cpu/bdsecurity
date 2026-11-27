-- Rollback del paso 58 (puntaje v3 inactivo y rangos por edad). Se niega si la v3 está activa o en uso (rondas cerradas con ella o
-- rankings congelados): en ese caso hay que revertir antes el paso 60 y no se puede borrar una versión con historia. Si no, borra la
-- versión v3 (sus rangos por edad, métricas y pesos), sus dos rangos de referencia, vuelve a las definiciones anteriores del motor y de
-- nueva_version_scoring (con sus comentarios) y quita la tabla de rangos por edad.
DO $chk$
DECLARE
  v_v3 uuid;
BEGIN
  SELECT id INTO v_v3 FROM public.scoring_version WHERE nombre = 'Selección v3 (calibre, Brix y rendimiento por edad) provisional';
  IF v_v3 IS NULL THEN
    RAISE EXCEPTION 'FAIL: rollback 58: no encuentro la versión v3';
  END IF;
  IF (SELECT estado FROM public.scoring_version WHERE id = v_v3) <> 'borrador' OR public.scoring_version_en_uso(v_v3) THEN
    RAISE EXCEPTION 'FAIL: rollback 58: la v3 está activa o en uso';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.scoring_metrica_rango_edad r JOIN public.scoring_metrica m ON m.id = r.scoring_metrica_id WHERE m.scoring_version_id <> v_v3
  ) THEN
    RAISE EXCEPTION 'FAIL: rollback 58: otra versión ya usa rangos por edad';
  END IF;
  DELETE FROM public.scoring_metrica_rango_edad r USING public.scoring_metrica m WHERE m.id = r.scoring_metrica_id AND m.scoring_version_id = v_v3;
  DELETE FROM public.scoring_metrica WHERE scoring_version_id = v_v3;
  DELETE FROM public.scoring_categoria_peso WHERE scoring_version_id = v_v3;
  DELETE FROM public.scoring_version WHERE id = v_v3;
  DELETE FROM public.rango_referencia rr
   WHERE rr.activo = false AND rr.especie_id IS NULL AND rr.vigente_desde = date '2026-10-26'
     AND ((rr.metrica = 'calibre_mm' AND rr.minimo_esperado = 12 AND rr.maximo_esperado = 25) OR (rr.metrica = 'brix' AND rr.minimo_esperado = 10 AND rr.maximo_esperado = 20))
     AND NOT EXISTS (SELECT 1 FROM public.scoring_metrica sm WHERE sm.rango_referencia_id = rr.id);
END;
$chk$;

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
      coalesce(rr.minimo_esperado, sm.minimo_normalizacion),
      coalesce(rr.maximo_esperado, sm.maximo_normalizacion),
      sm.direccion_favorable
    ) as normalizado
  from scoring_metrica sm
  left join rango_referencia rr on rr.id = sm.rango_referencia_id
  where sm.scoring_version_id = p_scoring_version_id;
$function$;

comment on function public.calcular_metricas_evaluacion(evaluaciones, uuid) is
  'Valor + normalizado por metrica configurada, para UNA evaluacion puntual. Extraccion generica via extraer_metrica_evaluacion desde el fix post-Fase-5 -- antes tenia su propio CASE de 14 nombres, desalineado de calcular_ranking_operativo tras Fase 5 (6 metricas nuevas). Reutilizado por obtener_comparacion_rondas, obtener_series_historicas_cientificas y comparar snapshots.';

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

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, null, 'nueva_version_scoring', array['scoring_version_id'],
          jsonb_build_object('version_base_id', p_version_base_id, 'version_nueva_id', v_nueva, 'nombre', btrim(p_nombre)));

  return v_nueva;
end;
$function$;

comment on function public.nueva_version_scoring(uuid, text, date, text) is
  'Solo admin. Copia una versión de scoring (métricas y pesos) como borrador editable. Único camino para cambiar la configuración de una versión en uso.';

drop table public.scoring_metrica_rango_edad;
drop function public.bloquear_rango_edad_en_uso();
