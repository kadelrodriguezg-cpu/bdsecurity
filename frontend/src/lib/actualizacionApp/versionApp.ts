/**
 * Versión de la app: la que está cargada en esta pestaña y la que está publicada.
 * La publicada se lee de `/version.json`, que genera el build (vite-plugin-version.ts)
 * con el mismo id que se compila dentro del código como `__BUILD_ID__`.
 */

/** Id de la versión que esta pestaña tiene cargada ('dev' en desarrollo y pruebas). */
export const ID_VERSION_CARGADA: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export const RUTA_VERSION = '/version.json';
const TIEMPO_MAXIMO_PETICION_MS = 10_000;

/** Extrae el id de un `version.json`; null si el contenido no es el esperado. */
export function leerIdVersion(contenido: unknown): string | null {
  if (contenido === null || typeof contenido !== 'object') return null;
  const id = (contenido as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/**
 * Pide a la red el id de la versión publicada. Devuelve null ante cualquier
 * fallo (sin conexión, 404, respuesta que no es JSON, como el `index.html` que
 * Vercel entrega para rutas desconocidas): una comprobación fallida nunca debe
 * molestar al usuario.
 */
export async function obtenerIdVersionPublicada(
  peticion: typeof fetch = fetch,
  tiempoMaximoMs: number = TIEMPO_MAXIMO_PETICION_MS,
): Promise<string | null> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), tiempoMaximoMs);
  try {
    const respuesta = await peticion(RUTA_VERSION, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: control.signal,
    });
    if (!respuesta.ok) return null;
    return leerIdVersion(await respuesta.json());
  } catch {
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}
