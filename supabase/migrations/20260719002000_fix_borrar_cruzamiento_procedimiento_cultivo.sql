-- =============================================================================
-- MIGRACIÓN 20260719002000 — fix borrar_cruzamiento: falta procedimiento_cultivo
-- en el orden de borrado del hard delete.
--
-- Diagnóstico: `procedimiento_cultivo` (migración 20260719001000) referencia
-- `plantas` con ON DELETE RESTRICT, pero se creó DESPUÉS de que
-- `borrar_cruzamiento` (migración 20260717002000) ya tuviera fijo el orden de
-- DELETE del hard delete. Resultado: `delete from plantas` fallaba con FK
-- violation (23503) cada vez que el cruce tenía al menos un registro en
-- procedimiento_cultivo — el error que la UI traduce como "hace referencia a
-- un registro relacionado que no existe o fue eliminado".
--
-- No hay basura huérfana que limpiar: la función corre como una sola
-- transacción implícita (RPC de PostgREST), así que el fallo en el último
-- DELETE revertía TODO lo anterior dentro de la misma llamada, incluido el
-- insert en audit_log. Confirmado por query directa: los cruces de prueba
-- (Test 2, Test 5, Test ql) seguían con eliminado_at = null y sin ninguna
-- fila 'borrado_cruzamiento_%' en audit_log.
-- =============================================================================

create or replace function borrar_cruzamiento(p_planta_id uuid, p_tipo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_planta         plantas;
  v_n_individuos   int;
  v_n_evaluaciones int;
  v_n_pcr          int;
  v_n_rondas       int;
  v_n_eventos      int;
  v_snapshot       jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede borrar un cruzamiento' using errcode = '42501';
  end if;
  if p_tipo not in ('soft', 'hard') then
    raise exception 'p_tipo debe ser ''soft'' o ''hard'' (recibido: %)', p_tipo using errcode = '22023';
  end if;

  select * into v_planta from plantas where id = p_planta_id;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  select count(*) into v_n_individuos from individuos where planta_id = p_planta_id;
  select count(*) into v_n_evaluaciones
    from evaluaciones e join ronda_evaluacion_anual r on r.id = e.ronda_id join individuos i on i.id = r.individuo_id
    where i.planta_id = p_planta_id;
  select count(*) into v_n_pcr
    from pcr_analisis pc join ronda_evaluacion_anual r on r.id = pc.ronda_id join individuos i on i.id = r.individuo_id
    where i.planta_id = p_planta_id;
  select count(*) into v_n_rondas
    from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id
    where i.planta_id = p_planta_id;
  select count(*) into v_n_eventos from registros_evento where planta_id = p_planta_id;

  -- Snapshot ANTES de borrar (aunque sea hard delete), para que quede
  -- registro trazable de qué contenía el cruce.
  v_snapshot := jsonb_build_object(
    'codigo_sistema', v_planta.codigo_sistema,
    'estado', v_planta.estado,
    'especie_id', v_planta.especie_id,
    'n_individuos', v_n_individuos,
    'n_evaluaciones', v_n_evaluaciones,
    'n_pcr', v_n_pcr,
    'n_rondas', v_n_rondas,
    'n_registros_evento', v_n_eventos,
    'tipo_borrado', p_tipo
  );

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'borrado_cruzamiento_' || p_tipo, array['*'], v_snapshot);

  if p_tipo = 'soft' then
    update plantas set eliminado_at = now() where id = p_planta_id;
  else
    -- Hard delete controlado, en el orden correcto de dependencias (ver
    -- comentario de cabecera). plantas_insumo, plantas_sustrato,
    -- registros_evento (y su evento_archivos) y audit_log (set null) ya
    -- tienen ON DELETE CASCADE/SET NULL automático hacia plantas — no
    -- necesitan DELETE explícito.
    delete from evaluaciones
      where ronda_id in (select r.id from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id where i.planta_id = p_planta_id);
    delete from pcr_analisis
      where ronda_id in (select r.id from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id where i.planta_id = p_planta_id);
    delete from ronda_evaluacion_anual
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    delete from multisitio
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    delete from baja_motivo
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    delete from evaluacion_reducida
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    -- Rompe la autorreferencia de clones ANTES de borrar individuos (clon_de_id
    -- es ON DELETE RESTRICT): todos se borran juntos, no hace falta preservarla.
    update individuos set clon_de_id = null where planta_id = p_planta_id;
    delete from individuos where planta_id = p_planta_id;
    delete from germinacion_evento where planta_id = p_planta_id;
    delete from cosecha_fruto where planta_id = p_planta_id;
    -- procedimiento_cultivo (migración 20260719001000) referencia plantas
    -- con ON DELETE RESTRICT — faltaba acá, era la causa del FK violation.
    delete from procedimiento_cultivo where planta_id = p_planta_id;
    delete from plantas where id = p_planta_id;
  end if;

  return jsonb_build_object('planta_id', p_planta_id, 'tipo', p_tipo, 'snapshot', v_snapshot);
end;
$$;

comment on function borrar_cruzamiento is 'Solo admin. soft: marca eliminado_at (recuperable). hard: borra el cruce y todo lo que cuelga de él, en orden controlado (irreversible). Audita snapshot completo antes de borrar en ambos casos.';
