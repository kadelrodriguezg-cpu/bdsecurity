/**
 * Auditoría integral, Corrida 1, grupo G7: R03 geocodificación.
 *
 * La función serverless de Vercel `frontend/api/geocoding.ts` es un proxy a
 * Nominatim. Aquí se ejecuta el manejador real con `fetch` simulado: NUNCA se
 * llama a Nominatim ni a producción. Las pruebas `it.fails` describen lo que
 * debería pasar y hoy no pasa (A1-G7-08: la función no exige sesión y no
 * limita frecuencia, así que cualquiera en Internet la usa como proxy con el
 * User-Agent de la app).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import geocoding from '../../../frontend/api/geocoding';

interface Salida { status?: number; json?: unknown; headers: Record<string, string> }

function respuesta() {
  const salida: Salida = { headers: {} };
  const mock = {
    setHeader: vi.fn((nombre: string, valor: string) => { salida.headers[nombre] = valor; }),
    status: vi.fn((codigo: number) => { salida.status = codigo; return mock; }),
    json: vi.fn((valor: unknown) => { salida.json = valor; return mock; }),
  };
  return { salida, mock };
}

async function llamar(consulta: unknown, extra: { method?: string; headers?: Record<string, string> } = {}) {
  const { salida, mock } = respuesta();
  await geocoding({ method: extra.method ?? 'GET', headers: extra.headers ?? {}, query: consulta === undefined ? {} : { q: consulta } } as never, mock as never);
  return salida;
}

const lugar = { place_id: 7, display_name: 'Vilches, Maule', lat: '-35.6', lon: '-71.1', address: { state: 'Región del Maule' } };
let fetchMock: ReturnType<typeof vi.fn>;
let errorLog: ReturnType<typeof vi.spyOn>;
let consoleLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify([lugar]), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('R03 /api/geocoding: exposición sin sesión (A1-G7-08)', () => {
  it('hoy responde 200 a una petición anónima, sin Authorization ni cookie, desde cualquier origen', async () => {
    const salida = await llamar('Vilches', { headers: { origin: 'https://sitio-ajeno.example' } });
    expect(salida.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No hay cabeceras CORS: un navegador ajeno no puede leer la respuesta, pero cualquier
    // cliente de servidor (curl, un script) sí.
    expect(salida.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it.fails('A1-G7-08: debería exigir una sesión válida (401) antes de llamar a Nominatim', async () => {
    const salida = await llamar('Vilches');
    expect(salida.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.fails('A1-G7-08: debería limitar la frecuencia por cliente (429) antes de agotar la cortesía con Nominatim', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      estados.push((await llamar(`Vilches ${i}`, { headers: { 'x-forwarded-for': '203.0.113.7' } })).status ?? 0);
    }
    expect(estados).toContain(429);
  });

  it('sin tope ni caché: 30 consultas seguidas del mismo cliente son 30 llamadas a Nominatim (la política pública pide 1 por segundo)', async () => {
    for (let i = 0; i < 30; i += 1) await llamar('Vilches', { headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });

  it('la respuesta es no-store: ni el navegador ni el CDN de Vercel cachean consultas repetidas', async () => {
    const salida = await llamar('Vilches');
    expect(salida.headers['Cache-Control']).toBe('no-store');
  });
});

describe('R03 /api/geocoding: validación y alcance acotado', () => {
  it('acepta 160 caracteres y rechaza 161, vacío, solo espacios y parámetro repetido (400) sin llamar a Nominatim', async () => {
    expect((await llamar('a'.repeat(160))).status).toBe(200);
    fetchMock.mockClear();
    for (const invalida of ['a'.repeat(161), '', '   ', undefined, ['uno', 'dos']]) {
      const salida = await llamar(invalida);
      expect(salida.status, JSON.stringify(invalida)).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('solo GET: los demás métodos reciben 405 con Allow: GET', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      const salida = await llamar('Vilches', { method });
      expect(salida.status, method).toBe(405);
      expect(salida.headers.Allow).toBe('GET');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no es un proxy genérico: host, ruta, país, formato y límite son fijos; la consulta se codifica y no puede inyectar parámetros', async () => {
    await llamar('x&countrycodes=us&limit=50&format=xml#fragmento');
    const destino = new URL(fetchMock.mock.calls[0][0] as URL);
    expect(destino.origin + destino.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(destino.searchParams.get('q')).toBe('x&countrycodes=us&limit=50&format=xml#fragmento');
    expect(destino.searchParams.get('countrycodes')).toBe('cl');
    expect(destino.searchParams.get('limit')).toBe('5');
    expect(destino.searchParams.get('format')).toBe('jsonv2');
    expect([...destino.searchParams.keys()].sort()).toEqual(['addressdetails', 'countrycodes', 'format', 'limit', 'q']);
  });

  it('identifica la app con User-Agent y no reenvía cabeceras del cliente (cookie, authorization, ip) a Nominatim', async () => {
    await llamar('Vilches', { headers: { authorization: 'Bearer secreto', cookie: 'sb=secreto', 'x-forwarded-for': '203.0.113.7' } });
    const opciones = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; signal: AbortSignal };
    expect(Object.keys(opciones.headers).sort()).toEqual(['Accept', 'User-Agent']);
    expect(opciones.headers['User-Agent']).toMatch(/^BDSecurity\/\d/);
    expect(JSON.stringify(opciones.headers)).not.toMatch(/secreto|203\.0\.113/);
    expect(opciones.signal).toBeInstanceOf(AbortSignal);
  });

  it('el User-Agent no incluye un correo de contacto (la política de Nominatim recomienda uno)', async () => {
    await llamar('Vilches');
    const ua = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers['User-Agent'];
    expect(ua).not.toMatch(/@/);
  });
});

describe('R03 /api/geocoding: lo que se registra y lo que se devuelve ante fallas', () => {
  const CONSULTA_SENSIBLE = 'Fundo El Secreto, km 14';

  it('en el camino feliz no escribe nada en consola (la consulta no se registra desde el código de la función)', async () => {
    await llamar(CONSULTA_SENSIBLE);
    expect(errorLog).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('ante 5xx del proveedor, respuesta no-lista, JSON inválido y excepción: 502/504 genérico, sin eco de la consulta ni en la respuesta ni en los logs', async () => {
    const casos: Array<[string, () => Promise<Response>, number]> = [
      ['5xx', async () => new Response('boom ' + CONSULTA_SENSIBLE, { status: 503 }), 502],
      ['no lista', async () => new Response(JSON.stringify({ error: CONSULTA_SENSIBLE }), { status: 200 }), 502],
      ['json inválido', async () => new Response('<html>' + CONSULTA_SENSIBLE, { status: 200 }), 502],
      ['red', async () => { throw new TypeError('fetch failed ' + CONSULTA_SENSIBLE); }, 502],
      ['timeout', async () => { throw new DOMException('agotado', 'TimeoutError'); }, 504],
    ];
    for (const [nombre, simulada, esperado] of casos) {
      fetchMock.mockImplementationOnce(simulada);
      const salida = await llamar(CONSULTA_SENSIBLE);
      expect(salida.status, nombre).toBe(esperado);
      expect(JSON.stringify(salida.json), nombre).not.toContain('Secreto');
    }
    const registrado = JSON.stringify(errorLog.mock.calls);
    expect(registrado).not.toContain('Secreto');
    expect(errorLog).toHaveBeenCalledTimes(casos.length);
  });

  it('devuelve solo place_id, display_name, lat, lon y address.state; descarta el resto del proveedor', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify([{ ...lugar, osm_id: 1, licence: 'ODbL', boundingbox: [1, 2], address: { state: 'Maule', postcode: '3460000', road: 'Calle X' } }]), { status: 200 }));
    const salida = await llamar('Vilches');
    expect(salida.json).toEqual([{ place_id: 7, display_name: 'Vilches, Maule', lat: '-35.6', lon: '-71.1', address: { state: 'Maule' } }]);
  });
});

describe('R03/R01 región sugerida desde Nominatim (A1-G7-15)', () => {
  // Los textos de `state` son los que Nominatim devuelve habitualmente para Chile
  // (nombre OSM de cada región, nivel administrativo 4). NO se verificaron contra
  // Nominatim (prohibido llamarlo): es el supuesto de este hallazgo.
  const ESTADOS_OSM: Array<[string, string]> = [
    ['Región de Arica y Parinacota', 'Arica y Parinacota'],
    ['Región de Tarapacá', 'Tarapacá'],
    ['Región de Antofagasta', 'Antofagasta'],
    ['Región de Atacama', 'Atacama'],
    ['Región de Coquimbo', 'Coquimbo'],
    ['Región de Valparaíso', 'Valparaíso'],
    ['Región Metropolitana de Santiago', 'Metropolitana de Santiago'],
    ["Región del Libertador General Bernardo O'Higgins", "Libertador General Bernardo O'Higgins"],
    ['Región del Maule', 'Maule'],
    ['Región de Ñuble', 'Ñuble'],
    ['Región del Biobío', 'Biobío'],
    ['Región de La Araucanía', 'La Araucanía'],
    ['Región de Los Ríos', 'Los Ríos'],
    ['Región de Los Lagos', 'Los Lagos'],
    ['Región de Aysén del General Carlos Ibáñez del Campo', 'Aysén del General Carlos Ibáñez del Campo'],
    ['Región de Magallanes y de la Antártica Chilena', 'Magallanes y de la Antártica Chilena'],
  ];

  it('las regiones del sur y del centro (Maule a Magallanes, salvo Ñuble y O\'Higgins) se reconocen', async () => {
    const { regionDesdeEstadoNominatim } = await import('../../../frontend/src/features/catalogos/predios/regionesChile');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const estado of ['Región del Maule', 'Región del Biobío', 'Región de La Araucanía', 'Región de Los Ríos', 'Región de Los Lagos', 'Región Metropolitana de Santiago']) {
      expect(regionDesdeEstadoNominatim(estado), estado).not.toBeNull();
    }
  });

  it.fails('A1-G7-15: las 16 regiones se reconocen con el texto habitual de OSM (hoy fallan Arica, Tarapacá, Antofagasta, Atacama, Coquimbo, Valparaíso, Ñuble y O\'Higgins)', async () => {
    const { regionDesdeEstadoNominatim } = await import('../../../frontend/src/features/catalogos/predios/regionesChile');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noReconocidas = ESTADOS_OSM.filter(([estado, esperada]) => regionDesdeEstadoNominatim(estado) !== esperada).map(([estado]) => estado);
    expect(noReconocidas).toEqual([]);
  });
});
