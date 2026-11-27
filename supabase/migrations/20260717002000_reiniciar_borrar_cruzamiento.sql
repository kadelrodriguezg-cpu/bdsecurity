-- =============================================================================
-- MIGRACIÓN 20260717002000 — Reiniciar y borrar cruzamiento (Prompt 7, Parte E)
-- =============================================================================

-- =============================================================================
-- 1) Soft-delete: columna eliminado_at (mismo patrón que registros_evento.eliminado_at)
-- =============================================================================
alter table plantas add column eliminado_at timestamptz;

comment on column plantas.eliminado_at is 'Soft-delete: NULL = activo. No NULL = borrado desde la app pero recuperable en la base (nunca DELETE físico salvo hard delete explícito vía borrar_cruzamiento).';

-- plantas_operativas (migración 004, columnas genetica_a/b/numero_notion_legacy
-- agregadas después): se redefine para excluir cruces soft-deleted por default.
-- No hay forma explícita de "ver los eliminados" en esta vista a propósito —
-- esa vista es la operativa de uso normal; el admin los ve por query directa
-- a `plantas` (ya tiene columnas de linaje reveladas por su rol, no hace
-- falta una segunda vista solo para esto).
create or replace view plantas_operativas
  with (security_invoker = on)
as
  select
    p.id,
    p.codigo_sistema,
    p.especie_id,
    e.nombre as especie_nombre,
    p.estado,
    p.created_at,
    p.updated_at,
    p.genetica_a,
    p.genetica_b,
    p.numero_notion_legacy
  from plantas p
  join especies e on e.id = p.especie_id
  where p.eliminado_at is null;

-- security_invoker=on evalúa el WHERE con los privilegios de quien consulta:
-- sin este grant, authenticated no puede ni siquiera filtrar por
-- eliminado_at aunque no la seleccione, y la vista entera falla con
-- "permission denied for table plantas" (detectado corriendo el suite de RLS
-- tras este cambio).
grant select (eliminado_at) on plantas to authenticated;


-- =============================================================================
-- 2) RPC reiniciar_cruzamiento — solo admin. Borra datos de fase (columnas de
-- plantas + satélites de cruce), vuelve estado a sin_empezar. NO TOCA
-- individuos ni lo que cuelga de ellos — si el cruce ya individualizó, esos
-- individuos quedan intactos (posible estado "raro": cruce sin_empezar con
-- individuos ya creados). Esto es intencional, no se resuelve acá — se
-- reporta en el resultado (n_individuos_preexistentes) para que la UI lo
-- muestre explícitamente al admin.
-- =============================================================================
create or replace function reiniciar_cruzamiento(p_planta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_planta      plantas;
  v_n_individuos int;
  v_snapshot    jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede reiniciar un cruzamiento' using errcode = '42501';
  end if;

  select * into v_planta from plantas where id = p_planta_id;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  select count(*) into v_n_individuos from individuos where planta_id = p_planta_id;

  -- Snapshot COMPLETO antes de borrar nada, para que el audit_log sea trazable
  -- (qué contenía, no solo "se reinició").
  v_snapshot := jsonb_build_object(
    'estado_anterior', v_planta.estado,
    'fecha_polinizacion', v_planta.fecha_polinizacion,
    'n_flores_cruzadas', v_planta.n_flores_cruzadas,
    'fecha_cosecha', v_planta.fecha_cosecha,
    'n_semillas', v_planta.n_semillas,
    'escarificacion_subtipo', v_planta.escarificacion_subtipo,
    'escarificacion_duracion_dias', v_planta.escarificacion_duracion_dias,
    'contenedor_id', v_planta.contenedor_id,
    'predio_id', v_planta.predio_id,
    'n_individuos_preexistentes', v_n_individuos,
    'n_registros_evento', (select count(*) from registros_evento where planta_id = p_planta_id),
    'n_germinacion_eventos', (select count(*) from germinacion_evento where planta_id = p_planta_id),
    'n_cosecha_frutos', (select count(*) from cosecha_fruto where planta_id = p_planta_id),
    'n_insumos', (select count(*) from plantas_insumo where planta_id = p_planta_id)
  );

  delete from registros_evento where planta_id = p_planta_id;
  delete from germinacion_evento where planta_id = p_planta_id;
  delete from cosecha_fruto where planta_id = p_planta_id;
  delete from plantas_insumo where planta_id = p_planta_id;

  update plantas set
    estado = 'sin_empezar',
    fecha_polinizacion = null,
    n_flores_cruzadas = null,
    fecha_cosecha = null,
    n_semillas = null,
    escarificacion_subtipo = null,
    escarificacion_duracion_dias = null,
    contenedor_id = null,
    predio_id = null
  where id = p_planta_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'reinicio_cruzamiento', array['*'], v_snapshot);

  return jsonb_build_object('planta_id', p_planta_id, 'snapshot', v_snapshot, 'n_individuos_preexistentes', v_n_individuos);
end;
$$;

comment on function reiniciar_cruzamiento is 'Solo admin. Vuelve plantas.estado a sin_empezar y borra datos de fase del cruce (no toca individuos). Audita snapshot completo antes de borrar.';

grant execute on function reiniciar_cruzamiento(uuid) to authenticated;


-- =============================================================================
-- 3) RPC borrar_cruzamiento — solo admin. p_tipo: 'soft' (marca eliminado_at,
-- recuperable) o 'hard' (elimina todo, irreversible). El ON DELETE RESTRICT
-- de individuos->plantas (Prompt 2) NO se toca a nivel de schema — el hard
-- delete borra explícitamente en el orden correcto dentro de esta función,
-- controlado, en vez de abrir CASCADE global.
-- =============================================================================
create or replace function borrar_cruzamiento(p_planta_id uuid, p_tipo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_planta         plantas;
  v_n_individuos   int;
  v_n_evaluaciones int;
  v_n_pcr          int;
  v_n_rondas       int;
  v_n_eventos      int;
  v_snapshot       jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not es_admin() then
    raise exception 'Solo un admin puede borrar un cruzamiento' using errcode = '42501';
  end if;
  if p_tipo not in ('soft', 'hard') then
    raise exception 'p_tipo debe ser ''soft'' o ''hard'' (recibido: %)', p_tipo using errcode = '22023';
  end if;

  select * into v_planta from plantas where id = p_planta_id;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  select count(*) into v_n_individuos from individuos where planta_id = p_planta_id;
  select count(*) into v_n_evaluaciones
    from evaluaciones e join ronda_evaluacion_anual r on r.id = e.ronda_id join individuos i on i.id = r.individuo_id
    where i.planta_id = p_planta_id;
  select count(*) into v_n_pcr
    from pcr_analisis pc join ronda_evaluacion_anual r on r.id = pc.ronda_id join individuos i on i.id = r.individuo_id
    where i.planta_id = p_planta_id;
  select count(*) into v_n_rondas
    from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id
    where i.planta_id = p_planta_id;
  select count(*) into v_n_eventos from registros_evento where planta_id = p_planta_id;

  -- Snapshot ANTES de borrar (aunque sea hard delete), para que quede
  -- registro trazable de qué contenía el cruce.
  v_snapshot := jsonb_build_object(
    'codigo_sistema', v_planta.codigo_sistema,
    'estado', v_planta.estado,
    'especie_id', v_planta.especie_id,
    'n_individuos', v_n_individuos,
    'n_evaluaciones', v_n_evaluaciones,
    'n_pcr', v_n_pcr,
    'n_rondas', v_n_rondas,
    'n_registros_evento', v_n_eventos,
    'tipo_borrado', p_tipo
  );

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (v_uid, p_planta_id, 'borrado_cruzamiento_' || p_tipo, array['*'], v_snapshot);

  if p_tipo = 'soft' then
    update plantas set eliminado_at = now() where id = p_planta_id;
  else
    -- Hard delete controlado, en el orden correcto de dependencias (ver
    -- comentario de cabecera). plantas_insumo, registros_evento (y su
    -- evento_archivos) y audit_log (set null) ya tienen ON DELETE
    -- CASCADE/SET NULL automático hacia plantas — no necesitan DELETE explícito.
    delete from evaluaciones
      where ronda_id in (select r.id from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id where i.planta_id = p_planta_id);
    delete from pcr_analisis
      where ronda_id in (select r.id from ronda_evaluacion_anual r join individuos i on i.id = r.individuo_id where i.planta_id = p_planta_id);
    delete from ronda_evaluacion_anual
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    delete from multisitio
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    delete from baja_motivo
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    delete from evaluacion_reducida
      where individuo_id in (select id from individuos where planta_id = p_planta_id);
    -- Rompe la autorreferencia de clones ANTES de borrar individuos (clon_de_id
    -- es ON DELETE RESTRICT): todos se borran juntos, no hace falta preservarla.
    update individuos set clon_de_id = null where planta_id = p_planta_id;
    delete from individuos where planta_id = p_planta_id;
    delete from germinacion_evento where planta_id = p_planta_id;
    delete from cosecha_fruto where planta_id = p_planta_id;
    delete from plantas where id = p_planta_id;
  end if;

  return jsonb_build_object('planta_id', p_planta_id, 'tipo', p_tipo, 'snapshot', v_snapshot);
end;
$$;

comment on function borrar_cruzamiento is 'Solo admin. soft: marca eliminado_at (recuperable). hard: borra el cruce y todo lo que cuelga de él, en orden controlado (irreversible). Audita snapshot completo antes de borrar en ambos casos.';

grant execute on function borrar_cruzamiento(uuid, text) to authenticated;
