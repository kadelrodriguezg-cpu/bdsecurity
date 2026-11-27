-- =============================================================================
-- SPRINT 4 / PARTE A — Territorio geolocalizado (migración de fundaciones).
-- Corresponde a docs/BDSecurity_Documento_Maestro.md, sección 2.4 y Fase 1.c.
--
-- Diagnóstico previo contra producción (no confiar del audit, mismo criterio
-- que Sprint 2/3 — ver evidencia del sprint): la auditoría decía "2 predios
-- legado, uno inactivo". La realidad es distinta: 4 predios, TODOS con
-- activo=false ('Predio 2 Inv 3', 'Predio prueba', 'Vilches',
-- 'TEST-E2E-20260717-predio'); solo 2 de los 4 tienen sector ('Vilches' y el
-- predio de prueba E2E no tienen ninguno). Esto no cambia el diseño de esta
-- migración (no se pide backfill de coordenadas ni de sector para legado,
-- solo que la creación de un predio NUEVO quede resuelta) pero sí explica la
-- causa raíz exacta: el backfill de 'Sector legado sin clasificar' en la
-- migración 20260719005000 fue un INSERT ... SELECT de una sola vez sobre los
-- predios que existían EN ESE MOMENTO. Nunca hubo un trigger que siguiera
-- creando sector para predios insertados después — por eso Vilches y el
-- predio de prueba E2E (creados más tarde) quedaron sin ninguno. Ese es el
-- gap real que cierra esta migración.
--
-- Decisión — reutilizar el Sitio de compatibilidad en vez de crear un
-- "Sitio General" nuevo: la sección 2.4 del documento maestro describe
-- anclar a un "Sitio General por defecto" al crear un Predio sin Sitio
-- explícito. Ya existe exactamente ese mecanismo desde Sprint 3
-- (sitio_predeterminado_legacy() + trigger trg_predio_sitio_compatibilidad,
-- migraciones 20260719005100/005200): idempotente, probado, y ya es el
-- default de la columna predio.sitio_id. Crear un segundo sitio "General"
-- distinto fragmentaría los predios en dos cubetas de default en vez de una,
-- y contradice el propio requisito de idempotencia del sprint. Se reutiliza
-- 'Sitio legado sin clasificar' como el Sitio general por defecto — el
-- nombre es una etiqueta heredada, no cambia su rol funcional. No se
-- renombra: el nombre no tiene efecto en ninguna lógica de negocio más allá
-- de esas dos funciones (comparan por id vía FK, no por nombre, salvo el
-- propio lookup inicial), y renombrarlo no aporta nada que el requisito
-- funcional ya no tenga cubierto.
--
-- Lo que SÍ falta y se agrega acá: un trigger AFTER INSERT en predio que
-- crea automáticamente un Sector por defecto para cada predio nuevo, de
-- forma idempotente (on conflict do nothing sobre el unique existente
-- (predio_id, nombre)), y las columnas de coordenada del predio.
-- =============================================================================

-- Coordenadas del predio: fuente del pin del mapa (2.4.1). Nullable — no se
-- exige backfill de los 4 predios legado, que pueden quedar sin coordenada
-- por ahora sin romper nada (el mapa simplemente no les muestra pin).
alter table predio
  add column latitud numeric,
  add column longitud numeric;

alter table predio
  add constraint predio_latitud_rango
    check (latitud is null or latitud between -90 and 90),
  add constraint predio_longitud_rango
    check (longitud is null or longitud between -180 and 180),
  add constraint predio_coordenada_completa
    check ((latitud is null) = (longitud is null));

comment on column predio.latitud is
  'Latitud del predio (WGS84). Fuente del pin del mapa de la ficha de cruce '
  '(2.4 del documento maestro). Nullable: predios legado pueden no tenerla.';
comment on column predio.longitud is
  'Longitud del predio (WGS84). Va siempre junto con latitud '
  '(predio_coordenada_completa) o ninguna de las dos.';

-- Auto-provisión de Sector por defecto al crear un Predio, de modo que el
-- predio quede inmediatamente utilizable como destino de traslado sin pasos
-- manuales adicionales (cierra el hallazgo E2E 4.2 a nivel de datos).
create or replace function auto_provisionar_sector_predio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- predio no tiene columna created_by (confirmado por \d predio): el
  -- sector queda con created_by NULL, igual que cualquier otra fila creada
  -- por un mecanismo automático sin autor humano directo.
  insert into sector (predio_id, nombre)
  values (new.id, 'Sector principal')
  on conflict (predio_id, nombre) do nothing;
  return new;
end;
$$;

comment on function auto_provisionar_sector_predio is
  'Crea un Sector "Sector principal" por defecto para todo predio nuevo, '
  'idempotente vía el unique (predio_id, nombre) de sector. Sin esto, un '
  'predio creado en Catálogos no tenía ningún destino de traslado válido '
  'hasta gestionar Sectores manualmente (hallazgo E2E 4.2).';

create trigger trg_predio_auto_sector
  after insert on predio
  for each row execute function auto_provisionar_sector_predio();
