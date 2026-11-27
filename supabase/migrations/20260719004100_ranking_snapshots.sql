-- =============================================================================
-- Sprint 2 / Bloque E: snapshots inmutables del ranking. Solo admin congela;
-- autenticados pueden consultar resultados ya publicados.
-- =============================================================================

create type alcance_ranking_snapshot as enum ('cruzamiento', 'especie');

create table ranking_snapshot (
  id                    uuid primary key default gen_random_uuid(),
  nombre                text not null check (btrim(nombre) <> ''),
  alcance               alcance_ranking_snapshot not null,
  scoring_version_id    uuid not null references scoring_version (id) on delete restrict,
  especie_id            uuid not null references especies (id) on delete restrict,
  planta_id             uuid,
  poblacion_comparada   integer not null check (poblacion_comparada > 0),
  criterios             jsonb not null,
  created_by            uuid not null references perfiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  check (
    (alcance = 'cruzamiento' and planta_id is not null)
    or (alcance = 'especie' and planta_id is null)
  )
);

create table ranking_snapshot_resultado (
  snapshot_id           uuid not null references ranking_snapshot (id) on delete restrict,
  individuo_id          uuid not null references individuos (id) on delete restrict,
  codigo_display        text not null,
  evaluacion_id         uuid not null references evaluaciones (id) on delete restrict,
  posicion              integer not null check (posicion > 0),
  puntaje               numeric not null,
  detalle               jsonb not null,
  primary key (snapshot_id, individuo_id),
  unique (snapshot_id, posicion)
);

comment on table ranking_snapshot is
  'Cabecera inmutable de un ranking congelado manualmente por admin. Cohortes quedan fuera hasta existir su modelo de dominio.';
comment on table ranking_snapshot_resultado is
  'Resultados inmutables: conserva individuo, evaluación utilizada, posición, puntaje y detalle al momento de congelar.';

alter table ranking_snapshot enable row level security;
alter table ranking_snapshot_resultado enable row level security;

create policy ranking_snapshot_select_autenticados on ranking_snapshot
  for select using (auth.uid() is not null);
create policy ranking_snapshot_resultado_select_autenticados on ranking_snapshot_resultado
  for select using (auth.uid() is not null);

grant select on ranking_snapshot, ranking_snapshot_resultado to authenticated;
grant all on ranking_snapshot, ranking_snapshot_resultado to service_role;

create or replace function congelar_ranking(
  p_nombre text,
  p_planta_id uuid default null,
  p_especie_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_especie_id uuid := p_especie_id;
  v_version_id uuid;
  v_version_nombre text;
  v_desempate jsonb;
  v_snapshot_id uuid;
  v_poblacion integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede congelar un ranking' using errcode = '42501';
  end if;
  if (p_planta_id is null) = (p_especie_id is null) then
    raise exception 'Indica exactamente un cruce o una especie' using errcode = '22023';
  end if;
  if coalesce(btrim(p_nombre), '') = '' then
    raise exception 'El snapshot requiere nombre' using errcode = '23514';
  end if;

  if p_planta_id is not null then
    select especie_id into v_especie_id
    from plantas
    where id = p_planta_id and eliminado_at is null;
    if not found then
      raise exception 'Cruce no encontrado' using errcode = 'P0002';
    end if;
  end if;

  v_version_id := resolver_scoring_version(v_especie_id, 'evaluacion_anual', current_date);
  if v_version_id is null then
    raise exception 'No hay versión activa de scoring para este alcance' using errcode = '23514';
  end if;

  select nombre, criterio_desempate into v_version_nombre, v_desempate
  from scoring_version where id = v_version_id;

  select count(*)::integer into v_poblacion
  from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id)
  where elegible;

  if v_poblacion = 0 then
    raise exception 'No hay población elegible para congelar' using errcode = '23514';
  end if;

  insert into ranking_snapshot (
    nombre, alcance, scoring_version_id, especie_id, planta_id,
    poblacion_comparada, criterios, created_by
  ) values (
    btrim(p_nombre),
    case when p_planta_id is null then 'especie' else 'cruzamiento' end,
    v_version_id,
    v_especie_id,
    p_planta_id,
    v_poblacion,
    jsonb_build_object(
      'scoring_version_nombre', v_version_nombre,
      'seleccion_evaluacion', 'ultima completa/corregida de la ronda mas reciente; fecha y updated_at como desempate',
      'exclusiones', jsonb_build_array('borrador', 'anulada', 'requiere_revision', 'no_comparable', 'metricas_incompletas'),
      'desempate', v_desempate
    ),
    v_uid
  ) returning id into v_snapshot_id;

  insert into ranking_snapshot_resultado (
    snapshot_id, individuo_id, codigo_display, evaluacion_id,
    posicion, puntaje, detalle
  )
  select
    v_snapshot_id,
    r.individuo_id,
    r.codigo_display,
    r.evaluacion_id,
    row_number() over (
      order by r.puntaje_ponderado desc,
               r.fecha_evaluacion desc,
               r.evaluacion_updated_at desc,
               r.codigo_display asc
    )::integer,
    r.puntaje_ponderado,
    jsonb_build_object(
      'fecha_evaluacion', r.fecha_evaluacion,
      'numero_ronda', r.numero_ronda,
      'estado_evaluacion', r.estado_evaluacion,
      'scoring_version_id', r.scoring_version_id,
      'scoring_version_nombre', r.scoring_version_nombre,
      'metricas', r.detalle_metricas
    )
  from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id) r
  where r.elegible
  order by r.puntaje_ponderado desc, r.fecha_evaluacion desc,
           r.evaluacion_updated_at desc, r.codigo_display asc;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    p_planta_id,
    'congelacion_ranking',
    array['scoring_version_id', 'evaluacion_id', 'puntaje'],
    jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'especie_id', v_especie_id,
      'poblacion', v_poblacion,
      'scoring_version_id', v_version_id
    )
  );

  return v_snapshot_id;
end;
$$;

revoke all on function congelar_ranking(text, uuid, uuid) from public, anon;
grant execute on function congelar_ranking(text, uuid, uuid) to authenticated, service_role;

