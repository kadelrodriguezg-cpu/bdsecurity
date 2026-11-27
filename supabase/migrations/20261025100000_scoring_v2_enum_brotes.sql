-- Scoring v2, paso 44 — la categoría «Brotes y varas» (clave `brotes`) entra al enum de categorías del puntaje.
--
-- Decisión S1 (5 categorías) y EF9 (pesos 40/30/15/10/5). Esta migración va SOLA y no usa el valor nuevo: Postgres no deja usar un
-- valor de enum agregado en la misma transacción. La versión de scoring v2 que lo usa es la migración siguiente (20261025120000).
--
-- El valor se agrega ANTES de `estres` para que el orden natural del enum sea fenologia, fruto_calidad, produccion, brotes, estres
-- (el motor SQL recorre `enum_range(null::categoria_scoring)`). Sin cambios de firma ni de datos: es aditivo.
--
-- Rollback: Postgres NO permite quitar un valor de un enum. El rollback de este paso deja el valor `brotes` en el tipo (inofensivo mientras
-- ninguna fila lo use) y solo quita el registro de la versión; ver docs/scoring_v2/rollback/44_enum_brotes.sql.

alter type public.categoria_scoring add value if not exists 'brotes' before 'estres';
