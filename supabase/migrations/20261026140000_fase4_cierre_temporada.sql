-- Fase 4, paso 52 — «Cerrar temporada y congelar ranking» (decisión 7 de Kadel, 25-10-2026; EF3: «un cierre por año»).
--
-- Usa el mecanismo de rankings congelados que ya existe (ranking_snapshot y ranking_snapshot_resultado, como
-- congelar_ranking_grupos), con dos diferencias:
--   - congela el ranking por grupos de UNA temporada de la especie (la ronda anual N; R5: una ronda abre una temporada), no la
--     última ronda de cada individuo;
--   - el nombre lo pone la base: «Cierre temporada AAAA» (el año de esa ronda). Si ya existe un congelado con ese nombre en la
--     especie, NO se duplica ni se devuelve el anterior en silencio: avisa (23505) para que la pantalla lo diga.
-- `anio_temporada(especie, ronda)` da el año para que la pantalla lo muestre antes de confirmar.
-- Solo admin. Queda en la auditoría como cualquier congelado (accion congelacion_ranking, con la temporada).
--
-- Aditivo (dos funciones nuevas). Rollback: docs/fase4/rollback/52_cierre_temporada.sql (los congelados creados se conservan:
-- son historia).

create function public.anio_temporada(p_especie_id uuid, p_numero_ronda smallint)
returns integer
language sql
stable
set search_path = public
as $$
  -- El año más frecuente de esa ronda anual entre los individuos de la especie (a igual frecuencia, el mayor).
  select r.anio::integer
  from ronda_evaluacion_anual r
  join individuos i on i.id = r.individuo_id
  join plantas p on p.id = i.planta_id
  where p.especie_id = p_especie_id and p.eliminado_at is null
    and r.tipo_ronda = 'anual' and r.numero_ronda = p_numero_ronda and r.anio is not null
  group by r.anio
  order by count(*) desc, r.anio desc
  limit 1;
$$;
comment on function public.anio_temporada(uuid, smallint) is
  'Fase 4: año de la temporada (ronda anual N) de una especie: el más frecuente entre sus individuos.';
revoke all on function public.anio_temporada(uuid, smallint) from public, anon;
grant execute on function public.anio_temporada(uuid, smallint) to authenticated, service_role;

create function public.cerrar_temporada_ranking(p_especie_id uuid, p_numero_ronda smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_anio integer;
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
  if v_anio is null then
    raise exception 'La especie no tiene individuos en esa temporada' using errcode = '23514';
  end if;
  v_nombre := 'Cierre temporada ' || v_anio;

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
      'scoring_version_id', v_version_id, 'modo', 'grupos', 'cierre_temporada', true, 'numero_ronda', p_numero_ronda, 'anio', v_anio));

  return jsonb_build_object('snapshot_id', v_snapshot_id, 'nombre', v_nombre, 'poblacion', v_poblacion);
end;
$$;
comment on function public.cerrar_temporada_ranking(uuid, smallint) is
  'Fase 4: congela el ranking por grupos de una temporada (ronda anual N) de la especie como «Cierre temporada AAAA». Si ya existe ese nombre en la especie, avisa (23505). Solo admin.';
revoke all on function public.cerrar_temporada_ranking(uuid, smallint) from public, anon;
grant execute on function public.cerrar_temporada_ranking(uuid, smallint) to authenticated;
