-- =============================================================================
-- Idempotencia de submit para las 4 tablas de escritura crítica sin
-- protección contra reintento (auditoría pre-lanzamiento). Confirmado
-- empíricamente ANTES de esta migración: 2 inserts idénticos para la misma
-- ronda_id en `evaluaciones` se aceptaban sin rechazo -- la única protección
-- existente era `disabled={isPending}` en el cliente, que no sobrevive a un
-- reintento de red real (mala señal en terreno) ni a doble tap.
--
-- Esto NO es una restricción de dominio. Varias evaluaciones reales para la
-- misma ronda del mismo individuo son legítimas y esperadas (evaluaciones
-- espaciadas meses aparte dentro de la misma ronda anual, series temporales
-- de 2.2/2.8). `idempotency_key` identifica el INTENTO de guardado, no el
-- contenido: se genera una vez al montar el formulario (no en cada click) y
-- se reusa en reintentos de ESE intento; una evaluación nueva y real usa una
-- key nueva porque viene de un montaje nuevo del formulario. No se toca
-- `ronda_evaluacion_anual`/`emplazamiento_individuo` -- confirmado que sus
-- UNIQUE/índice parcial son invariantes de dominio (una ronda por
-- individuo+tipo+número; un emplazamiento activo por individuo), un patrón
-- distinto al de idempotencia de submit; no existía ningún patrón
-- reutilizable de idempotency_key en el proyecto antes de esta migración.
-- =============================================================================

alter table evaluaciones add column idempotency_key uuid not null default gen_random_uuid();
alter table evaluaciones add constraint evaluaciones_idempotency_key_key unique (idempotency_key);
comment on column evaluaciones.idempotency_key is
  'Identifica el intento de guardado (generado una vez al montar el formulario), no el contenido. Protege contra duplicados por reintento de red/doble-tap -- no limita cuántas evaluaciones reales puede tener una ronda.';

alter table pcr_analisis add column idempotency_key uuid not null default gen_random_uuid();
alter table pcr_analisis add constraint pcr_analisis_idempotency_key_key unique (idempotency_key);
comment on column pcr_analisis.idempotency_key is
  'Identifica el intento de guardado. Mismo patrón que evaluaciones.idempotency_key.';

alter table procedimientos add column idempotency_key uuid not null default gen_random_uuid();
alter table procedimientos add constraint procedimientos_idempotency_key_key unique (idempotency_key);
comment on column procedimientos.idempotency_key is
  'Identifica el intento de guardado. Mismo patrón que evaluaciones.idempotency_key.';

-- baja_motivo: una sola "baja" real inserta VARIAS filas (una por criterio
-- elegido -- junction table, no enum-array) que comparten la MISMA key. El
-- UNIQUE es compuesto (key, criterio), no solo (key), para no bloquear los N
-- criterios de un mismo envío real entre sí -- solo rechaza el reintento
-- exacto (misma key + mismo criterio).
alter table baja_motivo add column idempotency_key uuid not null default gen_random_uuid();
alter table baja_motivo add constraint baja_motivo_idempotency_key_criterio_key unique (idempotency_key, criterio);
comment on column baja_motivo.idempotency_key is
  'Identifica el intento de guardado -- compartida por todas las filas (una por criterio) de UNA marcación de baja. UNIQUE compuesto con criterio, no solo con la key.';

-- crear_procedimiento cambia de firma (se agrega p_idempotency_key) --
-- CREATE OR REPLACE no permite agregar parámetros: dejaría un segundo
-- overload con la firma vieja, todavía invocable, sin la protección. Mismo
-- patrón ya usado en este proyecto para cambios de firma (20260719000500,
-- 20260719013000): DROP explícito de la firma anterior antes de recrear.
drop function if exists crear_procedimiento(text, text, date, date, text, jsonb, jsonb, uuid);

create or replace function crear_procedimiento(
  p_nombre text,
  p_tipo text,
  p_fecha_inicio date,
  p_fecha_fin date default null,
  p_notas text default null,
  p_objetivos jsonb default '[]'::jsonb,
  p_insumos jsonb default '[]'::jsonb,
  p_responsable_id uuid default null,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_responsable uuid;
  v_id uuid;
  v_planta_id uuid;
  v_existente_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;

  -- Idempotencia: un reintento con la MISMA key devuelve el procedimiento ya
  -- creado en vez de duplicarlo -- chequeado ANTES de validar el resto para
  -- que un reintento nunca falle por datos que ya pasaron la validación la
  -- vez anterior.
  if p_idempotency_key is not null then
    select id into v_existente_id from procedimientos where idempotency_key = p_idempotency_key;
    if v_existente_id is not null then
      return v_existente_id;
    end if;
  end if;

  if coalesce(btrim(p_nombre), '') = '' or coalesce(btrim(p_tipo), '') = '' or p_fecha_inicio is null then
    raise exception 'Nombre, tipo y fecha de inicio son obligatorios' using errcode = '23514';
  end if;
  if p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha de término no puede anteceder al inicio' using errcode = '22007';
  end if;
  if p_responsable_id is not null and p_responsable_id <> v_uid and not es_admin() then
    raise exception 'Solo admin puede asignar un responsable distinto al creador' using errcode = '42501';
  end if;
  v_responsable := coalesce(p_responsable_id, v_uid);
  perform 1 from perfiles where id = v_responsable;
  if not found then raise exception 'Responsable no encontrado' using errcode = '23503'; end if;

  begin
    insert into procedimientos (nombre, tipo, fecha_inicio, fecha_fin, notas, responsable_id, created_by, idempotency_key)
    values (btrim(p_nombre), btrim(p_tipo), p_fecha_inicio, p_fecha_fin, nullif(btrim(p_notas), ''), v_responsable, v_uid, coalesce(p_idempotency_key, gen_random_uuid()))
    returning id into v_id;
  exception
    when unique_violation then
      -- Carrera real entre 2 requests concurrentes con la misma key: el
      -- chequeo de arriba no llegó a tiempo, pero el UNIQUE de la tabla sí
      -- la atajó. Mismo resultado que el camino normal: devolver la fila que
      -- ya creó el otro request en vez de fallar.
      select id into v_id from procedimientos where idempotency_key = p_idempotency_key;
      if v_id is null then raise; end if;
      return v_id;
  end;

  perform reemplazar_objetivos_procedimiento(v_id, p_objetivos);
  perform reemplazar_insumos_procedimiento(v_id, p_insumos);
  v_planta_id := procedimiento_planta_auditable(v_id);

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, v_planta_id, 'creacion_procedimiento', array['tipo', 'estado', 'responsable_id'],
    jsonb_build_object('procedimiento_id', v_id, 'responsable_id', v_responsable));
  return v_id;
end;
$$;

comment on function crear_procedimiento is 'Crea un procedimiento con objetivos/insumos. Idempotente vía p_idempotency_key: un reintento con la misma key devuelve el id ya creado en vez de duplicar.';

revoke all on function crear_procedimiento(text, text, date, date, text, jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function crear_procedimiento(text, text, date, date, text, jsonb, jsonb, uuid, uuid) to authenticated, service_role;
