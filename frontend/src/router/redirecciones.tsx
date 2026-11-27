/**
 * Redirecciones de las rutas viejas de análisis a Resultados v3 (N21: ninguna URL deja de funcionar).
 * `/ranking` conserva su estado (`?tab=`, `g_col`/`g_dir`, `p_*`, especie y cruce); `/dashboard` va a Resultados con
 * su especie; `/visualizaciones` va a Tendencias.
 */
import { Navigate, useLocation } from 'react-router';
import { rutaDesdeRankingViejo } from '@/features/resultados/modelo';

export function RedireccionRanking() {
  const { search } = useLocation();
  return <Navigate to={rutaDesdeRankingViejo(new URLSearchParams(search))} replace />;
}

function conEspecie(base: string, search: string) {
  const especie = new URLSearchParams(search).get('especie');
  return especie ? `${base}?especie=${encodeURIComponent(especie)}` : base;
}

export function RedireccionDashboard() {
  const { search } = useLocation();
  return <Navigate to={conEspecie('/resultados', search)} replace />;
}

export function RedireccionVisualizaciones() {
  const { search } = useLocation();
  return <Navigate to={conEspecie('/resultados/tendencias', search)} replace />;
}
