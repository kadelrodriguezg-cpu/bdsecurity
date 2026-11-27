-- Paso 47 — ACTIVAR la versión v2 de scoring. Se aplica DESPUÉS del push del frontend (la app nueva ya sabe mostrar la quinta categoría).
-- La v1 queda inactiva (con fecha de fin); sus métricas y los rankings congelados no se tocan.
DO $act$
DECLARE
  v_v1 uuid;
  v_v2 uuid;
BEGIN
  SELECT id INTO v_v1 FROM public.scoring_version WHERE nombre = 'Selección de fruto v1 provisional (4-3-2-1)' AND estado = 'activa';
  SELECT id INTO v_v2 FROM public.scoring_version WHERE nombre = 'Selección v2 (5 categorías 40-30-15-10-5) provisional' AND estado = 'borrador';
  IF v_v1 IS NULL OR v_v2 IS NULL THEN
    RAISE EXCEPTION 'FAIL: activar v2: la v1 no está activa o la v2 no está en borrador';
  END IF;
  UPDATE public.scoring_version SET estado = 'inactiva', vigente_hasta = current_date WHERE id = v_v1;
  UPDATE public.scoring_version SET estado = 'activa', aprobado_at = now() WHERE id = v_v2;
END;
$act$;
