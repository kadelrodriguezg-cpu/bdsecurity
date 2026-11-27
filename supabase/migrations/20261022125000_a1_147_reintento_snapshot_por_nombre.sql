-- A1-147: idempotencia por nombre/alcance, sin modificar historico ni permisos.
CREATE OR REPLACE FUNCTION public.congelar_ranking(p_nombre text, p_planta_id uuid DEFAULT NULL::uuid, p_especie_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_especie_id uuid := p_especie_id;
  v_version_id uuid;
  v_version_nombre text;
  v_desempate jsonb;
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
    select especie_id into v_especie_id
    from plantas
    where id = p_planta_id and eliminado_at is null;
    if not found then
      raise exception 'Cruce no encontrado' using errcode = 'P0002';
    end if;
  end if;

  -- A1-147: el nombre identifica el snapshot dentro de su alcance.
  -- No se borran ni fusionan nombres duplicados históricos.
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

  select nombre, criterio_desempate into v_version_nombre, v_desempate
  from scoring_version where id = v_version_id;

  -- A1-152: una sola lectura del ranking. Cuenta y detalle salen del mismo
  -- conjunto materializado, aunque cambien evaluaciones durante el INSERT.
  select coalesce(jsonb_agg(to_jsonb(fila)), '[]'::jsonb) into v_resultados
  from (
    select r.individuo_id, r.codigo_display, r.evaluacion_id,
      row_number() over (order by r.puntaje_ponderado desc,
        codigo_display_numero(r.codigo_display) asc, r.codigo_display asc)::integer as posicion,
      r.puntaje_ponderado as puntaje,
      jsonb_build_object('fecha_evaluacion', r.fecha_evaluacion,
        'numero_ronda', r.numero_ronda, 'estado_evaluacion', r.estado_evaluacion,
        'scoring_version_id', r.scoring_version_id, 'scoring_version_nombre', r.scoring_version_nombre,
        'metricas', r.detalle_metricas, 'categorias', r.detalle_categorias) as detalle
    from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id, p_por_ronda => true) r
    where r.elegible
  ) fila;
  v_poblacion := jsonb_array_length(v_resultados);

  if v_poblacion = 0 then
    raise exception 'No hay población elegible para congelar' using errcode = '23514';
  end if;

  insert into ranking_snapshot (
    nombre, alcance, scoring_version_id, especie_id, planta_id,
    poblacion_comparada, criterios, created_by
  ) values (
    btrim(p_nombre),
    case when p_planta_id is null
      then 'especie'::alcance_ranking_snapshot
      else 'cruzamiento'::alcance_ranking_snapshot
    end,
    v_version_id,
    v_especie_id,
    p_planta_id,
    v_poblacion,
    jsonb_build_object(
      'scoring_version_nombre', v_version_nombre,
      'seleccion_evaluacion', 'ultima completa/corregida de la ronda mas reciente; fecha y updated_at como desempate',
      'exclusiones', jsonb_build_array('borrador', 'anulada', 'requiere_revision', 'no_comparable', 'metricas_incompletas'),
      'desempate', v_desempate
    ),
    v_uid
  ) returning id into v_snapshot_id;

  insert into ranking_snapshot_resultado (
    snapshot_id, individuo_id, codigo_display, evaluacion_id, posicion, puntaje, detalle
  )
  select v_snapshot_id, r.individuo_id, r.codigo_display, r.evaluacion_id, r.posicion, r.puntaje, r.detalle
  from jsonb_to_recordset(v_resultados) as r(
    individuo_id uuid, codigo_display text, evaluacion_id uuid, posicion integer, puntaje numeric, detalle jsonb
  );

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    p_planta_id,
    'congelacion_ranking',
    array['scoring_version_id', 'evaluacion_id', 'puntaje'],
    jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'especie_id', v_especie_id,
      'poblacion', v_poblacion,
      'scoring_version_id', v_version_id
    )
  );

  return v_snapshot_id;
end;
$function$
;
