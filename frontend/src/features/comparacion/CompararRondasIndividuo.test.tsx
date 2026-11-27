import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompararRondasIndividuo } from './CompararRondasIndividuo';

const m = vi.hoisted(() => ({ rondas: vi.fn(), congelados: vi.fn(), pares: vi.fn(), estados: vi.fn(), ranking: vi.fn(), linaje: vi.fn() }));
vi.mock('@/api/compararRondas', async (original) => ({
  ...(await original<typeof import('@/api/compararRondas')>()),
  listarRondasDeIndividuo: m.rondas,
  listarPuntajesCongelados: m.congelados,
}));
vi.mock('@/api/comparacion', async (original) => ({ ...(await original<typeof import('@/api/comparacion')>()), obtenerComparacionRondas: m.pares }));
vi.mock('@/api/protocolo', () => ({ obtenerEstadosEvaluacion: m.estados }));
vi.mock('@/api/rankingGrupos', async (original) => ({ ...(await original<typeof import('@/api/rankingGrupos')>()), obtenerRankingPorGrupos: m.ranking }));
vi.mock('@/api/linaje', () => ({ obtenerLinaje: m.linaje, actualizarLinaje: m.linaje }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));

const evaluacion = (id: string, extra: Record<string, unknown>) => ({
  id, estado: 'completa', fecha: '2025-12-04', evaluador: 'M. Soto', updated_at: '2025-12-04T16:00:00Z', ...extra,
});
const ronda = (id: string, numero: number, anio: number, ev: Record<string, unknown> | null) => ({ id, numero_ronda: numero, anio, fecha_inicio: null, evaluacion: ev });

const par = (categorias: [string, number | null, number | null][]) => ({
  individuos: [{
    individuo_id: 'i1', codigo_display: '02-961-P1', tipo_ronda: 'anual', numero_anterior: 1, numero_actual: 2,
    deltas_categoria: categorias.map(([categoria, a, b]) => ({ categoria, valor_anterior: a, valor_actual: b, delta: a !== null && b !== null ? b - a : null, etiqueta: a !== null && b !== null ? 'mejoro_leve' : null })),
    deltas_parametro: [],
  }],
  umbrales: { leve: 0.05, marcado: 0.15 },
});

const CATS_IGUALES = par([['fenologia', 0.5, 0.6], ['fruto_calidad', 0.4, 0.5], ['produccion', null, null], ['estres', null, null]]);
const CATS_DISTINTAS = par([['fenologia', 0.5, 0.6], ['fruto_calidad', 0.4, null], ['produccion', null, null], ['estres', null, null]]);

function itemRanking(extra: Record<string, unknown> = {}) {
  return {
    scoring_version_nombre: 'Versión 1', minimo_evaluaciones_grupo: 5, cobertura_advertencia: 0.5,
    items: [{ individuo_id: 'i1', evaluacion_id: 'e2', puntaje: 0.62, grupo: ['fenologia', 'fruto_calidad'], posicion_grupo: 3, tamano_grupo: 9, estado_ranking: 'comparable', ...extra }],
  };
}
const congeladoR1 = (extra: Record<string, unknown> = {}) => [{
  evaluacion_id: 'e1', puntaje: 0.5, grupo: ['fenologia', 'fruto_calidad'], posicion_grupo: 2, tamano_grupo: 7,
  scoring_version_nombre: 'Versión 1', snapshot_nombre: 'Cierre ronda 1', congelado_at: '2026-01-15T00:00:00Z', ...extra,
}];

function Ubicacion() { const l = useLocation(); return <output data-testid="ubicacion">{l.pathname}{l.search}</output>; }
function montar(ruta = '/planta/p/comparar/i1') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes><Route path="/planta/:id/comparar/:individuoId" element={<><CompararRondasIndividuo plantaId="p" individuoId="i1" /><Ubicacion /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.rondas.mockResolvedValue({
    individuo: { id: 'i1', codigo_display: '02-961-P1', planta_id: 'p' },
    rondas: [
      ronda('r1', 1, 2025, evaluacion('e1', { brotacion: 3, cuaja: 4, fecha_inicio_floracion: '2025-09-18', brix: 13.1 })),
      ronda('r2', 2, 2026, evaluacion('e2', { fecha: '2026-10-15', evaluador: 'J. Pérez', brotacion: 4, cuaja: null, fecha_inicio_floracion: '2026-09-11' })),
      ronda('r3', 3, 2027, null),
    ],
  });
  m.estados.mockImplementation(async (id: string) => ({
    evaluacion_id: id, protocolo: null,
    estados: id === 'e1'
      ? { brotacion: 'medido', cuaja: 'medido', fecha_inicio_floracion: 'medido', brix: 'medido' }
      : { brotacion: 'medido', cuaja: 'falto', fecha_inicio_floracion: 'medido', brix: 'no_evaluado' },
  }));
  m.pares.mockResolvedValue(CATS_IGUALES);
  m.ranking.mockResolvedValue(itemRanking());
  m.congelados.mockResolvedValue(congeladoR1());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('grupos y criterio de puntaje iguales: muestra la diferencia del total y por categoría', async () => {
  montar();
  expect(await screen.findByRole('heading', { name: /Comparar rondas/ })).toHaveTextContent('02-961-P1');
  const tabla = await screen.findByRole('table', { name: /Puntaje total y por categoría/ });
  expect(within(tabla).getByRole('row', { name: /Puntaje total/ })).toHaveTextContent('50,0');
  expect(within(tabla).getByRole('row', { name: /Puntaje total/ })).toHaveTextContent('+12,0');
  expect(within(tabla).getByRole('row', { name: /Fenología/ })).toHaveTextContent('+10,0');
  expect(screen.queryByText(/no se restan/)).not.toBeInTheDocument();
  expect(screen.getByText(/puesto 3 de 9 en su grupo/)).toBeInTheDocument();
  // Sin nombres de versión de puntaje en la pantalla (ni «versión» ni «scoring»).
  expect(screen.getByText(/Mismo grupo: el total/)).toBeInTheDocument();
  expect(screen.getByText('Ranking vigente')).toBeInTheDocument();
  expect(screen.queryByText(/versi[oó]n|scoring/i)).not.toBeInTheDocument();
});

it('grupos distintos: no resta el total, avisa y solo resta las categorías presentes en ambas', async () => {
  m.pares.mockResolvedValue(CATS_DISTINTAS);
  m.ranking.mockResolvedValue(itemRanking({ grupo: ['fenologia'] }));
  montar();
  const tabla = await screen.findByRole('table', { name: /Puntaje total y por categoría/ });
  expect(await screen.findByRole('note')).toHaveTextContent('Los puntajes de grupos distintos no se restan: cada uno se calcula con las categorías que se midieron.');
  expect(screen.getByRole('note')).toHaveTextContent('Ronda 1: Fruto/Calidad · Fenología. Ronda 2: Fenología.');
  const total = within(tabla).getByRole('row', { name: /Puntaje total/ });
  expect(total).toHaveTextContent('no se resta');
  expect(total).not.toHaveTextContent('+12,0');
  expect(within(tabla).getByRole('row', { name: /Fenología/ })).toHaveTextContent('+10,0');
  expect(within(tabla).getByRole('row', { name: /Fruto\/Calidad/ })).toHaveTextContent('no medida');
  expect(within(tabla).getByRole('row', { name: /Fruto\/Calidad/ })).not.toHaveTextContent('+');
});

it('criterios de puntaje distintos: no resta, lo dice sin nombres de versión ni jerga', async () => {
  m.congelados.mockResolvedValue(congeladoR1({ scoring_version_nombre: 'Versión 0' }));
  montar();
  const tabla = await screen.findByRole('table', { name: /Puntaje total y por categoría/ });
  expect(within(tabla).getByRole('row', { name: /Puntaje total/ })).toHaveTextContent('no se resta');
  const aviso = await screen.findByRole('note');
  expect(aviso).toHaveTextContent('Las dos rondas se puntuaron con criterios distintos, así que el puntaje total no se resta.');
  expect(aviso).not.toHaveTextContent(/scoring|Versión 0|Versión 1/);
  expect(screen.queryByText(/Versión 0|Versión 1|versión /)).not.toBeInTheDocument();
});

it('una ronda pasada que no quedó congelada: no hay puntaje, y se dice con honestidad', async () => {
  m.congelados.mockResolvedValue([]);
  montar();
  expect(await screen.findByRole('note')).toHaveTextContent('El puntaje de las rondas anteriores no está disponible: solo se conserva el de la ronda vigente y el de los rankings congelados.');
  expect(await screen.findByText('Puntaje no disponible.')).toBeInTheDocument();
  const tabla = await screen.findByRole('table', { name: /Puntaje total y por categoría/ });
  expect(within(tabla).getByRole('row', { name: /Puntaje total/ })).toHaveTextContent('no se resta');
  // Las categorías siguen comparándose: no dependen del puntaje total.
  expect(within(tabla).getByRole('row', { name: /Fenología/ })).toHaveTextContent('+10,0');
});

it('descriptor medido en una ronda y faltó en la otra: sin diferencia; los medidos en ambas sí', async () => {
  montar();
  await screen.findByRole('table', { name: /Valores de cada descriptor/ });
  // Por omisión solo «Evaluados en ambas».
  const tabla = screen.getByRole('table', { name: /Valores de cada descriptor/ });
  expect(within(tabla).getByRole('row', { name: /Brotación/ })).toHaveTextContent('sube 1');
  expect(within(tabla).getByRole('row', { name: /Inicio de floración/ })).toHaveTextContent('7 días antes');
  expect(within(tabla).queryByRole('row', { name: /Cuaja/ })).not.toBeInTheDocument();
  expect(screen.getByText(/2 descriptores ocultos/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Todos/ }));
  const cuaja = within(screen.getByRole('table', { name: /Valores de cada descriptor/ })).getByRole('row', { name: /Cuaja/ });
  expect(cuaja).toHaveTextContent('Faltó');
  expect(cuaja).toHaveTextContent('faltó en ronda 2');
  expect(cuaja).not.toHaveTextContent(/sube|baja|igual/);
  const brix = within(screen.getByRole('table', { name: /Valores de cada descriptor/ })).getByRole('row', { name: /Brix/ });
  expect(brix).toHaveTextContent('no evaluado');
  expect(brix).toHaveTextContent('solo ronda 1');
});

it('una ronda sin evaluación cerrada no se puede elegir y las dos elegidas quedan marcadas', async () => {
  montar();
  await screen.findByRole('heading', { name: /Comparar rondas/ });
  const grupo = screen.getByRole('group', { name: 'Rondas a comparar' });
  expect(within(grupo).getByRole('button', { name: /Ronda 3/ })).toBeDisabled();
  expect(within(grupo).getByRole('button', { name: /Ronda 1/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(grupo).getByRole('button', { name: /Ronda 2/ })).toHaveAttribute('aria-pressed', 'true');
});

it('elegir otra ronda cambia la dirección y la comparación', async () => {
  m.rondas.mockResolvedValue({
    individuo: { id: 'i1', codigo_display: '02-961-P1', planta_id: 'p' },
    rondas: [
      ronda('r1', 1, 2025, evaluacion('e1', { brotacion: 3 })),
      ronda('r2', 2, 2026, evaluacion('e2', { brotacion: 4 })),
      ronda('r3', 3, 2027, evaluacion('e3', { brotacion: 5 })),
    ],
  });
  m.estados.mockImplementation(async (id: string) => ({ evaluacion_id: id, protocolo: null, estados: { brotacion: 'medido' } }));
  montar();
  const grupo = await screen.findByRole('group', { name: 'Rondas a comparar' });
  // Por omisión, las dos últimas.
  expect(within(grupo).getByRole('button', { name: /Ronda 1/ })).toHaveAttribute('aria-pressed', 'false');
  expect(within(await screen.findByRole('table', { name: /Valores de cada descriptor/ })).getByRole('row', { name: /Brotación/ })).toHaveTextContent('sube 1');
  fireEvent.click(within(grupo).getByRole('button', { name: /Ronda 1/ }));
  expect(screen.getByTestId('ubicacion')).toHaveTextContent('?rondas=1,2');
  expect(await screen.findByRole('table', { name: /rondas 1 y 2/ })).toBeInTheDocument();
});

it('con una sola ronda cerrada no compara: explica por qué', async () => {
  m.rondas.mockResolvedValue({
    individuo: { id: 'i1', codigo_display: '02-961-P1', planta_id: 'p' },
    rondas: [ronda('r1', 1, 2025, evaluacion('e1', { brotacion: 3 })), ronda('r2', 2, 2026, null)],
  });
  montar();
  expect(await screen.findByText(/Hay una sola ronda con evaluación cerrada/)).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('una ronda con valor marcado no se resta y el valor se ve con su aviso', async () => {
  m.rondas.mockResolvedValue({
    individuo: { id: 'i1', codigo_display: '02-961-P1', planta_id: 'p' },
    rondas: [ronda('r1', 1, 2025, evaluacion('e1', { calibre_mm: 15 })), ronda('r2', 2, 2026, evaluacion('e2', { calibre_mm: 42 }))],
  });
  m.estados.mockImplementation(async (id: string) => ({ evaluacion_id: id, protocolo: null, estados: { calibre_mm: id === 'e1' ? 'medido' : 'marcado' } }));
  montar();
  const fila = within(await screen.findByRole('table', { name: /Valores de cada descriptor/ })).getByRole('row', { name: /Calibre/ });
  expect(fila).toHaveTextContent('Revisar');
  expect(fila).toHaveTextContent('sin diferencia');
  expect(fila).not.toHaveTextContent('sube');
});

it('no expone linaje: no lo lee ni lo muestra', async () => {
  montar();
  await screen.findByRole('table', { name: /Valores de cada descriptor/ });
  expect(m.linaje).not.toHaveBeenCalled();
  const texto = document.body.textContent ?? '';
  expect(texto).not.toMatch(/cruzamiento|madre|padre|mama|papa/i);
});

it('la distribución de flores y frutos se compara con el texto de cada nivel; rend_t_ha solo si alguna ronda lo trae', async () => {
  m.rondas.mockResolvedValue({
    individuo: { id: 'i1', codigo_display: '02-961-P1', planta_id: 'p' },
    rondas: [
      ronda('r1', 1, 2025, evaluacion('e1', { brotacion: 3, distribucion_flores_frutos: 1, rend_kg_planta: 2 })),
      ronda('r2', 2, 2026, evaluacion('e2', { fecha: '2026-10-15', brotacion: 4, distribucion_flores_frutos: 3, rend_kg_planta: 2.5 })),
    ],
  });
  m.estados.mockImplementation(async (id: string) => ({
    evaluacion_id: id, protocolo: null, estados: { brotacion: 'medido', distribucion_flores_frutos: 'medido', rend_kg_planta: 'medido' },
  }));
  montar();
  const tabla = await screen.findByRole('table', { name: /Valores de cada descriptor/ });
  const fila = within(tabla).getByRole('row', { name: /Distribución de flores y frutos/ });
  expect(fila).toHaveTextContent('Solo en la punta');
  expect(fila).toHaveTextContent('Toda la vara');
  expect(fila).toHaveTextContent('sube 2');
  expect(within(tabla).queryByRole('row', { name: /Rendimiento por hectárea/ })).not.toBeInTheDocument();
});

it('un rend_t_ha histórico en las dos rondas se sigue comparando', async () => {
  m.rondas.mockResolvedValue({
    individuo: { id: 'i1', codigo_display: '02-961-P1', planta_id: 'p' },
    rondas: [
      ronda('r1', 1, 2025, evaluacion('e1', { brotacion: 3, rend_t_ha: 10 })),
      ronda('r2', 2, 2026, evaluacion('e2', { fecha: '2026-10-15', brotacion: 4, rend_t_ha: 12.5 })),
    ],
  });
  m.estados.mockImplementation(async (id: string) => ({ evaluacion_id: id, protocolo: null, estados: { brotacion: 'medido', rend_t_ha: 'medido' } }));
  montar();
  const tabla = await screen.findByRole('table', { name: /Valores de cada descriptor/ });
  const fila = within(tabla).getByRole('row', { name: /Rendimiento por hectárea/ });
  expect(fila).toHaveTextContent('10');
  expect(fila).toHaveTextContent('12,5');
  expect(fila).toHaveTextContent('sube 2,5 t/ha');
});

it('con la versión de 5 categorías, Brotes y varas se compara en su lugar por peso y se resta si las dos rondas la midieron', async () => {
  m.pares.mockResolvedValue(par([['fenologia', 0.5, 0.6], ['fruto_calidad', 0.4, 0.5], ['produccion', 0.3, 0.4], ['brotes', 0.2, 0.5], ['estres', null, null]]));
  m.ranking.mockResolvedValue(itemRanking({ grupo: ['fenologia', 'fruto_calidad', 'produccion', 'brotes'] }));
  m.congelados.mockResolvedValue(congeladoR1({ grupo: ['fenologia', 'fruto_calidad', 'produccion', 'brotes'] }));
  montar();
  const tabla = await screen.findByRole('table', { name: /Puntaje total y por categoría/ });
  const categorias = within(tabla).getAllByRole('row').slice(2).map((r) => within(r).getAllByRole('rowheader')[0].textContent);
  expect(categorias).toEqual(['Fruto/Calidad', 'Producción', 'Fenología', 'Brotes y varas', 'Estrés']);
  expect(within(tabla).getByRole('row', { name: /Brotes y varas/ })).toHaveTextContent('+30,0');
  expect(within(tabla).getByRole('row', { name: /Estrés/ })).toHaveTextContent('no medida');
  // Mismo grupo (aunque la base lo entregue en otro orden): se resta el total, no se avisa de grupos distintos.
  expect(screen.queryByText(/no se restan/)).not.toBeInTheDocument();
});

it('hallazgo 2 (G2): las rondas se nombran con su temporada de julio a junio, nunca con el año calendario', async () => {
  m.rondas.mockResolvedValue({
    individuo: { id: 'i1', codigo_display: '02-961-P1', planta_id: 'p' },
    rondas: [
      { ...ronda('r1', 1, 2025, evaluacion('e1', { brotacion: 3, cuaja: 4, fecha_inicio_floracion: '2025-09-18', brix: 13.1 })), fecha_inicio: '2025-08-01' },
      { ...ronda('r2', 2, 2026, evaluacion('e2', { fecha: '2026-10-15', evaluador: 'J. Pérez', brotacion: 4, cuaja: null, fecha_inicio_floracion: '2026-09-11' })), fecha_inicio: '2026-03-01' },
    ],
  });
  montar();
  expect((await screen.findAllByText(/Ronda 1 · 2025-2026/)).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Ronda 2 · 2025-2026/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Ronda 1 · 2025(?!-)/)).toBeNull();
});
