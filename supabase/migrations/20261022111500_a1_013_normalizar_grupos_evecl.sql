-- A1-013: misma clave lower(btrim(variedad)) que usa el índice y los filtros.
-- =============================================================================
-- MIGRACIÓN 20260811000700 — EVECL: corregir grupo_label en evecl_comparar
--
-- Hallazgo de revisión de E2: grupo_label armaba "Variedad — ensayo {id}"
-- usando el bigint interno de evecl_ensayo.id, que no es legible en terreno.
-- Se corrige para usar codigo_parcela (el campo pensado para ser legible),
-- con localidad como fallback si codigo_parcela viniera vacío (no debería
-- pasar por el índice único de evecl_ensayo, pero por si acaso), y como
-- último recurso "ensayo #<id>" en vez de exponer el ID crudo sin contexto.
--
-- grupo_key (la clave interna, no mostrada al usuario) sigue basada en
-- ensayo_id — es un identificador opaco para el frontend, no texto de
-- pantalla, así que no aplica la misma corrección.
--
-- Mismo CREATE OR REPLACE (firma sin cambios), solo se corrige el cuerpo.
-- =============================================================================

create or replace function evecl_comparar(
  p_modo      text,
  p_ensayo_id bigint default null,
  p_variedad  text default null,
  p_conjunto  text default 'todos'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id_dulzor bigint;
  v_id_acidez bigint;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if p_modo not in ('entre_fichas', 'entre_grupos') then
    raise exception 'Modo inválido: % (esperado entre_fichas o entre_grupos)', p_modo using errcode = '22023';
  end if;
  if p_modo = 'entre_fichas' and (p_ensayo_id is null or p_variedad is null) then
    raise exception 'entre_fichas requiere ensayo_id y variedad' using errcode = '22023';
  end if;
  if p_conjunto not in ('todos', 'solo_evaluacion', 'evaluacion_vs_testigo') then
    raise exception 'Conjunto inválido: %', p_conjunto using errcode = '22023';
  end if;

  select id into v_id_dulzor from evecl_descriptor where codigo_upov = 29;
  select id into v_id_acidez from evecl_descriptor where codigo_upov = 30;

  with fichas_base as (
    select f.id as ficha_id, f.ensayo_id, f.variedad, f.tipo, f.numero_repeticion,
           coalesce(nullif(btrim(e.codigo_parcela), ''), nullif(btrim(e.localidad), ''), 'ensayo #' || f.ensayo_id::text) as ensayo_label
    from evecl_ficha f
    join evecl_ensayo e on e.id = f.ensayo_id
    where f.eliminado_at is null
      and (p_variedad is null or lower(trim(f.variedad)) = lower(trim(p_variedad)))
      and (p_ensayo_id is null or f.ensayo_id = p_ensayo_id)
      and (
        p_modo = 'entre_fichas'
        or p_conjunto <> 'solo_evaluacion'
        or f.tipo = 'evaluacion'
      )
  ),
  grupos as (
    select
      fb.ficha_id, fb.numero_repeticion, fb.variedad, fb.ensayo_id, fb.tipo,
      case
        when p_modo = 'entre_fichas' then fb.ficha_id::text
        when p_conjunto = 'evaluacion_vs_testigo' then lower(btrim(fb.variedad)) || '::' || fb.ensayo_id::text || '::' || fb.tipo::text
        else lower(btrim(fb.variedad)) || '::' || fb.ensayo_id::text
      end as grupo_key,
      case
        when p_modo = 'entre_fichas' then 'Repetición ' || fb.numero_repeticion::text
        when p_conjunto = 'evaluacion_vs_testigo' then fb.variedad || ' (' || fb.tipo::text || ') — ' || fb.ensayo_label
        else fb.variedad || ' — ' || fb.ensayo_label
      end as grupo_label
    from fichas_base fb
  ),
  grupos_meta as (
    select grupo_key, min(grupo_label) as grupo_label, min(variedad) as variedad,
           min(ensayo_id) as ensayo_id, min(tipo::text) as tipo, count(*) as n_total
    from grupos
    group by grupo_key
  ),
  criterios as (
    select id as descriptor_id, nombre, eje::text as eje, direccion_ranking as direccion
    from evecl_descriptor
    where rankeable
  ),
  valores_ficha_criterio as (
    select g.grupo_key, g.ficha_id, c.descriptor_id, c.nombre, c.eje, c.direccion,
           coalesce(r.valor_numerico, r.nota::numeric) as valor
    from grupos g
    cross join criterios c
    left join evecl_respuesta r on r.ficha_id = g.ficha_id and r.descriptor_id = c.descriptor_id
  ),
  promedios_grupo_criterio as (
    select grupo_key, descriptor_id, nombre, eje, direccion, avg(valor) as valor_promedio
    from valores_ficha_criterio
    group by grupo_key, descriptor_id, nombre, eje, direccion
  ),
  rango_criterio as (
    select descriptor_id, min(valor_promedio) as min_v, max(valor_promedio) as max_v
    from promedios_grupo_criterio
    group by descriptor_id
  ),
  normalizado_criterio as (
    select p.grupo_key, p.eje, p.descriptor_id,
      case
        when p.valor_promedio is null then null
        when r.max_v = r.min_v then 100
        when p.direccion = 'mayor' then 100.0 * (p.valor_promedio - r.min_v) / (r.max_v - r.min_v)
        when p.direccion = 'menor' then 100.0 * (r.max_v - p.valor_promedio) / (r.max_v - r.min_v)
        else null
      end as puntaje
    from promedios_grupo_criterio p
    join rango_criterio r using (descriptor_id)
  ),
  valores_ratio_ficha as (
    select g.grupo_key, g.ficha_id,
      case
        when d.valor_numerico is not null and a.valor_numerico is not null and a.valor_numerico <> 0
        then d.valor_numerico / a.valor_numerico
      end as ratio
    from grupos g
    left join evecl_respuesta d on d.ficha_id = g.ficha_id and d.descriptor_id = v_id_dulzor
    left join evecl_respuesta a on a.ficha_id = g.ficha_id and a.descriptor_id = v_id_acidez
  ),
  promedio_ratio_grupo as (
    select grupo_key, avg(ratio) as ratio_promedio
    from valores_ratio_ficha
    group by grupo_key
  ),
  distancia_ratio_grupo as (
    select grupo_key, ratio_promedio, abs(ratio_promedio - 18) as distancia
    from promedio_ratio_grupo
    where ratio_promedio is not null
  ),
  rango_ratio as (
    select min(distancia) as min_d, max(distancia) as max_d from distancia_ratio_grupo
  ),
  normalizado_ratio as (
    select d.grupo_key, 'calidad'::text as eje,
      case
        when r.max_d = r.min_d then 100
        else 100.0 * (r.max_d - d.distancia) / (r.max_d - r.min_d)
      end as puntaje
    from distancia_ratio_grupo d
    cross join rango_ratio r
  ),
  puntajes_eje as (
    select grupo_key, eje, avg(puntaje) as puntaje_eje
    from (
      select grupo_key, eje, puntaje from normalizado_criterio
      union all
      select grupo_key, eje, puntaje from normalizado_ratio
    ) u
    group by grupo_key, eje
  ),
  fichas_con_dato_eje as (
    select grupo_key, eje, ficha_id from valores_ficha_criterio where valor is not null
    union
    select grupo_key, 'calidad', ficha_id from valores_ratio_ficha where ratio is not null
  ),
  conteo_fichas_con_dato_eje as (
    select grupo_key, eje, count(distinct ficha_id) as n_con_dato
    from fichas_con_dato_eje
    group by grupo_key, eje
  ),
  descriptores_perfil as (
    select id as descriptor_id, nombre, eje::text as eje, orden
    from evecl_descriptor
    where eje in ('fenologia', 'adaptabilidad') and tipo = 'estado' and activo
  ),
  valores_perfil_ficha as (
    select g.grupo_key, g.ficha_id, dp.descriptor_id, dp.nombre, dp.eje, dp.orden, r.nota
    from grupos g
    cross join descriptores_perfil dp
    left join evecl_respuesta r on r.ficha_id = g.ficha_id and r.descriptor_id = dp.descriptor_id
  ),
  moda_perfil as (
    select grupo_key, descriptor_id, nombre, eje, orden,
      mode() within group (order by nota) as nota_moda,
      count(distinct nota) filter (where nota is not null) as n_valores_distintos,
      count(nota) as n_con_dato,
      count(*) as n_total
    from valores_perfil_ficha
    group by grupo_key, descriptor_id, nombre, eje, orden
  )
  select jsonb_build_object(
    'modo', p_modo,
    'conjunto', case when p_modo = 'entre_grupos' then p_conjunto else null end,
    'nota_metodologica', 'El puntaje es relativo al conjunto comparado (min-max), no un estándar de mercado absoluto.',
    'ranking_calidad', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'grupo_key', gm.grupo_key, 'grupo_label', gm.grupo_label, 'variedad', gm.variedad,
        'ensayo_id', gm.ensayo_id, 'tipo', gm.tipo,
        'puntaje', round(pe.puntaje_eje::numeric, 0),
        'n_con_dato', coalesce(cf.n_con_dato, 0), 'n_total', gm.n_total
      ) order by pe.puntaje_eje desc), '[]'::jsonb)
      from puntajes_eje pe
      join grupos_meta gm using (grupo_key)
      left join conteo_fichas_con_dato_eje cf on cf.grupo_key = pe.grupo_key and cf.eje = pe.eje
      where pe.eje = 'calidad' and pe.puntaje_eje is not null
    ),
    'ranking_productividad', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'grupo_key', gm.grupo_key, 'grupo_label', gm.grupo_label, 'variedad', gm.variedad,
        'ensayo_id', gm.ensayo_id, 'tipo', gm.tipo,
        'puntaje', round(pe.puntaje_eje::numeric, 0),
        'n_con_dato', coalesce(cf.n_con_dato, 0), 'n_total', gm.n_total
      ) order by pe.puntaje_eje desc), '[]'::jsonb)
      from puntajes_eje pe
      join grupos_meta gm using (grupo_key)
      left join conteo_fichas_con_dato_eje cf on cf.grupo_key = pe.grupo_key and cf.eje = pe.eje
      where pe.eje = 'productividad' and pe.puntaje_eje is not null
    ),
    'perfil_fenologia', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'grupo_key', mp.grupo_key, 'grupo_label', gm.grupo_label,
        'descriptor', mp.nombre, 'nota_moda', mp.nota_moda, 'label_moda', es.label,
        'divergente', mp.n_valores_distintos > 1,
        'n_con_dato', mp.n_con_dato, 'n_total', mp.n_total
      ) order by gm.grupo_label, mp.orden), '[]'::jsonb)
      from moda_perfil mp
      join grupos_meta gm using (grupo_key)
      left join evecl_descriptor_estado es on es.descriptor_id = mp.descriptor_id and es.nota = mp.nota_moda
      where mp.eje = 'fenologia' and mp.nota_moda is not null
    ),
    'perfil_adaptabilidad', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'grupo_key', mp.grupo_key, 'grupo_label', gm.grupo_label,
        'descriptor', mp.nombre, 'nota_moda', mp.nota_moda, 'label_moda', es.label,
        'divergente', mp.n_valores_distintos > 1,
        'n_con_dato', mp.n_con_dato, 'n_total', mp.n_total
      ) order by gm.grupo_label, mp.orden), '[]'::jsonb)
      from moda_perfil mp
      join grupos_meta gm using (grupo_key)
      left join evecl_descriptor_estado es on es.descriptor_id = mp.descriptor_id and es.nota = mp.nota_moda
      where mp.eje = 'adaptabilidad' and mp.nota_moda is not null
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function evecl_comparar is 'Scoring EVECL: ranking min-max relativo de Calidad/Productividad (7 descriptores rankeable + ratio derivado °Brix/Acidez) y perfil de moda/divergencia de Fenología/Adaptabilidad. Reglas fijas, no configurables en v1 (9.4.2/9.4.3). grupo_label usa codigo_parcela (fallback localidad) del ensayo, nunca el id crudo.';
