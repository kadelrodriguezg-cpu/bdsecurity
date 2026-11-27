-- Fase 4, paso 48 — fecha desde la que existe cada descriptor y etiquetas por nivel de la precocidad.
--
-- 1. `esquema_fase_campo.vigente_desde` (date, nula = existió siempre). La lectura de una evaluación no cuenta en su «N de M» los
--    descriptores creados después de la fecha de la evaluación (no se pudieron medir) y los muestra como «No existía en esa fecha».
--    Hoy solo «Distribución de flores y frutos en la vara» es posterior: entró a producción el 25-10-2026 (paso 45, EF12).
-- 2. Precocidad con el mes de cosecha en cada nivel (Efraín): 5 «Muy temprana (oct – inicio nov)», 4 «Temprana (nov)», 3 «Media (dic)»,
--    2 «Tardía (ene)», 1 «Muy tardía (feb o más)». Mismo mecanismo que la distribución floral (`etiquetas_nivel`). No cambia la escala,
--    el peso ni la dirección del puntaje (mayor es mejor): solo los textos. Los extremos (`etiqueta_minimo`/`etiqueta_maximo`) se
--    alinean con los niveles 1 y 5.
--
-- Aditivo: la app anterior no lee `vigente_desde` (pide las columnas con `select *` y las ignora) y ya sabe mostrar `etiquetas_nivel`.
-- Rollback: docs/fase4/rollback/48_vigente_desde_y_precocidad.sql.

alter table public.esquema_fase_campo
  add column vigente_desde date;

comment on column public.esquema_fase_campo.vigente_desde is
  'Fecha desde la que existe el descriptor (nula = existió siempre). Una evaluación anterior no lo cuenta en su «N de M».';

update public.esquema_fase_campo
set vigente_desde = date '2026-10-25'
where fase = 'evaluacion_anual' and clave = 'distribucion_flores_frutos';

update public.esquema_fase_campo
set etiqueta_minimo = 'Muy tardía (feb o más)',
    etiqueta_maximo = 'Muy temprana (oct – inicio nov)',
    etiquetas_nivel = array['Muy tardía (feb o más)', 'Tardía (ene)', 'Media (dic)', 'Temprana (nov)', 'Muy temprana (oct – inicio nov)']
where fase = 'evaluacion_anual' and clave = 'precocidad';

do $verificar$
begin
  if (select count(*) from public.esquema_fase_campo where fase = 'evaluacion_anual' and clave = 'precocidad'
        and cardinality(etiquetas_nivel) = 5 and escala_minimo = 1 and escala_maximo = 5) <> 1 then
    raise exception 'precocidad: etiquetas por nivel no aplicadas';
  end if;
end;
$verificar$;
