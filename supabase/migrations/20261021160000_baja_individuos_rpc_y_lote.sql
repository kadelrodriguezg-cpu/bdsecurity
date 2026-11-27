-- =============================================================================
-- MIGRACIÓN 20261021160000 — BAJA DE INDIVIDUOS POR RPC: INDIVIDUAL Y EN LOTE
--
-- Antes: la baja individual eran dos escrituras sueltas desde el cliente
-- (marcarBaja en frontend/src/api/individuos.ts): UPDATE de
-- individuos.estado_vital/fecha_baja y después INSERT en baja_motivo (una fila
-- por criterio). No era atómica (si el INSERT fallaba, el individuo quedaba de
-- baja sin motivo) y el RLS dejaba a cualquier autenticado insertar motivos a
-- cualquier individuo.
--
-- Ahora:
--   - validar_parametros_baja / evaluar_baja_individuos / aplicar_baja_individuos:
--     reglas y escritura en UN solo lugar. Las dos RPC las usan; no hay copias.
--   - marcar_baja_individuo: la baja de un individuo. Mismo permiso que antes
--     (autor del individuo o admin) y misma idempotencia por
--     (idempotency_key, criterio).
--   - previsualizar_baja_individuos + dar_baja_individuos: baja en lote, solo
--     admin, todo o nada, tope de lote (limite_baja_en_lote) y límite de
--     frecuencia por lote. Un individuo no elegible no se salta en silencio:
--     la previsualización lo informa y la RPC rechaza el lote completo.
--   - Se cierra el camino directo: authenticated ya no puede escribir
--     estado_vital/fecha_baja (ni al actualizar ni al crear un individuo) ni
--     insertar en baja_motivo.
--
-- Reglas (las mismas que aplicaba el cliente, sin agregar nuevas):
--   - el estado nuevo es descartado o muerto;
--   - al menos un criterio; la fecha es obligatoria; la nota es opcional y
--     común a todos los criterios;
--   - el individuo debe estar vivo (además lo exige el trigger
--     bloquear_rebaja_individuo: una baja no se deshace ni se rehace).
--   La baja en lote agrega: el cruce no puede estar archivado.
--
-- Auditoría: los triggers existentes siguen escribiendo una fila
-- edicion_individuo por individuo (estado anterior/nuevo) y una
-- creacion_baja_motivo por criterio. El lote suma una fila baja_lote de
-- resumen (mismo patrón que el importador B1).
--
-- La baja es irreversible por diseño (bloquear_rebaja_individuo): no existe
-- revertir lote.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tope de individuos por lote. Una función y no un número suelto, para
-- cambiarlo en un solo lugar (la previsualización lo informa al frontend).
-- 500 cubre un cruce completo con margen: el Documento Maestro registra
-- cruces de 110 individuos y tandas de ~300 etiquetas.
-- -----------------------------------------------------------------------------
create or replace function limite_baja_en_lote()
returns integer
language sql
immutable
as $$ select 500 $$;


create or replace function validar_parametros_baja(
  p_estado estado_vital,
  p_criterios criterio_baja[],
  p_fecha date
)
returns void
language plpgsql
immutable
as $$
begin
  if p_estado is null or p_estado not in ('descartado', 'muerto') then
    raise exception 'El estado de la baja debe ser descartado o muerto' using errcode = '22023';
  end if;
  if p_criterios is null or cardinality(array_remove(p_criterios, null)) = 0 then
    raise exception 'Selecciona al menos un criterio de baja.' using errcode = '22023';
  end if;
  if p_fecha is null then
    raise exception 'La fecha de la baja es obligatoria' using errcode = '22023';
  end if;
end;
$$;


-- Elegibilidad de cada id pedido. motivo_exclusion null = se puede dar de baja.
create or replace function evaluar_baja_individuos(p_ids uuid[])
returns table (
  individuo_id      uuid,
  codigo_display    text,
  planta_id         uuid,
  created_by        uuid,
  motivo_exclusion  text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pedidos.id,
    i.codigo_display,
    i.planta_id,
    i.created_by,
    case
      when i.id is null then 'no_existe'
      when i.estado_vital <> 'vivo' then 'ya_de_baja'
      when p.eliminado_at is not null then 'cruce_archivado'
    end
  from (select distinct unnest(p_ids) as id) pedidos
  left join individuos i on i.id = pedidos.id
  left join plantas p on p.id = i.planta_id
  where pedidos.id is not null;
$$;


-- Escritura común. Supone parámetros validados y elegibilidad ya comprobada.
-- Cada individuo usa su propia clave de idempotencia, derivada de forma
-- determinista de la del envío: el UNIQUE de baja_motivo es
-- (idempotency_key, criterio) y no incluye al individuo, así que una sola
-- clave para todo el lote chocaría consigo misma. Para un solo individuo la
-- clave derivada es la del envío (compatibilidad con la baja individual).
create or replace function aplicar_baja_individuos(
  p_ids uuid[],
  p_estado estado_vital,
  p_criterios criterio_baja[],
  p_nota text,
  p_fecha date,
  p_idempotency_key uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  update individuos
     set estado_vital = p_estado, fecha_baja = p_fecha
   where id = any(p_ids);

  insert into baja_motivo (individuo_id, criterio, nota, created_by, idempotency_key)
  select
    i.id,
    c.criterio,
    nullif(btrim(coalesce(p_nota, '')), ''),
    v_uid,
    case when cardinality(p_ids) = 1 then p_idempotency_key
         else md5(p_idempotency_key::text || i.id::text)::uuid end
  from unnest(p_ids) as i(id)
  cross join (select distinct unnest(array_remove(p_criterios, null)) as criterio) c;
end;
$$;

revoke all on function aplicar_baja_individuos(uuid[], estado_vital, criterio_baja[], text, date, uuid) from public, anon, authenticated;
revoke all on function evaluar_baja_individuos(uuid[]) from public, anon, authenticated;
grant execute on function evaluar_baja_individuos(uuid[]) to service_role;


-- -----------------------------------------------------------------------------
-- marcar_baja_individuo: baja de UN individuo (reemplaza las dos escrituras
-- del cliente). Permiso: autor del individuo o admin, igual que el RLS de
-- UPDATE que la cubría antes.
-- -----------------------------------------------------------------------------
create or replace function marcar_baja_individuo(
  p_individuo_id uuid,
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
  v_uid        uuid := auth.uid();
  v_individuo  record;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if p_idempotency_key is null then
    raise exception 'Falta la clave de idempotencia' using errcode = '22023';
  end if;
  perform validar_parametros_baja(p_estado, p_criterios, p_fecha);

  select * into v_individuo from evaluar_baja_individuos(array[p_individuo_id]);
  if v_individuo.motivo_exclusion = 'no_existe' then
    raise exception 'Individuo no encontrado' using errcode = 'P0002';
  end if;
  if v_individuo.created_by is distinct from v_uid and not es_admin() then
    raise exception 'Solo el autor del individuo o un admin puede darlo de baja' using errcode = '42501';
  end if;

  -- Reintento del mismo envío (PWA con mala señal): ya quedó aplicado.
  if exists (select 1 from baja_motivo
              where idempotency_key = p_idempotency_key and individuo_id = p_individuo_id) then
    return jsonb_build_object('individuo_id', p_individuo_id, 'repetido', true);
  end if;

  if v_individuo.motivo_exclusion = 'ya_de_baja' then
    raise exception 'Este individuo ya fue dado de baja — no se puede volver a dar de baja' using errcode = '42501';
  end if;

  perform 1 from individuos where id = p_individuo_id for update;
  perform aplicar_baja_individuos(array[p_individuo_id], p_estado, p_criterios, p_nota, p_fecha, p_idempotency_key);

  return jsonb_build_object('individuo_id', p_individuo_id, 'repetido', false);
end;
$$;

comment on function marcar_baja_individuo(uuid, estado_vital, criterio_baja[], text, date, uuid) is
  'Baja de un individuo en una transacción (estado_vital, fecha_baja y un motivo por criterio). Autor del individuo o admin. Idempotente por clave.';

revoke all on function marcar_baja_individuo(uuid, estado_vital, criterio_baja[], text, date, uuid) from public, anon;
grant execute on function marcar_baja_individuo(uuid, estado_vital, criterio_baja[], text, date, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- previsualizar_baja_individuos: qué se procesaría y qué no, con su motivo.
-- -----------------------------------------------------------------------------
create or replace function previsualizar_baja_individuos(p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede dar de baja en lote' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'limite', limite_baja_en_lote(),
      'procesables', coalesce(jsonb_agg(jsonb_build_object('id', e.individuo_id, 'codigo_display', e.codigo_display, 'planta_id', e.planta_id)
                                        order by e.codigo_display) filter (where e.motivo_exclusion is null), '[]'::jsonb),
      'excluidos', coalesce(jsonb_agg(jsonb_build_object('id', e.individuo_id, 'codigo_display', e.codigo_display, 'motivo', e.motivo_exclusion)
                                      order by e.codigo_display) filter (where e.motivo_exclusion is not null), '[]'::jsonb)
    )
    from evaluar_baja_individuos(coalesce(p_ids, '{}')) e
  );
end;
$$;

revoke all on function previsualizar_baja_individuos(uuid[]) from public, anon;
grant execute on function previsualizar_baja_individuos(uuid[]) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- dar_baja_individuos: baja en lote, solo admin, todo o nada.
-- -----------------------------------------------------------------------------
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

  -- Reintento del mismo lote: devuelve el resultado ya registrado.
  select detalle into v_previa
  from audit_log
  where usuario_id = v_uid and accion = 'baja_lote' and detalle->>'idempotency_key' = p_idempotency_key::text
  limit 1;
  if v_previa is not null then
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

comment on function dar_baja_individuos(uuid[], estado_vital, criterio_baja[], text, date, uuid) is
  'Solo admin. Da de baja un lote de individuos en una transacción (todo o nada). Rechaza el lote si alguno no es elegible. Tope limite_baja_en_lote(); 3 lotes por minuto. Irreversible.';

revoke all on function dar_baja_individuos(uuid[], estado_vital, criterio_baja[], text, date, uuid) from public, anon;
grant execute on function dar_baja_individuos(uuid[], estado_vital, criterio_baja[], text, date, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- Cierre del camino directo. Los grants de individuos eran de tabla completa:
-- se revoca la tabla y se vuelven a otorgar las columnas, sin las de la baja.
-- -----------------------------------------------------------------------------
revoke update on individuos from authenticated;
grant update (id, planta_id, codigo_display, clon_de_id, fecha_individualizacion, created_by, created_at, updated_at)
  on individuos to authenticated;

-- Tampoco se puede crear un individuo que ya nace de baja (sin motivo).
revoke insert on individuos from authenticated;
grant insert (id, planta_id, codigo_display, clon_de_id, fecha_individualizacion, created_by, created_at, updated_at)
  on individuos to authenticated;

-- baja_motivo: solo lo escriben las RPC. Antes cualquier autenticado podía
-- insertar motivos a cualquier individuo.
drop policy if exists baja_motivo_insert_autenticados on baja_motivo;
revoke insert on baja_motivo from authenticated;
