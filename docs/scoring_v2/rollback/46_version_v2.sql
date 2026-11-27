-- Rollback del paso 46 (versión v2 de scoring). Solo si la v2 sigue inactiva (borrador) y sin uso.
DO $rb$
DECLARE
  v_v2 uuid;
BEGIN
  SELECT id INTO v_v2 FROM public.scoring_version WHERE nombre = 'Selección v2 (5 categorías 40-30-15-10-5) provisional';
  IF v_v2 IS NULL THEN
    RAISE EXCEPTION 'FAIL: rollback 46: no existe la versión v2';
  END IF;
  IF (SELECT estado FROM public.scoring_version WHERE id = v_v2) <> 'borrador' THEN
    RAISE EXCEPTION 'FAIL: rollback 46: la v2 está activa o ya se usó; revierte antes el paso 47';
  END IF;
  IF public.scoring_version_en_uso(v_v2) THEN
    RAISE EXCEPTION 'FAIL: rollback 46: la v2 ya está en uso (rondas o rankings congelados la usan)';
  END IF;
  DELETE FROM public.scoring_categoria_peso WHERE scoring_version_id = v_v2;
  DELETE FROM public.scoring_metrica WHERE scoring_version_id = v_v2;
  DELETE FROM public.scoring_version WHERE id = v_v2;
END;
$rb$;
