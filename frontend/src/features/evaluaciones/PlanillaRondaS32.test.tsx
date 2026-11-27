/**
 * S3-2: selector de ronda de la planilla (rondas anteriores en solo lectura) y
 * «Ver valores» (matriz de valores, solo admin).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilaPlanilla, PlanillaRonda as Planilla } from '@/api/protocolo';
import { PlanillaRonda } from './PlanillaRonda';

const mocks = vi.hoisted(() => ({ planilla: vi.fn(), iniciar: vi.fn(), valores: vi.fn() }));
vi.mock('@/api/protocolo', () => ({ obtenerPlanillaRonda: mocks.planilla }));
vi.mock('@/api/rondas', () => ({ iniciarRonda: mocks.iniciar }));
vi.mock('@/api/valoresRonda', () => ({ listarValoresDeRonda: mocks.valores }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));

const fila = (n: number, extra: Partial<FilaPlanilla> = {}): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `90-901-P${n}`, numero: n, ronda_id: `r${n}`, estado: 'completa',
  evaluacion_id: `e${n}`, evaluacion_updated_at: '2026-10-20T12:00:00Z', fecha: '2026-10-20', evaluador: 'Equipo',
  es_mia: true, protocolo_id: 'p1', protocolo_distinto: false,
  estados: { brotacion: 'medido', floracion: 'medido', calibre_mm: 'no_evaluado' }, conteo: { medido: 2, falto: 0, no_evaluado: 1, marcado: 0 },
  ...extra,
});
const SIN_EVALUAR: Partial<FilaPlanilla> = { estado: 'sin_iniciar', evaluacion_id: null, evaluacion_updated_at: null, estados: null, conteo: null, evaluador: null, fecha: null };

const base = {
  planta_id: 'p', tipo_ronda: 'anual' as const,
  protocolo: { id: 'p1', version: 1, nombre: 'Ronda', descriptores: { brotacion: 'obligatorio', floracion: 'obligatorio', calibre_mm: 'opcional' } as const, created_at: '2026-10-01' },
};
const ronda2: Planilla = {
  ...base, numero_ronda: 2, avance: { vivos: 3, sin_ronda: 0, sin_iniciar: 1, borrador: 0, completa: 2 },
  individuos: [fila(1), fila(2, { estados: { brotacion: 'medido', floracion: 'falto', calibre_mm: 'no_evaluado' }, conteo: { medido: 1, falto: 1, no_evaluado: 1, marcado: 0 } }), fila(3, SIN_EVALUAR)],
};
const ronda1: Planilla = {
  ...base, numero_ronda: 1, avance: { vivos: 3, sin_ronda: 0, sin_iniciar: 1, borrador: 0, completa: 2 },
  individuos: [
    fila(1), fila(2, { estados: { brotacion: 'medido', floracion: 'medido', calibre_mm: 'marcado' }, conteo: { medido: 2, falto: 0, no_evaluado: 0, marcado: 1 } }),
    fila(3, SIN_EVALUAR),
  ],
};

beforeEach(() => {
  mocks.planilla.mockImplementation(async (_p: string, numero?: number) => (numero === 1 ? ronda1 : ronda2));
  mocks.valores.mockResolvedValue(new Map([
    ['e1', { brotacion: 4, floracion: 3 }],
    ['e2', { brotacion: 2, floracion: null, calibre_mm: 42.5 }],
  ]));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function Ubicacion() { const l = useLocation(); return <output data-testid="ubicacion">{l.pathname}{l.search}{l.hash}</output>; }

function montar(esAdmin: boolean, ruta = '/planta/p?pestana=planilla') {
  const props = { onAbrir: vi.fn(), onEvaluar: vi.fn(), onDefinirProtocolo: vi.fn() };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <PlanillaRonda plantaId="p" esAdmin={esAdmin} {...props} />
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return props;
}

// --- Selector de ronda ------------------------------------------------------

it('el selector lista las rondas 1..N y cambia a una anterior en solo lectura', async () => {
  const props = montar(true);
  const selector = within(await screen.findByRole('group', { name: 'Ronda de la serie anual' }));
  expect(selector.getByRole('button', { name: 'Ronda 2 · vigente' })).toHaveAttribute('aria-pressed', 'true');
  // En la vigente sí se puede iniciar/evaluar.
  expect(screen.getByRole('button', { name: /Evaluar siguiente/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Cambiar protocolo/ })).toBeInTheDocument();

  fireEvent.click(selector.getByRole('button', { name: 'Ronda 1' }));
  await screen.findByText(/Ronda anterior, solo lectura/);
  expect(mocks.planilla).toHaveBeenCalledWith('p', 1, 'anual');
  expect(selector.getByRole('button', { name: 'Ronda 1' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '2 de 3 cerradas')).toBeInTheDocument();

  // Sin inicio de ronda, sin lote, sin «siguiente», sin protocolo, sin «Evaluar».
  expect(screen.queryByRole('button', { name: /Evaluar siguiente/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Iniciar ronda/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /protocolo/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Sigue en el recorrido' })).not.toBeInTheDocument();
  const tabla = screen.getByRole('table');
  expect(within(tabla).queryByRole('button', { name: 'Evaluar' })).not.toBeInTheDocument();
  expect(within(tabla).queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument();
  const p3 = within(tabla).getByRole('button', { name: 'P3' }).closest('tr')!;
  expect(within(p3).getByText('Sin evaluar')).toBeInTheDocument();
  // Lo evaluado sí se abre; lo marcado, como «Revisar».
  expect(within(within(tabla).getByRole('button', { name: 'P1' }).closest('tr')!).getByRole('button', { name: 'Ver' })).toBeInTheDocument();
  expect(within(within(tabla).getByRole('button', { name: 'P2' }).closest('tr')!).getByRole('button', { name: 'Revisar' })).toBeInTheDocument();
  // Volver a la vigente.
  fireEvent.click(screen.getByRole('button', { name: 'Ir a la ronda 2' }));
  expect(await screen.findByRole('button', { name: /Evaluar siguiente/ })).toBeInTheDocument();
  expect(screen.queryByText(/Ronda anterior/)).not.toBeInTheDocument();
  expect(props.onEvaluar).not.toHaveBeenCalled();
});

it('con una sola ronda no hay selector', async () => {
  mocks.planilla.mockResolvedValue(ronda1);
  montar(false);
  await screen.findByRole('progressbar', { name: 'Avance de la ronda' });
  expect(screen.queryByRole('group', { name: /Ronda de la serie/ })).not.toBeInTheDocument();
});

it('un operario también puede mirar una ronda anterior, sin acciones de inicio', async () => {
  montar(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Ronda 1' }));
  await screen.findByText(/Ronda anterior, solo lectura/);
  expect(screen.queryByRole('button', { name: /Iniciar ronda/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Evaluar/ })).not.toBeInTheDocument();
});

// --- Ver valores ------------------------------------------------------------

it('el admin ve la matriz con valores, estados, secciones y leyenda', async () => {
  montar(true, '/planta/p?pestana=planilla#valores');
  const matriz = await screen.findByRole('region', { name: 'Valores de la ronda 2 por individuo y descriptor' });
  expect(mocks.valores).toHaveBeenCalledWith('p', 2, 'anual');
  const tabla = within(matriz).getByRole('table');
  // Columnas agrupadas por sección del esquema (solo las del protocolo).
  expect(within(tabla).getByRole('columnheader', { name: 'Fenología' })).toBeInTheDocument();
  expect(within(tabla).getByRole('columnheader', { name: 'Fruto / Calidad' })).toBeInTheDocument();
  expect(within(tabla).getByRole('columnheader', { name: 'Brotación' })).toBeInTheDocument();
  const p1 = within(tabla).getByRole('button', { name: 'P1' }).closest('tr')!;
  expect(within(p1).getByText('4')).toBeInTheDocument();
  expect(within(p1).getByText('3')).toBeInTheDocument();
  expect(within(p1).getByText('No evaluado: Calibre')).toBeInTheDocument();
  const p2 = within(tabla).getByRole('button', { name: 'P2' }).closest('tr')!;
  expect(within(p2).getByText('falta')).toBeInTheDocument();
  expect(within(p2).getByText('1/2')).toBeInTheDocument();
  // Sin evaluación: sin valores ni estados.
  const p3 = within(tabla).getByRole('button', { name: 'P3' }).closest('tr')!;
  expect(within(p3).queryByText('falta')).not.toBeInTheDocument();
  // Leyenda de los cuatro estados.
  const leyenda = within(screen.getByRole('list', { name: 'Leyenda de estados' }));
  for (const t of ['Medido', 'Faltó (obligatorio sin dato)', 'No evaluado', 'Marcado para revisión']) expect(leyenda.getByText(t)).toBeInTheDocument();
  // Nada de linaje.
  expect(document.body.textContent).not.toMatch(/cruzamiento|madre|padre|mama|papa/i);
  // La tabla de avance no se dibuja a la vez.
  expect(screen.queryByRole('columnheader', { name: 'Obligatorios' })).not.toBeInTheDocument();
});

it('la matriz de una ronda anterior marca lo que la base marcó, con «!» y el valor', async () => {
  montar(true, '/planta/p?pestana=planilla#valores');
  fireEvent.click(await screen.findByRole('button', { name: 'Ronda 1' }));
  await screen.findByRole('region', { name: 'Valores de la ronda 1 por individuo y descriptor' });
  expect(mocks.valores).toHaveBeenCalledWith('p', 1, 'anual');
  const p2 = within(screen.getByRole('table')).getByRole('button', { name: 'P2' }).closest('tr')!;
  const marcada = within(p2).getByText('42,5').closest('td')!;
  expect(marcada).toHaveTextContent(/!\s*42,5/);
  expect(marcada).toHaveTextContent('marcado para revisión');
});

it('el botón «Ver valores» cambia la vista y deja el hash en la URL sin perder el resto', async () => {
  montar(true);
  await screen.findByRole('table');
  const vista = within(screen.getByRole('group', { name: 'Vista de la planilla' }));
  expect(vista.getByRole('button', { name: 'Avance' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(vista.getByRole('button', { name: 'Ver valores' }));
  await screen.findByRole('region', { name: /Valores de la ronda 2/ });
  expect(screen.getByTestId('ubicacion')).toHaveTextContent('/planta/p?pestana=planilla#valores');
  fireEvent.click(vista.getByRole('button', { name: 'Avance' }));
  await screen.findByRole('columnheader', { name: 'Obligatorios' });
  expect(screen.getByTestId('ubicacion')).toHaveTextContent('/planta/p?pestana=planilla');
  expect(screen.getByTestId('ubicacion')).not.toHaveTextContent('#valores');
});

it('un operario no ve el botón ni la matriz aunque entre por el hash, y no se piden los valores', async () => {
  montar(false, '/planta/p?pestana=planilla#valores');
  await screen.findByRole('progressbar', { name: 'Avance de la ronda' });
  expect(screen.queryByRole('group', { name: 'Vista de la planilla' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ver valores' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /Valores de la ronda/ })).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Obligatorios' })).toBeInTheDocument();
  expect(mocks.valores).not.toHaveBeenCalled();
});

it('con muchos individuos la matriz se dibuja de a 50 y filtra como la planilla', async () => {
  const muchas = Array.from({ length: 379 }, (_, i) => fila(i + 1, i < 300 ? {} : SIN_EVALUAR));
  mocks.planilla.mockResolvedValue({ ...ronda2, avance: { vivos: 379, sin_ronda: 0, sin_iniciar: 79, borrador: 0, completa: 300 }, individuos: muchas });
  mocks.valores.mockResolvedValue(new Map(muchas.map((_, i) => [`e${i + 1}`, { brotacion: (i % 5) + 1, floracion: 3 }])));
  montar(true, '/planta/p?pestana=planilla#valores');
  const matriz = await screen.findByRole('region', { name: /Valores de la ronda 2/ });
  const filasDe = () => within(within(matriz).getByRole('table')).getAllByRole('row').length - 2; // dos filas de encabezado
  expect(filasDe()).toBe(50);
  expect(screen.getByText('Mostrando 1–50 de 379')).toBeInTheDocument();
  // G18: 100 filas por página.
  fireEvent.change(screen.getByRole('combobox', { name: 'Filas por página' }), { target: { value: '100' } });
  expect(filasDe()).toBe(100);
  // El filtro de la planilla acota la matriz.
  fireEvent.click(within(screen.getByRole('group', { name: 'Filtrar individuos' })).getByRole('button', { name: /Sin empezar 79/ }));
  await waitFor(() => expect(filasDe()).toBe(79));
  expect(screen.getAllByText('Mostrando 1–79 de 79 (de 379 vivos)').length).toBeGreaterThan(0); // una sola página: escritorio y celular dicen lo mismo
});

it('si la lectura de valores falla, se avisa y se puede reintentar', async () => {
  mocks.valores.mockRejectedValueOnce(new Error('caído')).mockResolvedValue(new Map([['e1', { brotacion: 4, floracion: 3 }]]));
  montar(true, '/planta/p?pestana=planilla#valores');
  const alerta = await screen.findByRole('alert');
  expect(alerta).toHaveTextContent('No se pudieron leer los valores de la ronda 2.');
  fireEvent.click(within(alerta).getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('region', { name: /Valores de la ronda 2/ })).toBeInTheDocument();
});
