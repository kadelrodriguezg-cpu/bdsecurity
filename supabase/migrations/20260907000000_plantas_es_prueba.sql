-- =============================================================================
-- Campo formal `plantas.es_prueba` — reemplaza la convención de nombre.
--
-- Problema real: hasta hoy la ÚNICA señal de que un cruce es de prueba es su
-- codigo_sistema (`TEST-…`, `%AUDIT%`, `prueba…`, `%VERIF%`). Es convención,
-- no dato: nada en la base ni en la app la lee. Consecuencia observada: los
-- cruces de prueba aparecen mezclados con población real en el selector de
-- cruce del Ranking (compartido por la pestaña Snapshots), y el usuario no
-- puede distinguir qué es población real.
--
-- Verificado con grep antes de escribir esta migración: NO existe hoy ningún
-- otro lugar del código (frontend, RPC o vista) que intente clasificar cruces
-- por patrón de nombre. Esta columna no crea una segunda fuente de verdad —
-- crea la primera.
--
-- Alcance deliberado de esta migración: SOLO agrega el campo y lo expone.
-- El backfill de los cruces existentes NO va acá: es una decisión humana
-- sobre datos reales, no una automatización. Vive en
-- `scripts/backfill_es_prueba.sql`, para revisar y correr a mano.
--
-- GRANTS: `plantas` usa grants a NIVEL DE COLUMNA (para que el REVOKE de
-- cruzamiento/mama/papa tenga sentido). Verificado contra la base real:
-- una columna nueva NO hereda ningún privilegio, así que hay que otorgarlo
-- explícitamente o `authenticated` ni siquiera puede leerla.
--
-- Se otorga SELECT e INSERT, pero deliberadamente NO UPDATE: un cruce se
-- marca como prueba al crearlo y nunca después. Esto no es un detalle de
-- formulario, es la propiedad de seguridad que sostiene la migración
-- siguiente: si `es_prueba` fuera actualizable desde la API, cualquier admin
-- podría marcar un cruce REAL como prueba y con eso habilitar su purga
-- irreversible. Sin grant de UPDATE, ese camino no existe.
-- =============================================================================

alter table plantas
  add column es_prueba boolean not null default false;

comment on column plantas.es_prueba is
  'true = cruce de prueba/verificación, no población real. Se fija al crear el cruce y no es actualizable desde la API (sin grant de UPDATE a authenticated) — es la única puerta que habilita la purga irreversible de borrar_cruzamiento(..., ''hard''). Reemplaza la convención de nombre TEST-/AUDIT/prueba/VERIF, que era pura convención y no un dato.';

grant select (es_prueba) on plantas to authenticated;
grant insert (es_prueba) on plantas to authenticated;

-- Los listados operativos filtran por esta columna; el índice parcial es
-- barato y solo indexa la minoría (los de prueba).
create index idx_plantas_es_prueba on plantas (es_prueba) where es_prueba;

-- ---------------------------------------------------------------------------
-- La vista operativa expone la marca para que los selectores puedan filtrar
-- sin tocar la tabla directamente. security_invoker = on se re-declara acá
-- porque `create or replace view` no lo hereda solo (decisión de arquitectura
-- de CLAUDE.md §5: sin ese flag la vista correría con permisos del dueño y
-- saltearía el RLS de plantas).
-- ---------------------------------------------------------------------------
create or replace view plantas_operativas
with (security_invoker = on) as
  select
    p.id,
    p.codigo_sistema,
    p.especie_id,
    e.nombre as especie_nombre,
    p.estado,
    p.created_at,
    p.updated_at,
    p.genetica_a,
    p.genetica_b,
    p.numero_notion_legacy,
    p.fecha_cambio_estado,
    p.es_prueba
  from plantas p
  join especies e on e.id = p.especie_id
  where p.eliminado_at is null;

comment on view plantas_operativas is
  'Listado operativo de cruces SIN linaje (security_invoker: respeta el RLS de plantas). Incluye es_prueba para que los selectores excluyan los cruces de prueba por default.';
