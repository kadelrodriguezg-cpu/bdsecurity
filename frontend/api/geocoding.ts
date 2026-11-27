import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Proxy acotado para Nominatim. El navegador consulta el mismo origen y la
 * función identifica explícitamente la aplicación al proveedor; así evitamos
 * tanto el bloqueo CORS como exponer un proxy genérico.
 */
type SolicitudVercel = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
};

type RespuestaVercel = ServerResponse & {
  status: (codigo: number) => RespuestaVercel;
  json: (cuerpo: unknown) => RespuestaVercel;
};

const MAXIMO_CARACTERES = 160;
/** Nominatim suele responder en < 2 s; sin tope, una caída retendría la función. */
const TIEMPO_MAXIMO_MS = 8000;

/** Solo los campos que usa el cliente (src/features/catalogos/predios/geocoding.ts). */
interface LugarGeocodificado {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: { state?: string };
}

function consultaUnica(valor: string | string[] | undefined): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function reducirLugar(fila: unknown): LugarGeocodificado | null {
  if (!fila || typeof fila !== 'object') return null;
  const { place_id, display_name, lat, lon, address } = fila as Record<string, unknown>;
  if (typeof place_id !== 'number' || typeof display_name !== 'string' || typeof lat !== 'string' || typeof lon !== 'string') return null;
  const region = address && typeof address === 'object' ? (address as Record<string, unknown>).state : undefined;
  return { place_id, display_name, lat, lon, ...(typeof region === 'string' ? { address: { state: region } } : {}) };
}

export default async function geocoding(request: SolicitudVercel, response: RespuestaVercel): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const consulta = consultaUnica(request.query?.q);
  if (!consulta || consulta.length > MAXIMO_CARACTERES) {
    response.status(400).json({ error: 'Indica una ubicación de hasta 160 caracteres.' });
    return;
  }

  const destino = new URL('https://nominatim.openstreetmap.org/search');
  destino.search = new URLSearchParams({
    q: consulta,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'cl',
    addressdetails: '1',
  }).toString();

  try {
    const resultado = await fetch(destino, {
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'BDSecurity/1.0 (+https://bdsecurity.example.com)',
      },
    });

    if (!resultado.ok) {
      // No reflejar cuerpo ni consulta: podría incluir datos de ubicación.
      console.error('Nominatim no respondió correctamente.', { status: resultado.status });
      response.status(502).json({ error: 'No fue posible buscar la ubicación. Puedes elegir el punto directamente en el mapa.' });
      return;
    }

    const filas: unknown = await resultado.json();
    if (!Array.isArray(filas)) {
      console.error('Nominatim devolvió una respuesta inesperada.');
      response.status(502).json({ error: 'No fue posible buscar la ubicación. Puedes elegir el punto directamente en el mapa.' });
      return;
    }

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json(filas.map(reducirLugar).filter((fila): fila is LugarGeocodificado => fila !== null));
  } catch (error) {
    // AbortSignal.timeout rechaza con un DOMException 'TimeoutError', que no
    // siempre es instanceof Error (depende del runtime): se lee solo `name`.
    const posible = (error as { name?: unknown } | null)?.name;
    const nombre = typeof posible === 'string' ? posible : 'Error';
    console.error('No se pudo conectar con Nominatim.', { nombre });
    response.status(nombre === 'TimeoutError' ? 504 : 502)
      .json({ error: 'No fue posible buscar la ubicación. Puedes elegir el punto directamente en el mapa.' });
  }
}
