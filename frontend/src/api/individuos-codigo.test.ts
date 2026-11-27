import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const ilike = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ ilike }));
  const from = vi.fn(() => ({ select }));
  return { maybeSingle, ilike, select, from };
});

vi.mock('./client', () => ({
  supabase: { from: dobles.from },
  traducirError: (e: unknown) => (e instanceof Error ? e : new Error('Error traducido')),
  esConflictoDeIdempotencia: vi.fn(),
}));

import { resolverIndividuoPorCodigo } from './individuos';

const fila = { id: 'i1', planta_id: 'p1', codigo_display: '02-502-P1', estado_vital: 'vivo' };

beforeEach(() => { dobles.maybeSingle.mockReset(); dobles.ilike.mockClear(); });

describe('resolverIndividuoPorCodigo (U-11)', () => {
  it('busca por el código impreso en la etiqueta, sin espacios y sin distinguir mayúsculas', async () => {
    dobles.maybeSingle.mockResolvedValue({ data: fila, error: null });
    await expect(resolverIndividuoPorCodigo('  02-502-p1 ')).resolves.toEqual(fila);
    expect(dobles.from).toHaveBeenCalledWith('individuos');
    expect(dobles.ilike).toHaveBeenCalledWith('codigo_display', '02-502-p1');
  });

  it('tolera el cero de relleno («P01») probando también el código sin él', async () => {
    dobles.maybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: fila, error: null });
    await expect(resolverIndividuoPorCodigo('02-502-P01')).resolves.toEqual(fila);
    expect(dobles.ilike).toHaveBeenNthCalledWith(1, 'codigo_display', '02-502-P01');
    expect(dobles.ilike).toHaveBeenNthCalledWith(2, 'codigo_display', '02-502-P1');
  });

  it('escapa los comodines del LIKE para que «_» y «%» no coincidan con cualquier carácter', async () => {
    dobles.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(resolverIndividuoPorCodigo('UXB-proceso_finalizado-P1')).resolves.toBeNull();
    expect(dobles.ilike).toHaveBeenCalledWith('codigo_display', 'UXB-proceso\\_finalizado-P1');
  });

  it('devuelve null si no existe y propaga el error de la base ya traducido', async () => {
    dobles.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(resolverIndividuoPorCodigo('02-502-P999')).resolves.toBeNull();
    dobles.maybeSingle.mockResolvedValue({ data: null, error: new Error('sin permiso') });
    await expect(resolverIndividuoPorCodigo('02-502-P1')).rejects.toThrow('sin permiso');
  });
});
