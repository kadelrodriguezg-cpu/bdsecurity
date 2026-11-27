-- =============================================================================
-- MIGRACIÓN 20261026160000 — FASE 5, PASO 54: ETIQUETA DE TEMPORADA Y NOMBRE EDITABLE DEL CIERRE (decisión G2)
--
-- Hallazgo 2 de la guía del administrador. La temporada NO es una entidad nueva ni se abre: sigue siendo la ronda
-- anual N (R5). No hay tabla de temporadas y no cambia el año guardado en las rondas (`ronda_evaluacion_anual.anio`).
-- Solo cambia la etiqueta que se calcula para mostrar (aclaración de Kadel, 26-10-2026): una ronda iniciada entre
-- julio y diciembre de AAAA es de la temporada «AAAA-AAAA+1»; una iniciada entre enero y junio de AAAA, de la
-- «AAAA-1-AAAA». La fecha de inicio es `fecha_inicio` y, si falta, el día (en Chile) en que se creó la ronda.
--
--   etiqueta_temporada(fecha)            la regla, en un solo lugar.
--   temporada_sugerida(especie, ronda)   la etiqueta más frecuente de la ronda anual N entre las plantas de la especie
--                                        (misma población que anio_temporada: cruces no archivados).
--   temporadas_especie(especie)          etiqueta por cruce y serie (anual y multisitio) y, con planta_id nulo, la de
--                                        toda la especie por ronda anual; la usan las listas de Cruces y Resultados.
--   cerrar_temporada_ranking(especie, ronda, nombre)
--                                        reemplaza a la de dos argumentos (paso 52): nombre sugerido «Temporada
--                                        AAAA-AAAA+1», editable; si ya existe ese nombre en la especie, avisa (23505).
--                                        Llamada con dos argumentos (la app anterior) sigue funcionando con el sugerido.
-- anio_temporada no cambia (la usa la app anterior).
-- Rollback: docs/fase5/rollback/54_temporada.sql (vuelve a la función del paso 52; los congelados creados se conservan).
-- =============================================================================

create function public.etiqueta_temporada(p_fecha date)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_fecha is null then null
    when extract(month from p_fecha) >= 7 then extract(year from p_fecha)::int || '-' || (extract(year from p_fecha)::int + 1)
    else (extract(year from p_fecha)::int - 1) || '-' || extract(year from p_fecha)::int
  end;
$$;
comment on function public.etiqueta_temporada(date) is
  'Fase 5 (G2): etiqueta de temporada de una fecha de inicio de ronda: julio a diciembre de AAAA = «AAAA-AAAA+1»; enero a junio = «AAAA-1-AAAA».';
revoke all on function public.etiqueta_temporada(date) from public, anon;
grant execute on function public.etiqueta_temporada(date) to authenticated, service_role;

create function public.temporada_sugerida(p_especie_id uuid, p_numero_ronda smallint)
returns text
language sql
stable
set search_path = public
as $$
  -- La etiqueta más frecuente de esa ronda anual entre los individuos de la especie (a igual frecuencia, la más reciente).
  select t.etiqueta
  from (
    select etiqueta_temporada(coalesce(r.fecha_inicio, (r.created_at at time zone 'America/Santiago')::date)) as etiqueta
    from ronda_evaluacion_anual r
    join individuos i on i.id = r.individuo_id
    join plantas p on p.id = i.planta_id
    where p.especie_id = p_especie_id and p.eliminado_at is null
      and r.tipo_ronda = 'anual' and r.numero_ronda = p_numero_ronda
  ) t
  where t.etiqueta is not null
  group by t.etiqueta
  order by count(*) desc, t.etiqueta desc
  limit 1;
$$;
comment on function public.temporada_sugerida(uuid, smallint) is
  'Fase 5 (G2): etiqueta de temporada de la ronda anual N de una especie: la más frecuente entre sus individuos.';
revoke all on function public.temporada_sugerida(uuid, smallint) from public, anon;
grant execute on function public.temporada_sugerida(uuid, smallint) to authenticated, service_role;

create function public.temporadas_especie(p_especie_id uuid)
returns table (planta_id uuid, tipo_ronda public.tipo_ronda, numero_ronda smallint, etiqueta text)
language sql
stable
set search_path = public
as $$
  with base as (
    select i.planta_id, r.tipo_ronda, r.numero_ronda,
      etiqueta_temporada(coalesce(r.fecha_inicio, (r.created_at at time zone 'America/Santiago')::date)) as etiqueta
    from ronda_evaluacion_anual r
    join individuos i on i.id = r.individuo_id
    join plantas p on p.id = i.planta_id
    where p.especie_id = p_especie_id and p.eliminado_at is null
  ),
  por_cruce as (
    select distinct on (b.planta_id, b.tipo_ronda, b.numero_ronda) b.planta_id, b.tipo_ronda, b.numero_ronda, b.etiqueta
    from (select planta_id, tipo_ronda, numero_ronda, etiqueta, count(*) as n from base where etiqueta is not null group by 1, 2, 3, 4) b
    order by b.planta_id, b.tipo_ronda, b.numero_ronda, b.n desc, b.etiqueta desc
  )
  select planta_id, tipo_ronda, numero_ronda, etiqueta from por_cruce
  union all
  select null::uuid, 'anual'::public.tipo_ronda, s.numero_ronda, temporada_sugerida(p_especie_id, s.numero_ronda)
  from (select distinct numero_ronda from base where tipo_ronda = 'anual') s;
$$;
comment on function public.temporadas_especie(uuid) is
  'Fase 5 (G2): etiqueta de temporada por cruce y serie de rondas y, con planta_id nulo, la de toda la especie por ronda anual. Sin linaje.';
revoke all on function public.temporadas_especie(uuid) from public, anon;
grant execute on function public.temporadas_especie(uuid) to authenticated, service_role;

drop function public.cerrar_temporada_ranking(uuid, smallint);

create function public.cerrar_temporada_ranking(p_especie_id uuid, p_numero_ronda smallint, p_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_anio integer;
  v_temporada text;
  v_nombre text;
  v_version_id uuid;
  v_version_nombre text;
  v_minimo integer;
  v_snapshot_id uuid;
  v_poblacion integer;
  v_resultados jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede cerrar una temporada' using errcode = '42501';
  end if;
  if p_especie_id is null or not exists (select 1 from especies where id = p_especie_id) then
    raise exception 'Especie no encontrada' using errcode = 'P0002';
  end if;
  if p_numero_ronda is null or p_numero_ronda not between 1 and 3 then
    raise exception 'Temporada inválida' using errcode = '22023';
  end if;

  v_anio := anio_temporada(p_especie_id, p_numero_ronda);
  v_temporada := temporada_sugerida(p_especie_id, p_numero_ronda);
  if v_anio is null or v_temporada is null then
    raise exception 'La especie no tiene individuos en esa temporada' using errcode = '23514';
  end if;
  -- G2: el nombre sugerido es «Temporada AAAA-AAAA+1»; el admin puede escribir otro.
  v_nombre := coalesce(nullif(btrim(coalesce(p_nombre, '')), ''), 'Temporada ' || v_temporada);
  if length(v_nombre) > 120 then
    raise exception 'El nombre puede tener hasta 120 caracteres' using errcode = '22023';
  end if;

  -- El nombre identifica el congelado dentro de su alcance (mismo candado que congelar_ranking_grupos). Si ya existe: se avisa.
  perform pg_advisory_xact_lock(hashtextextended('snapshot:especie:' || p_especie_id::text || ':' || lower(v_nombre), 0));
  if exists (
    select 1 from ranking_snapshot
    where planta_id is null and especie_id = p_especie_id and lower(btrim(nombre)) = lower(v_nombre)
  ) then
    raise exception 'Ya existe «%» en esta especie', v_nombre using errcode = '23505';
  end if;

  v_version_id := resolver_scoring_version(p_especie_id, 'evaluacion_anual', current_date);
  if v_version_id is null then
    raise exception 'No hay versión activa de scoring para este alcance' using errcode = '23514';
  end if;
  select nombre into v_version_nombre from scoring_version where id = v_version_id;
  select minimo_evaluaciones_grupo into v_minimo from configuracion_ranking where id = 1;

  -- Una sola lectura del ranking de esa temporada (A1-152); sin cruces de prueba.
  select coalesce(jsonb_agg(to_jsonb(fila) order by fila.posicion), '[]'::jsonb) into v_resultados
  from (
    select r.individuo_id, r.codigo_display, r.evaluacion_id,
      (row_number() over (order by r.grupo, r.posicion_grupo))::integer as posicion,
      r.posicion_grupo, r.grupo, r.cobertura,
      r.puntaje,
      jsonb_build_object('fecha_evaluacion', r.fecha_evaluacion,
        'numero_ronda', r.numero_ronda, 'estado_evaluacion', r.estado_evaluacion,
        'scoring_version_id', r.scoring_version_id, 'scoring_version_nombre', r.scoring_version_nombre,
        'metricas', r.detalle_metricas, 'categorias', r.detalle_categorias,
        'tamano_grupo', r.tamano_grupo) as detalle
    from calcular_ranking_grupos(v_version_id, null, p_especie_id, true, false, v_minimo, p_numero_ronda) r
    where r.posicion_grupo is not null
  ) fila;
  v_poblacion := jsonb_array_length(v_resultados);
  if v_poblacion = 0 then
    raise exception 'La temporada no tiene grupos con posición para congelar' using errcode = '23514';
  end if;

  insert into ranking_snapshot (nombre, alcance, scoring_version_id, especie_id, planta_id, poblacion_comparada, criterios, created_by)
  values (
    v_nombre, 'especie', v_version_id, p_especie_id, null, v_poblacion,
    jsonb_build_object(
      'modo', 'grupos',
      'cierre_temporada', true,
      'numero_ronda', p_numero_ronda,
      'anio', v_anio,
      'temporada', v_temporada,
      'scoring_version_nombre', v_version_nombre,
      'grupo', 'combinacion de categorias del motor con al menos una metrica con valor',
      'minimo_evaluaciones_grupo', v_minimo,
      'seleccion_evaluacion', 'evaluacion unificada de la ronda anual de la temporada',
      'exclusiones', jsonb_build_array('borrador', 'anulada', 'excluida_revision', 'no_comparable', 'sin_datos', 'pocas_plantas', 'es_prueba'),
      'orden', jsonb_build_array('puntaje_desc'),
      'empates', 'mismo puntaje (4 decimales) comparte posicion en el grupo; sin desempate por codigo'
    ),
    v_uid
  ) returning id into v_snapshot_id;

  insert into ranking_snapshot_resultado (snapshot_id, individuo_id, codigo_display, evaluacion_id, posicion, puntaje, detalle, grupo, cobertura, posicion_grupo)
  select v_snapshot_id, r.individuo_id, r.codigo_display, r.evaluacion_id, r.posicion, r.puntaje, r.detalle, r.grupo, r.cobertura, r.posicion_grupo
  from jsonb_to_recordset(v_resultados) as r(
    individuo_id uuid, codigo_display text, evaluacion_id uuid, posicion integer, puntaje numeric, detalle jsonb,
    grupo text[], cobertura jsonb, posicion_grupo integer
  );

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, null, 'congelacion_ranking',
    array['scoring_version_id', 'evaluacion_id', 'puntaje', 'grupo'],
    jsonb_build_object('snapshot_id', v_snapshot_id, 'especie_id', p_especie_id, 'poblacion', v_poblacion,
      'scoring_version_id', v_version_id, 'modo', 'grupos', 'cierre_temporada', true, 'numero_ronda', p_numero_ronda, 'anio', v_anio, 'temporada', v_temporada));

  return jsonb_build_object('snapshot_id', v_snapshot_id, 'nombre', v_nombre, 'poblacion', v_poblacion);
end;
$$;
comment on function public.cerrar_temporada_ranking(uuid, smallint, text) is
  'Fase 5 (G2): congela el ranking por grupos de una temporada (ronda anual N) de la especie. Nombre sugerido «Temporada AAAA-AAAA+1», editable (hasta 120 caracteres). Si ya existe ese nombre en la especie, avisa (23505). Solo admin.';
revoke all on function public.cerrar_temporada_ranking(uuid, smallint, text) from public, anon;
grant execute on function public.cerrar_temporada_ranking(uuid, smallint, text) to authenticated;
