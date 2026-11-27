import { regionDesdeEstadoNominatim, type RegionChile } from './regionesChile';

/**
 * Adaptador reemplazable de geocodificación. La UI sólo conoce esta función,
 * por lo que el proveedor puede sustituirse sin tocar el selector de
 * ubicación. La petición es al mismo origen: el proxy de Vercel se encarga
 * de Nominatim para cumplir su política y evitar CORS.
 *
 * Nominatim público se usa únicamente tras una acción explícita del usuario,
 * nunca para autocompletar. Se limita a Chile y a cinco resultados. Ver
 * docs/BDSecurity_Documento_Maestro.md (actualización posterior a Sprint 7).
 */
export interface ResultadoGeocodificacion {
  id: string;
  etiqueta: string;
  latitud: number;
  longitud: number;
  region: RegionChile | null;
}

const GEOCODIFICACION_URL = '/api/geocoding';

export async function buscarLugarChile(
  consulta: string,
  signal?: AbortSignal,
): Promise<ResultadoGeocodificacion[]> {
  const texto = consulta.trim();
  if (!texto) return [];

  const url = new URLSearchParams({ q: texto });
  const respuesta = await fetch(`${GEOCODIFICACION_URL}?${url.toString()}`, { signal, headers: { Accept: 'application/json' } });
  if (!respuesta.ok) throw new Error('No fue posible buscar la ubicación. Puedes elegir el punto directamente en el mapa.');
  const filas = await respuesta.json() as Array<{ place_id: number; display_name: string; lat: string; lon: string; address?: { state?: string } }>;
  return filas
    .map((fila) => ({ id: String(fila.place_id), etiqueta: fila.display_name, latitud: Number(fila.lat), longitud: Number(fila.lon), region: regionDesdeEstadoNominatim(fila.address?.state) }))
    .filter((fila) => Number.isFinite(fila.latitud) && Number.isFinite(fila.longitud));
}
