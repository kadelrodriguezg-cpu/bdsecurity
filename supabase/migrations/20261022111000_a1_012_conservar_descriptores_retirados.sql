-- A1-012: conservar respuestas retiradas, mostrarlas y contar solo activas.

create or replace function evecl_obtener_ficha(p_ficha_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ficha     evecl_ficha;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select * into v_ficha from evecl_ficha where id = p_ficha_id and eliminado_at is null;
  if not found then
    raise exception 'Ficha % no encontrada', p_ficha_id using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'id',                v_ficha.id,
    'ensayo_id',          v_ficha.ensayo_id,
    'variedad',           v_ficha.variedad,
    'codigo_genotipo',    v_ficha.codigo_genotipo,
    'origen_cruza',       v_ficha.origen_cruza,
    'tipo',               v_ficha.tipo,
    'numero_repeticion',  v_ficha.numero_repeticion,
    'codigo_planta',      v_ficha.codigo_planta,
    'encargado',          v_ficha.encargado,
    'fecha_siembra',      v_ficha.fecha_siembra,
    'fecha_evaluacion',   v_ficha.fecha_evaluacion,
    'notas',              v_ficha.notas,
    'created_by',         v_ficha.created_by,
    'created_at',         v_ficha.created_at,
    'updated_at',         v_ficha.updated_at,
    'ensayo', (
      select jsonb_build_object(
        'id', e.id, 'codigo_parcela', e.codigo_parcela,
        'nombre_productor', e.nombre_productor, 'empresa', e.empresa,
        'localidad', e.localidad
      )
      from evecl_ensayo e
      where e.id = v_ficha.ensayo_id and e.eliminado_at is null
    ),
    'respuestas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'descriptor_id',    r.descriptor_id,
        'nota',             r.nota,
        'valor_numerico',   r.valor_numerico,
        'valor_texto',      r.valor_texto,
        'foto_path',        r.foto_path,
        'fecha_observada',  r.fecha_observada,
        'descriptor', jsonb_build_object(
          'nombre', d.nombre, 'tipo', d.tipo, 'eje', d.eje,
          'unidad', d.unidad, 'orden', d.orden, 'activo', d.activo
        )
      ) order by d.orden)
      from evecl_respuesta r
      join evecl_descriptor d on d.id = r.descriptor_id
      where r.ficha_id = v_ficha.id
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

create or replace function evecl_obtener_fichas(p_ensayo_id bigint default null, p_variedad text default null)
returns table (
  id                  bigint,
  ensayo_id           bigint,
  variedad            text,
  tipo                evecl_tipo_ficha,
  numero_repeticion   int,
  codigo_planta       text,
  fecha_evaluacion    date,
  respondidos         bigint,
  total_descriptores  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total bigint;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select count(*) into v_total from evecl_descriptor where activo;

  return query
  select
    f.id, f.ensayo_id, f.variedad, f.tipo, f.numero_repeticion, f.codigo_planta, f.fecha_evaluacion,
    count(r.id) FILTER (WHERE d.activo) as respondidos,
    v_total as total_descriptores
  from evecl_ficha f
  left join evecl_respuesta r on r.ficha_id = f.id
  left join evecl_descriptor d on d.id = r.descriptor_id
  where f.eliminado_at is null
    and (p_ensayo_id is null or f.ensayo_id = p_ensayo_id)
    and (p_variedad is null or lower(trim(f.variedad)) = lower(trim(p_variedad)))
  group by f.id
  order by f.variedad, f.numero_repeticion;
end;
$$;

-- Compatibilidad: la RPC existente conserva firma y comportamiento.
-- El cliente nuevo guarda ficha/respuestas y bajas en una sola transacción.
CREATE OR REPLACE FUNCTION public.evecl_guardar_ficha_con_bajas(
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
    -- Un formulario con catálogo viejo tampoco puede sobrescribir retiradas.
    -- Descriptor inexistente sigue hacia la RPC previa para que falle validación.
    p_respuestas => coalesce((
      SELECT jsonb_agg(t.respuesta)
      FROM jsonb_array_elements(coalesce(p_entrada->'p_respuestas', '[]'::jsonb)) AS t(respuesta)
      WHERE NOT EXISTS (SELECT 1 FROM public.evecl_descriptor d
        WHERE d.id = (t.respuesta->>'descriptor_id')::bigint AND NOT d.activo)
    ), '[]'::jsonb),
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
  WHERE ficha_id = v_id AND descriptor_id = ANY(coalesce(p_descriptores_eliminar, '{}'::bigint[]))
    AND EXISTS (SELECT 1 FROM public.evecl_descriptor d WHERE d.id = descriptor_id AND d.activo);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.evecl_guardar_ficha_con_bajas(jsonb,bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evecl_guardar_ficha_con_bajas(jsonb,bigint[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.evecl_guardar_ficha_con_bajas(jsonb,bigint[]) IS
  'Guarda mediante la RPC existente y elimina respuestas indicadas en la misma transacción. Revalida autoría incluso ante retorno idempotente. Storage se limpia solo tras éxito.';
