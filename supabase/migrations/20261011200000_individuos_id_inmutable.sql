-- =============================================================================
-- MIGRACIÓN 20261011200000 — individuos.id inmutable
--
-- El QR de la etiqueta de un individuo codifica `individuos.id` (formato
-- `/individuo/<uuid>`, ver Documento Maestro, sección «Etiquetas y QR»). Si ese
-- id pudiera cambiar, la etiqueta ya pegada en la planta quedaría huérfana.
--
-- Hasta hoy `proteger_identidad_individuo` bloqueaba cambiar el cruce de origen,
-- el código y la fecha de individualización, pero no el `id`. `UPDATE` sobre
-- `individuos` está concedido a nivel de tabla y la política lo permite al autor
-- o a un admin, así que un individuo recién creado (sin filas hijas, donde la FK
-- no lo frena) podía cambiar de id.
--
-- Esta migración solo redefine la función (CREATE OR REPLACE); el trigger
-- `trg_individuos_proteger_identidad` ya existe y la sigue ejecutando. El resto
-- del cuerpo es idéntico al anterior (migración 20260719003000). No cambia
-- tablas, columnas, políticas ni privilegios, así que no requiere regenerar el
-- Mapa de Esquema.
-- =============================================================================

create or replace function proteger_identidad_individuo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'El id de un individuo es inmutable' using errcode = '23514';
  end if;
  if new.planta_id is distinct from old.planta_id then
    raise exception 'El cruce de origen de un individuo es inmutable' using errcode = '23514';
  end if;
  if new.codigo_display is distinct from old.codigo_display then
    raise exception 'El codigo de un individuo es inmutable' using errcode = '23514';
  end if;
  if new.fecha_individualizacion is distinct from old.fecha_individualizacion then
    raise exception 'La fecha de individualizacion es inmutable' using errcode = '23514';
  end if;
  if new.clon_de_id = new.id then
    raise exception 'Un individuo no puede ser clon de si mismo' using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function proteger_identidad_individuo is
  'Bloquea cambiar id, cruce de origen, codigo_display y fecha de individualizacion de un individuo, y la autoclonacion directa. El id es inmutable porque el QR de la etiqueta lo codifica.';
