/**
 * Fase 5, hallazgo 3 (G3): en la planilla de la ronda 2, «Pendientes de la ronda anterior» con acceso directo a evaluarlas, y la
 * acción «No evaluada en esta ronda» (solo admin) con motivo obligatorio.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilaPlanilla, PlanillaRonda as Planilla } from '@/api/protocolo';
import { PlanillaRonda } from './PlanillaRonda';

const m = vi.hoisted(() => ({ planilla: vi.fn(), iniciar: vi.fn(), marcar: vi.fn(), quitar: vi.fn() }));
vi.mock('@/api/protocolo', () => ({ obtenerPlanillaRonda: m.planilla }));
vi.mock('@/api/rondas', () => ({ iniciarRonda: m.iniciar, marcarRondaNoEvaluada: m.marcar, quitarRondaNoEvaluada: m.quitar }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));

const fila = (n: number, extra: Partial<FilaPlanilla>): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `90-901-P${n}`, numero: n, ronda_id: `r${n}`, estado: 'completa',
  evaluacion_id: `e${n}`, evaluacion_updated_at: '2026-10-20T12:00:00Z', fecha: '2026-10-20', evaluador: 'Equipo',
  es_mia: true, protocolo_id: null, protocolo_distinto: false,
  estados: { brotacion: 'medido' }, conteo: { medido: 1, falto: 0, no_evaluado: 0, marcado: 0 },
  ...extra,
});
const sinEvaluar = { evaluacion_id: null, evaluacion_updated_at: null, estados: null, conteo: null, evaluador: null, fecha: null };

const ronda2: Planilla = {
  planta_id: 'p', tipo_ronda: 'anual', numero_ronda: 2, protocolo: null,
  avance: { vivos: 4, sin_ronda: 2, sin_iniciar: 1, borrador: 0, completa: 0, no_evaluada: 1 },
  individuos: [
    fila(1, { ...sinEvaluar, estado: 'sin_iniciar', anterior: { ronda_id: 'r1-1', numero: 1, estado: 'completa' } }),
    fila(2, { ...sinEvaluar, ronda_id: null, estado: 'sin_ronda', anterior: { ronda_id: 'r1-2', numero: 1, estado: 'sin_iniciar' } }),
    fila(3, { ...sinEvaluar, ronda_id: null, estado: 'sin_ronda', anterior: { ronda_id: 'r1-3', numero: 1, estado: 'borrador' } }),
    fila(4, { ...sinEvaluar, estado: 'no_evaluada', no_evaluada: { motivo: 'sin_fruto', detalle: null }, anterior: { ronda_id: 'r1-4', numero: 1, estado: 'completa' } }),
  ],
};

beforeEach(() => { m.planilla.mockResolvedValue(ronda2); m.marcar.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function Ubicacion() { const l = useLocation(); return <output data-testid="url">{l.pathname}{l.search}</output>; }

function montar(esAdmin = true) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/planta/p']}>
        <PlanillaRonda plantaId="p" esAdmin={esAdmin} onAbrir={vi.fn()} onEvaluar={vi.fn()} onDefinirProtocolo={vi.fn()} />
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('la planta marcada se lee «No evaluada · Sin fruto» y el avance la cuenta aparte', async () => {
  montar();
  expect(await screen.findAllByText('No evaluada · Sin fruto')).not.toHaveLength(0);
  expect(screen.getByRole('list', { name: 'Detalle del avance' })).toHaveTextContent('1 no evaluada');
});

it('«Pendientes de la ronda anterior»: lista las plantas sin cerrar la ronda 1 y lleva a evaluarlas en esa ronda', async () => {
  montar();
  const seccion = await screen.findByRole('region', { name: 'Pendientes de la ronda anterior' });
  expect(within(seccion).getByText('P2')).toBeInTheDocument();
  expect(within(seccion).getByText('P3')).toBeInTheDocument();
  expect(within(seccion).queryByText('P1')).toBeNull();
  fireEvent.click(within(seccion).getByRole('button', { name: 'Evaluar la ronda 1 · P2' }));
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/planta/p/evaluar/i2?ronda=1'));
});

it('el admin marca una planta atrasada como «No evaluada» con motivo; el operario no ve la acción', async () => {
  montar();
  const seccion = await screen.findByRole('region', { name: 'Pendientes de la ronda anterior' });
  fireEvent.click(within(seccion).getByRole('button', { name: 'No evaluada en la ronda 1 · P2' }));
  const hoja = await screen.findByRole('dialog', { name: 'No evaluada en la ronda 1 · P2' });
  const confirmar = within(hoja).getByRole('button', { name: 'Marcar como no evaluada' });
  expect(confirmar).toBeDisabled();
  fireEvent.click(within(hoja).getByLabelText('Otro'));
  expect(confirmar).toBeDisabled();
  fireEvent.change(within(hoja).getByLabelText('¿Qué pasó?'), { target: { value: 'Planta en cuarentena' } });
  expect(confirmar).toBeEnabled();
  fireEvent.click(within(hoja).getByLabelText('Sin fruto'));
  fireEvent.click(confirmar);
  await waitFor(() => expect(m.marcar).toHaveBeenCalledWith('r1-2', 'sin_fruto', null));

  cleanup();
  montar(false);
  const deOperario = await screen.findByRole('region', { name: 'Pendientes de la ronda anterior' });
  expect(within(deOperario).queryByRole('button', { name: /No evaluada en/ })).toBeNull();
});

it('una planta con borrador en la ronda 1 no se puede marcar (hay que terminar o descartar el borrador)', async () => {
  montar();
  const seccion = await screen.findByRole('region', { name: 'Pendientes de la ronda anterior' });
  expect(within(seccion).queryByRole('button', { name: 'No evaluada en la ronda 1 · P3' })).toBeNull();
  expect(within(seccion).getByRole('button', { name: 'Evaluar la ronda 1 · P3' })).toBeInTheDocument();
});

it('en la ronda vigente, el admin también puede marcar una planta sin evaluar', async () => {
  montar();
  fireEvent.click(await screen.findByRole('button', { name: 'No evaluada en la ronda 2 · P1' }));
  expect(await screen.findByRole('dialog', { name: 'No evaluada en la ronda 2 · P1' })).toBeInTheDocument();
});
