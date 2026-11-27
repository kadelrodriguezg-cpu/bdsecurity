-- =============================================================================
-- La purga irreversible queda restringida a cruces marcados como prueba.
--
-- CONTEXTO — qué ya existía y qué cambia acá.
--
-- El hard-delete NO es nuevo: `borrar_cruzamiento(p_planta_id, 'hard')` existe
-- desde 20260717002000 y su orden de cascada se corrigió dos veces
-- (20260719002000, 20260719027000). Ya era solo-admin, ya era transaccional,
-- ya escribía el audit_log ANTES de los DELETE, y la UI ya exigía tipear el
-- codigo_sistema exacto. Lo que faltaba era la puerta: hasta hoy cualquier
-- admin podía purgar CUALQUIER cruce, incluido uno real.
--
-- El invariante 5 del documento maestro ("sin hard-delete de individuos, la FK
-- a plantas sobrevive siempre") protege linaje genético real — activo sensible
-- de espionaje industrial, con valor histórico años después. Un cruce de
-- prueba nunca tuvo ese valor. Esta migración no relaja el invariante: lo
-- APRIETA para los datos reales (antes había una ruta de purga abierta para
-- ellos, ahora no hay ninguna) y abre una vía angosta solo para es_prueba.
--
-- POR QUÉ SE MODIFICA ESTA FUNCIÓN Y NO SE CREA UNA NUEVA.
--
-- La tentación era una `purgar_cruce_prueba()` separada. Se descartó a
-- propósito: el orden de DELETE de esta función es el activo frágil del
-- sistema — se desincronizó del esquema real DOS veces, cada vez que se
-- agregó una tabla con FK RESTRICT hacia plantas/individuos (documentado en
-- 20260719027000 como patrón recurrente). Duplicarlo garantizaría una tercera
-- desincronización, esta vez silenciosa. Se mantiene UN solo camino de
-- escritura; la separación que pide el negocio ("acción aparte de
-- Archivar/Restaurar") es de UI, no de esquema — mismo criterio que la
-- decisión 2.3 del documento maestro (una tabla, dos secciones de UI).
--
-- LAS TRES PUERTAS DEL HARD-DELETE, en orden de evaluación:
--
--   1. es_prueba = true. Sin esto no se purga nada, ni siendo admin. Como
--      `es_prueba` no tiene grant de UPDATE para `authenticated` (migración
--      20260907000000), un cruce real no puede ser re-marcado para saltar
--      esta puerta desde la API.
--   2. Cero evaluaciones con datos reales. Heurística explícita: evaluación
--      en estado 'completa' o 'corregida'. Fundamento: 'borrador' es trabajo
--      a medias (autosave, formularios abiertos) y 'anulada' ya fue
--      descartada por un humano — ninguna de las dos representa un dato
--      científico vivo. Cualquier otra sí. Esto es lo que previene el caso
--      ya conocido de "cruce de prueba con individuos reales colgando":
--      alguien evaluó de verdad sobre un cruce marcado como prueba, y esos
--      datos no se pueden perder por un descuido.
--   3. Cero historial territorial. Puerta preexistente, sin cambios:
--      emplazamiento_individuo es append-only por trigger absoluto.
--
-- AUDITORÍA. El INSERT en audit_log sigue ocurriendo ANTES de los DELETE (si
-- la cascada fallara a mitad, la transacción entera revierte y no queda traza
-- huérfana; verificado empíricamente en 20260719027000). Se agregan al
-- snapshot `planta_id` como texto y `es_prueba`: audit_log.planta_id es
-- FK ON DELETE SET NULL, así que tras un hard-delete exitoso la columna queda
-- en NULL y el único registro de QUÉ cruce se purgó es el detalle jsonb.
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
  v_n_eval_reales  int;
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

  if p_tipo = 'hard' then
    -- PUERTA 1 — solo cruces de prueba. Un cruce real no se purga nunca, ni
    -- siendo admin: su linaje es el activo que el sistema existe para
    -- proteger. Para sacarlo de circulación está el archivado, que es
    -- reversible y no destruye nada.
    if not v_planta.es_prueba then
      raise exception 'El cruce «%» no está marcado como cruce de prueba, así que no se puede eliminar de forma permanente. Los cruces reales solo se archivan (acción reversible), porque su linaje genético es información histórica que no se destruye.', v_planta.codigo_sistema
        using errcode = '42501';
    end if;

    -- PUERTA 2 — evaluaciones con datos reales. 'borrador' (trabajo a medias)
    -- y 'anulada' (ya descartada por un humano) no bloquean; cualquier otra sí.
    -- La UI cuenta esto mismo ANTES de ofrecer el botón: si cambia la
    -- heurística acá, hay que cambiarla también en
    -- frontend/src/api/cruzamientosAdmin.ts (resumenParaBorrado).
    select count(*) into v_n_eval_reales
      from evaluaciones e
      join ronda_evaluacion_anual r on r.id = e.ronda_id
      join individuos i on i.id = r.individuo_id
      where i.planta_id = p_planta_id
        and e.estado in ('completa', 'corregida');
    if v_n_eval_reales > 0 then
      raise exception 'Este cruce está marcado como prueba, pero tiene % evaluación(es) terminada(s) (completa o corregida) — o sea, alguien registró datos reales sobre él. No se elimina: revisa esas evaluaciones antes de purgar, o archiva el cruce en su lugar.', v_n_eval_reales
        using errcode = '23514';
    end if;

    -- PUERTA 3 — historial territorial, append-only por invariante absoluto
    -- (trigger bloquear_borrado_emplazamiento). Un hard delete de un cruce con
    -- emplazamientos es, por diseño, irrealizable. Se rechaza acá, ANTES de
    -- intentar nada, en vez de dejar que el DELETE choque con el trigger y
    -- devuelva un error críptico.
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
  -- registro trazable de qué contenía el cruce. planta_id va como texto
  -- porque audit_log.planta_id es FK ON DELETE SET NULL: tras un hard-delete
  -- exitoso, la columna queda NULL y este jsonb es la única traza de cuál era.
  v_snapshot := jsonb_build_object(
    'planta_id', p_planta_id::text,
    'codigo_sistema', v_planta.codigo_sistema,
    'es_prueba', v_planta.es_prueba,
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

comment on function borrar_cruzamiento is 'Solo admin. soft: marca eliminado_at (recuperable), sirve para cualquier cruce. hard (purga irreversible): SOLO para cruces con es_prueba = true, y además rechaza si hay evaluaciones completa/corregida (datos reales colados) o historial territorial. Borra el cruce y todo lo que cuelga de él en orden controlado, en una sola transacción. Audita snapshot completo ANTES de borrar en ambos casos.';
