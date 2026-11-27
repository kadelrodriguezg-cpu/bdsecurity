-- =============================================================================
-- MIGRACIÓN 20260811000600 — EVECL: RPC de mutación (Sprint E2, parte 3/3)
--
-- evecl_guardar_ficha (upsert ficha+respuestas, idempotente vía
-- p_idempotency_key), evecl_eliminar_ficha (soft delete) y
-- evecl_guardar_ensayo (upsert). Mismo patrón de ownership manual que las
-- RPC de consulta: SECURITY DEFINER bypassa RLS, así que cada función
-- repite a mano lo que la policy "autor o admin" haría.
-- =============================================================================


-- =============================================================================
-- evecl_guardar_ficha — upsert de ficha + respuestas en una transacción.
-- p_respuestas: array jsonb de {descriptor_id, nota?, valor_numerico?,
-- valor_texto?, foto_path?}. Solo agrega/actualiza lo enviado — no borra
-- respuestas ausentes del array (formulario tolerante a lo parcial, 9.5.4).
-- =============================================================================
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

  -- Idempotencia: un reintento con la MISMA key devuelve la ficha ya
  -- guardada en vez de duplicarla. Chequeado antes de validar el resto,
  -- mismo patrón que crear_procedimiento (20260720001000).
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
        -- Carrera real entre 2 requests con la misma key (o mismo
        -- ensayo+variedad+repetición): devolver lo que ya existe en vez de fallar.
        if p_idempotency_key is not null then
          select id into v_id from evecl_ficha where idempotency_key = p_idempotency_key;
          if v_id is not null then return v_id; end if;
        end if;
        raise;
    end;
  end if;

  for v_respuesta in select * from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb))
  loop
    insert into evecl_respuesta (ficha_id, descriptor_id, nota, valor_numerico, valor_texto, foto_path)
    values (
      v_id,
      (v_respuesta->>'descriptor_id')::bigint,
      (v_respuesta->>'nota')::int,
      (v_respuesta->>'valor_numerico')::numeric,
      v_respuesta->>'valor_texto',
      v_respuesta->>'foto_path'
    )
    on conflict (ficha_id, descriptor_id) do update set
      nota           = excluded.nota,
      valor_numerico = excluded.valor_numerico,
      valor_texto    = excluded.valor_texto,
      foto_path      = excluded.foto_path,
      updated_at     = now();
  end loop;

  return v_id;
end;
$$;

comment on function evecl_guardar_ficha is 'Upsert de ficha EVECL + respuestas en una transacción. Idempotente vía p_idempotency_key (mismo patrón que crear_procedimiento). No borra respuestas ausentes del array — formulario tolerante a lo parcial.';

revoke all on function evecl_guardar_ficha(bigint, bigint, text, text, text, evecl_tipo_ficha, int, text, text, date, date, text, jsonb, uuid) from public, anon;
grant execute on function evecl_guardar_ficha(bigint, bigint, text, text, text, evecl_tipo_ficha, int, text, text, date, date, text, jsonb, uuid) to authenticated, service_role;


-- =============================================================================
-- evecl_eliminar_ficha — soft delete (eliminado_at). Autor o admin.
-- =============================================================================
create or replace function evecl_eliminar_ficha(p_ficha_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_created_by uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select created_by into v_created_by from evecl_ficha where id = p_ficha_id and eliminado_at is null;
  if v_created_by is null then
    raise exception 'Ficha % no encontrada', p_ficha_id using errcode = 'P0002';
  end if;
  if v_created_by <> v_uid and not es_admin() then
    raise exception 'Solo el autor de la ficha o un admin puede eliminarla' using errcode = '42501';
  end if;

  update evecl_ficha set eliminado_at = now(), updated_at = now() where id = p_ficha_id;
end;
$$;

comment on function evecl_eliminar_ficha is 'Soft delete de una ficha EVECL (eliminado_at). Autor o admin.';

revoke all on function evecl_eliminar_ficha(bigint) from public, anon;
grant execute on function evecl_eliminar_ficha(bigint) to authenticated, service_role;


-- =============================================================================
-- evecl_guardar_ensayo — upsert de ensayo/parcela.
-- =============================================================================
create or replace function evecl_guardar_ensayo(
  p_id               bigint default null,
  p_codigo_parcela   text default null,
  p_nombre_productor text default null,
  p_empresa          text default null,
  p_encargado_predio text default null,
  p_localidad        text default null,
  p_direccion        text default null,
  p_latitud          numeric default null,
  p_longitud         numeric default null,
  p_area_evaluada    text default null,
  p_notas            text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_created_by uuid;
  v_id         bigint;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if p_id is not null then
    select created_by into v_created_by from evecl_ensayo where id = p_id and eliminado_at is null;
    if v_created_by is null then
      raise exception 'Ensayo % no encontrado', p_id using errcode = 'P0002';
    end if;
    if v_created_by <> v_uid and not es_admin() then
      raise exception 'Solo el autor del ensayo o un admin puede editarlo' using errcode = '42501';
    end if;

    update evecl_ensayo set
      codigo_parcela    = coalesce(nullif(btrim(p_codigo_parcela), ''), codigo_parcela),
      nombre_productor  = p_nombre_productor,
      empresa           = p_empresa,
      encargado_predio  = p_encargado_predio,
      localidad         = p_localidad,
      direccion         = p_direccion,
      latitud           = p_latitud,
      longitud          = p_longitud,
      area_evaluada     = p_area_evaluada,
      notas             = p_notas
    where id = p_id;
    v_id := p_id;
  else
    if coalesce(btrim(p_codigo_parcela), '') = '' then
      raise exception 'codigo_parcela es obligatorio' using errcode = '23514';
    end if;

    insert into evecl_ensayo (
      codigo_parcela, nombre_productor, empresa, encargado_predio, localidad,
      direccion, latitud, longitud, area_evaluada, notas, created_by
    ) values (
      btrim(p_codigo_parcela), p_nombre_productor, p_empresa, p_encargado_predio, p_localidad,
      p_direccion, p_latitud, p_longitud, p_area_evaluada, p_notas, v_uid
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

comment on function evecl_guardar_ensayo is 'Upsert de ensayo/parcela EVECL. Autor o admin en edición.';

revoke all on function evecl_guardar_ensayo(bigint, text, text, text, text, text, text, numeric, numeric, text, text) from public, anon;
grant execute on function evecl_guardar_ensayo(bigint, text, text, text, text, text, text, numeric, numeric, text, text) to authenticated, service_role;
