/** N15: nombres de compañeros vía nombres_de_usuarios (solo id y nombre), con respaldo si la base aún no tiene la función. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./client', () => ({ supabase: { rpc: mocks.rpc } }));

import { completarNombres, nombresDeUsuarios } from './nombres';

beforeEach(() => { mocks.rpc.mockReset(); });

describe('nombresDeUsuarios', () => {
  it('pide los ids sin repetir ni nulos y arma el mapa id → nombre', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'u1', nombre: 'Ana Rojas' }, { id: 'u2', nombre: 'Jorge Pérez' }], error: null });
    const mapa = await nombresDeUsuarios(['u1', null, 'u2', 'u1', undefined]);
    expect(mocks.rpc).toHaveBeenCalledWith('nombres_de_usuarios', { p_ids: ['u1', 'u2'] });
    expect(Object.fromEntries(mapa)).toEqual({ u1: 'Ana Rojas', u2: 'Jorge Pérez' });
  });

  it('sin ids no consulta', async () => {
    expect((await nombresDeUsuarios([null])).size).toBe(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('si la base no tiene la función o falla, devuelve un mapa vacío (queda el respaldo)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'no existe' } });
    expect((await nombresDeUsuarios(['u1'])).size).toBe(0);
    mocks.rpc.mockRejectedValue(new Error('red'));
    expect((await nombresDeUsuarios(['u1'])).size).toBe(0);
  });
});

describe('completarNombres', () => {
  it('solo completa los nombres que faltan y no toca los que ya vienen', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'u2', nombre: 'Jorge Pérez' }], error: null });
    type Fila = { id: string; created_by: string | null; autor: string | null };
    const filas: Fila[] = [{ id: 'a', created_by: 'u1', autor: 'Ana Rojas' }, { id: 'b', created_by: 'u2', autor: null }, { id: 'c', created_by: null, autor: null }];
    const r = await completarNombres(filas, (f) => f.created_by, (f) => f.autor, (f, nombre) => ({ ...f, autor: nombre }));
    expect(r.map((f) => f.autor)).toEqual(['Ana Rojas', 'Jorge Pérez', null]);
    expect(mocks.rpc).toHaveBeenCalledWith('nombres_de_usuarios', { p_ids: ['u2'] });
  });
});
