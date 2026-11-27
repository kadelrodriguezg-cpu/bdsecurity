/**
 * Contratos de Sprint 7: las rondas se listan por serie (nunca mezcladas),
 * cada serie crea por su propia RPC, y el mapa del cruce va por RPC agregada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock('./client', () => ({
  supabase: { rpc, from },
  traducirError: (error: { message: string }) => new Error(error.message),
}));

import { listarRondas, iniciarRonda, iniciarRondaMultisitio } from './rondas';
import { obtenerMapaCruce, obtenerClimaPredio } from './emplazamientos';

function encadenarFrom() {
  const cadena: Record<string, unknown> = {};
  const misma = () => cadena;
  Object.assign(cadena, { select: misma, eq: vi.fn(misma), order: vi.fn(async () => ({ data: [], error: null })) });
  return cadena as { eq: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

describe('rondas por serie (Sprint 7)', () => {
  it('listarRondas filtra SIEMPRE por tipo_ronda — anual por defecto', async () => {
    const cadena = encadenarFrom();
    from.mockReturnValue(cadena);
    await listarRondas('ind-1');
    expect(cadena.eq).toHaveBeenCalledWith('tipo_ronda', 'anual');
  });

  it('listarRondas multisitio filtra la serie multisitio', async () => {
    const cadena = encadenarFrom();
    from.mockReturnValue(cadena);
    await listarRondas('ind-1', 'multisitio');
    expect(cadena.eq).toHaveBeenCalledWith('tipo_ronda', 'multisitio');
  });

  it('cada serie crea por su propia RPC (contadores independientes en backend)', async () => {
    await iniciarRonda('ind-1', 1);
    expect(rpc).toHaveBeenCalledWith('iniciar_ronda_esperada', { p_individuo_id: 'ind-1', p_tipo: 'anual', p_numero_esperado: 1 });
    await iniciarRondaMultisitio('ind-1', 2);
    expect(rpc).toHaveBeenCalledWith('iniciar_ronda_esperada', { p_individuo_id: 'ind-1', p_tipo: 'multisitio', p_numero_esperado: 2 });
  });
});

describe('mapa del cruce (Sprint 7)', () => {
  it('consume la RPC agregada por predio, sin descargar tablas', async () => {
    await obtenerMapaCruce('cruce-1');
    expect(rpc).toHaveBeenCalledWith('obtener_mapa_cruce', { p_planta_id: 'cruce-1' });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('clima histórico por predio (Sprint 7.5.1)', () => {
  it('consume la RPC de resumen cacheado por predio_id', async () => {
    await obtenerClimaPredio({ predioId: 'predio-1' });
    expect(rpc).toHaveBeenCalledWith('obtener_clima_predio', { p_predio_id: 'predio-1', p_planta_id: undefined });
    expect(from).not.toHaveBeenCalled();
  });

  it('consume la RPC agregada por planta_id (todos los predios del cruce)', async () => {
    await obtenerClimaPredio({ plantaId: 'cruce-1' });
    expect(rpc).toHaveBeenCalledWith('obtener_clima_predio', { p_predio_id: undefined, p_planta_id: 'cruce-1' });
  });
});
