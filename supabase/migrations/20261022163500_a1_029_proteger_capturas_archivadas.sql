-- A1-029: una ficha archivada no admite ediciones ni capturas nuevas.
-- Restaurar es una operación separada; no cambia fase ni otros datos a la vez.
create or replace function public.proteger_ficha_archivada()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if auth.uid() is null or old.eliminado_at is null then return new; end if;
  if (to_jsonb(new) - 'updated_at' - 'eliminado_at')
    is distinct from (to_jsonb(old) - 'updated_at' - 'eliminado_at') then
    raise exception 'El cruce está archivado. Restáuralo antes de modificar su ficha.' using errcode = '55000';
  end if;
  if new.eliminado_at is null and not public.es_admin() then
    raise exception 'Solo un admin puede restaurar el cruce.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.proteger_ficha_archivada() from public, anon, authenticated;
create trigger plantas_proteger_archivada before update on public.plantas
for each row execute function public.proteger_ficha_archivada();

create or replace function public.proteger_captura_archivada()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_planta uuid;
  v_archivada timestamptz;
begin
  -- Mantenimiento privilegiado sin actor Auth conserva el camino de limpieza.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  -- Solo la RPC de purga, después de verificar admin/es_prueba/integridad,
  -- activa este contexto LOCAL para el cruce exacto y lo restaura al salir.
  if tg_op = 'DELETE' and public.es_admin()
    and current_setting('bdsecurity.purga_cruce', true) = old.planta_id::text
  then return old; end if;
  -- ON DELETE SET NULL debe conservar autoría histórica al borrar un perfil.
  -- No permite que un cliente quite la autoría de un perfil todavía existente.
  if tg_op = 'UPDATE' and to_jsonb(old)->>'created_by' is not null
    and to_jsonb(new)->>'created_by' is null
    and (to_jsonb(new) - 'created_by' - 'updated_at') = (to_jsonb(old) - 'created_by' - 'updated_at')
    and not exists(select 1 from public.perfiles where id = (to_jsonb(old)->>'created_by')::uuid)
  then return new; end if;
  for v_planta in
    select distinct id from unnest(array[case when tg_op = 'DELETE' then old.planta_id else new.planta_id end,
      case when tg_op = 'UPDATE' then old.planta_id end]) id
    where id is not null order by id
  loop
    select eliminado_at into v_archivada from public.plantas where id = v_planta for share;
    if v_archivada is not null then
      raise exception 'El cruce está archivado. Restáuralo antes de registrar, editar o quitar datos.' using errcode = '55000';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.proteger_captura_archivada() from public, anon, authenticated;
create trigger polinizacion_proteger_archivada before insert or update or delete on public.polinizacion_evento
for each row execute function public.proteger_captura_archivada();
create trigger cosecha_proteger_archivada before insert or update or delete on public.cosecha_fruto
for each row execute function public.proteger_captura_archivada();
create trigger germinacion_proteger_archivada before insert or update or delete on public.germinacion_evento
for each row execute function public.proteger_captura_archivada();
create trigger insumos_proteger_archivada before insert or update or delete on public.plantas_insumo
for each row execute function public.proteger_captura_archivada();
create trigger sustratos_proteger_archivada before insert or update or delete on public.plantas_sustrato
for each row execute function public.proteger_captura_archivada();
create trigger eventos_proteger_archivada before insert or update or delete on public.registros_evento
for each row execute function public.proteger_captura_archivada();

-- Misma purga existente: solo contexto acotado, sin cambiar gates ni ACL.
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
  v_contexto_purga_anterior text := current_setting('bdsecurity.purga_cruce', true);
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
    perform set_config('bdsecurity.purga_cruce', p_planta_id::text, true);
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

  if p_tipo = 'hard' then
    perform set_config('bdsecurity.purga_cruce', coalesce(v_contexto_purga_anterior, ''), true);
  end if;
  return jsonb_build_object('planta_id', p_planta_id, 'tipo', p_tipo, 'snapshot', v_snapshot);
end;
$$;

comment on function borrar_cruzamiento is 'Solo admin. soft: marca eliminado_at (recuperable), sirve para cualquier cruce. hard (purga irreversible): SOLO para cruces con es_prueba = true, y además rechaza si hay evaluaciones completa/corregida (datos reales colados) o historial territorial. Borra el cruce y todo lo que cuelga de él (incluido polinizacion_evento) en orden controlado, en una sola transacción. Audita snapshot completo ANTES de borrar en ambos casos.';
