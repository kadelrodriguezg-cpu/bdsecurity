-- Rollback del paso 61: vuelve a activar la v2 y deja la v3 inactiva (borrador). Las rondas que se cerraron con la v3 activa quedan
-- ligadas a ella (y la v3 queda en uso: desde entonces el rollback del paso 58 se niega).
DO $rb$
DECLARE
  v_v2 uuid;
  v_v3 uuid;
BEGIN
  SELECT id INTO v_v2 FROM public.scoring_version WHERE nombre = 'Selección v2 (5 categorías 40-30-15-10-5) provisional' AND estado = 'inactiva';
  SELECT id INTO v_v3 FROM public.scoring_version WHERE nombre = 'Selección v3 (calibre, Brix y rendimiento por edad) provisional' AND estado = 'activa';
  IF v_v2 IS NULL OR v_v3 IS NULL THEN
    RAISE EXCEPTION 'FAIL: rollback 61: la v3 no está activa o la v2 no está inactiva';
  END IF;
  UPDATE public.scoring_version SET estado = 'borrador', aprobado_at = NULL WHERE id = v_v3;
  UPDATE public.scoring_version SET estado = 'activa', vigente_hasta = NULL WHERE id = v_v2;
END;
$rb$;
