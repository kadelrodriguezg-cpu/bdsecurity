-- A1-002. Requiere respaldo y autorización de Kadel para datos reales.
-- ANTES del índice 20261022110000. No infiere qué id debe sobrevivir.
-- En la MISMA conexión, indicar pares explícitamente revisados:
-- SET bdsecurity.fusiones_variedades = '[{"origen_id":"UUID","destino_id":"UUID"}]';
-- Conserva ambas filas; la sobrante queda inactiva y con sufijo UUID para
-- liberar su clave. El nombre original queda en cambio_variedad (A1-010).
-- Rollback posterior: respaldo + auditoría por cruce y catálogo; quitar índice
-- antes de restaurar nombres. No reactivar una fusionada sin revisar referencias.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE public.variedades, public.plantas IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE _fusion_variedades ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('bdsecurity.fusiones_variedades', true), ''), '[]')::jsonb)
AS x(origen_id uuid, destino_id uuid);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _fusion_variedades) THEN
    RAISE EXCEPTION 'Sin pares revisados: configurar bdsecurity.fusiones_variedades';
  END IF;
  IF EXISTS (SELECT 1 FROM _fusion_variedades GROUP BY origen_id HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM _fusion_variedades a JOIN _fusion_variedades b ON a.destino_id = b.origen_id) THEN
    RAISE EXCEPTION 'No se admiten orígenes repetidos, cadenas ni ciclos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _fusion_variedades f
    LEFT JOIN public.variedades o ON o.id = f.origen_id
    LEFT JOIN public.variedades d ON d.id = f.destino_id
    WHERE o.id IS NULL OR d.id IS NULL OR NOT d.activo OR o.especie_id <> d.especie_id
      OR public.clave_nombre_variedad(o.nombre) <> public.clave_nombre_variedad(d.nombre)
  ) THEN RAISE EXCEPTION 'Par inexistente, destino inactivo o especies/claves distintas'; END IF;
END;
$$;

-- Captura ids previos por cruce para que la reasignación sea rastreable.
INSERT INTO public.audit_log (usuario_id, planta_id, accion, campos_expuestos, detalle)
SELECT auth.uid(), p.id, 'fusion_variedades', ARRAY['mama_id','papa_id'],
  jsonb_build_object('anterior', jsonb_build_object('mama_id', p.mama_id, 'papa_id', p.papa_id),
    'nuevo', jsonb_build_object('mama_id', coalesce(m.destino_id, p.mama_id), 'papa_id', coalesce(a.destino_id, p.papa_id)))
FROM public.plantas p
LEFT JOIN _fusion_variedades m ON m.origen_id = p.mama_id
LEFT JOIN _fusion_variedades a ON a.origen_id = p.papa_id
WHERE m.origen_id IS NOT NULL OR a.origen_id IS NOT NULL;

UPDATE public.plantas p
SET mama_id = coalesce((SELECT f.destino_id FROM _fusion_variedades f WHERE f.origen_id = p.mama_id), p.mama_id),
    papa_id = coalesce((SELECT f.destino_id FROM _fusion_variedades f WHERE f.origen_id = p.papa_id), p.papa_id)
WHERE EXISTS (SELECT 1 FROM _fusion_variedades f WHERE f.origen_id IN (p.mama_id, p.papa_id));

UPDATE public.variedades v SET activo = false,
  nombre = v.nombre || ' [fusionada ' || v.id::text || ']'
FROM _fusion_variedades f WHERE v.id = f.origen_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.plantas p JOIN _fusion_variedades f ON f.origen_id IN (p.mama_id, p.papa_id)) THEN
    RAISE EXCEPTION 'FAIL: quedan referencias a variedades sobrantes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.variedades GROUP BY especie_id, public.clave_nombre_variedad(nombre) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'FAIL: quedan duplicados; transacción completa revertida';
  END IF;
  RAISE NOTICE 'PASS: referencias fusionadas, filas conservadas y claves únicas';
END;
$$;
COMMIT;
