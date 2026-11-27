-- Rollback del paso 44 (enum `brotes`). Postgres no permite quitar un valor de un enum: el valor `brotes` se queda en el tipo.
-- Solo se verifica que ninguna fila lo use (si la v2 sigue cargada hay que revertir antes el paso 46).
DO $rb$
BEGIN
  IF EXISTS (SELECT 1 FROM public.scoring_metrica WHERE categoria::text = 'brotes')
     OR EXISTS (SELECT 1 FROM public.scoring_categoria_peso WHERE categoria::text = 'brotes') THEN
    RAISE EXCEPTION 'FAIL: rollback 44: hay métricas o pesos de la categoría brotes; revierte antes el paso 46';
  END IF;
END;
$rb$;
