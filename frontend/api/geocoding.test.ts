import { afterEach, describe, expect, it, vi } from 'vitest';
import geocoding from './geocoding';

function respuesta() {
  const cuerpo: { status?: number; json?: unknown; headers: Record<string, string> } = { headers: {} };
  const mock = {
    setHeader: vi.fn((nombre: string, valor: string) => { cuerpo.headers[nombre] = valor; }),
    status: vi.fn((codigo: number) => { cuerpo.status = codigo; return mock; }),
    json: vi.fn((valor: unknown) => { cuerpo.json = valor; return mock; }),
  };
  return { cuerpo, mock };
}

afterEach(() => vi.unstubAllGlobals());

describe('proxy de geocodificación', () => {
  it('rechaza métodos y consultas inválidas antes de llamar a Nominatim', async () => {
    const salida = respuesta();
    await geocoding({ method: 'POST', query: { q: 'Vilches' } } as never, salida.mock as never);
    expect(salida.cuerpo.status).toBe(405);
    expect(salida.cuerpo.headers.Allow).toBe('GET');

    const invalida = respuesta();
    await geocoding({ method: 'GET', query: { q: ' ' } } as never, invalida.mock as never);
    expect(invalida.cuerpo.status).toBe(400);
  });

  it('limita la consulta a Chile e identifica la aplicación ante Nominatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ place_id: 1 }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const salida = respuesta();

    await geocoding({ method: 'GET', query: { q: 'Vilches' } } as never, salida.mock as never);

    const destino = new URL(fetchMock.mock.calls[0][0] as URL);
    expect(destino.origin + destino.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(destino.searchParams.get('q')).toBe('Vilches');
    expect(destino.searchParams.get('countrycodes')).toBe('cl');
    expect(destino.searchParams.get('limit')).toBe('5');
    expect(destino.searchParams.get('addressdetails')).toBe('1');
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toContain('BDSecurity/');
    expect(salida.cuerpo.status).toBe(200);
    expect(salida.cuerpo.headers['Cache-Control']).toBe('no-store');
  });

  it('aplica un tiempo máximo a la llamada y responde 504 si se agota', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Tiempo agotado', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);
    const salida = respuesta();

    await geocoding({ method: 'GET', query: { q: 'Vilches' } } as never, salida.mock as never);

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(salida.cuerpo.status).toBe(504);
    expect(JSON.stringify(salida.cuerpo.json)).not.toContain('Vilches');
  });

  it('devuelve solo los campos que usa el cliente', async () => {
    const lugar = {
      place_id: 7, display_name: 'Vilches, Maule', lat: '-35.6', lon: '-71.1', osm_id: 99, licence: 'ODbL', importance: 0.4,
      address: { state: 'Región del Maule', country: 'Chile', postcode: '3460000' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([lugar, { basura: true }]), { status: 200 })));
    const salida = respuesta();

    await geocoding({ method: 'GET', query: { q: 'Vilches' } } as never, salida.mock as never);

    expect(salida.cuerpo.status).toBe(200);
    expect(salida.cuerpo.json).toEqual([
      { place_id: 7, display_name: 'Vilches, Maule', lat: '-35.6', lon: '-71.1', address: { state: 'Región del Maule' } },
    ]);
  });

  it('trata una respuesta que no es lista como falla del proveedor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 200 })));
    const salida = respuesta();

    await geocoding({ method: 'GET', query: { q: 'Vilches' } } as never, salida.mock as never);

    expect(salida.cuerpo.status).toBe(502);
  });
});
