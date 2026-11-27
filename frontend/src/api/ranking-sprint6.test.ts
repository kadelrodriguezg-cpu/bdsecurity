/**
 * Contratos de las RPC de Sprint 5 consumidas por las pantallas de ranking
 * (Sprint 6): cada consulta va a la RPC correcta con los parámetros
 * correctos, exige el alcance XOR (cruce O especie / individuo O cruce) y
 * jamás descarga tablas para agregar en cliente.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock('./client', () => ({
  supabase: { rpc, from },
  traducirError: (error: { message: string }) => new Error(error.message),
}));

import { obtenerComparacionRondas } from './comparacion';
import { compararSnapshotVivo, listarSnapshotsRanking, obtenerDetalleSnapshot } from './snapshots';

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

describe('obtenerComparacionRondas', () => {
  it('consulta por cruce', async () => {
    await obtenerComparacionRondas({ plantaId: 'cruce-1' });
    expect(rpc).toHaveBeenCalledWith('obtener_comparacion_rondas', {
      p_individuo_id: undefined,
      p_planta_id: 'cruce-1',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('consulta por individuo', async () => {
    await obtenerComparacionRondas({ individuoId: 'ind-1' });
    expect(rpc).toHaveBeenCalledWith('obtener_comparacion_rondas', {
      p_individuo_id: 'ind-1',
      p_planta_id: undefined,
    });
  });

  it('rechaza ambos o ninguno (XOR)', async () => {
    await expect(obtenerComparacionRondas({})).rejects.toThrow(/exactamente/);
    await expect(obtenerComparacionRondas({ individuoId: 'a', plantaId: 'b' })).rejects.toThrow(/exactamente/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('snapshots consultables', () => {
  it('lista con alcance XOR y paginación en backend', async () => {
    await listarSnapshotsRanking({ plantaId: 'cruce-1', limite: 50 });
    expect(rpc).toHaveBeenCalledWith('listar_snapshots_ranking', {
      p_planta_id: 'cruce-1',
      p_especie_id: undefined,
      p_limite: 50,
      p_offset: 0,
    });
    await expect(listarSnapshotsRanking({})).rejects.toThrow(/exactamente/);
  });

  it('detalle y comparación van por RPC con el snapshot puntual', async () => {
    await obtenerDetalleSnapshot('snap-1');
    expect(rpc).toHaveBeenCalledWith('obtener_detalle_snapshot', { p_snapshot_id: 'snap-1' });
    await compararSnapshotVivo('snap-1');
    expect(rpc).toHaveBeenCalledWith('comparar_snapshot_vivo', { p_snapshot_id: 'snap-1' });
    expect(from).not.toHaveBeenCalled();
  });
});
