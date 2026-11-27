/**
 * Cambia parámetros de la URL sin perder el `#` (la planilla guarda «Ver valores» en `#valores`): `setSearchParams` de
 * react-router navega a «?…» y deja el hash vacío. Reemplaza la entrada del historial (no agrega una por cada cambio).
 */
import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

export function useParametrosUrl(): [URLSearchParams, (cambio: (p: URLSearchParams) => URLSearchParams | void) => void] {
  const [parametros] = useSearchParams();
  const ubicacion = useLocation();
  const navigate = useNavigate();
  const actualizar = useCallback((cambio: (p: URLSearchParams) => URLSearchParams | void) => {
    const copia = new URLSearchParams(ubicacion.search);
    const sig = cambio(copia) ?? copia;
    if (sig.toString() === new URLSearchParams(ubicacion.search).toString()) return;
    navigate({ pathname: ubicacion.pathname, search: sig.toString() ? `?${sig.toString()}` : '', hash: ubicacion.hash }, { replace: true, state: ubicacion.state });
  }, [navigate, ubicacion.pathname, ubicacion.search, ubicacion.hash, ubicacion.state]);
  return [parametros, actualizar];
}
