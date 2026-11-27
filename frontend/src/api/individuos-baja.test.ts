/**
 * La baja pasa solo por RPC (migración 20261021160000): ni la individual ni la
 * de lote escriben directo en individuos/baja_motivo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: { procesados: 2, repetido: false }, error: null })),
  from: vi.fn(),
}));

vi.mock('./client', () => ({
  supabase: { rpc: dobles.rpc, from: dobles.from },
  traducirError: (e: { message?: string }) => new Error(e.message ?? 'error'),
  esConflictoDeIdempotencia: vi.fn(),
}));

import { darBajaEnLote, marcarBaja } from './individuos';

beforeEach(() => vi.clearAllMocks());

describe('baja por RPC', () => {
  it('marcarBaja llama a marcar_baja_individuo con la clave del envío y no toca las tablas', async () => {
    await marcarBaja({ individuo_id: 'i1', estado_vital: 'muerto', fecha_baja: '2026-10-21', criterios: ['vigor', 'sanidad'], nota: '  Helada ' }, 'clave-1');
    expect(dobles.rpc).toHaveBeenCalledWith('marcar_baja_individuo', {
      p_individuo_id: 'i1', p_estado: 'muerto', p_criterios: ['vigor', 'sanidad'], p_nota: 'Helada', p_fecha: '2026-10-21', p_idempotency_key: 'clave-1',
    });
    expect(dobles.from).not.toHaveBeenCalled();
  });

  it('marcarBaja sin criterios falla antes de llamar a la base', async () => {
    await expect(marcarBaja({ individuo_id: 'i1', estado_vital: 'muerto', fecha_baja: '2026-10-21', criterios: [] }, 'k')).rejects.toThrow(/al menos un criterio/);
    expect(dobles.rpc).not.toHaveBeenCalled();
  });

  it('darBajaEnLote llama a dar_baja_individuos con todos los ids', async () => {
    const resultado = await darBajaEnLote({ ids: ['i1', 'i2'], estado_vital: 'descartado', fecha_baja: '2026-10-21', criterios: ['vigor'] }, 'clave-lote');
    expect(dobles.rpc).toHaveBeenCalledWith('dar_baja_individuos', expect.objectContaining({ p_ids: ['i1', 'i2'], p_idempotency_key: 'clave-lote' }));
    expect(resultado).toEqual({ procesados: 2, repetido: false });
  });
});
