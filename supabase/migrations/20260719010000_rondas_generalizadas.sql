-- =============================================================================
-- SPRINT 3 — Rondas generalizadas (migración de fundaciones de datos).
-- Corresponde a docs/BDSecurity_Documento_Maestro.md, sección 2.3 y Fase 1.b.
--
-- Diagnóstico previo (verificado por query directa a producción antes de
-- escribir esta migración, no solo confiado del audit): 11 filas en
-- ronda_evaluacion_anual, repartidas en 10 individuos (9 con 1 ronda, 1 con
-- 2 rondas: números 1 y 2). Máximo real = 2 < 3. Todas tienen anio no nulo
-- (2026). Ninguna fila choca con los nuevos constraints de esta migración.
-- (Una primera corrida de diagnóstico contra una réplica local dio 13 filas
-- por contaminación de datos de prueba dejados por la suite RLS del sprint
-- anterior, no por una discrepancia real — se descartó al confirmar contra
-- producción directamente y se resetea la réplica local antes de continuar.)
--
-- Decisión: NO se renombra la tabla en este sprint. `ronda_evaluacion_anual`
-- es referenciada como literal de texto embebido en el cuerpo de varias
-- funciones ya desplegadas (iniciar_ronda_evaluacion, auditar_creacion_ronda,
-- ronda_individuo_esta_vivo, calcular_ranking_operativo, las funciones de
-- borrar/restaurar cruzamiento). Un ALTER TABLE ... RENAME actualiza vistas y
-- FKs automáticamente, pero NO reescribe el texto SQL almacenado dentro de
-- funciones plpgsql/sql: esas quedarían rotas en tiempo de ejecución
-- ("relation ronda_evaluacion_anual does not exist") hasta que se les hiciera
-- CREATE OR REPLACE una por una. Eso es, en los hechos, tocar RPC — y este
-- sprint es explícitamente solo migración de datos, sin tocar RPC (eso es
-- Sprint 5/7). Renombrar ahora sin actualizar esas funciones dejaría el
-- sistema roto; actualizarlas ahora violaría el alcance del sprint. Se deja
-- como nota para cuando Sprint 5/7 ya estén tocando esas funciones de todos
-- modos. El nombre físico se conserva; el comentario de la tabla se actualiza
-- para reflejar que ya no es exclusivamente anual.
-- =============================================================================

create type tipo_ronda as enum ('anual', 'multisitio');

-- DEFAULT + NOT NULL en un solo ADD COLUMN: Postgres (11+) backfillea el
-- default para las filas existentes sin reescribir la tabla y sin dejar
-- ninguna fila en NULL en el camino, así que no hace falta un UPDATE
-- explícito separado. Se verifica con evidencia después de aplicar (ver
-- pruebas del sprint) que las 11 filas reales quedaron en 'anual'.
alter table ronda_evaluacion_anual
  add column tipo_ronda tipo_ronda not null default 'anual';

-- anio pasa a condicional: obligatorio solo para rondas anuales, permitido
-- NULL para multisitio (una ronda multisitio no tiene "año" en el mismo
-- sentido — se ubica por predio/fecha_inicio, no por año calendario).
alter table ronda_evaluacion_anual alter column anio drop not null;

alter table ronda_evaluacion_anual
  add constraint ronda_evaluacion_anio_requerido_si_anual
  check (tipo_ronda <> 'anual' or anio is not null);

-- Contexto opcional de predio para rondas multisitio. Nullable: una ronda
-- anual nunca lo necesita, y ni siquiera una multisitio está obligada a
-- declararlo en este sprint (el frontend que lo captura es Sprint 7).
-- on delete restrict: mismo criterio que el resto de las FK a predio en el
-- esquema (plantas, sector, multisitio, procedimiento_objetivos) — predio se
-- desactiva (columna `activo`), no se borra; RESTRICT es defensa adicional.
alter table ronda_evaluacion_anual
  add column predio_id uuid references predio (id) on delete restrict;

-- Contadores independientes por tipo: se reemplaza la unicidad global por
-- individuo por una unicidad por (individuo, tipo, número). Con esto, un
-- individuo puede tener su ronda anual 1-2-3 Y su ronda multisitio 1-2-3 en
-- paralelo sin colisionar.
alter table ronda_evaluacion_anual
  drop constraint ronda_evaluacion_anual_individuo_id_numero_ronda_key;

alter table ronda_evaluacion_anual
  add constraint ronda_evaluacion_anual_individuo_tipo_numero_key
  unique (individuo_id, tipo_ronda, numero_ronda);

drop index if exists idx_ronda_evaluacion_anual_individuo;
create index idx_ronda_evaluacion_anual_individuo
  on ronda_evaluacion_anual (individuo_id, tipo_ronda, numero_ronda);

-- El CHECK numero_ronda BETWEEN 1 AND 3 NO se toca: ya es correcto tal cual.
-- Es una condición de FILA (no compara contra otras filas), así que aplica
-- igual sin importar el tipo: cada fila individual, sea anual o multisitio,
-- debe tener numero_ronda entre 1 y 3. Combinado con el UNIQUE nuevo de
-- arriba (que impide dos filas con el mismo número para el mismo tipo), el
-- resultado es exactamente "máximo 3 por tipo, independientes" sin tocar el
-- CHECK: el UNIQUE ya lo garantiza a nivel de conjunto, el CHECK ya lo
-- garantiza a nivel de fila. No hacía falta ajustarlo.

comment on table ronda_evaluacion_anual is
  'Agrupa cada repetición de evaluación de un individuo como unidad '
  '(aplicaciones/podas/evaluación completa/PCR/baja de esa ronda). '
  'Generalizada en Sprint 3 (docs/BDSecurity_Documento_Maestro.md 2.3) para '
  'cubrir tanto rondas anuales como multisitio con la MISMA tabla, '
  'discriminadas por tipo_ronda. numero_ronda (1-3) es un contador '
  'INDEPENDIENTE por (individuo_id, tipo_ronda): un individuo puede tener su '
  'serie anual 1-2-3 y su serie multisitio 1-2-3 en paralelo sin colisionar '
  '(unique (individuo_id, tipo_ronda, numero_ronda)). anio es obligatorio '
  'solo cuando tipo_ronda=''anual''; predio_id es contexto opcional, '
  'relevante sobre todo para multisitio. El nombre físico de la tabla se '
  'conserva por compatibilidad con funciones ya desplegadas que la '
  'referencian por texto (ver migración de este sprint); no implica que siga '
  'siendo exclusivamente anual.';

comment on column ronda_evaluacion_anual.anio is
  'Año calendario de la ronda. Obligatorio si tipo_ronda=''anual'' '
  '(constraint ronda_evaluacion_anio_requerido_si_anual); puede ser NULL en '
  'multisitio. No existe un constraint que lo iguale a fecha_inicio ni a las '
  'fechas de evaluaciones hijas.';

comment on column ronda_evaluacion_anual.tipo_ronda is
  'Discriminador de tipo (Sprint 3): ''anual'' o ''multisitio''. Determina si '
  'anio es obligatorio y participa en la unicidad del contador '
  'numero_ronda junto con individuo_id.';

comment on column ronda_evaluacion_anual.predio_id is
  'Predio de contexto para la ronda, opcional. Sobre todo relevante para '
  'tipo_ronda=''multisitio''; una ronda anual normalmente no lo necesita.';
