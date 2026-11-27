-- Compatibilidad: la RPC existente conserva firma y comportamiento.
-- El cliente nuevo guarda ficha/respuestas y bajas en una sola transacción.
CREATE FUNCTION public.evecl_guardar_ficha_con_bajas(
  p_entrada jsonb,
  p_descriptores_eliminar bigint[] DEFAULT '{}'
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_autor uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(p_entrada) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Entrada de ficha inválida' USING ERRCODE = '22023';
  END IF;
  v_id := public.evecl_guardar_ficha(
    p_id => (p_entrada->>'p_id')::bigint,
    p_ensayo_id => (p_entrada->>'p_ensayo_id')::bigint,
    p_variedad => p_entrada->>'p_variedad',
    p_codigo_genotipo => p_entrada->>'p_codigo_genotipo',
    p_origen_cruza => p_entrada->>'p_origen_cruza',
    p_tipo => coalesce((p_entrada->>'p_tipo')::public.evecl_tipo_ficha, 'evaluacion'),
    p_numero_repeticion => (p_entrada->>'p_numero_repeticion')::int,
    p_codigo_planta => p_entrada->>'p_codigo_planta',
    p_encargado => p_entrada->>'p_encargado',
    p_fecha_siembra => (p_entrada->>'p_fecha_siembra')::date,
    p_fecha_evaluacion => coalesce((p_entrada->>'p_fecha_evaluacion')::date, current_date),
    p_notas => p_entrada->>'p_notas',
    p_respuestas => coalesce(p_entrada->'p_respuestas', '[]'::jsonb),
    p_idempotency_key => (p_entrada->>'p_idempotency_key')::uuid
  );
  -- La RPC anterior puede devolver un id por idempotencia antes de validar
  -- autoría. Nunca usar ese retorno para borrar respuestas sin comprobarlo.
  SELECT created_by INTO v_autor FROM public.evecl_ficha
  WHERE id = v_id AND eliminado_at IS NULL FOR UPDATE;
  IF v_autor IS NULL THEN
    RAISE EXCEPTION 'Ficha no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_autor <> auth.uid() AND NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo el autor de la ficha o un admin puede editarla' USING ERRCODE = '42501';
  END IF;
  IF (p_entrada->>'p_id')::bigint IS NOT NULL AND (p_entrada->>'p_id')::bigint <> v_id THEN
    RAISE EXCEPTION 'La clave de idempotencia corresponde a otra ficha' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.evecl_respuesta
  WHERE ficha_id = v_id AND descriptor_id = ANY(coalesce(p_descriptores_eliminar, '{}'::bigint[]));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.evecl_guardar_ficha_con_bajas(jsonb,bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evecl_guardar_ficha_con_bajas(jsonb,bigint[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.evecl_guardar_ficha_con_bajas(jsonb,bigint[]) IS
  'Guarda mediante la RPC existente y elimina respuestas indicadas en la misma transacción. Revalida autoría incluso ante retorno idempotente. Storage se limpia solo tras éxito.';
