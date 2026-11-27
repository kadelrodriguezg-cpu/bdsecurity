-- =============================================================================
-- MIGRACIÓN 20261021140000 — CADA RONDA QUEDA LIGADA A SU VERSIÓN DE SCORING
-- (brecha B6, paso 2)
--
-- Problema: el ranking evalúa TODAS las rondas con la versión de scoring
-- activa hoy (resolver_scoring_version). scoring_version tiene vigente_desde/
-- vigente_hasta, pero los cambios de configuración se hicieron siempre con
-- UPDATE en sitio y solo puede haber una versión 'activa' por especie y fase.
-- Agregar una métrica vuelve inelegible, de forma retroactiva, toda evaluación
-- anterior que no la tenga (Documento Maestro, «Hallazgo estructural, sin
-- resolver»).
--
-- Este paso: ronda_evaluacion_anual.scoring_version_id guarda con qué versión
-- se cerró la ronda. Se fija UNA vez, cuando la primera evaluación de la ronda
-- pasa a completa/corregida, con la versión vigente en la fecha de esa
-- evaluación (resolver_scoring_version(especie, 'evaluacion_anual', fecha)),
-- el mismo criterio por fecha que ya usaban las series históricas. Después no
-- cambia: corregir o anular evaluaciones no mueve la ligadura.
--
-- Las migraciones siguientes vuelven inmutable una versión en uso
-- (20261021141000) y hacen que el ranking calcule con la versión de cada ronda
-- (20261021142000).
-- =============================================================================

alter table ronda_evaluacion_anual
  add column scoring_version_id uuid references scoring_version (id) on delete restrict;

comment on column ronda_evaluacion_anual.scoring_version_id is
  'Versión de scoring con que se cerró la ronda (la vigente en la fecha de su primera evaluación completa/corregida). La fija un trigger; no se edita.';

create index ronda_evaluacion_anual_scoring_version_idx
  on ronda_evaluacion_anual (scoring_version_id)
  where scoring_version_id is not null;

-- La columna es un ALLOWLIST de SELECT (no hay grant de tabla completa).
-- Sin UPDATE: solo la escribe el trigger.
grant select (scoring_version_id) on ronda_evaluacion_anual to authenticated;


create or replace function ligar_ronda_a_version_scoring()
returns trigger
language plpgsql
security definer            -- ronda_evaluacion_anual no tiene UPDATE para
set search_path = public    -- authenticated; solo este trigger la escribe
as $$
begin
  if new.estado not in ('completa', 'corregida') then
    return new;
  end if;

  update ronda_evaluacion_anual r
     set scoring_version_id = resolver_scoring_version(p.especie_id, 'evaluacion_anual', new.fecha)
    from individuos i
    join plantas p on p.id = i.planta_id
   where r.id = new.ronda_id
     and i.id = r.individuo_id
     and r.scoring_version_id is null;

  return new;
end;
$$;

comment on function ligar_ronda_a_version_scoring is
  'Liga la ronda a la versión de scoring vigente en la fecha de su primera evaluación completa/corregida. No pisa una ligadura existente.';

create trigger trg_evaluaciones_ligar_version_scoring
  after insert or update of estado on evaluaciones
  for each row execute function ligar_ronda_a_version_scoring();


-- Backfill: rondas que ya tienen evaluaciones cerradas se ligan con la misma
-- regla, usando la primera evaluación completa/corregida de cada ronda.
-- (En producción, al cierre de la auditoría, no había ninguna.)
update ronda_evaluacion_anual r
   set scoring_version_id = resolver_scoring_version(p.especie_id, 'evaluacion_anual', primera.fecha)
  from (
    select distinct on (e.ronda_id) e.ronda_id, e.fecha
      from evaluaciones e
     where e.estado in ('completa', 'corregida')
     order by e.ronda_id, e.created_at, e.id
  ) primera
  join ronda_evaluacion_anual r2 on r2.id = primera.ronda_id
  join individuos i on i.id = r2.individuo_id
  join plantas p on p.id = i.planta_id
 where r.id = primera.ronda_id
   and r.scoring_version_id is null;
