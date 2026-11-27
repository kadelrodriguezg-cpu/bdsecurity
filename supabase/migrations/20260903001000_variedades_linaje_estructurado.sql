-- =============================================================================
-- MIGRACIÓN — variedades: catálogo estructurado de progenitores
-- (Bloque 3, Parte 3C de la auditoría de UX)
--
-- Mamá/Papá eran texto libre en plantas.mama/plantas.papa (columnas
-- SENSIBLES de linaje genético, CLAUDE.md sección 4). Confirmado con datos
-- reales ANTES de esta migración (consulta corrida en producción por el
-- dueño del proyecto): 26 filas de linaje, 18 valores únicos de Mamá, 6 de
-- Papá, CERO duplicados por formato (mayúsculas/espacios/tildes) — no hace
-- falta deduplicar nada, solo estructurar hacia adelante. La migración de
-- esos 26 registros a esta tabla es un script aparte (no esta migración),
-- que requiere autorización explícita antes de tocar producción.
--
-- Tabla PLANA, no jerárquica especie->variedad como entidad aparte: un
-- progenitor siempre pertenece a la misma especie que el cruce que lo usa,
-- la FK a especie ya expresa eso.
--
-- Alta: CUALQUIER autenticado puede crear una variedad nueva (no solo
-- admin) — decisión explícita del dueño del proyecto: el secreto que este
-- sistema protege es QUÉ progenitores se cruzan en cada cruce (ver
-- plantas.mama_id/papa_id más abajo, con las mismas protecciones que ya
-- tenían mama/papa), no que exista una variedad llamada "Duke" en el
-- catálogo — ese nombre ya es público en la industria. Bloquear el alta a
-- solo-admin dejaría al operario en terreno sin poder cargar una variedad
-- que no estaba anticipada, justo el caso de uso que motiva el combobox
-- con alta inline. Mismo patrón que registros_evento/evento_archivos:
-- cualquiera inserta su propio dato operativo, created_by forzado, sin
-- DELETE físico. Editar/desactivar (typo, variedad discontinuada) sigue
-- siendo admin-only, mismo criterio que contenedor/insumo/predio
-- (migración 20260716000000).
-- =============================================================================

create table variedades (
  id          uuid primary key default gen_random_uuid(),
  especie_id  uuid not null references especies (id) on delete restrict,
  nombre      text not null check (btrim(nombre) <> ''),
  activo      boolean not null default true,
  created_by  uuid references perfiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table variedades is 'Catálogo estructurado de progenitores (Mamá/Papá) por especie. Reemplaza el texto libre de plantas.mama/plantas.papa — ver plantas.mama_id/plantas.papa_id.';
comment on column variedades.nombre is 'Nombre de la variedad. Único por especie sin distinguir mayúsculas/espacios (ver índice variedades_especie_nombre_unico) para no reabrir el problema de duplicados por formato que motivó esta migración.';

-- Unicidad case-insensitive por especie: un índice, no un constraint UNIQUE
-- inline, porque Postgres no admite expresiones dentro de un UNIQUE(...) de
-- CREATE TABLE (sí admite índices sobre expresiones).
create unique index variedades_especie_nombre_unico on variedades (especie_id, lower(btrim(nombre)));
create index idx_variedades_especie_activa on variedades (especie_id) where activo;

create trigger trg_variedades_updated_at
  before update on variedades
  for each row execute function set_updated_at();

alter table variedades enable row level security;

create policy variedades_select_autenticados on variedades
  for select using (auth.uid() is not null);

create policy variedades_insert_autenticados on variedades
  for insert with check (auth.uid() is not null and created_by = auth.uid());

-- Editar/desactivar (corregir un typo, marcar una variedad discontinuada)
-- queda en admin — mismo criterio que el resto de los catálogos
-- (contenedor/insumo/predio). Sin policy de DELETE: no hay borrado físico,
-- mismo criterio que toda tabla de catálogo del proyecto.
create policy variedades_admin_actualiza on variedades
  for update using (es_admin()) with check (es_admin());

grant select, insert, update on variedades to authenticated;
grant all on variedades to service_role;


-- =============================================================================
-- plantas.mama_id / plantas.papa_id — linaje estructurado
--
-- Nullable y agregadas SIN tocar mama/papa (texto): quedan como respaldo
-- histórico hasta que la migración de datos (script aparte, autorización
-- explícita) confirme que cerró bien. No se sincronizan automáticamente con
-- las columnas de texto: a partir de esta migración, la app deja de escribir
-- mama/papa (texto) — cualquier valor que tengan queda congelado tal cual
-- estaba.
--
-- Mismo nivel de protección que mama/papa: NO se agregan a la lista
-- explícita de columnas que el grant de SELECT le da a `authenticated`
-- (migración 003) — ese grant es un ALLOWLIST, así que una columna nueva
-- queda protegida por default con solo no mencionarla ahí. El único camino
-- de lectura sigue siendo obtener_planta(), que se actualiza más abajo
-- para incluirlas (y resolver el nombre) solo cuando el usuario tiene
-- permiso de ver linaje.
-- =============================================================================

alter table plantas
  add column mama_id uuid references variedades (id) on delete restrict,
  add column papa_id uuid references variedades (id) on delete restrict;

comment on column plantas.mama_id is 'SENSIBLE (linaje). FK a variedades. Reemplaza a plantas.mama (texto, congelada) como fuente de verdad desde esta migración.';
comment on column plantas.papa_id is 'SENSIBLE (linaje). FK a variedades. Reemplaza a plantas.papa (texto, congelada) como fuente de verdad desde esta migración.';


-- =============================================================================
-- actualizar_linaje — firma nueva: mama_id/papa_id en vez de mama/papa texto.
-- Único llamador (LinajePanel.tsx) se actualiza en el mismo commit que esta
-- migración, así que no hace falta mantener la firma vieja en paralelo.
-- =============================================================================

drop function if exists actualizar_linaje(uuid, text, text, text);

create or replace function actualizar_linaje(
  p_planta_id   uuid,
  p_cruzamiento text,
  p_mama_id     uuid,
  p_papa_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_antes   plantas;
  v_count   int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  if not es_admin() then
    raise exception 'Solo un admin puede modificar el linaje genético'
      using errcode = '42501';
  end if;

  select count(*) into v_count
  from audit_log
  where usuario_id = v_uid
    and accion = 'escritura_linaje'
    and ocurrido_en > now() - interval '60 seconds';

  if v_count >= 10 then
    raise exception 'Rate limit excedido: máximo 10 escrituras de linaje por minuto por usuario'
      using errcode = '58503';
  end if;

  select * into v_antes from plantas where id = p_planta_id;
  if not found then
    raise exception 'Planta % no encontrada', p_planta_id using errcode = 'P0002';
  end if;

  update plantas
  set cruzamiento = p_cruzamiento,
      mama_id     = p_mama_id,
      papa_id     = p_papa_id
  where id = p_planta_id;

  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    v_uid,
    p_planta_id,
    'escritura_linaje',
    array['cruzamiento', 'mama_id', 'papa_id'],
    jsonb_build_object(
      'anterior', jsonb_build_object('cruzamiento', v_antes.cruzamiento, 'mama_id', v_antes.mama_id, 'papa_id', v_antes.papa_id),
      'nuevo',    jsonb_build_object('cruzamiento', p_cruzamiento, 'mama_id', p_mama_id, 'papa_id', p_papa_id)
    )
  );

  return jsonb_build_object('id', p_planta_id, 'cruzamiento', p_cruzamiento, 'mama_id', p_mama_id, 'papa_id', p_papa_id);
end;
$$;

comment on function actualizar_linaje(uuid, text, uuid, uuid) is
  'Único camino de escritura de linaje (mama_id/papa_id + cruzamiento). Solo admin. Audita valores anteriores y nuevos.';

revoke all on function actualizar_linaje(uuid, text, uuid, uuid) from public, anon;
grant execute on function actualizar_linaje(uuid, text, uuid, uuid) to authenticated, service_role;


-- =============================================================================
-- obtener_planta — agrega mama_id/papa_id y el nombre resuelto de la
-- variedad (mama_nombre/papa_nombre) a la rama que ya expone linaje.
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
  v_mama_nombre text;
  v_papa_nombre text;
  v_resultado  jsonb;
  v_campos     text[];
  v_accion     text;
  v_count      int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

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
    v_campos := array['codigo_sistema','especie_id','estado','cruzamiento','mama','papa','mama_id','papa_id'];

    select nombre into v_mama_nombre from variedades where id = v_planta.mama_id;
    select nombre into v_papa_nombre from variedades where id = v_planta.papa_id;

    v_resultado := jsonb_build_object(
      'id',                   v_planta.id,
      'codigo_sistema',       v_planta.codigo_sistema,
      'especie_id',           v_planta.especie_id,
      'estado',               v_planta.estado,
      'cruzamiento',          v_planta.cruzamiento,
      'mama',                 v_planta.mama,
      'papa',                 v_planta.papa,
      'mama_id',               v_planta.mama_id,
      'papa_id',               v_planta.papa_id,
      'mama_nombre',           v_mama_nombre,
      'papa_nombre',           v_papa_nombre,
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
  'Lectura auditada de una planta. Rate limit: 20/min por usuario. Expone linaje (incluido mama_id/papa_id y su nombre resuelto) solo si el usuario tiene permiso. Excluye cruces soft-deleted.';
