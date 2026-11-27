-- =============================================================================
-- MIGRACIÓN 20260811000400 — EVECL: RPC de consulta (Sprint E2, parte 1/3)
--
-- evecl_obtener_ensayos, evecl_obtener_ficha, evecl_obtener_fichas,
-- evecl_obtener_catalogo (sección 9.4.1). Todas SECURITY DEFINER con
-- search_path fijo, según lo pide 9.4 y el prompt E2 — aunque el RLS de
-- las tablas evecl_* ya alcanzaría por sí solo (ninguna es SECURITY
-- DEFINER-only como obtener_planta), se sigue el patrón pedido
-- explícitamente. Como SECURITY DEFINER bypassa RLS, cada función replica a
-- mano las mismas condiciones que exigirían las policies (auth.uid() no
-- nulo, eliminado_at is null) para no abrir una puerta más ancha que la que
-- el RLS ya definía.
--
-- evecl_obtener_ficha filtra eliminado_at is null sin excepción — la
-- lección explícita de obtener_planta() (nunca filtró durante 3 versiones)
-- no se repite acá.
-- =============================================================================


-- =============================================================================
-- evecl_obtener_ensayos() — lista de ensayos activos con conteo de fichas y
-- variedades distintas (ambos excluyen fichas soft-deleted).
-- =============================================================================
create or replace function evecl_obtener_ensayos()
returns table (
  id                bigint,
  codigo_parcela    text,
  nombre_productor  text,
  empresa           text,
  encargado_predio  text,
  localidad         text,
  direccion         text,
  latitud           numeric,
  longitud          numeric,
  area_evaluada     text,
  notas             text,
  created_by        uuid,
  created_at        timestamptz,
  total_fichas      bigint,
  total_variedades  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  return query
  select
    e.id, e.codigo_parcela, e.nombre_productor, e.empresa, e.encargado_predio,
    e.localidad, e.direccion, e.latitud, e.longitud, e.area_evaluada, e.notas,
    e.created_by, e.created_at,
    count(f.id) filter (where f.eliminado_at is null) as total_fichas,
    count(distinct lower(trim(f.variedad))) filter (where f.eliminado_at is null) as total_variedades
  from evecl_ensayo e
  left join evecl_ficha f on f.ensayo_id = e.id
  where e.eliminado_at is null
  group by e.id
  order by e.created_at desc;
end;
$$;

comment on function evecl_obtener_ensayos is 'Lista de ensayos EVECL activos con conteo de fichas y variedades distintas (ambos excluyen soft-deleted).';

revoke all on function evecl_obtener_ensayos() from public, anon;
grant execute on function evecl_obtener_ensayos() to authenticated, service_role;


-- =============================================================================
-- evecl_obtener_ficha(p_ficha_id) — ficha + ensayo + respuestas con
-- descriptor resuelto. DEBE filtrar eliminado_at is null (no opcional).
-- =============================================================================
create or replace function evecl_obtener_ficha(p_ficha_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ficha     evecl_ficha;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select * into v_ficha from evecl_ficha where id = p_ficha_id and eliminado_at is null;
  if not found then
    raise exception 'Ficha % no encontrada', p_ficha_id using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'id',                v_ficha.id,
    'ensayo_id',          v_ficha.ensayo_id,
    'variedad',           v_ficha.variedad,
    'codigo_genotipo',    v_ficha.codigo_genotipo,
    'origen_cruza',       v_ficha.origen_cruza,
    'tipo',               v_ficha.tipo,
    'numero_repeticion',  v_ficha.numero_repeticion,
    'codigo_planta',      v_ficha.codigo_planta,
    'encargado',          v_ficha.encargado,
    'fecha_siembra',      v_ficha.fecha_siembra,
    'fecha_evaluacion',   v_ficha.fecha_evaluacion,
    'notas',              v_ficha.notas,
    'created_by',         v_ficha.created_by,
    'created_at',         v_ficha.created_at,
    'updated_at',         v_ficha.updated_at,
    'ensayo', (
      select jsonb_build_object(
        'id', e.id, 'codigo_parcela', e.codigo_parcela,
        'nombre_productor', e.nombre_productor, 'empresa', e.empresa,
        'localidad', e.localidad
      )
      from evecl_ensayo e
      where e.id = v_ficha.ensayo_id and e.eliminado_at is null
    ),
    'respuestas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'descriptor_id',   r.descriptor_id,
        'nota',            r.nota,
        'valor_numerico',  r.valor_numerico,
        'valor_texto',     r.valor_texto,
        'foto_path',       r.foto_path,
        'descriptor', jsonb_build_object(
          'nombre', d.nombre, 'tipo', d.tipo, 'eje', d.eje,
          'unidad', d.unidad, 'orden', d.orden
        )
      ) order by d.orden)
      from evecl_respuesta r
      join evecl_descriptor d on d.id = r.descriptor_id
      where r.ficha_id = v_ficha.id
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

comment on function evecl_obtener_ficha is 'Ficha EVECL completa (ensayo + respuestas con descriptor resuelto). Filtra eliminado_at is null siempre — ver lección de obtener_planta() en 9.4.1.';

revoke all on function evecl_obtener_ficha(bigint) from public, anon;
grant execute on function evecl_obtener_ficha(bigint) to authenticated, service_role;


-- =============================================================================
-- evecl_obtener_fichas(ensayo_id?, variedad?) — lista con completitud
-- (respondidos / total de descriptores activos).
-- =============================================================================
create or replace function evecl_obtener_fichas(p_ensayo_id bigint default null, p_variedad text default null)
returns table (
  id                  bigint,
  ensayo_id           bigint,
  variedad            text,
  tipo                evecl_tipo_ficha,
  numero_repeticion   int,
  codigo_planta       text,
  fecha_evaluacion    date,
  respondidos         bigint,
  total_descriptores  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total bigint;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select count(*) into v_total from evecl_descriptor where activo;

  return query
  select
    f.id, f.ensayo_id, f.variedad, f.tipo, f.numero_repeticion, f.codigo_planta, f.fecha_evaluacion,
    count(r.id) as respondidos,
    v_total as total_descriptores
  from evecl_ficha f
  left join evecl_respuesta r on r.ficha_id = f.id
  where f.eliminado_at is null
    and (p_ensayo_id is null or f.ensayo_id = p_ensayo_id)
    and (p_variedad is null or lower(trim(f.variedad)) = lower(trim(p_variedad)))
  group by f.id
  order by f.variedad, f.numero_repeticion;
end;
$$;

comment on function evecl_obtener_fichas is 'Lista de fichas EVECL (filtrable por ensayo y/o variedad) con completitud respondidos/total de descriptores activos.';

revoke all on function evecl_obtener_fichas(bigint, text) from public, anon;
grant execute on function evecl_obtener_fichas(bigint, text) to authenticated, service_role;


-- =============================================================================
-- evecl_obtener_catalogo() — los 27 descriptores activos con sus estados,
-- para alimentar el formulario de captura.
-- =============================================================================
create or replace function evecl_obtener_catalogo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',                de.id,
      'codigo_upov',        de.codigo_upov,
      'nombre',             de.nombre,
      'tipo',               de.tipo,
      'eje',                de.eje,
      'unidad',             de.unidad,
      'nota_especial',      de.nota_especial,
      'rankeable',          de.rankeable,
      'direccion_ranking',  de.direccion_ranking,
      'orden',              de.orden,
      'estados', coalesce((
        select jsonb_agg(jsonb_build_object('nota', es.nota, 'label', es.label, 'orden', es.orden) order by es.orden)
        from evecl_descriptor_estado es
        where es.descriptor_id = de.id
      ), '[]'::jsonb)
    ) order by de.orden
  ), '[]'::jsonb)
  into v_resultado
  from evecl_descriptor de
  where de.activo;

  return v_resultado;
end;
$$;

comment on function evecl_obtener_catalogo is 'Los 27 descriptores UPOV activos con sus estados, para el formulario de captura (FichaForm/DescriptorEstadoPicker en E3).';

revoke all on function evecl_obtener_catalogo() from public, anon;
grant execute on function evecl_obtener_catalogo() to authenticated, service_role;
