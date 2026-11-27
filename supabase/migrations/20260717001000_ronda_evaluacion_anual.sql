-- =============================================================================
-- MIGRACIÓN 20260717001000 — ronda_evaluacion_anual (Prompt 7, Parte C)
--
-- North Star v4: "Primer año de evaluación" se repite 1-3 veces COMO RONDA
-- COMPLETA (aplicaciones + podas + evaluación + PCR + baja), no como
-- evaluaciones sueltas con un campo `tipo`. Esta tabla agrupa cada repetición.
-- =============================================================================

create table ronda_evaluacion_anual (
  id             uuid primary key default gen_random_uuid(),
  individuo_id   uuid not null references individuos (id) on delete restrict,
  numero_ronda   smallint not null check (numero_ronda between 1 and 3),
  anio           integer not null,
  fecha_inicio   date,
  created_by     uuid references perfiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (individuo_id, numero_ronda)
);

comment on table ronda_evaluacion_anual is 'Agrupa cada repetición (1-3) de "Primer año de evaluación" como unidad: aplicaciones/podas/evaluación completa/PCR/baja de esa ronda.';

create index idx_ronda_evaluacion_anual_individuo on ronda_evaluacion_anual (individuo_id, numero_ronda);

alter table ronda_evaluacion_anual enable row level security;

create policy ronda_evaluacion_anual_select_autenticados on ronda_evaluacion_anual for select using (auth.uid() is not null);
create policy ronda_evaluacion_anual_insert_autenticados on ronda_evaluacion_anual for insert with check (auth.uid() is not null and created_by = auth.uid());
-- Sin UPDATE/DELETE: una ronda, una vez creada, no se edita ni se borra
-- (numero_ronda/anio son inmutables por diseño; corregir un error de carga
-- es un caso de admin vía Studio, no un flujo de la app).

grant select, insert on ronda_evaluacion_anual to authenticated;
grant all on ronda_evaluacion_anual to service_role;

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
  values (auth.uid(), v_planta_id, 'creacion_ronda_evaluacion_anual', array['numero_ronda', 'anio'],
    jsonb_build_object('ronda_id', new.id, 'individuo_id', new.individuo_id, 'numero_ronda', new.numero_ronda, 'anio', new.anio));
  return new;
end;
$$;

create trigger trg_ronda_evaluacion_anual_auditoria
  after insert on ronda_evaluacion_anual
  for each row execute function auditar_creacion_ronda();


-- =============================================================================
-- RPC iniciar_ronda_evaluacion — única vía de creación de rondas. Asigna el
-- siguiente numero_ronda disponible (1, 2 o 3); rechaza si ya hay 3. Solo
-- permitida si el individuo está en fase 'evaluacion_anual'.
-- =============================================================================
create or replace function iniciar_ronda_evaluacion(p_individuo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_fase         fase_individuo;
  v_siguiente    smallint;
  v_ronda_id     uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select fase_actual into v_fase from individuos where id = p_individuo_id;
  if not found then
    raise exception 'Individuo % no encontrado', p_individuo_id using errcode = 'P0002';
  end if;

  if v_fase <> 'evaluacion_anual' then
    raise exception 'El individuo debe estar en fase evaluacion_anual para iniciar una ronda (fase actual: %)', v_fase
      using errcode = '42501';
  end if;

  select count(*) into v_siguiente from ronda_evaluacion_anual where individuo_id = p_individuo_id;
  if v_siguiente >= 3 then
    raise exception 'Este individuo ya tiene 3 rondas de evaluación anual — no se pueden crear más'
      using errcode = '42501';
  end if;

  insert into ronda_evaluacion_anual (individuo_id, numero_ronda, anio, fecha_inicio, created_by)
  values (p_individuo_id, v_siguiente + 1, extract(year from current_date)::int, current_date, v_uid)
  returning id into v_ronda_id;

  return jsonb_build_object('ronda_id', v_ronda_id, 'numero_ronda', v_siguiente + 1);
end;
$$;

comment on function iniciar_ronda_evaluacion is 'Crea la siguiente ronda (1-3) de evaluación anual para un individuo en fase evaluacion_anual. Rechaza si ya hay 3.';

grant execute on function iniciar_ronda_evaluacion(uuid) to authenticated;


-- =============================================================================
-- evaluaciones: reemplaza individuo_id + tipo por ronda_id (Prompt 7, Parte C).
-- Antes de este cambio: las evaluaciones de PRUEBA existentes se descartan
-- (ver reporte de verificación con conteo exacto — decisión ya confirmada,
-- no se migran). Se borran ANTES de agregar ronda_id NOT NULL para que la
-- tabla quede vacía y el ALTER sea seguro.
-- =============================================================================
-- individuos_scoring (Prompt 4) depende de evaluaciones.individuo_id: hay que
-- soltarla antes de tocar las columnas, se recrea más abajo con el join nuevo.
drop view if exists individuos_scoring;

delete from evaluaciones;

alter table evaluaciones drop column individuo_id;
alter table evaluaciones drop column tipo;
alter table evaluaciones add column ronda_id uuid not null references ronda_evaluacion_anual (id) on delete restrict;

drop type if exists tipo_evaluacion;

create index idx_evaluaciones_ronda on evaluaciones (ronda_id, fecha desc);

comment on column evaluaciones.ronda_id is 'Reemplaza individuo_id + tipo (v3). El individuo se resuelve vía ronda_evaluacion_anual.individuo_id — evita que ronda_id e individuo_id diverjan.';

-- auditar_escritura_evaluacion (migración 20260715000000) referenciaba
-- new.individuo_id/new.tipo directo, que ya no existen: se redefine
-- resolviendo el individuo (y de ahí planta_id) vía la ronda.
create or replace function auditar_escritura_evaluacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_individuo_id uuid;
  v_planta_id    uuid;
begin
  select individuo_id into v_individuo_id from ronda_evaluacion_anual where id = new.ronda_id;
  select planta_id into v_planta_id from individuos where id = v_individuo_id;

  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(), v_planta_id, 'creacion_evaluacion',
      array['ronda_id', 'anio', 'fecha'],
      jsonb_build_object('evaluacion_id', new.id, 'ronda_id', new.ronda_id, 'individuo_id', v_individuo_id, 'anio', new.anio, 'fecha', new.fecha)
    );
  elsif tg_op = 'UPDATE' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(), v_planta_id, 'edicion_evaluacion',
      array['ronda_id', 'anio', 'fecha'],
      jsonb_build_object('evaluacion_id', new.id, 'ronda_id', new.ronda_id, 'individuo_id', v_individuo_id)
    );
  end if;
  return new;
end;
$$;


-- =============================================================================
-- pcr_analisis: reemplaza individuo_id por ronda_id (el PCR es parte de una
-- ronda específica, no del individuo en abstracto). El único PCR de prueba
-- existente se descarta (ver reporte de verificación) antes de este ALTER.
-- =============================================================================
delete from pcr_analisis;

alter table pcr_analisis drop column individuo_id;
alter table pcr_analisis add column ronda_id uuid not null references ronda_evaluacion_anual (id) on delete restrict;

create index idx_pcr_analisis_ronda on pcr_analisis (ronda_id);

comment on column pcr_analisis.ronda_id is 'Antes colgaba directo de individuo_id (v3); ahora cuelga de la ronda específica de evaluación anual.';

-- auditar_escritura_pcr (migración 20260715000000) referenciaba
-- new.individuo_id directo, que ya no existe: se redefine resolviendo el
-- individuo (y de ahí planta_id) vía la ronda.
create or replace function auditar_escritura_pcr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_individuo_id uuid;
  v_planta_id    uuid;
begin
  select individuo_id into v_individuo_id from ronda_evaluacion_anual where id = new.ronda_id;
  select planta_id into v_planta_id from individuos where id = v_individuo_id;

  if tg_op = 'INSERT' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(), v_planta_id, 'creacion_pcr',
      array['ronda_id', 'realizado', 'fecha'],
      jsonb_build_object('pcr_id', new.id, 'ronda_id', new.ronda_id, 'individuo_id', v_individuo_id, 'realizado', new.realizado, 'fecha', new.fecha)
    );
  elsif tg_op = 'UPDATE' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(), v_planta_id, 'edicion_pcr',
      array['ronda_id', 'realizado', 'fecha'],
      jsonb_build_object('pcr_id', new.id, 'ronda_id', new.ronda_id, 'individuo_id', v_individuo_id)
    );
  end if;
  return new;
end;
$$;


-- =============================================================================
-- individuos_scoring: la vista (Prompt 4) hacía JOIN directo evaluaciones.
-- individuo_id, que ya no existe (se soltó más arriba, antes del ALTER).
-- Se recrea para llegar al individuo vía ronda_evaluacion_anual. Misma
-- fórmula, misma documentación de decisiones de normalización (ver migración
-- 20260714022000) — solo cambia el join.
-- =============================================================================
create view individuos_scoring
  with (security_invoker = on)
as
with ultima_evaluacion as (
  select distinct on (r.individuo_id)
    r.individuo_id,
    e.fecha,
    e.brotacion, e.floracion, e.cuaja, e.concentracion_cosecha,
    e.firmeza, e.color, e.bloom, e.calibre_mm, e.brix,
    e.rend_kg_planta, e.rend_t_ha, e.pct_fruta_exportable,
    e.dano_calor, e.golpe_sol, e.caida_fruto
  from evaluaciones e
  join ronda_evaluacion_anual r on r.id = e.ronda_id
  join individuos i on i.id = r.individuo_id
  where i.estado_vital = 'vivo'
  order by r.individuo_id, e.fecha desc, e.created_at desc, e.id desc
),
rangos_produccion as (
  select
    min(rend_kg_planta)       as min_kg,  max(rend_kg_planta)       as max_kg,
    min(rend_t_ha)            as min_tha, max(rend_t_ha)            as max_tha,
    min(pct_fruta_exportable) as min_pct, max(pct_fruta_exportable) as max_pct
  from ultima_evaluacion
),
normalizado as (
  select
    ue.individuo_id,
    (select avg(v) from unnest(array[
      case when ue.brotacion             is not null then (ue.brotacion - 1) / 4.0 end,
      case when ue.floracion             is not null then (ue.floracion - 1) / 4.0 end,
      case when ue.cuaja                 is not null then (ue.cuaja - 1) / 4.0 end,
      case when ue.concentracion_cosecha is not null then (ue.concentracion_cosecha - 1) / 4.0 end
    ]) as t(v)) as prom_fenologia,
    (select avg(v) from unnest(array[
      case when ue.firmeza    is not null then (ue.firmeza - 1) / 4.0 end,
      case when ue.color      is not null then (ue.color - 1) / 4.0 end,
      case when ue.bloom      is not null then (ue.bloom - 1) / 4.0 end,
      case when ue.calibre_mm is not null then (ue.calibre_mm - 14) / 10.0 end,
      case when ue.brix       is not null then (ue.brix - 10) / 8.0 end
    ]) as t(v)) as prom_fruto_calidad,
    (select avg(v) from unnest(array[
      case when ue.rend_kg_planta is not null and r.max_kg is not null and r.max_kg <> r.min_kg
        then (ue.rend_kg_planta - r.min_kg) / (r.max_kg - r.min_kg) end,
      case when ue.rend_t_ha is not null and r.max_tha is not null and r.max_tha <> r.min_tha
        then (ue.rend_t_ha - r.min_tha) / (r.max_tha - r.min_tha) end,
      case when ue.pct_fruta_exportable is not null and r.max_pct is not null and r.max_pct <> r.min_pct
        then (ue.pct_fruta_exportable - r.min_pct) / (r.max_pct - r.min_pct) end
    ]) as t(v)) as prom_produccion,
    (select avg(v) from unnest(array[
      case when ue.dano_calor  is not null then (ue.dano_calor - 1) / 4.0 end,
      case when ue.golpe_sol   is not null then (ue.golpe_sol - 1) / 4.0 end,
      case when ue.caida_fruto is not null then (ue.caida_fruto - 1) / 4.0 end
    ]) as t(v)) as prom_estres
  from ultima_evaluacion ue
  cross join rangos_produccion r
)
select
  i.id           as individuo_id,
  i.codigo_display,
  i.planta_id,
  p.codigo_sistema,
  round(n.prom_fenologia::numeric, 4)     as promedio_fenologia,
  round(n.prom_fruto_calidad::numeric, 4) as promedio_fruto_calidad,
  round(n.prom_produccion::numeric, 4)    as promedio_produccion,
  round(n.prom_estres::numeric, 4)        as promedio_estres,
  round((
    (n.prom_fenologia     * 0.20) +
    (n.prom_fruto_calidad * 0.40) +
    (n.prom_produccion    * 0.30) -
    (n.prom_estres        * 0.10)
  )::numeric, 4) as puntaje_ponderado
from individuos i
join plantas p on p.id = i.planta_id
left join normalizado n on n.individuo_id = i.id
where i.estado_vital = 'vivo';

comment on view individuos_scoring is 'Ranking de individuos vivos por puntaje ponderado. Llega a la última evaluación vía ronda_evaluacion_anual (Prompt 7) en vez de evaluaciones.individuo_id directo (v3, ya no existe). Misma fórmula y decisiones documentadas en la migración 20260714022000.';

grant select on individuos_scoring to authenticated;
grant select on individuos_scoring to service_role;
