-- =============================================================================
-- MIGRACIÓN 20260716000500 — Columnas de fase en plantas (Polinización, Cosecha,
-- Siembra, Traslado) + plantas_insumo (multiselect de Siembra)
--
-- Polinización, Cosecha, Siembra y Traslado son 1 registro por cruce
-- (cardinalidad baja): viven como columnas directas en `plantas`, no como
-- tablas 1:1 aparte (con 1 fila por cruce, una tabla satélite solo agrega
-- joins innecesarios). Germinación es la única con cardinalidad N — esa va
-- en tabla aparte (ver migración 20260716001000_germinacion_evento.sql).
--
-- Columnas NULLABLE a nivel de DB aunque el formulario marque algunas como
-- "obligatorias": son ALTER TABLE sobre una tabla ya poblada (25+ filas
-- reales sin estos datos), así que NOT NULL rompería esas filas. Lo
-- "obligatorio" se valida en el formulario, no en el schema.
--
-- Auditoría: trigger nuevo `auditar_escritura_fase` (independiente de
-- auditar_cambio_estado, que sigue enfocado solo en `estado`) — registra
-- cualquier cambio en estas columnas nuevas. Mismo motivo que llevó a
-- corregir el gap de auditoría de evaluaciones/pcr/baja en el Prompt 5: más
-- vale auditar desde el día uno que arreglarlo como bug después.
-- =============================================================================

-- --- Polinización -----------------------------------------------------------
alter table plantas add column fecha_polinizacion date;
alter table plantas add column n_flores_cruzadas  integer check (n_flores_cruzadas >= 0);

-- --- Cosecha ------------------------------------------------------------------
-- conteo_f1/conteo_f2: semántica exacta pendiente de confirmar con Efraín
-- (ver Prompt 6). Se etiquetan tal cual en la UI, sin inventar explicación.
alter table plantas add column fecha_cosecha date;
alter table plantas add column n_semillas    integer check (n_semillas >= 0);
alter table plantas add column conteo_f1     integer check (conteo_f1 >= 0);
alter table plantas add column conteo_f2     integer check (conteo_f2 >= 0);

-- --- Siembra --------------------------------------------------------------
create type escarificacion_subtipo as enum ('quimica', 'fisica', 'estratificacion');

alter table plantas add column escarificacion_subtipo escarificacion_subtipo;
alter table plantas add column escarificacion_duracion_dias integer check (escarificacion_duracion_dias >= 0);

-- La duración solo tiene sentido si el subtipo es estratificación (la UI ya
-- lo oculta si no aplica, pero se refuerza también a nivel de constraint).
alter table plantas add constraint chk_escarificacion_duracion_solo_estratificacion
  check (escarificacion_duracion_dias is null or escarificacion_subtipo = 'estratificacion');

alter table plantas add column contenedor_id uuid references contenedor(id) on delete restrict;

-- --- Traslado -------------------------------------------------------------
-- A nivel de plantas (cruce), no de individuos: todos los individuos de un
-- cruce se trasladan juntos (confirmado explícitamente en el Prompt 6).
alter table plantas add column predio_id uuid references predio(id) on delete restrict;

comment on column plantas.conteo_f1 is 'Semántica exacta pendiente de confirmar con Efraín. No inventar explicación en UI ni en comentarios de negocio.';
comment on column plantas.conteo_f2 is 'Semántica exacta pendiente de confirmar con Efraín. No inventar explicación en UI ni en comentarios de negocio.';


-- =============================================================================
-- plantas_insumo — junction de Siembra (multiselect: puede haber más de un
-- insumo por registro). NO es una columna FK en plantas porque no es 1 sola
-- opción, a diferencia de contenedor_id.
-- =============================================================================
create table plantas_insumo (
  planta_id uuid not null references plantas (id) on delete cascade,
  insumo_id uuid not null references insumo  (id) on delete restrict,
  primary key (planta_id, insumo_id)
);

comment on table plantas_insumo is 'Junction Siembra: insumos/productos usados (multiselect). PK compuesta evita duplicados. Resiembra: el formulario reemplaza el set completo (delete + insert), no acumula.';

alter table plantas_insumo enable row level security;

-- Igual de abierto que el resto de la captura de campo (registros_evento):
-- cualquier autenticado arma/edita el set de insumos de SU propio registro de
-- siembra. No hay columna created_by en esta junction (es un N:M simple sin
-- dueño individual de fila), así que no se puede acotar "solo lo propio".
create policy plantas_insumo_select_autenticados on plantas_insumo for select using (auth.uid() is not null);
create policy plantas_insumo_insert_autenticados on plantas_insumo for insert with check (auth.uid() is not null);
create policy plantas_insumo_delete_autenticados on plantas_insumo for delete using (auth.uid() is not null);
-- Sin policy de UPDATE: no hay columnas mutables además de la PK compuesta.

grant select, insert, delete on plantas_insumo to authenticated;
grant all on plantas_insumo to service_role;


-- =============================================================================
-- GRANTS DE COLUMNA sobre plantas para las columnas nuevas — igual criterio
-- que la migración 003/009: plantas usa grants de columna explícitos (no de
-- tabla completa) para proteger el linaje. Sin este grant, ni SELECT ni
-- UPDATE de estas columnas nuevas funcionarían para authenticated aunque el
-- RLS las permita (el grant se evalúa antes que el RLS).
-- =============================================================================
grant select (
  fecha_polinizacion, n_flores_cruzadas,
  fecha_cosecha, n_semillas, conteo_f1, conteo_f2,
  escarificacion_subtipo, escarificacion_duracion_dias, contenedor_id,
  predio_id
) on plantas to authenticated;

grant update (
  fecha_polinizacion, n_flores_cruzadas,
  fecha_cosecha, n_semillas, conteo_f1, conteo_f2,
  escarificacion_subtipo, escarificacion_duracion_dias, contenedor_id,
  predio_id
) on plantas to authenticated;


-- =============================================================================
-- AUDITORÍA de escrituras sobre las columnas de fase (independiente de
-- auditar_cambio_estado, que sigue cubriendo solo la columna `estado`).
-- =============================================================================
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
  or new.conteo_f1                     is distinct from old.conteo_f1
  or new.conteo_f2                     is distinct from old.conteo_f2
  or new.escarificacion_subtipo        is distinct from old.escarificacion_subtipo
  or new.escarificacion_duracion_dias  is distinct from old.escarificacion_duracion_dias
  or new.contenedor_id                 is distinct from old.contenedor_id
  or new.predio_id                     is distinct from old.predio_id
  then
    insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
    values (
      auth.uid(),
      new.id,
      'escritura_fase',
      array['fecha_polinizacion','n_flores_cruzadas','fecha_cosecha','n_semillas','conteo_f1','conteo_f2','escarificacion_subtipo','escarificacion_duracion_dias','contenedor_id','predio_id'],
      jsonb_build_object(
        'anterior', jsonb_build_object(
          'fecha_polinizacion', old.fecha_polinizacion, 'n_flores_cruzadas', old.n_flores_cruzadas,
          'fecha_cosecha', old.fecha_cosecha, 'n_semillas', old.n_semillas,
          'conteo_f1', old.conteo_f1, 'conteo_f2', old.conteo_f2,
          'escarificacion_subtipo', old.escarificacion_subtipo, 'escarificacion_duracion_dias', old.escarificacion_duracion_dias,
          'contenedor_id', old.contenedor_id, 'predio_id', old.predio_id
        ),
        'nuevo', jsonb_build_object(
          'fecha_polinizacion', new.fecha_polinizacion, 'n_flores_cruzadas', new.n_flores_cruzadas,
          'fecha_cosecha', new.fecha_cosecha, 'n_semillas', new.n_semillas,
          'conteo_f1', new.conteo_f1, 'conteo_f2', new.conteo_f2,
          'escarificacion_subtipo', new.escarificacion_subtipo, 'escarificacion_duracion_dias', new.escarificacion_duracion_dias,
          'contenedor_id', new.contenedor_id, 'predio_id', new.predio_id
        )
      )
    );
  end if;
  return new;
end;
$$;

comment on function auditar_escritura_fase is 'Registra en audit_log cualquier cambio en las columnas de fase (Polinización/Cosecha/Siembra/Traslado) de plantas. Independiente de auditar_cambio_estado (solo estado).';

create trigger trg_plantas_auditoria_fase
  after update on plantas
  for each row execute function auditar_escritura_fase();
