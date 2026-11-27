-- A1-050: comparar payload normalizado y serializar reintentos de lote.
create or replace function dar_baja_individuos(
  p_ids uuid[],
  p_estado estado_vital,
  p_criterios criterio_baja[],
  p_nota text,
  p_fecha date,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_ids         uuid[];
  v_previa      jsonb;
  v_recientes   integer;
  v_excluidos   integer;
  v_ejemplos    text;
  v_plantas     uuid[];
  v_huella text;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede dar de baja en lote' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Falta la clave de idempotencia' using errcode = '22023';
  end if;
  perform validar_parametros_baja(p_estado, p_criterios, p_fecha);

  -- A1-050: comparar sin conservar la nota libre en audit_log.
  select array_agg(distinct x order by x) into v_ids from unnest(p_ids) x where x is not null;
  v_huella := encode(sha256(convert_to(jsonb_build_object(
    'ids', to_jsonb(v_ids), 'estado', p_estado, 'fecha', p_fecha,
    'criterios', (select jsonb_agg(c order by c) from (select distinct x::text c from unnest(p_criterios) x where x is not null) q),
    'nota', nullif(btrim(coalesce(p_nota, '')), '')
  )::text, 'UTF8')), 'hex');
  -- Serializa reintentos de la misma clave antes de consultar su resultado.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0));
  -- Reintento: devuelve el resultado solo si coincide la solicitud.
  select detalle into v_previa
  from audit_log
  where usuario_id = v_uid and accion = 'baja_lote' and detalle->>'idempotency_key' = p_idempotency_key::text
  limit 1;
  if v_previa is not null then
    if v_previa->>'huella_solicitud' is distinct from v_huella then
      raise exception 'Clave de idempotencia reutilizada con otros datos o resultado antiguo sin huella. No se proceso ningun individuo.' using errcode = '22023';
    end if;
    return jsonb_build_object('procesados', (v_previa->>'procesados')::int, 'repetido', true);
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_ids) x where x is not null;
  if v_ids is null then
    raise exception 'No hay individuos seleccionados' using errcode = '22023';
  end if;
  if cardinality(v_ids) > limite_baja_en_lote() then
    raise exception 'Máximo % individuos por lote (llegaron %). Divide la selección.', limite_baja_en_lote(), cardinality(v_ids)
      using errcode = '22023';
  end if;

  select count(*) into v_recientes
  from audit_log
  where usuario_id = v_uid and accion = 'baja_lote' and ocurrido_en > now() - interval '60 seconds';
  if v_recientes >= 3 then
    raise exception 'Rate limit excedido: máximo 3 bajas en lote por minuto por usuario' using errcode = '58503';
  end if;

  -- Bloqueo antes de evaluar: nadie da de baja a uno de estos en paralelo.
  perform 1 from individuos where id = any(v_ids) order by id for update;

  select count(*), string_agg(coalesce(codigo_display, individuo_id::text) || ' (' || motivo_exclusion || ')', ', ')
    into v_excluidos, v_ejemplos
  from (select * from evaluar_baja_individuos(v_ids) where motivo_exclusion is not null order by codigo_display limit 5) e;
  if v_excluidos > 0 then
    select count(*) into v_excluidos from evaluar_baja_individuos(v_ids) where motivo_exclusion is not null;
    raise exception 'El lote incluye % individuo(s) que no se pueden dar de baja: %. No se procesó ninguno.', v_excluidos, v_ejemplos
      using errcode = '23514';
  end if;

  perform aplicar_baja_individuos(v_ids, p_estado, p_criterios, p_nota, p_fecha, p_idempotency_key);

  select array_agg(distinct planta_id) into v_plantas from individuos where id = any(v_ids);

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    case when cardinality(v_plantas) = 1 then v_plantas[1] end,
    'baja_lote',
    array['estado_vital', 'fecha_baja'],
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'huella_solicitud', v_huella,
      'procesados', cardinality(v_ids),
      'estado_vital', p_estado,
      'criterios', to_jsonb(p_criterios),
      'fecha_baja', p_fecha,
      'individuo_ids', to_jsonb(v_ids),
      'planta_ids', to_jsonb(v_plantas)
    )
  );

  return jsonb_build_object('procesados', cardinality(v_ids), 'repetido', false);
end;
$$;
