-- =============================================================================
-- MIGRACIÓN 20260715000000 — AUDITORÍA DE evaluaciones/pcr_analisis/baja_motivo
--
-- Bug encontrado en prueba manual (Prompt 5, Parte B): el panel "Auditoría de
-- esta planta" no mostraba nada al crear una evaluación. Confirmado por
-- query directa: solo `individuos` tenía trigger de auditoría
-- (trg_individuos_auditoria, migración 20260714020000); evaluaciones,
-- pcr_analisis y baja_motivo no tenían ninguno, y audit_log no tenía ninguna
-- fila con accion tipo 'creacion_evaluacion' pese a haber evaluaciones reales
-- cargadas.
--
-- Mismo patrón que auditar_escritura_individuo: cada tabla resuelve su
-- planta_id vía individuo_id -> individuos.planta_id (estas tablas no tienen
-- planta_id directo), y registra alta/edición.
-- =============================================================================

create or replace function auditar_escritura_evaluacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planta_id uuid;
begin
  select planta_id into v_planta_id from individuos where id = new.individuo_id;

  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      v_planta_id,
      'creacion_evaluacion',
      array['tipo', 'anio', 'fecha'],
      jsonb_build_object('evaluacion_id', new.id, 'individuo_id', new.individuo_id, 'tipo', new.tipo, 'anio', new.anio, 'fecha', new.fecha)
    );
  elsif tg_op = 'UPDATE' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      v_planta_id,
      'edicion_evaluacion',
      array['tipo', 'anio', 'fecha'],
      jsonb_build_object('evaluacion_id', new.id, 'individuo_id', new.individuo_id)
    );
  end if;
  return new;
end;
$$;

comment on function auditar_escritura_evaluacion is 'Registra en audit_log cada alta o edición de una evaluación (resuelve planta_id vía individuo_id).';

create trigger trg_evaluaciones_auditoria
  after insert or update on evaluaciones
  for each row execute function auditar_escritura_evaluacion();


create or replace function auditar_escritura_pcr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planta_id uuid;
begin
  select planta_id into v_planta_id from individuos where id = new.individuo_id;

  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      v_planta_id,
      'creacion_pcr',
      array['realizado', 'fecha'],
      jsonb_build_object('pcr_id', new.id, 'individuo_id', new.individuo_id, 'realizado', new.realizado, 'fecha', new.fecha)
    );
  elsif tg_op = 'UPDATE' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      v_planta_id,
      'edicion_pcr',
      array['realizado', 'fecha'],
      jsonb_build_object('pcr_id', new.id, 'individuo_id', new.individuo_id)
    );
  end if;
  return new;
end;
$$;

comment on function auditar_escritura_pcr is 'Registra en audit_log cada alta o edición de un análisis PCR (resuelve planta_id vía individuo_id).';

create trigger trg_pcr_analisis_auditoria
  after insert or update on pcr_analisis
  for each row execute function auditar_escritura_pcr();


create or replace function auditar_escritura_baja_motivo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planta_id uuid;
begin
  select planta_id into v_planta_id from individuos where id = new.individuo_id;

  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      v_planta_id,
      'creacion_baja_motivo',
      array['criterio'],
      jsonb_build_object('baja_motivo_id', new.id, 'individuo_id', new.individuo_id, 'criterio', new.criterio)
    );
  elsif tg_op = 'UPDATE' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      v_planta_id,
      'edicion_baja_motivo',
      array['criterio', 'nota'],
      jsonb_build_object('baja_motivo_id', new.id, 'individuo_id', new.individuo_id)
    );
  end if;
  return new;
end;
$$;

comment on function auditar_escritura_baja_motivo is 'Registra en audit_log cada alta o edición de un motivo de baja (resuelve planta_id vía individuo_id).';

create trigger trg_baja_motivo_auditoria
  after insert or update on baja_motivo
  for each row execute function auditar_escritura_baja_motivo();
