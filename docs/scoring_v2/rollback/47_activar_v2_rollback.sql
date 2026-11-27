-- Rollback del paso 47: vuelve a activar la v1 y deja la v2 inactiva (borrador). Las rondas que se cerraron con la v2 activa quedan ligadas a ella.
DO $rb$
DECLARE
  v_v1 uuid;
  v_v2 uuid;
BEGIN
  SELECT id INTO v_v1 FROM public.scoring_version WHERE nombre = 'Selección de fruto v1 provisional (4-3-2-1)' AND estado = 'inactiva';
  SELECT id INTO v_v2 FROM public.scoring_version WHERE nombre = 'Selección v2 (5 categorías 40-30-15-10-5) provisional' AND estado = 'activa';
  IF v_v1 IS NULL OR v_v2 IS NULL THEN
    RAISE EXCEPTION 'FAIL: rollback 47: la v2 no está activa o la v1 no está inactiva';
  END IF;
  UPDATE public.scoring_version SET estado = 'borrador', aprobado_at = NULL WHERE id = v_v2;
  UPDATE public.scoring_version SET estado = 'activa', vigente_hasta = NULL WHERE id = v_v1;
END;
$rb$;
