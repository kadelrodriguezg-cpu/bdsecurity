-- =============================================================================
-- MIGRACIÓN 20261026150000 — FASE 5, PASO 53: RETROCEDER LA FASE DE UN CRUCE (decisión G1)
--
-- Hallazgo 1 de la guía del administrador: con plantas creadas, la interfaz no
-- dejaba volver una fase aunque la base sí lo permite al admin (U-03). Un avance
-- por error de Evaluación anual a Multisitio cerraba la carga de las lecturas de
-- poscosecha que faltaban, sin vuelta atrás.
--
-- retroceder_fase_cruce(planta, fase_actual, motivo): solo admin; vuelve UNA fase;
-- motivo obligatorio; control de concurrencia por la fase que el admin tenía a la
-- vista; se niega si el cruce está archivado o si volver dejaría datos huérfanos:
--   Multisitio -> Evaluación anual: rondas de Multisitio o traslados registrados.
--   Evaluación anual -> Crecimiento: rondas de evaluación anual.
--   Crecimiento -> Trasplante: evaluaciones reducidas de Crecimiento.
--   Trasplante -> Germinación: plantas (individuos) creadas.
-- El cambio de fase queda auditado como siempre (trigger trg_plantas_audit_estado,
-- «cambio_estado») y, además, con una fila «retroceso_fase» que guarda el motivo.
--
-- poscosecha_incompleta_cruce(planta): cuántas plantas vivas tienen, en su última
-- ronda anual, la poscosecha empezada y sin terminar (alguna de las lecturas de
-- 15, 30 o 45 días, pero no las tres, juntando todas las visitas no anuladas), o
-- ninguna lectura cuando el protocolo vigente de esa ronda las pide. La usa el
-- aviso previo a pasar de Evaluación anual a Multisitio.
--
-- El trigger validar_orden_fases no cambia: un admin puede seguir cambiando la
-- fase con un UPDATE directo (lo usan la app anterior y las funciones de
-- reinicio y restauración); la app nueva retrocede solo por esta función.
-- Rollback: docs/fase5/rollback/53_retroceder_fase.sql
-- =============================================================================

create or replace function public.retroceder_fase_cruce(
  p_planta_id uuid,
  p_estado_actual public.estado_planta,
  p_motivo text
)
returns public.estado_planta
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planta record;
  v_fases public.estado_planta[] := enum_range(null::public.estado_planta);
  v_pos int;
  v_destino public.estado_planta;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_n bigint;
begin
  if not es_admin() then
    raise exception 'Solo un admin puede retroceder la fase de un cruce.' using errcode = '42501';
  end if;
  if v_motivo is null then
    raise exception 'Escribe el motivo para retroceder la fase.' using errcode = '22023';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'El motivo puede tener hasta 500 caracteres.' using errcode = '22023';
  end if;

  select id, estado, eliminado_at into v_planta from plantas where id = p_planta_id for update;
  if not found then
    raise exception 'El cruce no existe.' using errcode = 'P0002';
  end if;
  if v_planta.eliminado_at is not null then
    raise exception 'El cruce está archivado: restáuralo en Administrar cruces antes de cambiar su fase.' using errcode = '23514';
  end if;
  if v_planta.estado is distinct from p_estado_actual then
    raise exception 'La fase del cruce cambió desde otra sesión. Recarga la ficha antes de retroceder.' using errcode = '55000';
  end if;

  v_pos := array_position(v_fases, v_planta.estado);
  if v_pos is null or v_pos = 1 then
    raise exception 'Este cruce está en la primera fase: no hay una fase anterior.' using errcode = '22023';
  end if;
  v_destino := v_fases[v_pos - 1];

  -- Datos que quedarían sin su fase
  if v_planta.estado = 'traslado_destino' then
    select count(*) into v_n from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id
      where i.planta_id = p_planta_id and r.tipo_ronda = 'multisitio';
    if v_n > 0 then
      raise exception 'No se puede volver a Evaluación anual: ya hay rondas de Multisitio iniciadas en este cruce (%).', v_n using errcode = '23514';
    end if;
    select count(*) into v_n from (
      select e.id from emplazamiento_individuo e join individuos i on i.id = e.individuo_id where i.planta_id = p_planta_id
      union all
      select m.id from multisitio m join individuos i on i.id = m.individuo_id where i.planta_id = p_planta_id
    ) t;
    if v_n > 0 then
      raise exception 'No se puede volver a Evaluación anual: ya hay traslados de Multisitio registrados en este cruce (%).', v_n using errcode = '23514';
    end if;
  elsif v_planta.estado = 'evaluacion_anual' then
    select count(*) into v_n from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id
      where i.planta_id = p_planta_id and r.tipo_ronda = 'anual';
    if v_n > 0 then
      raise exception 'No se puede volver a Crecimiento: ya hay rondas de evaluación anual iniciadas en este cruce (%).', v_n using errcode = '23514';
    end if;
  elsif v_planta.estado = 'crecimiento' then
    select count(*) into v_n from evaluacion_reducida er join individuos i on i.id = er.individuo_id
      where i.planta_id = p_planta_id and er.fase = 'crecimiento';
    if v_n > 0 then
      raise exception 'No se puede volver a Trasplante: ya hay evaluaciones de Crecimiento registradas en este cruce (%).', v_n using errcode = '23514';
    end if;
  elsif v_planta.estado = 'trasplante' then
    select count(*) into v_n from individuos where planta_id = p_planta_id;
    if v_n > 0 then
      raise exception 'No se puede volver a Germinación: este cruce ya tiene plantas creadas en Trasplante (%).', v_n using errcode = '23514';
    end if;
  end if;

  update plantas set estado = v_destino where id = p_planta_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (auth.uid(), p_planta_id, 'retroceso_fase', array['estado'],
          jsonb_build_object('estado_anterior', v_planta.estado, 'estado_nuevo', v_destino, 'motivo', v_motivo));

  return v_destino;
end;
$$;

comment on function public.retroceder_fase_cruce(uuid, public.estado_planta, text) is
  'Fase 5 (G1): el admin vuelve UNA fase un cruce, con motivo obligatorio; se niega si quedarían datos huérfanos. Audita «retroceso_fase» con el motivo.';

revoke all on function public.retroceder_fase_cruce(uuid, public.estado_planta, text) from public, anon;
grant execute on function public.retroceder_fase_cruce(uuid, public.estado_planta, text) to authenticated;

create or replace function public.poscosecha_incompleta_cruce(p_planta_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  with ultima as (
    select distinct on (r.individuo_id) r.id, r.numero_ronda
    from ronda_evaluacion_anual r
    join individuos i on i.id = r.individuo_id
    where i.planta_id = p_planta_id and i.estado_vital = 'vivo' and r.tipo_ronda = 'anual'
    order by r.individuo_id, r.numero_ronda desc
  ),
  lecturas as (
    select u.id, u.numero_ronda,
      (bool_or(e.pct_buen_estado_15d is not null))::int
      + (bool_or(e.pct_buen_estado_30d is not null))::int
      + (bool_or(e.pct_buen_estado_45d is not null))::int as n
    from ultima u
    left join evaluaciones e on e.ronda_id = u.id and e.estado <> 'anulada'
    group by u.id, u.numero_ronda
  ),
  pide as (
    select distinct on (pr.numero_ronda) pr.numero_ronda,
      (pr.descriptores ?| array['pct_buen_estado_15d', 'pct_buen_estado_30d', 'pct_buen_estado_45d']) as pide
    from protocolo_ronda pr
    where pr.planta_id = p_planta_id and pr.tipo_ronda = 'anual'
    order by pr.numero_ronda, pr.version desc
  )
  select count(*)::int
  from lecturas l left join pide p on p.numero_ronda = l.numero_ronda
  where (l.n between 1 and 2) or (l.n = 0 and coalesce(p.pide, false));
$$;

comment on function public.poscosecha_incompleta_cruce(uuid) is
  'Fase 5 (hallazgo 1): plantas vivas con la poscosecha de su última ronda anual empezada y sin terminar, o sin lecturas cuando el protocolo vigente las pide. Aviso previo a pasar a Multisitio.';

revoke all on function public.poscosecha_incompleta_cruce(uuid) from public, anon;
grant execute on function public.poscosecha_incompleta_cruce(uuid) to authenticated;
