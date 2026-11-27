import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { RankingGeneral } from './RankingGeneral';
import { qk } from '@/lib/queryKeys';
const mocks = vi.hoisted(() => ({ valores: vi.fn(), grupos: vi.fn(), comparacion: vi.fn(), lista: vi.fn(), detalle: vi.fn(), vivo: vi.fn(), crear: vi.fn() }));
vi.mock('@/api/scoring', () => ({
  CATEGORIAS_SCORING: ['fruto'], CATEGORIAS_BASE: ['fruto'], ordenarGrupo: (g: string[]) => [...g], CATEGORIA_LABEL: { fruto: 'Fruto' }, METRICA_LABEL: { brix: 'Brix' }, MOTIVO_EXCLUSION_LABEL: {},
  congelarRanking: mocks.crear,
}));
vi.mock('@/api/rankingGrupos', () => ({
  ESTADO_RANKING_LABEL: {}, claveGrupo: (c: string[]) => c.join(','), categoriasConCoberturaBaja: () => [], obtenerRankingPorGrupos: mocks.grupos,
  esDelGrupo: (i: { estado_ranking: string }) => i.estado_ranking === 'comparable' || i.estado_ranking === 'pocas_plantas', obtenerValoresParametros: mocks.valores,
}));
vi.mock('@/api/comparacion', () => ({ ETIQUETA_DELTA_LABEL: {}, obtenerComparacionRondas: mocks.comparacion }));
vi.mock('@/api/snapshots', () => ({ listarSnapshotsRanking: mocks.lista, obtenerDetalleSnapshot: mocks.detalle, compararSnapshotVivo: mocks.vivo }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: true }) }));
const valoresIniciales = { i: { brix: { valor: null } } };
const poblacionVacia = { total: 0, comparables: 0, con_posicion: 0, pocas_plantas: 0, excluidas_revision: 0, no_comparables: 0, sin_datos: 0, sin_evaluacion: 0, sin_version: 0 };
const grupos = {
  scoring_version_nombre: 'v1', minimo_evaluaciones_grupo: 5, cobertura_advertencia: 0.5,
  poblacion: { ...poblacionVacia, total: 1, comparables: 1 },
  grupos: [{ categorias: ['fruto'], n: 1, con_posicion: false }],
  items: [{ individuo_id: 'i', codigo_display: 'IND-1', estado_ranking: 'pocas_plantas', grupo: ['fruto'], puntaje: 1, posicion_grupo: null, detalle_categorias: { fruto: 1 }, cobertura: {} }],
};
const snapshot = { id: 's', nombre: 'Cierre', alcance: 'cruzamiento', created_at: '2026-01-01T12:00:00Z', poblacion_comparada: 1, scoring_version_nombre: 'v1' };
const comparacion = { individuos: [{ individuo_id: 'i', codigo_display: 'IND-1', tipo_ronda: 'anual', numero_anterior: 1, numero_actual: 2, deltas_categoria: [], deltas_parametro: [] }] };
function diferido<T>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; }
function montar(element: React.ReactNode) { const qc = new QueryClient({defaultOptions:{queries:{retry:false}}}); render(<QueryClientProvider client={qc}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>); return qc; }
beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.valores.mockResolvedValue(valoresIniciales);
  mocks.grupos.mockResolvedValue(grupos);
  mocks.comparacion.mockResolvedValue(comparacion);
  mocks.lista.mockResolvedValue({ items: [snapshot] });
  mocks.detalle.mockResolvedValue({ snapshot, resultados: [] });
  mocks.vivo.mockResolvedValue({ version_cambio: false, umbrales: { leve: 0.1, marcado: 0.2 }, individuos: [] });
});
afterEach(cleanup);

// v3 paso 7: Parámetro, Comparación y Snapshots pasaron a Resultados (features/resultados); aquí queda el ranking del cruce.
it('general distingue carga, error y vacío, y reintenta sin exponer error crudo', async () => {
  const pendiente = diferido<unknown>();
  const rpc = mocks.grupos;
  rpc.mockReturnValueOnce(pendiente.promise);
  montar(<RankingGeneral plantaId="p"/>);
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(screen.queryByText(/No hay individuos vivos/)).not.toBeInTheDocument();
  await act(async () => pendiente.reject(new Error('private SQL')));
  expect(await screen.findByRole('alert')).not.toHaveTextContent('private SQL');
  rpc.mockResolvedValue({ ...grupos, poblacion: poblacionVacia, grupos: [], items: [] });
  fireEvent.click(screen.getByRole('button',{name:'Reintentar ranking'}));
  expect(await screen.findByText(/No hay individuos vivos/)).toBeInTheDocument();
});

it('General conserva la misma tabla y su orden tras fallo de actualización', async () => {
  const qc=montar(<RankingGeneral plantaId="p"/>);
  const boton=await screen.findByRole('button',{name:'Puntaje'});
  fireEvent.click(boton);
  const tabla=screen.getByRole('table');
  mocks.grupos.mockRejectedValue(new Error('secret'));
  await act(async () => { await qc.invalidateQueries({queryKey:qk.ranking.grupos({plantaId:'p',incluirPruebas:false})}); });
  expect(await screen.findByRole('alert')).not.toHaveTextContent('secret');
  expect(screen.getByRole('table')).toBe(tabla);
  expect(boton.closest('th')).toHaveAttribute('aria-sort','ascending');
});
