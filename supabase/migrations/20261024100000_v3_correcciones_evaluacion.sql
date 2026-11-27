-- =============================================================================
-- MIGRACIÓN 20261024100000 — HISTORIAL DE CORRECCIONES DE EVALUACIONES (v3, decisión A8; docs/rediseno_v3/corregir.md)
--
-- La corrección ya existía en la base: un admin actualiza una evaluación cerrada, la deja `corregida` y escribe un
-- motivo (triggers validar_evaluacion_integridad y validar_ciclo_evaluacion; RLS evaluaciones_update_borrador_o_admin).
-- Faltaba que el historial del individuo mostrara a todos quién corrigió, cuándo y por qué:
--   - el operario no puede leer audit_log (solo el admin);
--   - una segunda corrección (corregida -> corregida) no escribe cambio_estado_evaluacion, y edicion_evaluacion solo
--     trae el motivo si el texto cambió.
-- Esta migración agrega:
--   1. Trigger trg_evaluaciones_auditar_correccion: cada corrección de una evaluación cerrada escribe en audit_log una
--      fila 'correccion_evaluacion' (quién, motivo, individuo y los NOMBRES de los campos cambiados, no los valores).
--      No cambia ninguna regla de quién puede corregir.
--   2. obtener_correcciones_individuo(p_individuo_id): las correcciones del individuo con fecha, nombre de quien
--      corrigió (solo el nombre, como N15), motivo y campos cambiados. Cualquier usuario autenticado.
--
--   3. (v3 paso 7, decisión N30) validar_ciclo_evaluacion deja que el ADMIN corrija una evaluación cerrada aunque el
--      cruce ya haya cambiado de fase: solo la corrección (completa -> corregida o corregida -> corregida) de la misma
--      fila, sin moverla de ronda. Crear evaluaciones o borradores fuera de la fase sigue bloqueado. El motivo lo sigue
--      exigiendo validar_evaluacion_integridad.
--   4. (v3 paso 8, decisión N37) La corrección del admin también vale con el individuo dado de baja; con el cruce
--      archivado NO, y el mensaje lo dice claro.
--
-- Paquete: parte del despliegue de v3 (docs/rediseno_v3/paquete_v3.md). No se aplica sola. Va después de 20261024090000.
-- =============================================================================

create or replace function public.validar_ciclo_evaluacion()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare
  v_ronda uuid;
  v_individuo uuid;
  v_tipo text;
  v_planta uuid;
  v_vital public.estado_vital;
  v_estado public.estado_planta;
  v_archivado timestamptz;
  v_es_correccion boolean;
begin
  if auth.uid() is null then return new; end if;
  -- Conserva la limpieza FK de autoría; no habilita cambios de autor por API.
  if tg_op = 'UPDATE' and old.created_by is not null and new.created_by is null
    and (to_jsonb(new) - 'created_by' - 'updated_at') = (to_jsonb(old) - 'created_by' - 'updated_at')
    and not exists(select 1 from public.perfiles where id = old.created_by)
  then return new; end if;
  -- N30 (v3): corrección de una evaluación cerrada por un admin, en la misma ronda. Solo se salta el chequeo de fase.
  v_es_correccion := tg_op = 'UPDATE'
    and old.estado in ('completa', 'corregida')
    and new.estado = 'corregida'
    and new.ronda_id = old.ronda_id
    and public.es_admin();
  for v_ronda in select distinct id from unnest(array[new.ronda_id,
    case when tg_op = 'UPDATE' then old.ronda_id end]) id where id is not null order by id
  loop
    select individuo_id, tipo_ronda::text into v_individuo, v_tipo
      from public.ronda_evaluacion_anual where id = v_ronda for share;
    if not found then raise exception 'La ronda no existe.' using errcode = 'P0002'; end if;
    select planta_id, estado_vital into v_planta, v_vital
      from public.individuos where id = v_individuo for share;
    -- N37 (v3): la corrección del admin vale aunque el individuo esté dado de baja.
    if v_vital <> 'vivo' and not v_es_correccion then
      raise exception 'El individuo no está vivo. No se puede guardar la evaluación.' using errcode = '42501';
    end if;
    select estado, eliminado_at into v_estado, v_archivado
      from public.plantas where id = v_planta for share;
    if v_archivado is not null then
      if v_es_correccion then
        raise exception 'El cruce está archivado: sus evaluaciones no se pueden corregir. Restáuralo en Administrar cruces y vuelve a intentarlo.' using errcode = '55000';
      end if;
      raise exception 'El cruce está archivado. Restáuralo antes de guardar la evaluación.' using errcode = '55000';
    end if;
    if not v_es_correccion and (
      (v_tipo = 'anual' and v_estado <> 'evaluacion_anual')
      or (v_tipo = 'multisitio' and v_estado <> 'traslado_destino')) then
      raise exception 'La fase del cruce no permite guardar evaluaciones de esta ronda.' using errcode = '55000';
    end if;
  end loop;
  return new;
end;
$function$;

comment on function public.validar_ciclo_evaluacion() is 'Rechaza guardar evaluaciones con el individuo no vivo, el cruce archivado o fuera de la fase de la ronda. v3 (N30, N37, 20261024100000): la corrección de una evaluación cerrada por un admin (misma ronda) no exige la fase ni que el individuo esté vivo; con el cruce archivado se rechaza con un mensaje propio.';
revoke all on function public.validar_ciclo_evaluacion() from public, anon, authenticated;

create or replace function public.auditar_correccion_evaluacion()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_individuo_id uuid;
  v_planta_id    uuid;
  v_campos       text[];
begin
  if new.estado <> 'corregida' or old.estado not in ('completa', 'corregida') then
    return new;
  end if;

  select r.individuo_id, i.planta_id into v_individuo_id, v_planta_id
  from ronda_evaluacion_anual r
  join individuos i on i.id = r.individuo_id
  where r.id = new.ronda_id;

  -- Solo los nombres de los campos que cambiaron (los valores quedan en edicion_evaluacion, que lee solo el admin).
  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_campos
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'estado', 'motivo_cambio', 'requiere_revision', 'anio', 'capturada_at');

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    auth.uid(),
    v_planta_id,
    'correccion_evaluacion',
    array['estado', 'motivo_cambio'],
    jsonb_build_object(
      'evaluacion_id', new.id,
      'ronda_id', new.ronda_id,
      'individuo_id', v_individuo_id,
      'estado_anterior', old.estado,
      'motivo', new.motivo_cambio,
      'campos', to_jsonb(v_campos)
    )
  );
  return new;
end;
$function$;

comment on function public.auditar_correccion_evaluacion() is 'v3 (A8, 20261024100000): cada corrección de una evaluación cerrada deja una fila correccion_evaluacion en audit_log con quién, motivo, individuo y los nombres de los campos cambiados.';
revoke all on function public.auditar_correccion_evaluacion() from public, anon, authenticated;

drop trigger if exists trg_evaluaciones_auditar_correccion on public.evaluaciones;
create trigger trg_evaluaciones_auditar_correccion
  after update on public.evaluaciones
  for each row execute function public.auditar_correccion_evaluacion();

create or replace function public.obtener_correcciones_individuo(p_individuo_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not exists (select 1 from individuos where id = p_individuo_id) then
    raise exception 'Individuo no encontrado' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'evaluacion_id', (a.detalle->>'evaluacion_id')::uuid,
      'fecha', a.ocurrido_en,
      'corregido_por', coalesce(p.nombre, 'Usuario eliminado'),
      'motivo', a.detalle->>'motivo',
      'campos', coalesce(a.detalle->'campos', '[]'::jsonb)
    ) order by a.ocurrido_en desc, a.id desc)
    from audit_log a
    left join perfiles p on p.id = a.usuario_id
    where a.accion = 'correccion_evaluacion'
      and a.detalle->>'individuo_id' = p_individuo_id::text
  ), '[]'::jsonb);
end;
$function$;

comment on function public.obtener_correcciones_individuo(uuid) is 'v3 (A8, 20261024100000): correcciones de las evaluaciones de un individuo (fecha, nombre de quien corrigió, motivo y nombres de campos cambiados). Cualquier autenticado; no expone linaje ni el resto de audit_log.';
revoke all on function public.obtener_correcciones_individuo(uuid) from public, anon;
grant execute on function public.obtener_correcciones_individuo(uuid) to authenticated, service_role;
