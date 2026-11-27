-- =============================================================================
-- Sprint 2 / Bloque E: scoring versionado y ranking operativo seguro.
-- La configuración inicial traduce el orden aprobado firmeza > calibre > Brix
-- > bloom como pesos 4-3-2-1. Se identifica explícitamente como provisional.
-- =============================================================================

create type estado_scoring_version as enum ('borrador', 'activa', 'inactiva');
create type direccion_scoring as enum ('mayor', 'menor');
create type metodo_normalizacion_scoring as enum ('escala', 'rango_referencia');
create type tratamiento_nulos_scoring as enum ('excluir_evaluacion');

create table scoring_version (
  id                    uuid primary key default gen_random_uuid(),
  nombre                text not null unique check (btrim(nombre) <> ''),
  especie_id            uuid references especies (id) on delete restrict,
  fase                  estado_planta,
  vigente_desde         date not null,
  vigente_hasta         date,
  estado                estado_scoring_version not null default 'borrador',
  criterio_desempate    jsonb not null default '["puntaje_desc","fecha_evaluacion_desc","codigo_asc"]'::jsonb,
  nota                  text,
  aprobado_by           uuid references perfiles (id) on delete set null,
  aprobado_at           timestamptz,
  created_by            uuid references perfiles (id) on delete set null,
  updated_by            uuid references perfiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta >= vigente_desde),
  check (jsonb_typeof(criterio_desempate) = 'array')
);

create unique index scoring_version_activa_por_alcance
  on scoring_version (especie_id, fase)
  nulls not distinct
  where estado = 'activa';

create table scoring_metrica (
  id                       uuid primary key default gen_random_uuid(),
  scoring_version_id       uuid not null references scoring_version (id) on delete restrict,
  metrica                  text not null check (btrim(metrica) <> ''),
  peso                     numeric not null check (peso > 0),
  direccion_favorable      direccion_scoring not null default 'mayor',
  metodo_normalizacion     metodo_normalizacion_scoring not null,
  minimo_normalizacion     numeric,
  maximo_normalizacion     numeric,
  rango_referencia_id      uuid references rango_referencia (id) on delete restrict,
  tratamiento_nulos        tratamiento_nulos_scoring not null default 'excluir_evaluacion',
  orden                    smallint not null,
  created_at               timestamptz not null default now(),
  unique (scoring_version_id, metrica),
  unique (scoring_version_id, orden),
  check (
    (metodo_normalizacion = 'escala'
      and minimo_normalizacion is not null
      and maximo_normalizacion is not null
      and maximo_normalizacion > minimo_normalizacion
      and rango_referencia_id is null)
    or
    (metodo_normalizacion = 'rango_referencia'
      and rango_referencia_id is not null
      and minimo_normalizacion is null
      and maximo_normalizacion is null)
  )
);

comment on table scoring_version is
  'Versiones reproducibles de scoring. Una versión activa por especie/fase; el nombre y nota deben declarar configuraciones provisionales.';
comment on table scoring_metrica is
  'Métricas, pesos, dirección, normalización y tratamiento de nulos pertenecientes a una versión de scoring.';

create or replace function mantener_scoring_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_scoring_version_metadata
  before insert or update on scoring_version
  for each row execute function mantener_scoring_version();

alter table scoring_version enable row level security;
alter table scoring_metrica enable row level security;

create policy scoring_version_select_autenticados on scoring_version
  for select using (auth.uid() is not null);
create policy scoring_version_admin_inserta on scoring_version
  for insert with check (es_admin());
create policy scoring_version_admin_actualiza on scoring_version
  for update using (es_admin()) with check (es_admin());

create policy scoring_metrica_select_autenticados on scoring_metrica
  for select using (auth.uid() is not null);
create policy scoring_metrica_admin_inserta on scoring_metrica
  for insert with check (es_admin());
create policy scoring_metrica_admin_actualiza on scoring_metrica
  for update using (es_admin()) with check (es_admin());

-- No se habilita DELETE: versiones usadas por snapshots deben permanecer.
grant select, insert, update on scoring_version, scoring_metrica to authenticated;
grant all on scoring_version, scoring_metrica to service_role;

with nueva_version as (
  insert into scoring_version (
    nombre, especie_id, fase, vigente_desde, estado,
    criterio_desempate, nota
  ) values (
    'Selección de fruto v1 provisional (4-3-2-1)',
    null,
    'evaluacion_anual',
    date '2026-01-01',
    'activa',
    '["puntaje_desc","fecha_evaluacion_desc","codigo_asc"]'::jsonb,
    'Pesos provisionales que traducen el orden aprobado firmeza > calibre > Brix > bloom; pendientes de validación científica por Efraín.'
  )
  returning id
), referencias as (
  select metrica, id
  from rango_referencia
  where especie_id is null
    and fase = 'evaluacion_anual'
    and vigente_desde = date '2026-01-01'
    and metrica in ('calibre_mm', 'brix')
)
insert into scoring_metrica (
  scoring_version_id, metrica, peso, direccion_favorable,
  metodo_normalizacion, minimo_normalizacion, maximo_normalizacion,
  rango_referencia_id, tratamiento_nulos, orden
)
select nv.id, m.metrica, m.peso, 'mayor', m.metodo,
       m.minimo, m.maximo, r.id, 'excluir_evaluacion', m.orden
from nueva_version nv
cross join (values
  ('firmeza'::text,    4::numeric, 'escala'::metodo_normalizacion_scoring, 1::numeric, 5::numeric, null::text, 1::smallint),
  ('calibre_mm'::text, 3::numeric, 'rango_referencia', null::numeric, null::numeric, 'calibre_mm'::text, 2::smallint),
  ('brix'::text,       2::numeric, 'rango_referencia', null::numeric, null::numeric, 'brix'::text, 3::smallint),
  ('bloom'::text,      1::numeric, 'escala', 1::numeric, 5::numeric, null::text, 4::smallint)
) as m(metrica, peso, metodo, minimo, maximo, referencia_metrica, orden)
left join referencias r on r.metrica = m.referencia_metrica;

create or replace function normalizar_metrica_scoring(
  p_valor numeric,
  p_minimo numeric,
  p_maximo numeric,
  p_direccion direccion_scoring
)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when p_valor is null or p_minimo is null or p_maximo is null or p_maximo <= p_minimo then null
    when p_direccion = 'menor' then
      greatest(0::numeric, least(1::numeric, (p_maximo - p_valor) / (p_maximo - p_minimo)))
    else
      greatest(0::numeric, least(1::numeric, (p_valor - p_minimo) / (p_maximo - p_minimo)))
  end;
$$;

create or replace function resolver_scoring_version(
  p_especie_id uuid,
  p_fase estado_planta default 'evaluacion_anual',
  p_fecha date default current_date
)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select sv.id
  from scoring_version sv
  where sv.estado = 'activa'
    and (sv.especie_id = p_especie_id or sv.especie_id is null)
    and (sv.fase = p_fase or sv.fase is null)
    and sv.vigente_desde <= p_fecha
    and (sv.vigente_hasta is null or sv.vigente_hasta >= p_fecha)
  order by
    (sv.especie_id is not null) desc,
    (sv.fase is not null) desc,
    sv.vigente_desde desc,
    sv.created_at desc
  limit 1;
$$;

create or replace function calcular_ranking_operativo(
  p_scoring_version_id uuid,
  p_planta_id uuid default null,
  p_especie_id uuid default null
)
returns table (
  individuo_id uuid,
  codigo_display text,
  planta_id uuid,
  codigo_sistema text,
  especie_id uuid,
  evaluacion_id uuid,
  fecha_evaluacion date,
  evaluacion_updated_at timestamptz,
  numero_ronda smallint,
  estado_evaluacion estado_evaluacion,
  requiere_revision boolean,
  no_comparable boolean,
  scoring_version_id uuid,
  scoring_version_nombre text,
  puntaje_ponderado numeric,
  elegible boolean,
  motivo_exclusion text,
  detalle_metricas jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with alcance as (
    select
      i.id as individuo_id,
      i.codigo_display,
      i.planta_id,
      p.codigo_sistema,
      p.especie_id
    from individuos i
    join plantas p on p.id = i.planta_id
    where i.estado_vital = 'vivo'
      and p.eliminado_at is null
      and (p_planta_id is null or p.id = p_planta_id)
      and (p_especie_id is null or p.especie_id = p_especie_id)
  ), ultima_ronda as (
    select distinct on (r.individuo_id)
      r.individuo_id,
      r.id as ronda_id,
      r.numero_ronda
    from ronda_evaluacion_anual r
    join alcance a on a.individuo_id = r.individuo_id
    order by r.individuo_id, r.numero_ronda desc, r.created_at desc, r.id desc
  ), base as (
    select
      a.*,
      ur.numero_ronda,
      e.id as evaluacion_id,
      e.fecha as fecha_evaluacion,
      e.updated_at as evaluacion_updated_at,
      e.estado as estado_evaluacion,
      e.requiere_revision,
      e.no_comparable,
      e.brotacion, e.floracion, e.cuaja, e.concentracion_cosecha,
      e.calibre_mm, e.firmeza, e.color, e.bloom, e.brix,
      e.rend_kg_planta, e.rend_t_ha, e.pct_fruta_exportable,
      e.dano_calor, e.golpe_sol, e.caida_fruto,
      sv.id as scoring_version_id,
      sv.nombre as scoring_version_nombre
    from alcance a
    left join ultima_ronda ur on ur.individuo_id = a.individuo_id
    left join lateral (
      select ev.*
      from evaluaciones ev
      where ev.ronda_id = ur.ronda_id
        and ev.estado in ('completa', 'corregida')
      order by ev.fecha desc, ev.updated_at desc, ev.id desc
      limit 1
    ) e on true
    left join scoring_version sv on sv.id = p_scoring_version_id
  ), calculado as (
    select
      b.*,
      metricas.configuradas,
      metricas.disponibles,
      metricas.puntaje,
      metricas.detalle
    from base b
    left join lateral (
      select
        count(sm.id)::integer as configuradas,
        count(valor.valor)::integer as disponibles,
        case
          when sum(sm.peso) filter (where valor.valor is not null) > 0 then
            sum(
              normalizar_metrica_scoring(
                valor.valor,
                coalesce(rr.minimo_esperado, sm.minimo_normalizacion),
                coalesce(rr.maximo_esperado, sm.maximo_normalizacion),
                sm.direccion_favorable
              ) * sm.peso
            ) filter (where valor.valor is not null)
            / sum(sm.peso) filter (where valor.valor is not null)
          else null
        end as puntaje,
        coalesce(
          jsonb_object_agg(
            sm.metrica,
            jsonb_build_object(
              'valor', valor.valor,
              'peso', sm.peso,
              'normalizado', normalizar_metrica_scoring(
                valor.valor,
                coalesce(rr.minimo_esperado, sm.minimo_normalizacion),
                coalesce(rr.maximo_esperado, sm.maximo_normalizacion),
                sm.direccion_favorable
              )
            )
          ) filter (where sm.id is not null),
          '{}'::jsonb
        ) as detalle
      from scoring_metrica sm
      left join rango_referencia rr on rr.id = sm.rango_referencia_id
      left join lateral (
        select case sm.metrica
          when 'brotacion' then b.brotacion::numeric
          when 'floracion' then b.floracion::numeric
          when 'cuaja' then b.cuaja::numeric
          when 'concentracion_cosecha' then b.concentracion_cosecha::numeric
          when 'calibre_mm' then b.calibre_mm
          when 'firmeza' then b.firmeza::numeric
          when 'color' then b.color::numeric
          when 'bloom' then b.bloom::numeric
          when 'brix' then b.brix
          when 'rend_kg_planta' then b.rend_kg_planta
          when 'rend_t_ha' then b.rend_t_ha
          when 'pct_fruta_exportable' then b.pct_fruta_exportable
          when 'dano_calor' then b.dano_calor::numeric
          when 'golpe_sol' then b.golpe_sol::numeric
          when 'caida_fruto' then b.caida_fruto::numeric
          else null
        end as valor
      ) valor on true
      where sm.scoring_version_id = b.scoring_version_id
    ) metricas on true
  )
  select
    c.individuo_id,
    c.codigo_display,
    c.planta_id,
    c.codigo_sistema,
    c.especie_id,
    c.evaluacion_id,
    c.fecha_evaluacion,
    c.evaluacion_updated_at,
    c.numero_ronda,
    c.estado_evaluacion,
    coalesce(c.requiere_revision, false),
    coalesce(c.no_comparable, false),
    c.scoring_version_id,
    c.scoring_version_nombre,
    case
      when c.evaluacion_id is not null
        and not coalesce(c.requiere_revision, false)
        and not coalesce(c.no_comparable, false)
        and c.configuradas > 0
        and c.disponibles = c.configuradas
      then round(c.puntaje, 4)
      else null
    end,
    c.evaluacion_id is not null
      and not coalesce(c.requiere_revision, false)
      and not coalesce(c.no_comparable, false)
      and c.configuradas > 0
      and c.disponibles = c.configuradas,
    case
      when c.numero_ronda is null then 'sin_ronda'
      when c.evaluacion_id is null then 'sin_evaluacion_completa_en_ronda_actual'
      when c.requiere_revision then 'requiere_revision'
      when c.no_comparable then 'no_comparable'
      when c.scoring_version_id is null then 'sin_version_scoring'
      when c.configuradas = 0 then 'version_sin_metricas'
      when c.disponibles < c.configuradas then 'faltan_metricas_scoring'
      else null
    end,
    coalesce(c.detalle, '{}'::jsonb)
  from calculado c;
$$;

revoke all on function calcular_ranking_operativo(uuid, uuid, uuid) from public, anon;
grant execute on function calcular_ranking_operativo(uuid, uuid, uuid) to authenticated, service_role;

create or replace function obtener_ranking_operativo(
  p_planta_id uuid default null,
  p_especie_id uuid default null,
  p_limite integer default 25,
  p_offset integer default 0,
  p_orden text default 'puntaje_desc'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_especie_id uuid := p_especie_id;
  v_version_id uuid;
  v_version_nombre text;
  v_desempate jsonb;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if (p_planta_id is null) = (p_especie_id is null) then
    raise exception 'Indica exactamente un cruce o una especie' using errcode = '22023';
  end if;
  if p_limite < 1 or p_limite > 100 or p_offset < 0 then
    raise exception 'Paginación inválida' using errcode = '22023';
  end if;
  if p_orden not in ('puntaje_desc', 'puntaje_asc', 'codigo_asc', 'fecha_desc') then
    raise exception 'Orden no permitido' using errcode = '22023';
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
  select nombre, criterio_desempate
    into v_version_nombre, v_desempate
  from scoring_version
  where id = v_version_id;

  with base as materialized (
    select *
    from calcular_ranking_operativo(v_version_id, p_planta_id, p_especie_id)
  ), posicionado as (
    select
      b.*,
      case when b.elegible then row_number() over (
        order by b.puntaje_ponderado desc,
                 b.fecha_evaluacion desc,
                 b.evaluacion_updated_at desc,
                 b.codigo_display asc
      ) end as posicion
    from base b
  ), pagina as (
    select *
    from posicionado
    order by
      case when p_orden = 'puntaje_desc' then puntaje_ponderado end desc nulls last,
      case when p_orden = 'puntaje_asc' then puntaje_ponderado end asc nulls last,
      case when p_orden = 'fecha_desc' then fecha_evaluacion end desc nulls last,
      case when p_orden = 'codigo_asc' then codigo_display end asc,
      codigo_display asc
    limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(pagina)) from pagina), '[]'::jsonb),
    'total', (select count(*) from base),
    'poblacion_comparada', (select count(*) from base where elegible),
    'limite', p_limite,
    'offset', p_offset,
    'orden', p_orden,
    'scoring_version_id', v_version_id,
    'scoring_version_nombre', v_version_nombre,
    'criterios', jsonb_build_object(
      'alcance', case when p_planta_id is null then 'especie' else 'cruzamiento' end,
      'seleccion_evaluacion', 'ultima completa/corregida de la ronda mas reciente; fecha y updated_at como desempate',
      'exclusiones', jsonb_build_array('borrador', 'anulada', 'requiere_revision', 'no_comparable', 'metricas_incompletas'),
      'desempate', coalesce(v_desempate, '[]'::jsonb)
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function obtener_ranking_operativo(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function obtener_ranking_operativo(uuid, uuid, integer, integer, text) to authenticated, service_role;

-- La vista legacy no es reproducible y mezclaba poblaciones para min-max.
-- Se conserva por compatibilidad de esquema, pero deja de ser API pública.
revoke select on individuos_scoring from authenticated;
comment on view individuos_scoring is
  'DEPRECADA: scoring legacy no reproducible. Usar obtener_ranking_operativo().';

