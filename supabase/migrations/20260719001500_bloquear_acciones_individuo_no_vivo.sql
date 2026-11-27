-- =============================================================================
-- MIGRACIÓN 20260719001500 — bloquea acciones sobre individuos no vivos
-- (North Star v5, sección 2.3 y 6 — defecto BLOQUEANTE confirmado por
-- reproducción directa en la Parte A de la reunificación: un individuo
-- descartado/muerto podía seguir recibiendo evaluación reducida y PCR sin
-- ninguna validación, en ningún nivel).
--
-- La lectura NUNCA se bloquea (principio explícito de v5): estas funciones y
-- policies solo afectan INSERT, nunca SELECT.
-- =============================================================================

create or replace function individuo_esta_vivo(p_individuo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select estado_vital = 'vivo' from individuos where id = p_individuo_id;
$$;

create or replace function ronda_individuo_esta_vivo(p_ronda_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select i.estado_vital = 'vivo'
  from ronda_evaluacion_anual r
  join individuos i on i.id = r.individuo_id
  where r.id = p_ronda_id;
$$;

comment on function individuo_esta_vivo is 'true si el individuo está vivo. Usado en RLS de INSERT para bloquear evaluación reducida sobre individuos dados de baja — nunca se usa para bloquear SELECT.';
comment on function ronda_individuo_esta_vivo is 'Resuelve el individuo de una ronda de evaluación anual y expone si sigue vivo. Usado en RLS de INSERT de evaluaciones/pcr_analisis.';

-- evaluacion_reducida: Trasplante y Crecimiento.
drop policy if exists evaluacion_reducida_insert_autenticados on evaluacion_reducida;
create policy evaluacion_reducida_insert_autenticados on evaluacion_reducida
  for insert with check (
    auth.uid() is not null
    and created_by = auth.uid()
    and individuo_esta_vivo(individuo_id)
  );

-- evaluaciones: evaluación completa (15 descriptores) de una ronda.
drop policy if exists evaluaciones_insert_autenticados on evaluaciones;
create policy evaluaciones_insert_autenticados on evaluaciones
  for insert with check (
    auth.uid() is not null
    and created_by = auth.uid()
    and ronda_individuo_esta_vivo(ronda_id)
  );

-- pcr_analisis: PCR de una ronda.
drop policy if exists pcr_analisis_insert_autenticados on pcr_analisis;
create policy pcr_analisis_insert_autenticados on pcr_analisis
  for insert with check (
    auth.uid() is not null
    and created_by = auth.uid()
    and ronda_individuo_esta_vivo(ronda_id)
  );

-- iniciar_ronda_evaluacion ya valida estado_vital directamente (migración
-- 20260719000500) — no depende de estas funciones porque además necesita
-- distinguir el mensaje de error de "no está vivo" vs "cruce en otra fase".


-- =============================================================================
-- "No se puede dar de baja dos veces" (North Star v5, sección 2.3): una vez
-- que estado_vital deja de ser 'vivo', no se puede volver a cambiar
-- estado_vital ni fecha_baja. La LECTURA de individuos.* nunca se bloquea —
-- esto es un trigger de UPDATE, no toca SELECT.
-- =============================================================================
create or replace function bloquear_rebaja_individuo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado_vital <> 'vivo'
     and (new.estado_vital is distinct from old.estado_vital or new.fecha_baja is distinct from old.fecha_baja)
  then
    raise exception 'Este individuo ya fue dado de baja (%) el % — no se puede volver a dar de baja', old.estado_vital, old.fecha_baja
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function bloquear_rebaja_individuo is 'Bloquea cambiar estado_vital/fecha_baja de un individuo que ya no está vivo. No afecta lectura ni otras columnas.';

create trigger trg_individuos_bloquear_rebaja
  before update on individuos
  for each row execute function bloquear_rebaja_individuo();
