import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { Individuo } from '@/api/individuos';
import type { ItemRankingGrupos, RankingPorGrupos } from '@/api/rankingGrupos';

const m = vi.hoisted(() => ({ obtener: vi.fn(), congelar: vi.fn(), esAdmin: false }));
vi.mock('@/api/rankingGrupos', async (original) => ({
  ...(await original<typeof import('@/api/rankingGrupos')>()),
  obtenerRankingPorGrupos: m.obtener,
  congelarRankingGrupos: m.congelar,
}));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: m.esAdmin }) }));

import { RankingTabla } from './RankingTabla';

afterEach(() => { cleanup(); vi.resetAllMocks(); m.esAdmin = false; });

const individuo = (id: string, estado_vital: Individuo['estado_vital'] = 'vivo'): Individuo => ({
  id, planta_id: 'p1', codigo_display: `02-001-${id}`, clon_de_id: null, estado_vital, fecha_baja: null, created_at: '2026-07-01T00:00:00Z',
});

const fila = (n: number, extra: Partial<ItemRankingGrupos> = {}): ItemRankingGrupos => ({
  individuo_id: `i${n}`, codigo_display: `02-001-P${n}`, planta_id: 'p1', codigo_sistema: '02-001', especie_id: 'e', es_prueba: false,
  evaluacion_id: `e${n}`, fecha_evaluacion: '2026-10-20', numero_ronda: 1, requiere_revision: false, no_comparable: false, tiene_metrica_marcada: false,
  puntaje: 0.5, grupo: ['fenologia'], cobertura: {}, detalle_categorias: { fenologia: 0.5 },
  estado_ranking: 'comparable', tamano_grupo: 5, posicion_grupo: 1, ...extra,
});

const respuesta = (items: ItemRankingGrupos[]): RankingPorGrupos => ({
  scoring_version_id: 'v', scoring_version_nombre: 'Selección de fruto v1', minimo_evaluaciones_grupo: 5, cobertura_advertencia: 0.5,
  poblacion: {
    total: items.length, comparables: items.length, con_posicion: items.filter((i) => i.posicion_grupo !== null).length,
    pocas_plantas: 0, excluidas_revision: 0, no_comparables: 0, sin_datos: 0, sin_evaluacion: 0, sin_version: 0,
  },
  grupos: [{ categorias: ['fenologia'], n: items.length, con_posicion: true }],
  items,
});

function montar(individuos = [individuo('P1')]) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><RankingTabla plantaId="p1" individuos={individuos} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RankingTabla — el ranking de la ficha es el ranking por grupos', () => {
  it('lee el ranking por grupos del cruce y muestra posición en el grupo con empates', async () => {
    m.obtener.mockResolvedValue(respuesta([
      fila(1, { posicion_grupo: 1, puntaje: 0.9 }), fila(2, { posicion_grupo: 2, puntaje: 0.7 }), fila(3, { posicion_grupo: 2, puntaje: 0.7 }),
      fila(4, { posicion_grupo: 4, puntaje: 0.5 }), fila(5, { posicion_grupo: 5, puntaje: 0.1 }),
    ]));
    montar();
    const grupo = await screen.findByRole('region', { name: /^Grupo Fenología/ });
    const filas = within(grupo).getAllByRole('row').slice(1) as HTMLTableRowElement[];
    // Empates como «2=»: mismo puntaje, mismo puesto; el siguiente salta a 4.
    expect(filas.map((f) => f.cells[0].textContent)).toEqual(['1 de 5', '2= (empate) de 5', '2= (empate) de 5', '4 de 5', '5 de 5']);
    expect(m.obtener).toHaveBeenCalledWith({ plantaId: 'p1', especieId: undefined, incluirPruebas: false });
  });

  it('carga y fallo no se presentan como vacío; el reintento no expone el error crudo', async () => {
    let rechazar!: (e: Error) => void;
    m.obtener.mockReturnValueOnce(new Promise((_, r) => { rechazar = r; }));
    montar();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando ranking');
    await act(async () => rechazar(new Error('private SQL details')));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('private SQL details');
    m.obtener.mockResolvedValue({ ...respuesta([]), grupos: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar ranking' }));
    expect(await screen.findByText(/No hay individuos vivos/)).toBeInTheDocument();
  });

  it('el admin congela el mismo ranking por grupos; los no vivos se nombran aparte', async () => {
    m.esAdmin = true;
    m.obtener.mockResolvedValue(respuesta([fila(1)]));
    m.congelar.mockResolvedValue('snap-1');
    montar([individuo('P1'), individuo('P2', 'muerto')]);
    expect(await screen.findByText('1 no vivos fuera del ranking.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Congelar ranking/ }));
    expect(await screen.findByText('Ranking congelado. Lo encuentras en Resultados, opción «Congelado…».')).toBeInTheDocument();
    expect(screen.queryByText(/snap-1|Snapshot/)).not.toBeInTheDocument();
    expect(m.congelar).toHaveBeenCalledWith(expect.objectContaining({ plantaId: 'p1' }));
  });
});
