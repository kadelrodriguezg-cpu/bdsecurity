-- =============================================================================
-- MIGRACIÓN 20260714020500 — evaluaciones, pcr_analisis, baja_motivo
-- (satélites de individuos, NO de plantas — corrección central del North Star v3)
--
-- `evaluaciones` es una sola tabla reutilizada horizontalmente por `tipo`
-- (primaria/secundaria/multisitio), no una tabla por ronda (sección 5 del
-- North Star). Los 15 descriptores son TODOS nullable ("detallado pero no
-- condicionante"): cargar una evaluación nunca debería bloquearse porque falta
-- un dato de campo.
--
-- `baja_motivo` es una tabla junction (una fila por criterio elegido), no un
-- enum-array ni una columna booleana: un individuo puede darse de baja por
-- varios criterios a la vez (sección 2.2 del North Star).
--
-- RLS: mismo patrón que individuos, con una diferencia deliberada: el UPDATE
-- de una evaluación/PCR/baja YA CARGADA es admin-only (no autor-o-admin como
-- en individuos/registros_evento). Un descriptor fenotípico cargado no debería
-- editarse libremente por cualquiera; si hace falta corregir un dato de campo,
-- que sea con supervisión de un admin.
-- =============================================================================


-- =============================================================================
-- TABLA: evaluaciones
-- =============================================================================
create type tipo_evaluacion as enum ('primaria', 'secundaria', 'multisitio');

create table evaluaciones (
  id             uuid primary key default gen_random_uuid(),
  individuo_id   uuid not null references individuos (id) on delete restrict,
  tipo           tipo_evaluacion not null,
  anio           integer not null,
  -- Sin FK a catálogo: no existe tabla `predios` todavía (fuera de scope de
  -- este prompt). Columna simple por ahora.
  predio_id      uuid,
  fecha          date not null,
  evaluador      text,

  -- Fenología (escala 1-5)
  brotacion              smallint check (brotacion between 1 and 5),
  floracion              smallint check (floracion between 1 and 5),
  cuaja                  smallint check (cuaja between 1 and 5),
  concentracion_cosecha  smallint check (concentracion_cosecha between 1 and 5),

  -- Fruto / calidad
  calibre_mm             numeric check (calibre_mm between 14 and 24),
  firmeza                smallint check (firmeza between 1 and 5),
  color                  smallint check (color between 1 and 5),
  bloom                  smallint check (bloom between 1 and 5),
  brix                   numeric check (brix between 10 and 18),

  -- Producción
  rend_kg_planta         numeric,
  rend_t_ha              numeric,
  pct_fruta_exportable   numeric check (pct_fruta_exportable between 0 and 100),

  -- Estrés climático (escala 1-5)
  dano_calor             smallint check (dano_calor between 1 and 5),
  golpe_sol              smallint check (golpe_sol between 1 and 5),
  caida_fruto            smallint check (caida_fruto between 1 and 5),

  observaciones          text,

  created_by     uuid references perfiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table evaluaciones is 'Satélite de individuos (NO de plantas). Una sola tabla reutilizada por tipo (primaria/secundaria/multisitio). Los 15 descriptores son todos nullable.';
comment on column evaluaciones.tipo is 'primaria (año 1) / secundaria (año 2, previa a posible clonación) / multisitio (por predio). Ver North Star sección 2.3.';
comment on column evaluaciones.predio_id is 'Columna simple sin FK: no existe catálogo predios todavía. No agregar la tabla predios sin acuerdo explícito.';

create index idx_evaluaciones_individuo on evaluaciones (individuo_id, fecha desc);


-- =============================================================================
-- TABLA: pcr_analisis
-- =============================================================================
create table pcr_analisis (
  id                uuid primary key default gen_random_uuid(),
  individuo_id      uuid not null references individuos (id) on delete restrict,
  realizado         boolean not null,
  -- Ruta dentro del bucket privado media-plantas (el mismo que ya usan las
  -- fotos/videos de eventos; no se crea un bucket nuevo). Convención de ruta:
  -- pcr/<codigo_display>/<uuid>/<archivo> — mismo criterio que evento_archivos.
  informe_pdf_url   text,
  fecha             date,
  created_by        uuid references perfiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

comment on table pcr_analisis is 'Satélite de individuos. Análisis PCR (genético/molecular). El PDF vive en Storage (bucket media-plantas); acá solo la ruta.';
comment on column pcr_analisis.informe_pdf_url is 'Ruta dentro del bucket privado media-plantas (reutilizado, no se crea bucket nuevo). Se lee con URL firmada, igual que evento_archivos.';

create index idx_pcr_analisis_individuo on pcr_analisis (individuo_id);


-- =============================================================================
-- TABLA: baja_motivo
-- Junction: una fila por criterio elegido (un individuo puede tener varios
-- motivos de baja simultáneos). NO es un enum-array ni un booleano.
-- =============================================================================
create type criterio_baja as enum ('vigor', 'arquitectura', 'sanidad', 'uniformidad', 'muerte_natural');

create table baja_motivo (
  id             uuid primary key default gen_random_uuid(),
  individuo_id   uuid not null references individuos (id) on delete restrict,
  criterio       criterio_baja not null,
  nota           text,
  created_by     uuid references perfiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table baja_motivo is 'Junction de motivos de baja de un individuo (satélite de individuos). Una fila por criterio elegido; un individuo puede tener varios.';

create index idx_baja_motivo_individuo on baja_motivo (individuo_id);


-- =============================================================================
-- RLS — mismo patrón en las tres tablas:
--   SELECT: cualquier autenticado.
--   INSERT: cualquier autenticado, a su propio nombre (created_by = auth.uid()).
--   UPDATE: SOLO admin (una evaluación/PCR/baja ya cargada no se edita libremente).
--   DELETE: nadie (policy explícita `using (false)`, sin GRANT DELETE).
-- =============================================================================
alter table evaluaciones enable row level security;
alter table pcr_analisis enable row level security;
alter table baja_motivo  enable row level security;

-- --- evaluaciones ---
create policy evaluaciones_select_autenticados
  on evaluaciones for select
  using (auth.uid() is not null);

create policy evaluaciones_insert_autenticados
  on evaluaciones for insert
  with check (auth.uid() is not null and created_by = auth.uid());

create policy evaluaciones_update_admin
  on evaluaciones for update
  using (es_admin())
  with check (es_admin());

create policy evaluaciones_delete_nadie
  on evaluaciones for delete
  using (false);

-- --- pcr_analisis ---
create policy pcr_analisis_select_autenticados
  on pcr_analisis for select
  using (auth.uid() is not null);

create policy pcr_analisis_insert_autenticados
  on pcr_analisis for insert
  with check (auth.uid() is not null and created_by = auth.uid());

create policy pcr_analisis_update_admin
  on pcr_analisis for update
  using (es_admin())
  with check (es_admin());

create policy pcr_analisis_delete_nadie
  on pcr_analisis for delete
  using (false);

-- --- baja_motivo ---
create policy baja_motivo_select_autenticados
  on baja_motivo for select
  using (auth.uid() is not null);

create policy baja_motivo_insert_autenticados
  on baja_motivo for insert
  with check (auth.uid() is not null and created_by = auth.uid());

create policy baja_motivo_update_admin
  on baja_motivo for update
  using (es_admin())
  with check (es_admin());

create policy baja_motivo_delete_nadie
  on baja_motivo for delete
  using (false);


-- =============================================================================
-- GRANTS EXPLÍCITOS (mismo motivo que la migración 009). Sin GRANT DELETE en
-- ninguna de las tres, a propósito.
-- =============================================================================
grant select, insert, update on evaluaciones to authenticated;
grant select, insert, update on pcr_analisis to authenticated;
grant select, insert, update on baja_motivo  to authenticated;
