-- =============================================================================
-- MIGRACIÓN 20260812000200 — EVECL: exponer fecha_observada en las RPC
-- (Fix B, complemento de esquema — capa de API)
--
-- evecl_respuesta.fecha_observada (20260812000100) necesita un camino de
-- lectura y escritura para que DescriptorEstadoPicker pueda usarla.
-- evecl_obtener_ficha la agrega al jsonb de cada respuesta; evecl_guardar_ficha
-- la acepta como campo opcional de cada elemento de p_respuestas y la
-- persiste en el upsert. Mismas firmas — CREATE OR REPLACE, sin DROP.
-- =============================================================================

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
          'unidad', d.unidad, 'orden', d.orden
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

comment on function evecl_obtener_ficha is 'Ficha EVECL completa (ensayo + respuestas con descriptor resuelto, incluida fecha_observada). Filtra eliminado_at is null siempre — ver lección de obtener_planta() en 9.4.1.';


create or replace function evecl_guardar_ficha(
  p_id                bigint default null,
  p_ensayo_id         bigint default null,
  p_variedad          text default null,
  p_codigo_genotipo   text default null,
  p_origen_cruza      text default null,
  p_tipo              evecl_tipo_ficha default 'evaluacion',
  p_numero_repeticion int default null,
  p_codigo_planta     text default null,
  p_encargado         text default null,
  p_fecha_siembra     date default null,
  p_fecha_evaluacion  date default current_date,
  p_notas             text default null,
  p_respuestas        jsonb default '[]'::jsonb,
  p_idempotency_key   uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_id          bigint;
  v_created_by  uuid;
  v_respuesta   jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if p_idempotency_key is not null then
    select id into v_id from evecl_ficha where idempotency_key = p_idempotency_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  if p_id is not null then
    select created_by into v_created_by from evecl_ficha where id = p_id and eliminado_at is null;
    if v_created_by is null then
      raise exception 'Ficha % no encontrada', p_id using errcode = 'P0002';
    end if;
    if v_created_by <> v_uid and not es_admin() then
      raise exception 'Solo el autor de la ficha o un admin puede editarla' using errcode = '42501';
    end if;

    update evecl_ficha set
      ensayo_id          = coalesce(p_ensayo_id, ensayo_id),
      variedad           = coalesce(nullif(btrim(p_variedad), ''), variedad),
      codigo_genotipo    = p_codigo_genotipo,
      origen_cruza       = p_origen_cruza,
      tipo               = coalesce(p_tipo, tipo),
      numero_repeticion  = coalesce(p_numero_repeticion, numero_repeticion),
      codigo_planta      = p_codigo_planta,
      encargado          = p_encargado,
      fecha_siembra      = p_fecha_siembra,
      fecha_evaluacion   = coalesce(p_fecha_evaluacion, fecha_evaluacion),
      notas              = p_notas,
      updated_at         = now()
    where id = p_id;
    v_id := p_id;
  else
    if p_ensayo_id is null or coalesce(btrim(p_variedad), '') = '' or p_numero_repeticion is null then
      raise exception 'ensayo_id, variedad y numero_repeticion son obligatorios' using errcode = '23514';
    end if;

    begin
      insert into evecl_ficha (
        ensayo_id, variedad, codigo_genotipo, origen_cruza, tipo, numero_repeticion,
        codigo_planta, encargado, fecha_siembra, fecha_evaluacion, notas, created_by, idempotency_key
      ) values (
        p_ensayo_id, btrim(p_variedad), p_codigo_genotipo, p_origen_cruza, coalesce(p_tipo, 'evaluacion'),
        p_numero_repeticion, p_codigo_planta, p_encargado, p_fecha_siembra,
        coalesce(p_fecha_evaluacion, current_date), p_notas, v_uid,
        coalesce(p_idempotency_key, gen_random_uuid())
      )
      returning id into v_id;
    exception
      when unique_violation then
        if p_idempotency_key is not null then
          select id into v_id from evecl_ficha where idempotency_key = p_idempotency_key;
          if v_id is not null then return v_id; end if;
        end if;
        raise;
    end;
  end if;

  for v_respuesta in select * from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb))
  loop
    insert into evecl_respuesta (ficha_id, descriptor_id, nota, valor_numerico, valor_texto, foto_path, fecha_observada)
    values (
      v_id,
      (v_respuesta->>'descriptor_id')::bigint,
      (v_respuesta->>'nota')::int,
      (v_respuesta->>'valor_numerico')::numeric,
      v_respuesta->>'valor_texto',
      v_respuesta->>'foto_path',
      (v_respuesta->>'fecha_observada')::date
    )
    on conflict (ficha_id, descriptor_id) do update set
      nota             = excluded.nota,
      valor_numerico   = excluded.valor_numerico,
      valor_texto      = excluded.valor_texto,
      foto_path        = excluded.foto_path,
      fecha_observada  = excluded.fecha_observada,
      updated_at       = now();
  end loop;

  return v_id;
end;
$$;

comment on function evecl_guardar_ficha is 'Upsert de ficha EVECL + respuestas (incluida fecha_observada) en una transacción. Idempotente vía p_idempotency_key. No borra respuestas ausentes del array — formulario tolerante a lo parcial.';
