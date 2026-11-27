-- =============================================================================
-- MIGRACIÓN 20260717000500 — fase_actual (individuos) + evaluacion_reducida
-- (Prompt 7, Parte B)
--
-- North Star v4 sección 2.3: Trasplante y Crecimiento NO usan los 15
-- descriptores completos de `evaluaciones` — usan un set reducido y distinto
-- entre sí (Crecimiento agrega multibrotes + presencia_raices que Trasplante
-- no tiene). Se modela aparte, no como columnas nullable dentro de
-- `evaluaciones` (mezclar dos conceptos con campos distintos en una sola
-- tabla pierde la validación de "esto no corresponde en esta fase").
-- =============================================================================

create type fase_individuo as enum ('trasplante', 'crecimiento', 'evaluacion_anual', 'multisitio');

alter table individuos add column fase_actual fase_individuo not null default 'trasplante';

comment on column individuos.fase_actual is 'Fase de la secuencia post-Trasplante del individuo (North Star v4 sección 2.3). Independiente de estado_vital: un individuo puede estar vivo y en cualquier fase.';


create type fase_evaluacion_reducida as enum ('trasplante', 'crecimiento');

create table evaluacion_reducida (
  id                  uuid primary key default gen_random_uuid(),
  individuo_id        uuid not null references individuos (id) on delete restrict,
  fase                fase_evaluacion_reducida not null,
  talla               numeric,
  numero_entrenudos   integer,
  vigor               smallint check (vigor between 1 and 5),
  -- multibrotes/presencia_raices solo aplican en fase='crecimiento'. Nullable
  -- siempre a nivel de DB (no se fuerza NOT NULL condicional) — la UI es la
  -- que oculta estos campos cuando fase='trasplante', según pide el prompt.
  multibrotes         integer,
  presencia_raices    smallint check (presencia_raices between 1 and 5),
  observaciones       text,
  created_by          uuid references perfiles (id) on delete set null,
  created_at          timestamptz not null default now()
);

comment on table evaluacion_reducida is 'Evaluación de Trasplante (talla+entrenudos+vigor) y Crecimiento (+ multibrotes + presencia_raices). Set de campos distinto y más chico que evaluaciones (15 descriptores), que solo aplica desde Primer año de evaluación.';
comment on column evaluacion_reducida.multibrotes is 'Solo aplica si fase=crecimiento. Nullable siempre a nivel de DB; la UI no lo muestra en fase=trasplante.';
comment on column evaluacion_reducida.presencia_raices is 'Solo aplica si fase=crecimiento. Nullable siempre a nivel de DB; la UI no lo muestra en fase=trasplante.';

create index idx_evaluacion_reducida_individuo on evaluacion_reducida (individuo_id, created_at desc);

alter table evaluacion_reducida enable row level security;

-- Mismo patrón que evaluaciones: SELECT/INSERT autenticados, UPDATE admin-only, sin hard-delete.
create policy evaluacion_reducida_select_autenticados on evaluacion_reducida for select using (auth.uid() is not null);
create policy evaluacion_reducida_insert_autenticados on evaluacion_reducida for insert with check (auth.uid() is not null and created_by = auth.uid());
create policy evaluacion_reducida_update_admin on evaluacion_reducida for update using (es_admin()) with check (es_admin());
create policy evaluacion_reducida_delete_nadie on evaluacion_reducida for delete using (false);

grant select, insert, update on evaluacion_reducida to authenticated;
grant all on evaluacion_reducida to service_role;

create or replace function auditar_escritura_evaluacion_reducida()
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
    values (auth.uid(), v_planta_id, 'creacion_evaluacion_reducida', array['fase', 'talla', 'numero_entrenudos', 'vigor', 'multibrotes', 'presencia_raices'],
      jsonb_build_object('evaluacion_id', new.id, 'individuo_id', new.individuo_id, 'fase', new.fase));
  elsif tg_op = 'UPDATE' then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (auth.uid(), v_planta_id, 'edicion_evaluacion_reducida', array['fase', 'talla', 'numero_entrenudos', 'vigor', 'multibrotes', 'presencia_raices'],
      jsonb_build_object('evaluacion_id', new.id, 'individuo_id', new.individuo_id));
  end if;
  return new;
end;
$$;

create trigger trg_evaluacion_reducida_auditoria
  after insert or update on evaluacion_reducida
  for each row execute function auditar_escritura_evaluacion_reducida();


-- =============================================================================
-- RPC avanzar_fase_individuo — única vía para mover fase_actual. Valida que la
-- transición sea estrictamente hacia adelante en la secuencia (North Star v4,
-- principio: "no implementar navegación libre entre fases, decidido
-- explícitamente que no, por ahora").
-- =============================================================================
create or replace function avanzar_fase_individuo(p_individuo_id uuid, p_fase_nueva text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_actual    fase_individuo;
  v_planta_id uuid;
  v_orden     constant text[] := array['trasplante', 'crecimiento', 'evaluacion_anual', 'multisitio'];
  v_idx_actual int;
  v_idx_nueva  int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select fase_actual, planta_id into v_actual, v_planta_id from individuos where id = p_individuo_id;
  if not found then
    raise exception 'Individuo % no encontrado', p_individuo_id using errcode = 'P0002';
  end if;

  if p_fase_nueva not in ('trasplante', 'crecimiento', 'evaluacion_anual', 'multisitio') then
    raise exception 'Fase % inválida', p_fase_nueva using errcode = '22023';
  end if;

  v_idx_actual := array_position(v_orden, v_actual::text);
  v_idx_nueva  := array_position(v_orden, p_fase_nueva);

  if v_idx_nueva <> v_idx_actual + 1 then
    raise exception 'No se puede pasar de % a % — solo se puede avanzar una fase a la vez, en orden (%)', v_actual, p_fase_nueva, array_to_string(v_orden, ' → ')
      using errcode = '42501';
  end if;

  update individuos set fase_actual = p_fase_nueva::fase_individuo where id = p_individuo_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, v_planta_id, 'avance_fase_individuo', array['fase_actual'],
    jsonb_build_object('individuo_id', p_individuo_id, 'fase_anterior', v_actual, 'fase_nueva', p_fase_nueva));

  return jsonb_build_object('individuo_id', p_individuo_id, 'fase_actual', p_fase_nueva);
end;
$$;

comment on function avanzar_fase_individuo is 'Única vía para avanzar individuos.fase_actual. Solo permite avanzar una fase a la vez, en orden (sin navegación libre ni retroceso). Audita.';

grant execute on function avanzar_fase_individuo(uuid, text) to authenticated;
