import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./client', () => ({
  supabase: { rpc },
  traducirError: (error: { message: string }) => new Error(error.message),
}));

import { obtenerRankingPolinizacionVarietal } from './rankingPolinizacion';

beforeEach(() => rpc.mockReset());

describe('obtenerRankingPolinizacionVarietal', () => {
  it('consulta únicamente la RPC agregada con especie y modo ambos por defecto', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const resultado = await obtenerRankingPolinizacionVarietal('especie-1');

    expect(rpc).toHaveBeenCalledWith('obtener_ranking_polinizacion_varietal', { p_especie_id: 'especie-1', p_rol: 'ambos' });
    expect(resultado).toEqual({ filas: [], resumen: { flores_reales: 0 } });
  });

  it('envía el rol parental seleccionado a la RPC', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await obtenerRankingPolinizacionVarietal('especie-1', 'papa');

    expect(rpc).toHaveBeenCalledWith('obtener_ranking_polinizacion_varietal', { p_especie_id: 'especie-1', p_rol: 'papa' });
  });

  it('separa la fila técnica de resumen de las variedades visibles', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          tipo_fila: 'variedad', variedad_id: 'variedad-1', variedad_nombre: 'Draper',
          flores_totales: 40, sesiones_polinizacion: 2, cruces_distintos: 1, flores_reales: null,
        },
        {
          tipo_fila: 'resumen', variedad_id: null, variedad_nombre: null,
          flores_totales: null, sesiones_polinizacion: null, cruces_distintos: null, flores_reales: 40,
        },
      ],
      error: null,
    });

    await expect(obtenerRankingPolinizacionVarietal('especie-1')).resolves.toEqual({
      filas: [{ variedad_id: 'variedad-1', variedad_nombre: 'Draper', flores_totales: 40, sesiones_polinizacion: 2, cruces_distintos: 1 }],
      resumen: { flores_reales: 40 },
    });
  });

  it('rechaza una consulta sin especie antes de llamar a la base', async () => {
    await expect(obtenerRankingPolinizacionVarietal('')).rejects.toThrow(/selecciona una especie/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('traduce errores de la RPC sin exponer detalles crudos', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Solo un admin puede consultar el ranking varietal de polinización' } });

    await expect(obtenerRankingPolinizacionVarietal('especie-1')).rejects.toThrow(/solo un admin/i);
  });
});
