-- La entidad actual representa exclusivamente rondas anuales. El nombre físico
-- se conserva por compatibilidad; una ronda puntual o multisitio requerirá un
-- modelo de dominio explícito, no reutilizar esta tabla con un anio artificial.
comment on table ronda_evaluacion_anual is
  'Modelo vigente solo para rondas anuales: requiere anio y numero_ronda 1-3 por individuo. No usar para rondas puntuales o multisitio hasta diseñar un modelo generalizado.';

comment on column ronda_evaluacion_anual.anio is
  'Año calendario obligatorio de la ronda anual. Actualmente no existe un constraint que lo iguale a fecha_inicio ni a las fechas de evaluaciones hijas.';

-- Los valores esperados provienen del comportamiento histórico de la app y no
-- constituyen aún una referencia científica aprobada.
update rango_referencia
set nota = 'Rango heredado del comportamiento anterior del sistema — pendiente de confirmación científica por Efraín'
where especie_id is null
  and fase = 'evaluacion_anual'
  and metrica in ('brix', 'calibre_mm')
  and vigente_desde = date '2026-01-01';

