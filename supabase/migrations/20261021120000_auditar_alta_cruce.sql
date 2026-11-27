-- =============================================================================
-- MIGRACIÓN 20261021120000 — AUDITORÍA DEL ALTA DE UN CRUCE (brecha B3)
--
-- Problema que cierra: el linaje (cruzamiento, mama_id, papa_id) entra a la
-- base en el mismo INSERT que crea el cruce (`crearPlanta` en
-- frontend/src/api/plantas.ts), y ese INSERT no dejaba rastro en audit_log.
-- Las escrituras posteriores sí se auditan (actualizar_linaje, migración 007,
-- auditar_escritura_fase), así que el único hueco era el alta.
--
-- Por qué un trigger y no una RPC: mismo criterio que la migración 007. Un
-- trigger AFTER INSERT cubre CUALQUIER camino de inserción (la app, SQL
-- directo, el futuro importador masivo de B1) sin depender de que cada camino
-- se acuerde de auditar. `crearPlanta` no cambia.
--
-- El detalle guarda los valores de linaje, igual que `escritura_linaje` en
-- actualizar_linaje: audit_log solo lo lee un admin (policy de SELECT), así
-- que no abre un camino nuevo para leer el linaje.
-- =============================================================================

create or replace function auditar_alta_cruce()
returns trigger
language plpgsql
security definer            -- audit_log no tiene policy de INSERT (append-only
set search_path = public    -- vía funciones), igual que auditar_cambio_estado
as $$
begin
  insert into audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
  values (
    auth.uid(),             -- null si el alta vino de un contexto administrativo
                            -- (Studio/service_role); la fila se registra igual
    new.id,
    'alta_cruce',
    array['cruzamiento', 'mama_id', 'papa_id'],
    jsonb_build_object(
      'codigo_sistema', new.codigo_sistema,
      'especie_id',     new.especie_id,
      'estado',         new.estado,
      'es_prueba',      new.es_prueba,
      'nuevo', jsonb_strip_nulls(jsonb_build_object(
        'cruzamiento', new.cruzamiento,
        'mama_id',     new.mama_id,
        'papa_id',     new.papa_id,
        -- Texto libre congelado desde 20260903001000; solo aparece si algún
        -- camino lo vuelve a escribir.
        'mama',        new.mama,
        'papa',        new.papa
      ))
    )
  );
  return new;
end;
$$;

comment on function auditar_alta_cruce is
  'Registra en audit_log el alta de cada cruce (accion alta_cruce), con el linaje con que nació. Cubre cualquier camino de INSERT en plantas.';

create trigger trg_plantas_audit_alta
  after insert on plantas
  for each row execute function auditar_alta_cruce();
