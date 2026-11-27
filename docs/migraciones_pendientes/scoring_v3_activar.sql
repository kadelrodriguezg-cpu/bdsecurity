-- Paso 61 — ACTIVAR la versión v3 de puntaje (decisión G6). Se aplica DESPUÉS del push del frontend (la app nueva muestra «Año N» junto
-- al puntaje, que es lo que hace legible un rendimiento normalizado por edad).
-- La v2 queda inactiva (con fecha de fin); sus métricas, las rondas cerradas con ella y los rankings congelados no se tocan.
DO $act$
DECLARE
  v_v2 uuid;
  v_v3 uuid;
BEGIN
  SELECT id INTO v_v2 FROM public.scoring_version WHERE nombre = 'Selección v2 (5 categorías 40-30-15-10-5) provisional' AND estado = 'activa';
  SELECT id INTO v_v3 FROM public.scoring_version WHERE nombre = 'Selección v3 (calibre, Brix y rendimiento por edad) provisional' AND estado = 'borrador';
  IF v_v2 IS NULL OR v_v3 IS NULL THEN
    RAISE EXCEPTION 'FAIL: activar v3: la v2 no está activa o la v3 no está en borrador';
  END IF;
  UPDATE public.scoring_version SET estado = 'inactiva', vigente_hasta = current_date WHERE id = v_v2;
  UPDATE public.scoring_version SET estado = 'activa', aprobado_at = now() WHERE id = v_v3;
END;
$act$;
