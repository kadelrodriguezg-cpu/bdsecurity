/**
 * Fase 5, segunda parte (G13, G14): la planilla recuerda en la URL el filtro, la búsqueda y la página; al volver de evaluar
 * (`desde=`) abre en la página de esa planta, visible y resaltada un momento; muestra el aviso con que se volvió; y el
 * buscador por código pone primero el número exacto.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilaPlanilla, PlanillaRonda as Planilla } from '@/api/protocolo';
import { PlanillaRonda } from './PlanillaRonda';

const mocks = vi.hoisted(() => ({ planilla: vi.fn(), iniciar: vi.fn() }));
vi.mock('@/api/protocolo', () => ({ obtenerPlanillaRonda: mocks.planilla }));
vi.mock('@/api/rondas', () => ({ iniciarRonda: mocks.iniciar }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));

const fila = (n: number, extra: Partial<FilaPlanilla> = {}): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `02-001-P${n}`, numero: n, ronda_id: `r${n}`, estado: 'sin_iniciar',
  evaluacion_id: null, evaluacion_updated_at: null, fecha: null, evaluador: null, es_mia: false,
  protocolo_id: null, protocolo_distinto: false, estados: null, conteo: null, ...extra,
});
const borradorAjeno = (n: number) => fila(n, { estado: 'borrador', evaluacion_id: `e${n}` });

/** 180 plantas: P1..P180, con borradores ajenos en la P73, P75 y P178. */
const individuos = Array.from({ length: 180 }, (_, i) => ([73, 75, 178].includes(i + 1) ? borradorAjeno(i + 1) : fila(i + 1)));
const planilla: Planilla = {
  planta_id: 'p', tipo_ronda: 'anual', numero_ronda: 1, protocolo: null,
  avance: { vivos: 180, sin_ronda: 0, sin_iniciar: 177, borrador: 3, completa: 0 },
  individuos,
};

beforeEach(() => {
  mocks.planilla.mockResolvedValue(planilla);
  Element.prototype.scrollIntoView = vi.fn(); // jsdom no lo implementa
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

function Url() {
  const l = useLocation();
  return <output data-testid="url">{l.pathname}{l.search}</output>;
}

function montar(url = '/planta/p?pestana=planilla', estado?: unknown, esAdmin = true) {
  const props = { onAbrir: vi.fn(), onEvaluar: vi.fn(), onDefinirProtocolo: vi.fn() };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: url.split('?')[0], search: url.includes('?') ? `?${url.split('?')[1]}` : '', state: estado }]}>
        <Routes><Route path="/planta/:id" element={<><PlanillaRonda plantaId="p" esAdmin={esAdmin} {...props} /><Url /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return props;
}

const tabla = () => screen.getByRole('table');
const codigosVisibles = () => within(tabla()).getAllByRole('row').slice(1).map((tr) => tr.querySelector('td')?.textContent);

it('el filtro, la búsqueda y la página quedan en la URL; cambiar el filtro vuelve a la página 1', async () => {
  montar();
  fireEvent.click(await screen.findByRole('button', { name: 'Página 3' }));
  expect(screen.getByTestId('url')).toHaveTextContent('pag=3');
  fireEvent.click(screen.getByRole('button', { name: /Borradores 3/ }));
  expect(screen.getByTestId('url')).toHaveTextContent('filtro=borradores');
  expect(screen.getByTestId('url')).not.toHaveTextContent('pag=');
  expect(screen.getByTestId('url')).toHaveTextContent('pestana=planilla'); // no pisa los parámetros de la ficha
  fireEvent.change(screen.getByPlaceholderText('Número o código'), { target: { value: '75' } });
  expect(screen.getByTestId('url')).toHaveTextContent('q=75');
});

it('al montar con filtro, búsqueda y página en la URL, se abre igual', async () => {
  montar('/planta/p?pestana=planilla&filtro=pendientes&pag=2');
  expect(await screen.findByRole('button', { name: /Sin empezar 177/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Mostrando 51–100 de 177 (de 180 vivos)')).toBeInTheDocument();
  cleanup();
  montar('/planta/p?q=P75');
  expect(await screen.findByPlaceholderText('Número o código')).toHaveValue('P75');
});

it('al evaluar, la planilla pasa el filtro y su propia URL (para volver igual)', async () => {
  const props = montar('/planta/p?pestana=planilla&filtro=borradores&pag=1');
  const filaP75 = within(await screen.findByRole('table')).getByText('P75').closest('tr')!;
  fireEvent.click(within(filaP75).getByRole('button', { name: 'Continuar' }));
  expect(props.onEvaluar).toHaveBeenCalledWith('i75', { filtro: 'borradores', planilla: '/planta/p?pestana=planilla&filtro=borradores&pag=1' });
});

it('al volver con desde=P75 abre en su página (la 2), con la planta visible y resaltada un momento', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  montar('/planta/p?pestana=planilla&desde=i75');
  await screen.findByRole('table');
  const filaP75 = (await waitFor(() => within(tabla()).getByText('P75'))).closest('tr')!;
  expect(screen.getByText('Mostrando 51–100 de 180')).toBeInTheDocument();
  expect(screen.getByTestId('url')).toHaveTextContent('pag=2');
  expect(filaP75).toHaveAttribute('data-resaltada', 'true');
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(4000); });
  expect(within(tabla()).getByText('P75').closest('tr')).not.toHaveAttribute('data-resaltada');
});

it('si la planta de la que se volvió ya no cumple el filtro, se abre la página donde estaría', async () => {
  // P75 se cerró: ya no está en «Borradores». Los borradores que quedan son P73 y P178: la P75 «estaría» después de la P73.
  mocks.planilla.mockResolvedValue({ ...planilla, individuos: individuos.map((f) => (f.individuo_id === 'i75' ? { ...f, estado: 'completa', evaluacion_id: 'e75' } : f)) });
  montar('/planta/p?filtro=borradores&desde=i75');
  await screen.findByRole('table');
  expect(codigosVisibles()).toEqual(['P73', 'P178']);
});

it('muestra el aviso con que se volvió («No quedan borradores después de P78»)', async () => {
  montar('/planta/p?filtro=borradores&desde=i78', { aviso: 'No quedan borradores después de P78' });
  expect(await screen.findByText('No quedan borradores después de P78')).toHaveAttribute('role', 'status');
});

it('G14: el buscador pone primero el número exacto, también cuando el número está en el código del cruce', async () => {
  // Hoy: al buscar «2» en el cruce 02-001 coinciden todas (el código del cruce tiene un 2) y la primera era la P1.
  montar('/planta/p?q=2');
  await screen.findByRole('table');
  expect(codigosVisibles().slice(0, 4)).toEqual(['P2', 'P12', 'P20', 'P21']);
  cleanup();
  montar('/planta/p?q=78');
  await screen.findByRole('table');
  expect(codigosVisibles()).toEqual(['P78', 'P178']);
});
