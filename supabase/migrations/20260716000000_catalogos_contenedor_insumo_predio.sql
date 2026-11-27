-- =============================================================================
-- MIGRACIÓN 20260716000000 — CATÁLOGOS: contenedor, insumo, predio
--
-- Tres catálogos simples que alimentan los formularios estructurados por fase
-- (Prompt 6, Parte B): contenedor (Siembra), insumo (Siembra, multiselect vía
-- plantas_insumo en la migración siguiente), predio (Traslado).
--
-- Arrancan VACÍOS a propósito (sin seed) — los carga el admin desde la UI.
--
-- No hay borrado físico: un catálogo que deja de usarse se marca activo=false
-- (evita romper FKs de registros históricos que ya lo referencian). RLS
-- técnicamente permite DELETE a un admin (mismo patrón que otras tablas
-- admin-only de este proyecto), pero la UI de administración solo ofrece
-- activar/desactivar, nunca borrar.
-- =============================================================================

create type tipo_insumo as enum ('fungicida', 'insecticida', 'escarificante', 'otro');

create table contenedor (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  capacidad_litros  numeric,
  activo            boolean not null default true
);

create table insumo (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null,
  tipo    tipo_insumo not null,
  activo  boolean not null default true
);

create table predio (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null,
  activo  boolean not null default true
);

comment on table predio is 'Catálogo de predios/ubicaciones físicas de destino (Traslado). El nombre NO debe describir genética/variedad cultivada ahí (postura anti-reconocimiento del checklist de seguridad) — convención operativa reforzada en la UI de alta, no verificable por constraint de DB.';

alter table contenedor enable row level security;
alter table insumo     enable row level security;
alter table predio     enable row level security;

-- Mismo patrón que especies (migración 003): SELECT abierto a cualquier
-- autenticado (lo necesitan los dropdowns de los formularios de fase),
-- escritura (INSERT/UPDATE/DELETE) solo admin.
create policy contenedor_select_autenticados on contenedor for select using (auth.uid() is not null);
create policy contenedor_admin_escribe        on contenedor for all    using (es_admin()) with check (es_admin());

create policy insumo_select_autenticados on insumo for select using (auth.uid() is not null);
create policy insumo_admin_escribe        on insumo for all    using (es_admin()) with check (es_admin());

create policy predio_select_autenticados on predio for select using (auth.uid() is not null);
create policy predio_admin_escribe        on predio for all    using (es_admin()) with check (es_admin());

-- Grants explícitos (mismo motivo que la migración 009: Supabase no concede
-- privilegios DML por default a authenticated sobre tablas nuevas).
grant select, insert, update, delete on contenedor to authenticated;
grant select, insert, update, delete on insumo     to authenticated;
grant select, insert, update, delete on predio     to authenticated;

-- service_role tampoco hereda grants sobre objetos nuevos automáticamente
-- (hallazgo repetido de los Prompts 2 y 4): se declara explícito acá mismo,
-- no como parche posterior.
grant all on contenedor to service_role;
grant all on insumo     to service_role;
grant all on predio     to service_role;
