-- =============================================================================
-- SPRINT 4 / PARTE B — Evaluación: frutos y peso.
-- Corresponde a docs/BDSecurity_Documento_Maestro.md, Fase 1.d.
--
-- El documento maestro pide agregar evaluaciones.n_frutos_evaluados y
-- evaluaciones.peso_total_frutos_g, con peso_promedio_g recalculado a partir
-- de ambas. Diagnóstico contra producción (evidencia del sprint): esas dos
-- columnas YA EXISTEN bajo otro nombre — cantidad_frutos y peso_total_g,
-- agregadas en 20260719003000 — y peso_promedio_g YA es una columna
-- generada (`peso_total_g / cantidad_frutos cuando cantidad_frutos > 0`)
-- que depende de ellas. 7 de las 10 evaluaciones reales tienen datos no
-- nulos ahí (valores completa/borrador reales, no de prueba), y
-- validar_evaluacion_integridad() exige cantidad_frutos > 0 y
-- peso_total_g > 0 para poder cerrar una evaluación como 'completa'. El
-- formulario del frontend (EvaluacionForm.tsx, EvaluacionesLista.tsx) ya lee
-- y escribe estos campos.
--
-- Decisión (confirmada explícitamente, no asumida): NO se crean columnas
-- nuevas ni se toca peso_promedio_g. Crear n_frutos_evaluados/
-- peso_total_frutos_g como columnas paralelas duplicaría un concepto que ya
-- existe y ya tiene datos históricos reales detrás, sin que quede claro cuál
-- alimentaría el formulario ya desplegado. Renombrar las columnas existentes
-- preserva los datos pero obliga a tocar frontend ya desplegado
-- (EvaluacionForm.tsx, EvaluacionesLista.tsx, api/client.ts, api/rondas.ts)
-- en un sprint que es explícitamente solo de migración. Se documenta acá la
-- correspondencia de nombres para que quede trazado en el catálogo mismo,
-- sin alterar ni estructura ni datos. Fase 1.d y 3.e del documento maestro
-- se consideran ya resueltas por la implementación existente bajo estos
-- nombres.
-- =============================================================================

comment on column evaluaciones.cantidad_frutos is
  'Cantidad de frutos evaluados. Corresponde a "n_frutos_evaluados" en '
  'docs/BDSecurity_Documento_Maestro.md (Fase 1.d) — el campo ya existía '
  'bajo este nombre (migración 20260719003000) antes de que se documentara '
  'el requisito; no se creó una columna duplicada (ver Sprint 4, Parte B). '
  'Obligatorio (> 0) para cerrar una evaluación como completa/corregida '
  '(validar_evaluacion_integridad).';

comment on column evaluaciones.peso_total_g is
  'Peso total de los frutos evaluados, en gramos. Corresponde a '
  '"peso_total_frutos_g" en docs/BDSecurity_Documento_Maestro.md (Fase 1.d) '
  '— el campo ya existía bajo este nombre (migración 20260719003000); no se '
  'creó una columna duplicada (ver Sprint 4, Parte B). Obligatorio (> 0) '
  'para cerrar una evaluación como completa/corregida.';

comment on column evaluaciones.peso_promedio_g is
  'Columna generada: peso_total_g / cantidad_frutos cuando cantidad_frutos '
  '> 0. Ya cumple el criterio de Fase 1.d/3.e del documento maestro '
  '("el promedio se calcula solo") — no se redefinió ni se tocó su '
  'expresión en Sprint 4 (ver Parte B): ya dependía de columnas con datos '
  'históricos reales, y las columnas que el documento maestro pedía crear '
  '(n_frutos_evaluados/peso_total_frutos_g) resultaron ser estas mismas '
  'bajo otro nombre.';
