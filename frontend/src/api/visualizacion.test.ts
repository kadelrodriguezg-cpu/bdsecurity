import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('./client', () => ({ supabase: { rpc, from }, traducirError: (error: { message: string }) => new Error(error.message) }));

import { consultarMapaViewport, obtenerMapaAgregado, obtenerSeriesHistoricas } from './visualizacion';

beforeEach(() => { rpc.mockReset(); from.mockReset(); rpc.mockResolvedValue({ data: {}, error: null }); });

describe('contratos de visualización', () => {
  it('exige especie antes de solicitar una serie histórica comparable', async () => {
    await expect(obtenerSeriesHistoricas({ especieId: '' })).rejects.toThrow(/especie/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('delega series históricas al backend sin descargar evaluaciones', async () => {
    await obtenerSeriesHistoricas({ especieId: 'especie-1', plantaId: 'cruce-1', fechaDesde: '2026-01-01', fechaHasta: '2026-12-31' });
    expect(rpc).toHaveBeenCalledWith('obtener_series_historicas_cientificas', {
      p_especie_id: 'especie-1', p_planta_id: 'cruce-1', p_fecha_desde: '2026-01-01', p_fecha_hasta: '2026-12-31',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('mantiene el mapa agregado separado de la consulta exacta por viewport', async () => {
    await obtenerMapaAgregado({ especieId: 'especie-1', limite: 50, offset: 10 });
    expect(rpc).toHaveBeenLastCalledWith('obtener_resumen_mapa_territorial', {
      p_especie_id: 'especie-1', p_predio_id: undefined, p_sector_id: undefined, p_limite: 50, p_offset: 10,
    });
    await consultarMapaViewport({ latitudMinima: -36, latitudMaxima: -35, longitudMinima: -72, longitudMaxima: -71, especieId: 'especie-1' });
    expect(rpc).toHaveBeenLastCalledWith('consultar_mapa_viewport', {
      p_latitud_minima: -36, p_latitud_maxima: -35, p_longitud_minima: -72, p_longitud_maxima: -71,
      p_especie_id: 'especie-1', p_limite: 250, p_offset: 0,
    });
    expect(from).not.toHaveBeenCalled();
  });
});
