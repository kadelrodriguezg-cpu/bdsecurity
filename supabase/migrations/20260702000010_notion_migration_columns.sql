-- =============================================================================
-- MIGRACIÓN 010 — Columnas heredadas de Notion + actualización de vista/RPC
--
-- Agrega tres columnas a plantas para soportar la migración inicial desde el
-- sistema Notion anterior:
--   genetica_a / genetica_b : programa genético (no son linaje sensible).
--   numero_notion_legacy    : campo "Planta" de Notion. Semántica incierta —
--                             preservado sin interpretar como INTEGER.
--
-- También actualiza plantas_operativas y obtener_planta para exponer las dos
-- nuevas columnas de genética (no sensibles, visibles a todos los autenticados).
-- numero_notion_legacy se expone también; no forma parte del linaje protegido.
-- =============================================================================

alter table plantas
  add column if not exists genetica_a           text,
  add column if not exists genetica_b           text,
  add column if not exists numero_notion_legacy integer;

comment on column plantas.genetica_a is
  'Programa genético A (campo "Genética A" en Notion). No es linaje sensible (cruzamiento/mama/papa).';
comment on column plantas.genetica_b is
  'Programa genético B (campo "Genética B" en Notion). No es linaje sensible.';
comment on column plantas.numero_notion_legacy is
  'Campo "Planta" del sistema Notion anterior. Semantica incierta — preservado sin interpretar. Puede descartarse una vez confirmado su significado.';


-- Extendemos el GRANT SELECT existente para incluir las columnas nuevas.
-- Las columnas sensibles (cruzamiento/mama/papa) siguen sin grant directo.
grant select (genetica_a, genetica_b, numero_notion_legacy)
  on plantas to authenticated;


-- =============================================================================
-- VISTA plantas_operativas — añadir las tres columnas nuevas
-- Las columnas de linaje siguen sin aparecer (por diseño).
-- =============================================================================
create or replace view plantas_operativas
  with (security_invoker = on)
as
  select
    p.id,
    p.codigo_sistema,
    p.especie_id,
    e.nombre                as especie_nombre,
    p.estado,
    p.created_at,
    p.updated_at,
    p.genetica_a,
    p.genetica_b,
    p.numero_notion_legacy
  from plantas p
  join especies e on e.id = p.especie_id;

comment on view plantas_operativas is
  'Ficha operativa SIN linaje genético. Consumo del rol operario. security_invoker=on respeta el RLS.';


-- =============================================================================
-- FUNCIÓN obtener_planta — incluir las tres columnas nuevas en la respuesta
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
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select * into v_planta from plantas where id = p_planta_id;

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
  'Lectura auditada de una planta. Registra en audit_log y expone linaje solo si el usuario tiene permiso.';

grant execute on function obtener_planta(uuid) to authenticated;
