-- =============================================================================
-- SPRINT 7 — Rondas multisitio: vía de creación + fix del contador anual.
-- Corresponde a docs/BDSecurity_Documento_Maestro.md 2.3 / 3.c.
--
-- Hallazgo (bug latente, confirmado por lectura del código): tras la
-- generalización de Sprint 3, iniciar_ronda_evaluacion seguía contando
-- TODAS las rondas del individuo (`count(*) where individuo_id = ...`) sin
-- filtrar tipo_ronda. Con cero rondas multisitio reales era inofensivo, pero
-- en cuanto este sprint crea la primera: un individuo con 1 multisitio + 0
-- anuales crearía su "ronda anual 2" (saltándose la 1), y uno con 2 anuales
-- + 1 multisitio vería rechazada su 3ª anual legítima. Se corrige ANTES de
-- habilitar la creación de rondas multisitio desde la UI, no después.
--
-- Además no existía ninguna vía de creación para rondas multisitio: el RPC
-- anual está cableado a tipo='anual' y un INSERT directo desde el cliente
-- tendría que calcular numero_ronda en el navegador (carrera entre dos
-- usuarios) y no pasaría por las validaciones de vivo/fase que toda otra
-- ronda tiene. Se agrega iniciar_ronda_multisitio con las mismas garantías,
-- gateado a la fase traslado_destino (la sección Multisitio de la ficha,
-- 2.4.5) en paralelo al gate evaluacion_anual del RPC anual.
-- =============================================================================

create or replace function iniciar_ronda_evaluacion(p_individuo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_estado       estado_planta;
  v_estado_vital estado_vital;
  v_siguiente    smallint;
  v_ronda_id     uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select p.estado, i.estado_vital
    into v_estado, v_estado_vital
  from individuos i
  join plantas p on p.id = i.planta_id
  where i.id = p_individuo_id;

  if not found then
    raise exception 'Individuo % no encontrado', p_individuo_id using errcode = 'P0002';
  end if;

  if v_estado_vital <> 'vivo' then
    raise exception 'El individuo no está vivo — no puede recibir una nueva ronda de evaluación' using errcode = '42501';
  end if;

  if v_estado <> 'evaluacion_anual' then
    raise exception 'El cruce debe estar en la fase Evaluación anual para iniciar una ronda (fase actual del cruce: %)', v_estado
      using errcode = '42501';
  end if;

  -- Fix Sprint 7: contar SOLO la serie anual. Sin este filtro, una ronda
  -- multisitio del mismo individuo corría el correlativo anual o bloqueaba
  -- una 3ª ronda anual legítima (los contadores son independientes por
  -- diseño desde Sprint 3).
  select count(*) into v_siguiente
  from ronda_evaluacion_anual
  where individuo_id = p_individuo_id and tipo_ronda = 'anual';

  if v_siguiente >= 3 then
    raise exception 'Este individuo ya tiene 3 rondas de evaluación anual — no se pueden crear más'
      using errcode = '42501';
  end if;

  insert into ronda_evaluacion_anual (individuo_id, tipo_ronda, numero_ronda, anio, fecha_inicio, created_by)
  values (p_individuo_id, 'anual', v_siguiente + 1, extract(year from current_date)::int, current_date, v_uid)
  returning id into v_ronda_id;

  return jsonb_build_object('ronda_id', v_ronda_id, 'numero_ronda', v_siguiente + 1);
end;
$$;

comment on function iniciar_ronda_evaluacion is
  'Crea la siguiente ronda ANUAL (1-3) para un individuo vivo cuyo cruce esté en fase evaluacion_anual. Desde Sprint 7 cuenta solo la serie anual (tipo_ronda=''anual'') — los contadores anual/multisitio son independientes.';

create or replace function iniciar_ronda_multisitio(
  p_individuo_id uuid,
  p_predio_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_estado       estado_planta;
  v_estado_vital estado_vital;
  v_siguiente    smallint;
  v_ronda_id     uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select p.estado, i.estado_vital
    into v_estado, v_estado_vital
  from individuos i
  join plantas p on p.id = i.planta_id
  where i.id = p_individuo_id;

  if not found then
    raise exception 'Individuo % no encontrado', p_individuo_id using errcode = 'P0002';
  end if;

  if v_estado_vital <> 'vivo' then
    raise exception 'El individuo no está vivo — no puede recibir una nueva ronda multisitio' using errcode = '42501';
  end if;

  -- La sección Multisitio de la ficha vive en la fase traslado_destino
  -- (2.4.5) — mismo patrón de gate por fase del cruce que el RPC anual.
  if v_estado <> 'traslado_destino' then
    raise exception 'El cruce debe estar en la fase Multisitio (traslado a destino) para iniciar una ronda multisitio (fase actual del cruce: %)', v_estado
      using errcode = '42501';
  end if;

  if p_predio_id is not null and not exists (
    select 1 from predio where id = p_predio_id and activo
  ) then
    raise exception 'Este predio está inactivo o no existe, elige otro contexto' using errcode = '23514';
  end if;

  select count(*) into v_siguiente
  from ronda_evaluacion_anual
  where individuo_id = p_individuo_id and tipo_ronda = 'multisitio';

  if v_siguiente >= 3 then
    raise exception 'Este individuo ya tiene 3 rondas multisitio — no se pueden crear más'
      using errcode = '42501';
  end if;

  -- anio queda NULL: una ronda multisitio se ubica por predio/fecha_inicio,
  -- no por año calendario (CHECK ronda_evaluacion_anio_requerido_si_anual).
  insert into ronda_evaluacion_anual (individuo_id, tipo_ronda, numero_ronda, anio, fecha_inicio, predio_id, created_by)
  values (p_individuo_id, 'multisitio', v_siguiente + 1, null, current_date, p_predio_id, v_uid)
  returning id into v_ronda_id;

  return jsonb_build_object('ronda_id', v_ronda_id, 'numero_ronda', v_siguiente + 1);
end;
$$;

comment on function iniciar_ronda_multisitio is
  'Crea la siguiente ronda MULTISITIO (1-3, contador independiente de la serie anual) para un individuo vivo cuyo cruce esté en fase traslado_destino. p_predio_id opcional como contexto; si se envía debe ser un predio activo.';

revoke all on function iniciar_ronda_multisitio(uuid, uuid) from public, anon;
grant execute on function iniciar_ronda_multisitio(uuid, uuid) to authenticated, service_role;

-- El audit de creación de rondas ahora deja constancia del tipo — antes solo
-- numero/anio, ambiguo con dos series en paralelo.
create or replace function auditar_creacion_ronda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planta_id uuid;
begin
  select planta_id into v_planta_id from individuos where id = new.individuo_id;
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (auth.uid(), v_planta_id, 'creacion_ronda_evaluacion_anual', array['numero_ronda', 'anio', 'tipo_ronda'],
    jsonb_build_object('ronda_id', new.id, 'individuo_id', new.individuo_id, 'numero_ronda', new.numero_ronda, 'anio', new.anio, 'tipo_ronda', new.tipo_ronda, 'predio_id', new.predio_id));
  return new;
end;
$$;
