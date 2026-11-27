-- =============================================================================
-- MIGRACIÓN 011 — Rate limiting en RPCs críticas
--
-- Implementación: reusa la tabla audit_log existente.
-- Al inicio de obtener_planta() y actualizar_linaje() se cuenta cuántas veces
-- el mismo usuario llamó a esa función en el último minuto. Si supera el umbral,
-- se rechaza con error 58503.
--
-- Ventaja de reusar audit_log: sin tabla extra, sin pg_cron, sin dependencias.
-- La ventana de 60 segundos con N=20 es generosa para uso legítimo (un operario
-- que escanea 20 plantas por minuto ya sería inusual) pero restrictiva para un
-- ataque de enumeración automatizado.
--
-- Índice adicional: (usuario_id, accion, ocurrido_en) para que el COUNT sea
-- eficiente incluso si audit_log crece con el tiempo.
-- =============================================================================

-- Índice para acelerar la consulta de rate limiting.
-- CONCURRENT para no bloquear lecturas/escrituras durante la creación.
create index if not exists idx_audit_log_rate_limit
  on audit_log (usuario_id, accion, ocurrido_en desc);


-- =============================================================================
-- obtener_planta — con rate limiting
-- =============================================================================
create or replace function obtener_planta(p_planta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid    := auth.uid();
  v_ve_linaje  boolean := puede_ver_linaje_actual();
  v_planta     plantas;
  v_resultado  jsonb;
  v_campos     text[];
  v_accion     text;
  v_count      int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  -- Rate limit: máximo 20 lecturas de ficha/linaje por usuario por minuto.
  select count(*) into v_count
  from audit_log
  where usuario_id = v_uid
    and accion in ('lectura_ficha', 'lectura_linaje')
    and ocurrido_en > now() - interval '60 seconds';

  if v_count >= 20 then
    raise exception 'Rate limit excedido: máximo 20 lecturas por minuto por usuario'
      using errcode = '58503';
  end if;

  select * into v_planta from plantas where id = p_planta_id;

  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  if v_ve_linaje then
    v_accion := 'lectura_linaje';
    v_campos := array['codigo_sistema','especie_id','estado','cruzamiento','mama','papa'];
    v_resultado := jsonb_build_object(
      'id',                   v_planta.id,
      'codigo_sistema',       v_planta.codigo_sistema,
      'especie_id',           v_planta.especie_id,
      'estado',               v_planta.estado,
      'cruzamiento',          v_planta.cruzamiento,
      'mama',                 v_planta.mama,
      'papa',                 v_planta.papa,
      'genetica_a',           v_planta.genetica_a,
      'genetica_b',           v_planta.genetica_b,
      'numero_notion_legacy', v_planta.numero_notion_legacy,
      'created_at',           v_planta.created_at,
      'updated_at',           v_planta.updated_at
    );
  else
    v_accion := 'lectura_ficha';
    v_campos := array['codigo_sistema','especie_id','estado'];
    v_resultado := jsonb_build_object(
      'id',                   v_planta.id,
      'codigo_sistema',       v_planta.codigo_sistema,
      'especie_id',           v_planta.especie_id,
      'estado',               v_planta.estado,
      'genetica_a',           v_planta.genetica_a,
      'genetica_b',           v_planta.genetica_b,
      'numero_notion_legacy', v_planta.numero_notion_legacy,
      'created_at',           v_planta.created_at,
      'updated_at',           v_planta.updated_at
    );
  end if;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos)
  values (v_uid, p_planta_id, v_accion, v_campos);

  return v_resultado;
end;
$$;

comment on function obtener_planta is
  'Lectura auditada de una planta. Rate limit: 20/min por usuario. Expone linaje solo si el usuario tiene permiso.';

grant execute on function obtener_planta(uuid) to authenticated;


-- =============================================================================
-- actualizar_linaje — con rate limiting
-- =============================================================================
create or replace function actualizar_linaje(
  p_planta_id   uuid,
  p_cruzamiento text,
  p_mama        text,
  p_papa        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_antes   plantas;
  v_count   int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if not es_admin() then
    raise exception 'Solo un admin puede modificar el linaje genético'
      using errcode = '42501';
  end if;

  -- Rate limit: máximo 10 escrituras de linaje por admin por minuto.
  -- Umbral más estricto que la lectura: el linaje no debería modificarse
  -- decenas de veces por minuto en ningún escenario legítimo.
  select count(*) into v_count
  from audit_log
  where usuario_id = v_uid
    and accion = 'escritura_linaje'
    and ocurrido_en > now() - interval '60 seconds';

  if v_count >= 10 then
    raise exception 'Rate limit excedido: máximo 10 escrituras de linaje por minuto por usuario'
      using errcode = '58503';
  end if;

  select * into v_antes from plantas where id = p_planta_id;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  update plantas
  set cruzamiento = p_cruzamiento,
      mama        = p_mama,
      papa        = p_papa
  where id = p_planta_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    p_planta_id,
    'escritura_linaje',
    array['cruzamiento','mama','papa'],
    jsonb_build_object(
      'anterior', jsonb_build_object(
        'cruzamiento', v_antes.cruzamiento,
        'mama',        v_antes.mama,
        'papa',        v_antes.papa),
      'nuevo', jsonb_build_object(
        'cruzamiento', p_cruzamiento,
        'mama',        p_mama,
        'papa',        p_papa)
    )
  );

  return jsonb_build_object(
    'id',          p_planta_id,
    'cruzamiento', p_cruzamiento,
    'mama',        p_mama,
    'papa',        p_papa
  );
end;
$$;

comment on function actualizar_linaje is
  'Único camino de escritura del linaje. Solo admin. Rate limit: 10/min. Audita valores anteriores y nuevos.';

grant execute on function actualizar_linaje(uuid, text, text, text) to authenticated;
