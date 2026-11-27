-- =============================================================================
-- Sprint 9 (calidad) — obtener_planta excluye cruces soft-deleted.
--
-- Hallazgo real (no coincide con la descripción original del hallazgo E2E
-- "carga en blanco al entrar por URL a un cruce eliminado"): probado
-- directamente contra el código, obtener_planta() nunca filtró
-- eliminado_at en ninguna de sus 3 versiones (incluidas las 2 que ya
-- corrían DESPUÉS de que plantas.eliminado_at existiera, desde
-- 20260717002000). Un cruce soft-deleted no muestra pantalla en blanco:
-- se muestra COMPLETO y editable, como si estuviera activo — más grave
-- que lo documentado, no menos.
--
-- Fix: mismo patrón ya usado en obtener_ranking_operativo (Sprint 5) y en
-- plantas_operativas — excluir eliminado_at del camino de lectura normal,
-- rechazando con P0002 ("Planta % no encontrada"), que el frontend YA
-- traduce a un estado "Cruce no encontrado" claro (mismo camino usado hoy
-- para un id inexistente). No se optó por devolver el cruce con un
-- indicador "eliminado" porque Administrar cruces (restaurar_cruzamiento)
-- ya opera desde su propia lista sin necesitar la ficha — bloquear la
-- ficha por completo no rompe ningún flujo de recuperación existente, y
-- reusa un estado de UI ya construido y probado en vez de crear uno nuevo.
-- =============================================================================

create or replace function obtener_planta(p_planta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid    := auth.uid();
  v_ve_linaje  boolean := puede_ver_linaje_actual();
  v_planta     plantas;
  v_resultado  jsonb;
  v_campos     text[];
  v_accion     text;
  v_count      int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  -- Rate limit: máximo 20 lecturas de ficha/linaje por usuario por minuto.
  select count(*) into v_count
  from audit_log
  where usuario_id = v_uid
    and accion in ('lectura_ficha', 'lectura_linaje')
    and ocurrido_en > now() - interval '60 seconds';

  if v_count >= 20 then
    raise exception 'Rate limit excedido: máximo 20 lecturas por minuto por usuario'
      using errcode = '58503';
  end if;

  select * into v_planta from plantas where id = p_planta_id and eliminado_at is null;

  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  if v_ve_linaje then
    v_accion := 'lectura_linaje';
    v_campos := array['codigo_sistema','especie_id','estado','cruzamiento','mama','papa'];
    v_resultado := jsonb_build_object(
      'id',                   v_planta.id,
      'codigo_sistema',       v_planta.codigo_sistema,
      'especie_id',           v_planta.especie_id,
      'estado',               v_planta.estado,
      'cruzamiento',          v_planta.cruzamiento,
      'mama',                 v_planta.mama,
      'papa',                 v_planta.papa,
      'genetica_a',           v_planta.genetica_a,
      'genetica_b',           v_planta.genetica_b,
      'numero_notion_legacy', v_planta.numero_notion_legacy,
      'created_at',           v_planta.created_at,
      'updated_at',           v_planta.updated_at
    );
  else
    v_accion := 'lectura_ficha';
    v_campos := array['codigo_sistema','especie_id','estado'];
    v_resultado := jsonb_build_object(
      'id',                   v_planta.id,
      'codigo_sistema',       v_planta.codigo_sistema,
      'especie_id',           v_planta.especie_id,
      'estado',               v_planta.estado,
      'genetica_a',           v_planta.genetica_a,
      'genetica_b',           v_planta.genetica_b,
      'numero_notion_legacy', v_planta.numero_notion_legacy,
      'created_at',           v_planta.created_at,
      'updated_at',           v_planta.updated_at
    );
  end if;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos)
  values (v_uid, p_planta_id, v_accion, v_campos);

  return v_resultado;
end;
$$;

comment on function obtener_planta is
  'Lectura auditada de una planta. Rate limit: 20/min por usuario. Expone linaje solo si el usuario tiene permiso. Excluye cruces soft-deleted (eliminado_at) desde Sprint 9 — antes los devolvía completos y editables como si estuvieran activos.';
