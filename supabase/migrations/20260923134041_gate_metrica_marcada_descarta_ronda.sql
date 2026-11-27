-- =============================================================================
-- Fix (Problema 2 del arreglo post-Fase 5) -- PARTE 2: conectar la procedencia
-- de calidad al gate de elegibilidad del ranking.
--
-- Decision de producto confirmada: si CUALQUIER metrica que participa en el
-- calculo de una ronda (una fila de scoring_metrica de la version en uso)
-- proviene de una visita marcada requiere_revision o no_comparable, la RONDA
-- COMPLETA queda inelegible -- no se excluye solo esa metrica del promedio.
--
-- Razon (registrada tal como se decidio): un valor requiere_revision no es
-- un dato ausente -- es un valor que el sistema ya inspecciono y decidio que
-- no confia en el. Tratarlo igual que "no se midio" (excluirlo del promedio
-- y seguir) seria silencioso: el ranking usaria ese valor sospechoso sin que
-- nadie que mire el puntaje final se entere. Se prefiere que una ronda buena
-- quede afuera por precaucion a que una ronda con un dato sospechoso quede
-- disfrazada de limpia -- misma logica que la tripleta de frutos (un NULL
-- honesto es mejor que un numero plausible y falso). Ademas, descartar la
-- ronda completa le da al evaluador un incentivo real para resolver la
-- revision en vez de acumular deuda de calidad invisible.
--
-- El chequeo se acota a las metricas efectivamente configuradas en
-- scoring_metrica para la version en uso -- una bandera sobre un descriptor
-- que no participa del scoring (p.ej. altura_brote_mm, fuera del ranking a
-- proposito segun docs/pendientes.md) no debe tumbar la ronda.
-- =============================================================================

create or replace function public.calcular_ranking_operativo(p_scoring_version_id uuid, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(individuo_id uuid, codigo_display text, planta_id uuid, codigo_sistema text, especie_id uuid, evaluacion_id uuid, fecha_evaluacion date, evaluacion_updated_at timestamp with time zone, numero_ronda smallint, estado_evaluacion estado_evaluacion, requiere_revision boolean, no_comparable boolean, scoring_version_id uuid, scoring_version_nombre text, puntaje_ponderado numeric, elegible boolean, motivo_exclusion text, detalle_metricas jsonb, detalle_categorias jsonb)
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
      p.especie_id
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
      r.numero_ronda
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
    left join scoring_version sv on sv.id = p_scoring_version_id
  ), calculado as (
    select
      b.*,
      metricas.configuradas,
      metricas.disponibles,
      metricas.puntaje,
      metricas.detalle,
      metricas.detalle_categorias,
      metricas.tiene_metrica_marcada
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
        coalesce((select bool_or(marcada) from m), false) as tiene_metrica_marcada
    ) metricas on true
  )
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
      then round(c.puntaje, 4)
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
      -- Orden deliberado: requiere_revision/no_comparable (fila representante)
      -- van ANTES para no cambiar la etiqueta del caso simple ya cubierto por
      -- ellos (una sola visita, su propio flag) -- contiene_metrica_marcada
      -- solo se vuelve el motivo visible cuando esos dos NO detectan nada
      -- pero una visita ANTERIOR (no la representante) sí dejo una metrica
      -- marcada colgando -- exactamente el caso noviembre/diciembre que
      -- motiva este fix. La elegibilidad (mas abajo) no depende del orden:
      -- exige not tiene_metrica_marcada Y not requiere_revision Y not
      -- no_comparable, asi que el resultado booleano es identico sea cual
      -- sea el orden -- lo unico que cambia es que string se reporta.
      when coalesce(c.tiene_metrica_marcada, false) then 'contiene_metrica_marcada'
      when c.scoring_version_id is null then 'sin_version_scoring'
      when c.configuradas = 0 then 'version_sin_metricas'
      when c.disponibles < c.configuradas then 'evaluacion_parcial_en_curso'
      else null
    end,
    coalesce(c.detalle, '{}'::jsonb),
    coalesce(c.detalle_categorias, '{}'::jsonb)
  from calculado c;
$function$;

comment on function public.calcular_ranking_operativo(uuid, uuid, uuid) is
  'Motor canonico de ranking. Extraccion de metricas via extraer_metrica_evaluacion, ronda unificada via unificar_evaluacion_ronda. Inelegible si: sin ronda/evaluacion, si CUALQUIER metrica configurada proviene de una visita marcada requiere_revision/no_comparable (contiene_metrica_marcada -- decision de producto: la ronda completa se descarta, no solo esa metrica), si la fila representante esta marcada, sin version de scoring, o cobertura incompleta (evaluacion_parcial_en_curso).';
