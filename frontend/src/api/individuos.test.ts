import { describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => {
  const eq = vi.fn();
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { eq, select, from };
});

vi.mock('./client', () => ({
  supabase: { from: dobles.from },
  traducirError: (e: unknown) => (e instanceof Error ? e : new Error('Error traducido')),
  esConflictoDeIdempotencia: vi.fn(),
}));

import { listarIndividuosDePlanta, type Individuo } from './individuos';

function individuo(codigo_display: string): Individuo {
  return {
    id: codigo_display,
    planta_id: 'p1',
    codigo_display,
    clon_de_id: null,
    estado_vital: 'vivo',
    fecha_baja: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('listarIndividuosDePlanta — orden numérico (Bloque 2, paso 2)', () => {
  it('ordena por el correlativo numérico de codigo_display, no como texto plano', async () => {
    dobles.eq.mockResolvedValue({
      data: [
        individuo('02-001-P100'),
        individuo('02-001-P9'),
        individuo('02-001-P10'),
        individuo('02-001-P2'),
        individuo('02-001-P99'),
      ],
      error: null,
    });

    const resultado = await listarIndividuosDePlanta('p1');

    expect(resultado.map((i) => i.codigo_display)).toEqual([
      '02-001-P2',
      '02-001-P9',
      '02-001-P10',
      '02-001-P99',
      '02-001-P100',
    ]);
  });
});
