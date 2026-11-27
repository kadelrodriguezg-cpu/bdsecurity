-- =============================================================================
-- MIGRACIÓN 20260718000000 — Catálogo `sustrato` + junction `plantas_sustrato`
-- (Siembra, selección múltiple con porcentaje) + `plantas.semillas_sembradas`
--
-- Único cambio de schema de este pase de UI (el resto de la lista es UI pura).
-- `sustrato` replica EXACTO el patrón de contenedor/insumo/predio (migración
-- 20260716000000). `plantas_sustrato` replica el patrón de `plantas_insumo`
-- (migración 20260716000500), con el agregado de `porcentaje` — el formulario
-- reemplaza el set completo (delete+insert) igual que insumos, así que no
-- hace falta policy de UPDATE.
--
-- `semillas_sembradas`: cantidad de semillas efectivamente sembradas (puede
-- ser menor a `plantas.n_semillas`, que es lo cosechado) — necesaria para
-- calcular % de germinación en la fase Germinación. Mismo patrón que las
-- demás columnas de fase (nullable, grants de columna, auditada por
-- auditar_escritura_fase).
-- =============================================================================

create table sustrato (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null,
  activo  boolean not null default true
);

alter table sustrato enable row level security;

create policy sustrato_select_autenticados on sustrato for select using (auth.uid() is not null);
create policy sustrato_admin_escribe        on sustrato for all    using (es_admin()) with check (es_admin());

grant select, insert, update, delete on sustrato to authenticated;
grant all on sustrato to service_role;


-- =============================================================================
-- plantas_sustrato — junction de Siembra (multiselect con porcentaje). Mismo
-- criterio que plantas_insumo: sin columna created_by (N:M simple, sin dueño
-- individual de fila), reemplazo de set completo en vez de edición in place.
-- =============================================================================
create table plantas_sustrato (
  planta_id   uuid not null references plantas (id) on delete cascade,
  sustrato_id uuid not null references sustrato (id) on delete restrict,
  porcentaje  numeric not null check (porcentaje > 0 and porcentaje <= 100),
  primary key (planta_id, sustrato_id)
);

comment on table plantas_sustrato is 'Junction Siembra: sustratos usados + porcentaje cada uno (multiselect). No se valida que la suma dé 100 — puede haber cargas parciales en progreso; el formulario solo muestra la suma como referencia. Resiembra: reemplaza el set completo (delete + insert), no acumula.';

alter table plantas_sustrato enable row level security;

create policy plantas_sustrato_select_autenticados on plantas_sustrato for select using (auth.uid() is not null);
create policy plantas_sustrato_insert_autenticados on plantas_sustrato for insert with check (auth.uid() is not null);
create policy plantas_sustrato_delete_autenticados on plantas_sustrato for delete using (auth.uid() is not null);
-- Sin policy de UPDATE: no se edita porcentaje in place, se reemplaza la fila.

grant select, insert, delete on plantas_sustrato to authenticated;
grant all on plantas_sustrato to service_role;


-- =============================================================================
-- plantas.semillas_sembradas — columna de fase Siembra (D4).
-- =============================================================================
alter table plantas add column semillas_sembradas integer check (semillas_sembradas >= 0);

grant select (semillas_sembradas) on plantas to authenticated;
grant update (semillas_sembradas) on plantas to authenticated;

-- Redefine auditar_escritura_fase para cubrir también semillas_sembradas.
-- OJO: la versión vigente hoy es la de 20260717000000_cosecha_fruto.sql (ya
-- sin conteo_f1/conteo_f2, dropeadas ahí) — no la original de 20260716000500.
create or replace function auditar_escritura_fase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fecha_polinizacion            is distinct from old.fecha_polinizacion
  or new.n_flores_cruzadas             is distinct from old.n_flores_cruzadas
  or new.fecha_cosecha                 is distinct from old.fecha_cosecha
  or new.n_semillas                    is distinct from old.n_semillas
  or new.escarificacion_subtipo        is distinct from old.escarificacion_subtipo
  or new.escarificacion_duracion_dias  is distinct from old.escarificacion_duracion_dias
  or new.contenedor_id                 is distinct from old.contenedor_id
  or new.predio_id                     is distinct from old.predio_id
  or new.semillas_sembradas            is distinct from old.semillas_sembradas
  then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      new.id,
      'escritura_fase',
      array['fecha_polinizacion','n_flores_cruzadas','fecha_cosecha','n_semillas','escarificacion_subtipo','escarificacion_duracion_dias','contenedor_id','predio_id','semillas_sembradas'],
      jsonb_build_object(
        'anterior', jsonb_build_object(
          'fecha_polinizacion', old.fecha_polinizacion, 'n_flores_cruzadas', old.n_flores_cruzadas,
          'fecha_cosecha', old.fecha_cosecha, 'n_semillas', old.n_semillas,
          'escarificacion_subtipo', old.escarificacion_subtipo, 'escarificacion_duracion_dias', old.escarificacion_duracion_dias,
          'contenedor_id', old.contenedor_id, 'predio_id', old.predio_id,
          'semillas_sembradas', old.semillas_sembradas
        ),
        'nuevo', jsonb_build_object(
          'fecha_polinizacion', new.fecha_polinizacion, 'n_flores_cruzadas', new.n_flores_cruzadas,
          'fecha_cosecha', new.fecha_cosecha, 'n_semillas', new.n_semillas,
          'escarificacion_subtipo', new.escarificacion_subtipo, 'escarificacion_duracion_dias', new.escarificacion_duracion_dias,
          'contenedor_id', new.contenedor_id, 'predio_id', new.predio_id,
          'semillas_sembradas', new.semillas_sembradas
        )
      )
    );
  end if;
  return new;
end;
$$;

comment on function auditar_escritura_fase is 'Registra en audit_log cualquier cambio en las columnas de fase (Polinización/Cosecha/Siembra/Traslado, incl. semillas_sembradas) de plantas. Independiente de auditar_cambio_estado (solo estado).';
