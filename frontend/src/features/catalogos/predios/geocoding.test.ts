import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarLugarChile } from './geocoding';

afterEach(() => vi.unstubAllGlobals());

describe('buscarLugarChile', () => {
  it('usa el proxy del mismo origen y no el dominio público desde el navegador', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { place_id: 1, display_name: 'Vilches, Chile', lat: '-35.5', lon: '-71.2', address: { state: 'Región del Maule' } },
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(buscarLugarChile('Vilches')).resolves.toEqual([
      { id: '1', etiqueta: 'Vilches, Chile', latitud: -35.5, longitud: -71.2, region: 'Maule' },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/geocoding?q=Vilches');
  });
});
