-- =============================================================================
-- Fix (Problema 1 del arreglo post-Fase 5): calcular_metricas_evaluacion era
-- una TERCERA copia de "leer el valor de un descriptor por nombre", distinta
-- de la que ya vive en calcular_ranking_operativo. Fase 5 actualizo la
-- segunda pero no esta -- por eso una ronda con las 26 columnas completas
-- puntuaba en el ranking pero la serie historica la reportaba con cero
-- rondas elegibles: calcular_metricas_evaluacion solo sabia extraer 14 de
-- las 20 metricas configuradas en scoring_metrica.
--
-- La correccion NO es agregar las 6 metricas nuevas al CASE de
-- calcular_metricas_evaluacion (eso repite exactamente el patron que causo
-- el bug: una cuarta copia que la proxima temporada alguien vuelve a
-- olvidar). En su lugar, se reemplaza el CASE por nombre en AMBOS lugares
-- (calcular_metricas_evaluacion y calcular_ranking_operativo) por una unica
-- funcion generica que lee cualquier columna de "evaluaciones" por su
-- nombre de texto. Agregar una metrica nueva a scoring_metrica deja de
-- requerir tocar codigo en dos funciones SQL: solo el INSERT en
-- scoring_metrica, siempre que la columna ya exista en evaluaciones.
--
-- Riesgo que esto introduce y que el CASE anterior no tenia: el CASE viejo
-- devolvia NULL en silencio ante cualquier nombre de metrica no reconocido
-- (rama "else null"). Una extraccion generica por nombre de columna, en
-- cambio, hace CAST a numeric de lo que sea que encuentre -- si
-- scoring_metrica.metrica apuntara por error a una columna de texto/fecha/
-- uuid, el cast fallaria y tumbaria el calculo de ranking para TODOS los
-- individuos del lote, no solo para esa fila. Se cierra ese riesgo con un
-- trigger que valida, al guardar scoring_metrica, que el nombre corresponde
-- a una columna real de evaluaciones de tipo numerico -- el error se
-- detecta al configurar la metrica, no en cada calculo de ranking.
-- =============================================================================

create or replace function public.extraer_metrica_evaluacion(p_evaluacion evaluaciones, p_metrica text)
returns numeric
language sql
immutable
parallel safe
as $$
  select (to_jsonb(p_evaluacion) ->> p_metrica)::numeric;
$$;

comment on function public.extraer_metrica_evaluacion(evaluaciones, text) is
  'Unico punto de lectura de un descriptor de evaluaciones por su nombre de scoring_metrica.metrica. Reemplaza los CASE por nombre que existian por separado en calcular_metricas_evaluacion y calcular_ranking_operativo -- agregar una columna nueva a evaluaciones no requiere tocar esta funcion. Ver trigger validar_metrica_es_columna_numerica en scoring_metrica para la validacion que reemplaza al "else null" implicito del CASE viejo.';

create or replace function public.validar_metrica_es_columna_numerica()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tipo text;
begin
  select data_type into v_tipo
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'evaluaciones'
    and column_name = new.metrica;

  if v_tipo is null then
    raise exception 'scoring_metrica.metrica = % no corresponde a ninguna columna de evaluaciones', new.metrica
      using errcode = '23514';
  end if;

  if v_tipo not in ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision') then
    raise exception 'scoring_metrica.metrica = % apunta a la columna evaluaciones.% de tipo % (no numerico) -- extraer_metrica_evaluacion no puede castearla',
      new.metrica, new.metrica, v_tipo
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validar_metrica_es_columna_numerica() is
  'Con extraccion generica por nombre (extraer_metrica_evaluacion), un nombre de metrica mal configurado ya no degrada en silencio a NULL -- fallaria el cast en pleno calculo de ranking. Este trigger mueve ese error al momento de guardar la config.';

drop trigger if exists trg_scoring_metrica_validar_columna on public.scoring_metrica;
create trigger trg_scoring_metrica_validar_columna
  before insert or update of metrica on public.scoring_metrica
  for each row execute function public.validar_metrica_es_columna_numerica();

-- ---------------------------------------------------------------------------
-- calcular_metricas_evaluacion: mismo contrato (metrica, categoria, peso,
-- valor, normalizado), extraccion generica en vez del CASE de 14 nombres.
-- ---------------------------------------------------------------------------
create or replace function public.calcular_metricas_evaluacion(
  p_evaluacion evaluaciones,
  p_scoring_version_id uuid
)
returns table (
  metrica text,
  categoria categoria_scoring,
  peso numeric,
  valor numeric,
  normalizado numeric
)
language sql
stable
parallel safe
set search_path = public
as $$
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
$$;

comment on function public.calcular_metricas_evaluacion(evaluaciones, uuid) is
  'Valor + normalizado por metrica configurada, para UNA evaluacion puntual. Extraccion generica via extraer_metrica_evaluacion desde el fix post-Fase-5 -- antes tenia su propio CASE de 14 nombres, desalineado de calcular_ranking_operativo tras Fase 5 (6 metricas nuevas). Reutilizado por obtener_comparacion_rondas, obtener_series_historicas_cientificas y comparar snapshots.';

-- ---------------------------------------------------------------------------
-- calcular_ranking_operativo: mismo cambio, dentro del CTE "m". Se preserva
-- exactamente el resto de la funcion (seleccion de ronda/evaluacion via
-- unificar_evaluacion_ronda, agregacion por categoria, gate de elegibilidad,
-- motivo_exclusion) -- unico cambio es como se lee "valor" de cada metrica.
-- ---------------------------------------------------------------------------
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
      sv.id as scoring_version_id,
      sv.nombre as scoring_version_nombre
    from alcance a
    left join ultima_ronda ur on ur.individuo_id = a.individuo_id
    left join lateral unificar_evaluacion_ronda(ur.ronda_id) e on true
    left join scoring_version sv on sv.id = p_scoring_version_id
  ), calculado as (
    select
      b.*,
      metricas.configuradas,
      metricas.disponibles,
      metricas.puntaje,
      metricas.detalle,
      metricas.detalle_categorias
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
          end as fuera_rango_inferior
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
        ) as detalle_categorias
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
        and not coalesce(c.requiere_revision, false)
        and not coalesce(c.no_comparable, false)
        and c.configuradas > 0
        and c.disponibles = c.configuradas
      then round(c.puntaje, 4)
      else null
    end,
    c.evaluacion_id is not null
      and not coalesce(c.requiere_revision, false)
      and not coalesce(c.no_comparable, false)
      and c.configuradas > 0
      and c.disponibles = c.configuradas,
    case
      when c.numero_ronda is null then 'sin_ronda'
      when c.evaluacion_id is null then 'sin_evaluacion_completa_en_ronda_actual'
      when c.requiere_revision then 'requiere_revision'
      when c.no_comparable then 'no_comparable'
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
  'Motor canonico de ranking. Extraccion de metricas via extraer_metrica_evaluacion desde el fix post-Fase-5 (antes tenia su propio CASE de 20 nombres, unica razon por la que estaba sincronizado con Fase 5 y calcular_metricas_evaluacion no). Unifica la ronda por descriptor via unificar_evaluacion_ronda, conserva el gate de cobertura completa y clasifica cobertura incompleta como evaluacion_parcial_en_curso.';
