-- Fase 2, Sprint 0 — regla de frutos por descriptores (decisión de Kadel,
-- 22-10-2026: «se evalúa por fases; si no evalúan fruto, no se pide fruto»).
--
-- Antes (20260922191236): finalizar exigía cantidad de frutos > 0 y peso total
-- > 0 salvo «Sin muestra de frutos». Ahora la muestra se exige SOLO si la
-- evaluación trae algún descriptor de fruta o de muestra: calibre, firmeza,
-- color, bloom, brix, cantidad o peso. «Sin muestra» sigue eximiendo.
-- Los borradores no cambian: la regla solo se aplica al finalizar
-- (completa/corregida). El frontend aplica la misma regla
-- (lib/esquemaFase/evaluacionAnual.ts, exigeMuestraDeFrutos).
--
-- Solo cambia el bloque de la muestra; el resto del cuerpo es idéntico al de
-- 20260922191236_permitir_cerrar_evaluacion_sin_muestra.sql.

create or replace function public.validar_evaluacion_integridad()
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

  -- Regla de frutos: solo con datos de fruta o de muestra.
  if new.estado in ('completa', 'corregida')
     and not coalesce(new.sin_muestra, false)
     and (new.calibre_mm is not null or new.firmeza is not null or new.color is not null
          or new.bloom is not null or new.brix is not null
          or new.cantidad_frutos is not null or new.peso_total_g is not null) then
    if coalesce(new.cantidad_frutos, 0) <= 0 then
      raise exception 'Hay datos de fruta o de muestra: cantidad de frutos debe ser mayor que cero para finalizar. Si no se tomo muestra, marca Sin muestra de frutos'
        using errcode = '23514';
    end if;
    if coalesce(new.peso_total_g, 0) <= 0 then
      raise exception 'Hay datos de fruta o de muestra: peso total debe ser mayor que cero para finalizar. Si no se tomo muestra, marca Sin muestra de frutos'
        using errcode = '23514';
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

comment on function public.validar_evaluacion_integridad() is
  'Integridad de evaluaciones: anio desde fecha, permisos de cierre/correccion, motivo, regla de frutos solo con datos de fruta o muestra (Fase 2) y requiere_revision por rangos.';
