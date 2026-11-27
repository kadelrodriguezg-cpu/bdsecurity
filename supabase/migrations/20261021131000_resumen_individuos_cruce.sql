-- =============================================================================
-- MIGRACIÓN 20261021131000 — RESUMEN AGREGADO DE INDIVIDUOS DE UN CRUCE
-- (brecha B8, pendiente M-11)
--
-- Problema que cierra: ResumenFinal (frontend/src/features/fases/
-- ResumenFinal.tsx) armaba el bloque de individuos con un N+1: por cada
-- individuo pedía sus rondas, y por cada ronda sus evaluaciones y PCR, más sus
-- motivos de baja y emplazamientos. Un cruce de 110 individuos con 2 rondas son
-- más de 600 requests. Mismo patrón que ya se corrigió en el explorador de
-- individuos: una sola RPC agregada.
--
-- Replica EXACTAMENTE lo que calculaba el cliente:
--   - evaluaciones: solo rondas anuales (listarRondas usa tipo 'anual') y solo
--     estado completa/corregida (listarEvaluacionesDeRonda);
--   - pcr: todos los de las rondas anuales;
--   - observaciones: motivos de baja con nota no vacía, del más nuevo al más
--     viejo;
--   - emplazamiento actual: el abierto (fecha_fin null) más reciente.
--
-- SECURITY INVOKER: corre con el RLS del usuario, igual que las consultas que
-- reemplaza. No toca linaje.
-- =============================================================================

create or replace function resumen_individuos_cruce(p_planta_id uuid)
returns table (
  individuo_id         uuid,
  codigo_display       text,
  estado_vital         estado_vital,
  evaluaciones_count   integer,
  pcr_count            integer,
  observaciones        jsonb,
  tiene_emplazamiento  boolean,
  predio_nombre        text,
  sector_nombre        text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    i.id,
    i.codigo_display,
    i.estado_vital,
    (select count(*)::int
       from evaluaciones e
       join ronda_evaluacion_anual r on r.id = e.ronda_id
      where r.individuo_id = i.id
        and r.tipo_ronda = 'anual'
        and e.estado in ('completa', 'corregida')),
    (select count(*)::int
       from pcr_analisis p
       join ronda_evaluacion_anual r on r.id = p.ronda_id
      where r.individuo_id = i.id
        and r.tipo_ronda = 'anual'),
    coalesce((select jsonb_agg(jsonb_build_object('criterio', b.criterio, 'nota', b.nota) order by b.created_at desc)
                from baja_motivo b
               where b.individuo_id = i.id
                 and coalesce(b.nota, '') <> ''), '[]'::jsonb),
    emp.id is not null,
    emp.predio_nombre,
    emp.sector_nombre
  from individuos i
  left join lateral (
    select ei.id, pr.nombre as predio_nombre, s.nombre as sector_nombre
      from emplazamiento_individuo ei
      left join sector s on s.id = ei.sector_id
      left join predio pr on pr.id = s.predio_id
     where ei.individuo_id = i.id
       and ei.fecha_fin is null
     order by ei.fecha_inicio desc
     limit 1
  ) emp on true
  where i.planta_id = p_planta_id;
$$;

comment on function resumen_individuos_cruce(uuid) is
  'Resumen de cada individuo de un cruce para ResumenFinal (evaluaciones completas/corregidas, PCR, observaciones de baja, emplazamiento actual) en una sola consulta. SECURITY INVOKER.';

revoke all on function resumen_individuos_cruce(uuid) from public, anon;
grant execute on function resumen_individuos_cruce(uuid) to authenticated, service_role;
