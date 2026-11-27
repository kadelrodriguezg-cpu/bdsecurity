-- Rollback del paso 52 (cierre de temporada). Solo quita las dos funciones: los rankings congelados que se hayan creado con ellas
-- se conservan (son historia y se leen como cualquier otro congelado).
DROP FUNCTION public.cerrar_temporada_ranking(uuid, smallint);
DROP FUNCTION public.anio_temporada(uuid, smallint);
