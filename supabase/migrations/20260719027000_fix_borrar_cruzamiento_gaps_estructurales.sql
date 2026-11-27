-- =============================================================================
-- Mid-fix — borrar_cruzamiento: 3 gaps estructurales encontrados en el orden
-- de hard-delete, reproducidos en producción (TEST-VERIF-20260716).
--
-- Diagnóstico real (no supuesto, confirmado con queries directas contra
-- producción antes de escribir esta migración):
--
--   - emplazamiento_individuo, procedimiento_objetivos y
--     ranking_snapshot_resultado referencian individuos/plantas con
--     ON DELETE RESTRICT, y ninguna de las 3 estaba en el orden de borrado
--     de hard-delete. Es el MISMO patrón que ya se había encontrado y
--     corregido una vez para procedimiento_cultivo (migración 20260719002000)
--     — la función lleva desincronizándose del esquema real cada vez que se
--     agrega una tabla nueva con FK RESTRICT hacia plantas/individuos, sin
--     que nadie la revisite. Documentado en el documento maestro como
--     patrón recurrente (mismo espíritu que la invalidación de queries).
--   - Confirmado con evidencia que el fallo es limpio, no deja basura: el
--     cruce de prueba real (TEST-VERIF-20260716) sigue con eliminado_at=null
--     y SIN entrada 'borrado_cruzamiento_hard' en audit_log — el INSERT de
--     auditoría (que corre ANTES que los DELETE) también se revirtió, o sea
--     la transacción completa hizo rollback, como corresponde a una sola
--     invocación de función plpgsql.
--   - Otros 3 cruces reales en producción (además de TEST-VERIF-20260716)
--     tienen el mismo problema latente si alguien intentara un hard-delete:
--     "prueba 2", "Test", "TEST-E2E-20260717". Ninguno tiene datos
--     corruptos hoy — es un riesgo latente, no una corrupción existente.
--
-- emplazamiento_individuo es un caso DISTINTO de los otros dos: no es un
-- DELETE faltante, es un trigger absoluto (bloquear_borrado_emplazamiento,
-- migración 20260719005000: "Los emplazamientos no se eliminan", sin
-- excepción, invariante deliberado de historial append-only territorial).
-- Decisión explícita: NO se levanta ese invariante bajo ninguna
-- circunstancia. En su lugar, hard-delete ahora RECHAZA de entrada
-- cualquier cruce con historial territorial, con mensaje claro que sugiere
-- soft-delete — nunca intenta forzar un DELETE que el propio esquema
-- prohíbe explícitamente.
--
-- procedimiento_objetivos y ranking_snapshot_resultado sí se agregan al
-- orden de DELETE (sin trigger bloqueante, gap real de cobertura). Se borra
-- solo lo que pertenece a ESTE cruce/sus individuos — ranking_snapshot (la
-- cabecera) puede ser de alcance especie (varios cruces en un mismo
-- snapshot) y NO se toca, solo sus filas resultado de este cruce.
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
  v_n_emplazamientos int;
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

  -- Historial territorial es append-only por invariante absoluto (trigger
  -- bloquear_borrado_emplazamiento) — nunca se puede purgar, así que un hard
  -- delete de un cruce con emplazamientos es, por diseño, irrealizable.
  -- Se rechaza acá, ANTES de intentar nada, en vez de dejar que el DELETE
  -- de más abajo choque con el trigger y devuelva un error críptico.
  if p_tipo = 'hard' then
    select count(*) into v_n_emplazamientos
      from emplazamiento_individuo ei join individuos i on i.id = ei.individuo_id
      where i.planta_id = p_planta_id;
    if v_n_emplazamientos > 0 then
      raise exception 'Este cruce tiene % registro(s) de historial territorial (traslados/multisitio), que nunca se elimina por diseño. No se puede hacer un borrado permanente — usa borrado suave (soft) en su lugar.', v_n_emplazamientos
        using errcode = '23514';
    end if;
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
    -- Hard delete controlado, en el orden correcto de dependencias.
    -- plantas_insumo, plantas_sustrato, registros_evento (y su
    -- evento_archivos) y audit_log (set null) ya tienen ON DELETE
    -- CASCADE/SET NULL automático hacia plantas — no necesitan DELETE
    -- explícito. emplazamiento_individuo ya se validó arriba: cero filas
    -- garantizado en este punto, no hace falta (ni se podría) borrarlo.

    -- ranking_snapshot_resultado referencia evaluaciones CON RESTRICT
    -- también — debe borrarse ANTES de evaluaciones, no después. Solo las
    -- filas resultado de este cruce; la cabecera ranking_snapshot puede
    -- ser de alcance especie (compartida con otros cruces) y no se toca.
    delete from ranking_snapshot_resultado
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
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
    -- procedimiento_objetivos: filas propias de este cruce, ya sea el
    -- objetivo directo (tipo='cruzamiento', planta_id) o vía sus individuos
    -- (tipo='individuo'). No se toca procedimientos (la cabecera, puede
    -- tener objetivos hacia otros predios/cruces) ni objetivos de otros.
    delete from procedimiento_objetivos where planta_id = p_planta_id;
    delete from procedimiento_objetivos
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    -- Rompe la autorreferencia de clones ANTES de borrar individuos (clon_de_id
    -- es ON DELETE RESTRICT): todos se borran juntos, no hace falta preservarla.
    update individuos set clon_de_id = null where planta_id = p_planta_id;
    delete from individuos where planta_id = p_planta_id;
    delete from germinacion_evento where planta_id = p_planta_id;
    delete from cosecha_fruto where planta_id = p_planta_id;
    delete from procedimiento_cultivo where planta_id = p_planta_id;
    delete from plantas where id = p_planta_id;
  end if;

  return jsonb_build_object('planta_id', p_planta_id, 'tipo', p_tipo, 'snapshot', v_snapshot);
end;
$$;

comment on function borrar_cruzamiento is 'Solo admin. soft: marca eliminado_at (recuperable). hard: borra el cruce y todo lo que cuelga de él, en orden controlado (irreversible) — rechaza de entrada si hay historial territorial (emplazamiento_individuo, nunca se elimina por diseño). Audita snapshot completo antes de borrar en ambos casos.';
