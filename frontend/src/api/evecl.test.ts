import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => {
  const borrarSegundaCondicion = vi.fn();
  const borrarPrimeraCondicion = vi.fn(() => ({ eq: borrarSegundaCondicion }));
  const borrar = vi.fn(() => ({ eq: borrarPrimeraCondicion }));
  const fromTabla = vi.fn(() => ({ delete: borrar }));
  const remove = vi.fn();
  const fromStorage = vi.fn(() => ({ remove }));
  const rpc = vi.fn();
  return { borrarSegundaCondicion, borrarPrimeraCondicion, borrar, fromTabla, remove, fromStorage, rpc };
});

vi.mock('./client', () => ({
  supabase: {
    storage: { from: dobles.fromStorage },
    from: dobles.fromTabla,
    rpc: dobles.rpc,
  },
  traducirError: () => new Error('Error traducido'),
}));

import { compararEvecl, eliminarRespuestaEvecl, guardarFichaEvecl, type EveclFichaEntrada, type EveclRespuesta } from './evecl';

describe('A1-011 guardado antes de limpiar Storage', () => {
  const entrada: EveclFichaEntrada = {
    id: 8, ensayo_id: 2, variedad: 'Duke', tipo: 'evaluacion', numero_repeticion: 1,
    fecha_evaluacion: '2026-10-01', respuestas: [],
  };
  const anteriores = () => new Map<number, EveclRespuesta>([[19, {
    descriptor_id: 19, nota: null, valor_numerico: 3, valor_texto: null,
    foto_path: 'evecl/2/8/19.jpg', fecha_observada: null,
    descriptor: { nombre: 'Firmeza', tipo: 'valor', eje: 'calidad', unidad: null, orden: 1 },
  }]]);
  beforeEach(() => vi.clearAllMocks());

  it('el rechazo SQL no toca Storage ni ejecuta bajas separadas', async () => {
    dobles.rpc.mockResolvedValueOnce({ error: { message: 'validación' }, data: null });
    await expect(guardarFichaEvecl(entrada, [], anteriores())).rejects.toThrow('Error traducido');
    expect(dobles.remove).not.toHaveBeenCalled();
    expect(dobles.fromTabla).not.toHaveBeenCalled();
  });

  it('si falla Storage después, informa que la ficha ya se guardó', async () => {
    dobles.rpc.mockResolvedValueOnce({ data: 8, error: null });
    dobles.remove.mockResolvedValueOnce({ error: { message: 'sin conexión' } });
    await expect(guardarFichaEvecl(entrada, [], anteriores())).rejects.toThrow('La ficha se guardó, pero');
    expect(dobles.rpc.mock.invocationCallOrder[0]).toBeLessThan(dobles.remove.mock.invocationCallOrder[0]);
    expect(dobles.rpc).toHaveBeenCalledWith('evecl_guardar_ficha_con_bajas', expect.objectContaining({ p_descriptores_eliminar: [19] }));
  });
});

describe('fotos EVECL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dobles.remove.mockResolvedValue({ error: null });
    dobles.borrarSegundaCondicion.mockResolvedValue({ error: null });
  });

  it('borra primero el objeto privado y después la fila de respuesta', async () => {
    await eliminarRespuestaEvecl(8, 19, 'evecl/2/8/19.jpg');
    expect(dobles.remove).toHaveBeenCalledWith(['evecl/2/8/19.jpg']);
    expect(dobles.fromTabla).toHaveBeenCalledWith('evecl_respuesta');
    expect(dobles.remove.mock.invocationCallOrder[0]).toBeLessThan(dobles.fromTabla.mock.invocationCallOrder[0]);
  });

  it('conserva la fila cuando falla el borrado de Storage', async () => {
    dobles.remove.mockResolvedValueOnce({ error: { message: 'falló Storage' } });
    await expect(eliminarRespuestaEvecl(8, 19, 'evecl/2/8/19.jpg')).rejects.toThrow('La respuesta se conservó');
    expect(dobles.fromTabla).not.toHaveBeenCalled();
  });
});

describe('comparación EVECL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dobles.rpc.mockResolvedValue({
      error: null,
      data: {
        modo: 'entre_grupos',
        conjunto: 'todos',
        nota_metodologica: 'Relativo al conjunto.',
        ranking_calidad: [{ grupo_key: 'Duke::1', grupo_label: 'Duke — P-01', variedad: 'Duke', ensayo_id: 1, tipo: 'evaluacion', puntaje: 83, n_con_dato: 2, n_total: 5 }],
        ranking_productividad: [],
        perfil_fenologia: [],
        perfil_adaptabilidad: [],
      },
    });
  });

  it('delega modo y conjunto a evecl_comparar sin calcular scoring en cliente', async () => {
    const resultado = await compararEvecl({ modo: 'entre_grupos', conjunto: 'solo_evaluacion' });
    expect(dobles.rpc).toHaveBeenCalledWith('evecl_comparar', {
      p_modo: 'entre_grupos',
      p_ensayo_id: null,
      p_variedad: null,
      p_conjunto: 'solo_evaluacion',
    });
    expect(resultado.ranking_calidad[0].puntaje).toBe(83);
    expect(resultado.ranking_calidad[0].grupo_label).toBe('Duke — P-01');
  });

  it('envía ensayo y variedad solo en modo entre_fichas', async () => {
    await compararEvecl({ modo: 'entre_fichas', ensayoId: 7, variedad: ' Legacy ' });
    expect(dobles.rpc).toHaveBeenCalledWith('evecl_comparar', {
      p_modo: 'entre_fichas',
      p_ensayo_id: 7,
      p_variedad: 'Legacy',
      p_conjunto: 'todos',
    });
  });
});
