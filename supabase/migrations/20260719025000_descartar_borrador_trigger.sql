-- =============================================================================
-- Sprint 9 (calidad) — el trigger de integridad también bloqueaba el
-- autodescarte, no solo la RLS.
--
-- La migración anterior (20260719024000) amplió la policy RLS
-- evaluaciones_update_borrador_o_admin para permitir que el autor
-- transicione su propio borrador a 'anulada'. Probado en vivo (RLS suite):
-- la policy ya lo permitía, pero el trigger validar_evaluacion_integridad()
-- (BEFORE UPDATE) tiene su propio guardia independiente —
-- "Solo un admin puede corregir o anular una evaluacion" — que seguía
-- rechazando la transición. Dos capas de defensa distintas, hay que ajustar
-- ambas.
--
-- Fix: excepción estrecha, no una relajación general. Se agrega UNA
-- condición extra al mismo IF: además de es_admin(), también se permite
-- cuando la fila pasa exactamente de estado='borrador' a 'anulada' Y quien
-- escribe es el mismo created_by de la fila. Cualquier otra combinación
-- (corregida, anulada desde completa/corregida, o anular el borrador de
-- otro usuario) sigue rechazada exactamente igual que antes.
-- =============================================================================

create or replace function validar_evaluacion_integridad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_especie_id uuid;
  v_revision boolean := false;
  v_rango rango_referencia;
begin
  -- Fuente temporal unica: fecha efectiva.
  new.anio := extract(year from new.fecha)::integer;
  new.updated_at := now();

  if tg_op = 'INSERT' and new.estado in ('corregida', 'anulada') and not es_admin() then
    raise exception 'Solo un admin puede crear una correccion o anulacion' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if old.estado in ('completa', 'corregida', 'anulada') and not es_admin() then
      raise exception 'Solo un admin puede modificar una evaluacion cerrada' using errcode = '42501';
    end if;
    if new.estado in ('corregida', 'anulada')
       and new.estado is distinct from old.estado
       and not es_admin()
       and not (new.estado = 'anulada' and old.estado = 'borrador' and old.created_by = auth.uid()) then
      raise exception 'Solo un admin puede corregir o anular una evaluacion' using errcode = '42501';
    end if;
    if old.estado in ('completa', 'corregida')
       and new.estado = 'borrador'
       and not es_admin() then
      raise exception 'Solo un admin puede reabrir una evaluacion' using errcode = '42501';
    end if;
  end if;

  if new.estado in ('corregida', 'anulada')
     and coalesce(btrim(new.motivo_cambio), '') = '' then
    raise exception 'Una correccion o anulacion requiere motivo' using errcode = '23514';
  end if;

  if new.estado in ('completa', 'corregida') then
    if new.sin_muestra then
      raise exception 'Una evaluacion sin muestra solo puede guardarse como borrador' using errcode = '23514';
    end if;
    if not evaluacion_tiene_descriptores_completos(new) then
      raise exception 'Faltan descriptores cientificos obligatorios para finalizar' using errcode = '23514';
    end if;
    if coalesce(new.cantidad_frutos, 0) <= 0 then
      raise exception 'Cantidad de frutos debe ser mayor que cero para finalizar' using errcode = '23514';
    end if;
    if coalesce(new.peso_total_g, 0) <= 0 then
      raise exception 'Peso total debe ser mayor que cero para finalizar' using errcode = '23514';
    end if;
  end if;

  select p.especie_id into v_especie_id
  from ronda_evaluacion_anual r
  join individuos i on i.id = r.individuo_id
  join plantas p on p.id = i.planta_id
  where r.id = new.ronda_id;

  for v_rango in
    select distinct on (rr.metrica) rr.*
    from rango_referencia rr
    where rr.activo
      and rr.metrica in ('brix', 'calibre_mm')
      and (rr.especie_id = v_especie_id or rr.especie_id is null)
      and (rr.fase = 'evaluacion_anual' or rr.fase is null)
      and rr.vigente_desde <= new.fecha
      and (rr.vigente_hasta is null or rr.vigente_hasta >= new.fecha)
    order by
      rr.metrica,
      (rr.especie_id is not null) desc,
      (rr.fase is not null) desc,
      rr.vigente_desde desc,
      rr.created_at desc
  loop
    if v_rango.metrica = 'brix' and new.brix is not null then
      v_revision := v_revision
        or (v_rango.limite_revision_inferior is not null and new.brix <= v_rango.limite_revision_inferior)
        or (v_rango.limite_revision_superior is not null and new.brix >= v_rango.limite_revision_superior);
    elsif v_rango.metrica = 'calibre_mm' and new.calibre_mm is not null then
      v_revision := v_revision
        or (v_rango.limite_revision_inferior is not null and new.calibre_mm <= v_rango.limite_revision_inferior)
        or (v_rango.limite_revision_superior is not null and new.calibre_mm >= v_rango.limite_revision_superior);
    end if;
  end loop;

  new.requiere_revision := v_revision;
  return new;
end;
$$;
