-- =============================================================================
-- Sprint 7.5.1 (1/4) — Clima histórico por predio: esquema.
-- Corresponde a docs/BDSecurity_Documento_Maestro.md 2.8.
--
-- Fuente de dato verificada en vivo antes de diseñar (no asumida de la
-- documentación de Open-Meteo): endpoint real
-- https://archive-api.open-meteo.com/v1/archive, sin API key para uso no
-- comercial, cobertura histórica 1940-presente vía reanálisis ERA5
-- (grilla ~0.1-0.25°, no estación puntual — coherente con 2.8: "contexto",
-- no precisión agronómica de campo). Límites de la capa gratuita: 600
-- llamadas/min, 5.000/hora, 10.000/día — muy por encima de lo que este
-- proyecto (2-10 predios reales) necesitará jamás. Un único llamado por
-- predio cubriendo 24 meses de rango funciona bien (probado en vivo: ~5s de
-- latencia para 1 mes de datos; el archivo histórico soporta rangos de años
-- en una sola llamada, es su caso de uso principal). No expone endpoint de
-- agregación mensual nativa: la API solo da series DIARIAS
-- (temperature_2m_max/min, sunshine_duration en segundos, precipitation_sum
-- en mm) — la agregación a mensual la hace este proyecto.
--
-- Mecanismo de llamada HTTP elegido: pg_net (ya viene precargado en
-- shared_preload_libraries de este proyecto Supabase, junto con pg_cron —
-- confirmado por SHOW shared_preload_libraries tanto en local como en
-- producción — ninguno de los dos estaba con CREATE EXTENSION corrido
-- todavía). No hay Edge Functions en este repo (sin carpeta
-- supabase/functions/, sin precedente de ese mecanismo) y el proyecto ya
-- resuelve TODO en RPC de Postgres — usar pg_net/pg_cron mantiene el mismo
-- patrón en vez de introducir un segundo camino de despliegue.
--
-- HALLAZGO IMPORTANTE de esta migración (probado en vivo, no asumido):
-- `net.http_collect_response(request_id, async := false)` — la forma
-- "bloqueante" de esperar una respuesta dentro de la misma función — está
-- DEPRECADA (Postgres emite el aviso literal al llamarla) y en la práctica
-- se quedó colgada indefinidamente en este entorno al probarla. El patrón
-- correcto y el que usa esta migración es el asíncrono real: `net.http_get`
-- devuelve un `request_id` de inmediato (sub-segundo, seguro de llamar desde
-- un trigger sin bloquear el guardado del predio) y la respuesta aparece más
-- tarde en `net._http_response`; un job de pg_cron aparte la recoge. Esto
-- además resuelve por diseño el requisito de "no debe bloquear el guardado
-- del predio": el trigger nunca espera la respuesta.
-- =============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Resumen mensual cacheado y tipado (nunca JSONB en el dominio — mismo
-- invariante que el resto del esquema). Una fila por predio-mes.
create table predio_clima_mensual (
  id                    uuid primary key default gen_random_uuid(),
  predio_id             uuid not null references predio (id) on delete restrict,
  anio                  integer not null check (anio between 1940 and 2100),
  mes                   smallint not null check (mes between 1 and 12),
  temp_max_promedio     numeric,
  temp_min_promedio     numeric,
  horas_sol_acumuladas  numeric,
  precipitacion_mm      numeric,
  dias_helada           integer,
  fuente                text not null default 'open-meteo-archive',
  sincronizado_at       timestamptz not null default now(),
  unique (predio_id, anio, mes)
);

comment on table predio_clima_mensual is
  'Resumen climático mensual cacheado por predio (2.8 del documento maestro), fuente Open-Meteo Historical Weather API (ERA5, resolución de grilla, no estación puntual). Poblada por sincronizar_clima_predio()/recolectar_clima_pendiente() — nunca escrita directamente por el cliente. horas_sol_acumuladas ya viene convertida a horas (la API entrega sunshine_duration en segundos).';

create index idx_predio_clima_mensual_predio on predio_clima_mensual (predio_id, anio, mes);

alter table predio_clima_mensual enable row level security;

create policy predio_clima_mensual_select_autenticados on predio_clima_mensual
  for select using (auth.uid() is not null);

-- Sin INSERT/UPDATE/DELETE para authenticated: solo las funciones
-- SECURITY DEFINER de sincronización escriben acá (dueño de la tabla).
grant select on predio_clima_mensual to authenticated;
grant all on predio_clima_mensual to service_role;

-- ---------------------------------------------------------------------------
-- Tabla de plomería interna: qué request_id de pg_net corresponde a qué
-- predio/rango, mientras la respuesta todavía no llegó. Sin esto, la fase de
-- recolección (que corre en una transacción/momento distinto al del
-- despacho) no tendría forma de saber a qué predio aplicar la respuesta.
-- Nunca se expone al cliente: RLS activado (regla no negociable del
-- proyecto — "sin policy = sin acceso") pero sin ninguna policy, ni grants a
-- authenticated/anon.
-- ---------------------------------------------------------------------------
create table predio_clima_sync_pendiente (
  request_id    bigint primary key,
  predio_id     uuid not null references predio (id) on delete cascade,
  fecha_desde   date not null,
  fecha_hasta   date not null,
  intentos      integer not null default 0,
  created_at    timestamptz not null default now()
);

comment on table predio_clima_sync_pendiente is
  'Plomería interna de sincronización de clima (2.8): un request_id de pg_net pendiente de respuesta, con el predio/rango al que corresponde. Sin acceso de cliente — RLS activado sin policies (regla no negociable del proyecto: toda tabla nueva nace con RLS).';

alter table predio_clima_sync_pendiente enable row level security;
grant all on predio_clima_sync_pendiente to service_role;
