-- =============================================================================
-- MIGRACIÓN 20260811000100 — EVECL: RLS, grants y storage (Sprint E1, commit 2/3)
--
-- Habilita RLS en las 5 tablas evecl_*, aplica las políticas de la sección 9.3
-- del Documento Maestro, declara los grants explícitos por rol y crea el
-- bucket privado evecl-fotos.
--
-- CORRECCIÓN respecto al snippet SQL ilustrativo de 9.3 (marcado ahí mismo
-- como "verificar, no asumir"): en este proyecto "admin" NO es un rol de
-- Postgres separado — es `perfiles.rol` evaluado por es_admin() dentro de las
-- policies. admin y operario comparten el mismo rol de base `authenticated`.
-- Por eso:
--   1) evecl_descriptor / evecl_descriptor_estado necesitan grant de INSERT y
--      UPDATE para `authenticated` (no solo SELECT): si no, un admin real
--      recibe "permission denied" en la capa de GRANT antes de que la policy
--      de RLS llegue a evaluarse, aunque la policy sí lo autorizaría.
--   2) evecl_respuesta necesita grant de DELETE para `authenticated`: la
--      tabla de políticas de 9.3 permite DELETE a autor/admin, pero el
--      snippet de grants de 9.3 no lo incluía.
-- Es exactamente el bug recurrente que el prompt E1 pide verificar
-- reflexivamente, no asumir.
-- =============================================================================

alter table evecl_descriptor        enable row level security;
alter table evecl_descriptor_estado enable row level security;
alter table evecl_ensayo            enable row level security;
alter table evecl_ficha             enable row level security;
alter table evecl_respuesta         enable row level security;


-- =============================================================================
-- evecl_descriptor / evecl_descriptor_estado
-- SELECT: cualquier autenticado (alimenta el formulario). INSERT/UPDATE: solo
-- admin. DELETE: nadie (ni admin) — no se crea policy de delete a propósito;
-- sin policy que lo permita, RLS lo deniega siempre.
-- =============================================================================
create policy evecl_descriptor_select_autenticados on evecl_descriptor
  for select using (auth.uid() is not null);
create policy evecl_descriptor_admin_insert on evecl_descriptor
  for insert with check (es_admin());
create policy evecl_descriptor_admin_update on evecl_descriptor
  for update using (es_admin()) with check (es_admin());

create policy evecl_descriptor_estado_select_autenticados on evecl_descriptor_estado
  for select using (auth.uid() is not null);
create policy evecl_descriptor_estado_admin_insert on evecl_descriptor_estado
  for insert with check (es_admin());
create policy evecl_descriptor_estado_admin_update on evecl_descriptor_estado
  for update using (es_admin()) with check (es_admin());


-- =============================================================================
-- evecl_ensayo
-- SELECT: autenticado, solo activos (eliminado_at is null). INSERT: cualquier
-- autenticado, a su propio nombre. UPDATE: autor o admin (incluye la baja
-- suave vía eliminado_at). DELETE: nadie — no se crea policy.
-- =============================================================================
create policy evecl_ensayo_select_autenticados on evecl_ensayo
  for select using (auth.uid() is not null and eliminado_at is null);
create policy evecl_ensayo_insert_autenticados on evecl_ensayo
  for insert with check (auth.uid() is not null and created_by = auth.uid());
create policy evecl_ensayo_update_autor_o_admin on evecl_ensayo
  for update using (created_by = auth.uid() or es_admin())
  with check (created_by = auth.uid() or es_admin());


-- =============================================================================
-- evecl_ficha
-- Mismo patrón que evecl_ensayo.
-- =============================================================================
create policy evecl_ficha_select_autenticados on evecl_ficha
  for select using (auth.uid() is not null and eliminado_at is null);
create policy evecl_ficha_insert_autenticados on evecl_ficha
  for insert with check (auth.uid() is not null and created_by = auth.uid());
create policy evecl_ficha_update_autor_o_admin on evecl_ficha
  for update using (created_by = auth.uid() or es_admin())
  with check (created_by = auth.uid() or es_admin());


-- =============================================================================
-- evecl_respuesta
-- No tiene created_by propio: "autor" se resuelve vía created_by de la ficha
-- padre (evecl_ficha). SELECT solo si la ficha padre está visible (activa).
-- UPDATE/DELETE: autor de la ficha o admin. A diferencia del núcleo genético
-- (evaluaciones_delete_nadie), acá SÍ hay DELETE real: es una observación de
-- campo sobre material ajeno, sin valor de trazabilidad genética (9.3).
-- =============================================================================
create policy evecl_respuesta_select_via_ficha on evecl_respuesta
  for select using (
    auth.uid() is not null
    and exists (
      select 1 from evecl_ficha f
      where f.id = evecl_respuesta.ficha_id and f.eliminado_at is null
    )
  );
create policy evecl_respuesta_insert_autenticados on evecl_respuesta
  for insert with check (
    auth.uid() is not null
    and exists (
      select 1 from evecl_ficha f
      where f.id = evecl_respuesta.ficha_id and f.eliminado_at is null
    )
  );
create policy evecl_respuesta_update_autor_ficha_o_admin on evecl_respuesta
  for update using (
    es_admin() or exists (
      select 1 from evecl_ficha f
      where f.id = evecl_respuesta.ficha_id and f.created_by = auth.uid()
    )
  )
  with check (
    es_admin() or exists (
      select 1 from evecl_ficha f
      where f.id = evecl_respuesta.ficha_id and f.created_by = auth.uid()
    )
  );
create policy evecl_respuesta_delete_autor_ficha_o_admin on evecl_respuesta
  for delete using (
    es_admin() or exists (
      select 1 from evecl_ficha f
      where f.id = evecl_respuesta.ficha_id and f.created_by = auth.uid()
    )
  );


-- =============================================================================
-- GRANTS explícitos (mismo motivo que la migración 009 del núcleo: Supabase
-- no concede privilegios DML por default a authenticated/service_role sobre
-- tablas nuevas). revoke primero, por si algo quedó heredado.
-- =============================================================================
revoke all on evecl_ensayo, evecl_ficha, evecl_respuesta,
              evecl_descriptor, evecl_descriptor_estado
  from anon, authenticated;

grant select, insert, update on evecl_descriptor, evecl_descriptor_estado to authenticated;
grant select, insert, update on evecl_ensayo, evecl_ficha to authenticated;
grant select, insert, update, delete on evecl_respuesta to authenticated;

-- anon: sin grants — deliberado, igual que el resto del proyecto.

-- service_role: ya tiene "grant all on all tables in schema public" desde la
-- migración 009, pero esa sentencia solo aplica a las tablas que existían en
-- ese momento. Se re-declara explícito acá para las tablas nuevas, en vez de
-- asumir que algo lo cubre (el propio hallazgo recurrente del proyecto).
grant all on evecl_descriptor, evecl_descriptor_estado,
             evecl_ensayo, evecl_ficha, evecl_respuesta
  to service_role;


-- =============================================================================
-- STORAGE: bucket evecl-fotos (PRIVADO)
-- Ruta: evecl/{ensayo_id}/{ficha_id}/{descriptor_id}.jpg. El frontend consume
-- signed URLs, nunca URLs públicas (mismo requisito no negociable #5 del
-- núcleo, extendido acá).
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('evecl-fotos', 'evecl-fotos', false)
on conflict (id) do nothing;

create policy storage_evecl_fotos_select_autenticados
  on storage.objects for select
  to authenticated
  using (bucket_id = 'evecl-fotos');

create policy storage_evecl_fotos_insert_autenticados
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'evecl-fotos');

create policy storage_evecl_fotos_delete_propietario
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'evecl-fotos' and owner = auth.uid());

-- Sin policy de UPDATE: mismo criterio que media-plantas — los archivos son
-- inmutables una vez subidos; para "reemplazar" una foto se sube una nueva y
-- se borra la vieja.
