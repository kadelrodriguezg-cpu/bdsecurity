-- =============================================================================
-- MIGRACIÓN 002 — AUDIT LOG + FUNCIONES AUXILIARES DE SEGURIDAD
--
-- Contiene:
--   1) La tabla audit_log (esqueleto del registro de auditoría).
--   2) Funciones helper (es_admin, puede_ver_linaje_actual) que el RLS de la
--      migración 003 usa para decidir permisos. Se definen ANTES que el RLS
--      porque las políticas las invocan.
--
-- NOTA sobre auditar LECTURAS: Postgres NO permite triggers ON SELECT, así que
-- el registro de cada lectura NO se hace con trigger. Se hace con la función
-- RPC obtener_planta() de la migración 004, que escribe el log y luego devuelve
-- los datos. Ver docs/decisiones-arquitectura.md, sección "Auditoría de lecturas".
-- =============================================================================


-- =============================================================================
-- TABLA: audit_log
-- Registro append-only (solo se inserta, nunca se edita ni borra) de accesos.
-- Especialmente lecturas de fichas de planta y exposición de campos de linaje.
-- =============================================================================
create table audit_log (
  id                 bigint generated always as identity primary key,
  -- Quién. Puede quedar NULL si el usuario fue borrado, para no perder el registro histórico.
  usuario_id         uuid references perfiles (id) on delete set null,
  -- Sobre qué planta. NULL si la acción no es sobre una planta puntual.
  planta_id          uuid references plantas (id) on delete set null,
  -- Qué hizo: 'lectura_ficha', 'lectura_linaje', 'exportacion', etc.
  accion             text not null,
  -- Qué columnas se expusieron realmente en esa lectura. Guardar la lista permite
  -- responder "¿este operario llegó a ver el cruzamiento?" con evidencia.
  -- Ej: ["codigo_sistema","estado","cruzamiento","mama","papa"]
  campos_expuestos   text[] not null default '{}',
  -- Detalle libre opcional (IP, user-agent, motivo) como JSONB.
  detalle            jsonb not null default '{}'::jsonb,
  ocurrido_en        timestamptz not null default now()
);

comment on table audit_log is 'Registro append-only de accesos. Cada lectura de ficha/linaje deja una fila (ver RPC obtener_planta).';
comment on column audit_log.campos_expuestos is 'Lista real de columnas expuestas en la lectura. Permite probar si se vio o no el linaje.';

create index idx_audit_log_planta on audit_log (planta_id, ocurrido_en desc);
create index idx_audit_log_usuario on audit_log (usuario_id, ocurrido_en desc);


-- =============================================================================
-- FUNCIÓN: es_admin()
-- Devuelve true si el usuario autenticado que está ejecutando la consulta tiene
-- rol 'admin'. auth.uid() es una función que da Supabase: devuelve el UUID del
-- usuario logueado (sacado del JWT). Si no hay usuario, es NULL.
--
-- SECURITY DEFINER: la función corre con permisos de su dueño, así puede leer
-- perfiles aunque el RLS de perfiles restrinja al usuario. STABLE: no modifica
-- datos y devuelve lo mismo dentro de una misma consulta (permite cachear).
-- =============================================================================
create or replace function es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from perfiles
    where id = auth.uid() and rol = 'admin'
  );
$$;

comment on function es_admin is 'True si el usuario logueado es admin. Usada por las políticas RLS.';


-- =============================================================================
-- FUNCIÓN: puede_ver_linaje_actual()
-- True si el usuario logueado puede ver el linaje genético: o es admin, o tiene
-- el permiso granular puede_ver_linaje = true en su perfil.
-- =============================================================================
create or replace function puede_ver_linaje_actual()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from perfiles
    where id = auth.uid()
      and (rol = 'admin' or puede_ver_linaje = true)
  );
$$;

comment on function puede_ver_linaje_actual is 'True si el usuario puede ver cruzamiento/mama/papa (admin o permiso explícito).';
