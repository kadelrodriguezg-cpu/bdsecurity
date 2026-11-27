-- U-09 (seguimiento): la planilla de ronda deja ver el borrador de una visita nueva.
--
-- Una ronda puede tener varias evaluaciones cerradas del mismo individuo (visitas espaciadas; decisión E1 de
-- docs/decisiones_cerradas.md) y, encima, un borrador de la visita nueva (a lo sumo uno por ronda: índice único
-- parcial evaluaciones_un_borrador_activo_por_ronda_uidx). obtener_planilla_ronda elige UNA evaluación por ronda y la
-- cerrada gana siempre sobre el borrador (A1-144), así que ese borrador no se veía en la planilla.
--
-- Cambio ADITIVO, solo claves nuevas; no cambia nada del comportamiento actual:
--   por fila:  hay_borrador (la ronda tiene un borrador activo) y borrador_mio (es de quien consulta). Son booleanos:
--              no exponen el contenido del borrador ni quién lo creó.
--   avance:    con_borrador = filas cerradas con un borrador de visita nueva (no se suma a los otros conteos).
-- Se conservan EXACTAMENTE los atributos de la función vigente: LANGUAGE plpgsql, STABLE, SECURITY INVOKER, SET search_path = public,
-- dueño postgres, EXECUTE solo para authenticated (create or replace conserva ACL y comentario). Rollback: la definición
-- anterior está en docs/migraciones_pendientes/rollback_planilla_borrador_visita_nueva.sql.

create or replace function public.obtener_planilla_ronda(p_planta_id uuid, p_tipo_ronda tipo_ronda DEFAULT 'anual'::tipo_ronda, p_numero_ronda smallint DEFAULT NULL::smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_numero smallint := p_numero_ronda;
  v_protocolo protocolo_ronda;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not exists (select 1 from plantas where id = p_planta_id and eliminado_at is null) then
    raise exception 'Cruce no encontrado' using errcode = 'P0002';
  end if;
  if v_numero is null then
    select max(r.numero_ronda) into v_numero
    from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id
    where i.planta_id = p_planta_id and r.tipo_ronda = p_tipo_ronda;
  end if;

  select * into v_protocolo
  from protocolo_ronda pr
  where pr.planta_id = p_planta_id and pr.tipo_ronda = p_tipo_ronda and pr.numero_ronda = v_numero
  order by pr.version desc
  limit 1;

  with vivos as (
    select i.id, i.codigo_display
    from individuos i
    where i.planta_id = p_planta_id and i.estado_vital = 'vivo'
  ), rondas as (
    select r.individuo_id, r.id as ronda_id
    from ronda_evaluacion_anual r
    join vivos v on v.id = r.individuo_id
    where r.tipo_ronda = p_tipo_ronda and r.numero_ronda = v_numero
  ), elegida as (
    -- A1-144: el avance se mide por evaluación cerrada; si no hay, el borrador.
    select distinct on (e.ronda_id) e.*
    from evaluaciones e
    join rondas ro on ro.ronda_id = e.ronda_id
    where e.estado in ('borrador', 'completa', 'corregida')
    order by e.ronda_id, (e.estado <> 'borrador') desc, e.fecha desc, e.updated_at desc, e.id desc
  ), borradores as (
    -- U-09: un borrador activo (a lo sumo uno por ronda) puede convivir con una evaluación cerrada: una visita nueva.
    -- Solo se expone si existe y si es de quien consulta; nunca su contenido ni quién lo creó.
    select e.ronda_id, bool_or(e.created_by = auth.uid()) as mio
    from evaluaciones e
    join rondas ro on ro.ronda_id = e.ronda_id
    where e.estado = 'borrador'
    group by e.ronda_id
  ), filas as (
    select
      v.id as individuo_id,
      v.codigo_display,
      codigo_display_numero(v.codigo_display) as numero,
      ro.ronda_id,
      case
        when ro.ronda_id is null then 'sin_ronda'
        when e.id is null then 'sin_iniciar'
        when e.estado = 'borrador' then 'borrador'
        else 'completa'
      end as estado,
      e.id as evaluacion_id,
      e.updated_at as evaluacion_updated_at,
      e.fecha,
      e.evaluador,
      e.created_by = auth.uid() as es_mia,
      e.protocolo_id,
      -- Solo si la evaluación tiene protocolo y no es el vigente (las anteriores a los protocolos no cuentan).
      e.protocolo_id is not null and e.protocolo_id is distinct from v_protocolo.id as protocolo_distinto,
      case when e.id is not null then estados_descriptores(e) end as estados,
      b.ronda_id is not null as hay_borrador,
      coalesce(b.mio, false) as borrador_mio
    from vivos v
    left join rondas ro on ro.individuo_id = v.id
    left join elegida e on e.ronda_id = ro.ronda_id
    left join borradores b on b.ronda_id = ro.ronda_id
  )
  select jsonb_build_object(
    'planta_id', p_planta_id,
    'tipo_ronda', p_tipo_ronda,
    'numero_ronda', v_numero,
    'protocolo', case when v_protocolo.id is null then null else jsonb_build_object(
      'id', v_protocolo.id, 'version', v_protocolo.version, 'nombre', v_protocolo.nombre,
      'descriptores', v_protocolo.descriptores, 'created_at', v_protocolo.created_at) end,
    'avance', jsonb_build_object(
      'vivos', (select count(*) from filas),
      'sin_ronda', (select count(*) from filas where estado = 'sin_ronda'),
      'sin_iniciar', (select count(*) from filas where estado = 'sin_iniciar'),
      'borrador', (select count(*) from filas where estado = 'borrador'),
      'completa', (select count(*) from filas where estado = 'completa'),
      -- Filas cerradas que además tienen un borrador de visita nueva (no suma a los demás conteos).
      'con_borrador', (select count(*) from filas where estado = 'completa' and hay_borrador)
    ),
    'individuos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'individuo_id', f.individuo_id, 'codigo_display', f.codigo_display, 'numero', f.numero,
        'ronda_id', f.ronda_id, 'estado', f.estado, 'evaluacion_id', f.evaluacion_id,
        'evaluacion_updated_at', f.evaluacion_updated_at, 'fecha', f.fecha, 'evaluador', f.evaluador,
        'es_mia', coalesce(f.es_mia, false), 'protocolo_id', f.protocolo_id,
        'protocolo_distinto', coalesce(f.protocolo_distinto, false), 'estados', f.estados,
        'conteo', case when f.estados is null then null else (
          select jsonb_build_object(
            'medido', count(*) filter (where x.value #>> '{}' = 'medido'),
            'falto', count(*) filter (where x.value #>> '{}' = 'falto'),
            'no_evaluado', count(*) filter (where x.value #>> '{}' = 'no_evaluado'),
            'marcado', count(*) filter (where x.value #>> '{}' = 'marcado'))
          from jsonb_each(f.estados) x) end,
        'hay_borrador', f.hay_borrador, 'borrador_mio', f.borrador_mio
      ) order by f.numero nulls last, f.codigo_display)
      from filas f), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$function$;
