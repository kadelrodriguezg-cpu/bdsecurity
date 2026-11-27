import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('./client', () => ({
  supabase: { rpc, from },
  traducirError: (error: { message: string }) => new Error(error.message),
}));

import { obtenerDashboardCientifico } from './dashboard';
import { listarCrucesAnaliticos } from './plantas';
import { obtenerRankingPorGrupos } from './rankingGrupos';

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

describe('contratos analíticos', () => {
  it('dashboard usa una RPC de agregación y no descarga tablas para agrupar en cliente', async () => {
    await obtenerDashboardCientifico('especie-1', 8);
    expect(rpc).toHaveBeenCalledWith('obtener_dashboard_cientifico', { p_especie_id: 'especie-1', p_limite: 8, p_incluir_pruebas: false });
    expect(from).not.toHaveBeenCalled();
  });

  it('ranking por grupos consulta por cruce o por especie y no manda filtros que la base no tiene', async () => {
    await obtenerRankingPorGrupos({ especieId: 'especie-1' });
    expect(rpc).toHaveBeenLastCalledWith('obtener_ranking_por_grupos', { p_especie_id: 'especie-1', p_incluir_pruebas: false });

    await obtenerRankingPorGrupos({ plantaId: 'cruce-1', incluirPruebas: true });
    expect(rpc).toHaveBeenLastCalledWith('obtener_ranking_por_grupos', { p_planta_id: 'cruce-1', p_incluir_pruebas: true });
  });

  it('tabla de cruces delega filtros, orden y página a PostgreSQL', async () => {
    await listarCrucesAnaliticos({ especieId: 'especie-1', estado: 'cosecha', busqueda: '02-', orden: 'vivos_desc', limite: 25, offset: 25 });
    expect(rpc).toHaveBeenCalledWith('listar_cruces_analiticos', {
      p_especie_id: 'especie-1',
      p_estado: 'cosecha',
      p_busqueda: '02-',
      p_orden: 'vivos_desc',
      p_limite: 25,
      p_offset: 25,
      p_incluir_pruebas: false,
    });
    expect(from).not.toHaveBeenCalled();
  });
});
