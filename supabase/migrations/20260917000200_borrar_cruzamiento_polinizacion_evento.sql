-- =============================================================================
-- MIGRACIÓN 20260917000200 — borrar_cruzamiento también borra
-- polinizacion_evento antes del hard-delete (Paso A, fix de integridad)
--
-- polinizacion_evento.planta_id es ON DELETE RESTRICT hacia plantas (mismo
-- criterio que germinacion_evento/cosecha_fruto). borrar_cruzamiento(...,
-- 'hard') ya borra esas dos tablas explícitamente antes de `delete from
-- plantas`, pero polinizacion_evento no existía cuando se escribió esa
-- función (20260717002000, con dos correcciones posteriores: 20260719002000
-- y 20260719027000; la puerta es_prueba se agregó en 20260907001000). Sin
-- este fix, purgar (hard) un cruce de prueba que ya tenga sesiones de
-- polinización cargadas falla con una violación de foreign key -- el mismo
-- patrón de desincronización que 20260719027000 documentó como recurrente
-- cada vez que se agrega una tabla con FK RESTRICT hacia plantas/individuos.
--
-- Redefine la función completa (mismo cuerpo que 20260907001000), sumando el
-- DELETE de polinizacion_evento junto a germinacion_evento/cosecha_fruto y su
-- conteo al snapshot auditado.
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
  v_n_polinizacion_eventos int;
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
    if not v_planta.es_prueba then
      raise exception 'El cruce «%» no está marcado como cruce de prueba, así que no se puede eliminar de forma permanente. Los cruces reales solo se archivan (acción reversible), porque su linaje genético es información histórica que no se destruye.', v_planta.codigo_sistema
        using errcode = '42501';
    end if;

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
  select count(*) into v_n_polinizacion_eventos from polinizacion_evento where planta_id = p_planta_id;

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
    'n_polinizacion_eventos', v_n_polinizacion_eventos,
    'tipo_borrado', p_tipo
  );

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'borrado_cruzamiento_' || p_tipo, array['*'], v_snapshot);

  if p_tipo = 'soft' then
    update plantas set eliminado_at = now() where id = p_planta_id;
  else
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
    delete from procedimiento_objetivos where planta_id = p_planta_id;
    delete from procedimiento_objetivos
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    update individuos set clon_de_id = null where planta_id = p_planta_id;
    delete from individuos where planta_id = p_planta_id;
    delete from germinacion_evento where planta_id = p_planta_id;
    delete from cosecha_fruto where planta_id = p_planta_id;
    delete from polinizacion_evento where planta_id = p_planta_id;
    delete from procedimiento_cultivo where planta_id = p_planta_id;
    delete from plantas where id = p_planta_id;
  end if;

  return jsonb_build_object('planta_id', p_planta_id, 'tipo', p_tipo, 'snapshot', v_snapshot);
end;
$$;

comment on function borrar_cruzamiento is 'Solo admin. soft: marca eliminado_at (recuperable), sirve para cualquier cruce. hard (purga irreversible): SOLO para cruces con es_prueba = true, y además rechaza si hay evaluaciones completa/corregida (datos reales colados) o historial territorial. Borra el cruce y todo lo que cuelga de él (incluido polinizacion_evento) en orden controlado, en una sola transacción. Audita snapshot completo ANTES de borrar en ambos casos.';
