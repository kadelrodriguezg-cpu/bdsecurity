/**
 * Fase 5, segunda parte (G11, G12, G13): «Siguiente» sigue el filtro desde el que se llegó a evaluar, hay dos acciones al
 * cerrar y la vuelta a la planilla conserva su URL (filtro, búsqueda, página) y dice de qué planta se volvió.
 *
 * El caso de Efraín: el admin cierra desde «Borradores» el borrador ajeno de la P75 y la app lo mandaba a la P2 (la primera
 * planta sin empezar del cruce), porque los borradores ajenos no contaban como «suyos».
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilaPlanilla, PlanillaRonda } from '@/api/protocolo';
import { EvaluarIndividuoPage } from './EvaluarIndividuoPage';

const mocks = vi.hoisted(() => ({ planilla: vi.fn(), esAdmin: true }));
vi.mock('@/api/protocolo', () => ({ obtenerPlanillaRonda: mocks.planilla }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: mocks.esAdmin }) }));
vi.mock('@/features/individuos/EvaluacionForm', () => ({
  EvaluacionForm: (p: { codigoIndividuo: string; siguiente?: string; barraDerecha?: React.ReactNode; onCerrar?: () => void; onGuardado: (e: 'borrador' | 'completa', resumen?: { llenos: number; total: number }, destino?: 'seguir' | 'volver') => void; textoVolver?: string }) => (
    <div>
      <p>Formulario {p.codigoIndividuo} · siguiente {p.siguiente ?? 'ninguno'} · volver {p.textoVolver ?? 'ninguno'}</p>
      {p.barraDerecha}
      <button type="button" onClick={() => p.onGuardado('completa', { llenos: 15, total: 15 }, 'seguir')}>finalizar y seguir</button>
      <button type="button" onClick={() => p.onGuardado('completa', { llenos: 15, total: 15 }, 'volver')}>finalizar y volver</button>
      <button type="button" onClick={() => p.onGuardado('borrador')}>borrador</button>
      <button type="button" onClick={() => p.onCerrar?.()}>cerrar</button>
    </div>
  ),
}));

const fila = (n: number, extra: Partial<FilaPlanilla> = {}): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `02-001-P${n}`, numero: n, ronda_id: `r${n}`, estado: 'sin_iniciar',
  evaluacion_id: null, evaluacion_updated_at: null, fecha: null, evaluador: null, es_mia: false,
  protocolo_id: null, protocolo_distinto: false, estados: null, conteo: null, ...extra,
});
const borradorAjeno = (n: number) => fila(n, { estado: 'borrador', evaluacion_id: `e${n}`, es_mia: false });
const borradorMio = (n: number) => fila(n, { estado: 'borrador', evaluacion_id: `e${n}`, es_mia: true });

const planilla = (individuos: FilaPlanilla[]): PlanillaRonda => ({
  planta_id: 'p', tipo_ronda: 'anual', numero_ronda: 1, protocolo: null,
  avance: { vivos: individuos.length, sin_ronda: 0, sin_iniciar: 0, borrador: 0, completa: 0 },
  individuos,
});

const PLANILLA_EJEMPLO = planilla([fila(2), borradorAjeno(73), borradorAjeno(75), fila(76, { estado: 'completa', evaluacion_id: 'e76' }), borradorAjeno(78), fila(80)]);
const URL_PLANILLA = '/planta/p?pestana=planilla&filtro=borradores&q=7&pag=2';
const conRecorrido = (individuo: string, filtro = 'borradores') => `/planta/p/evaluar/${individuo}?filtro=${filtro}&planilla=${encodeURIComponent(URL_PLANILLA)}`;

beforeEach(() => { mocks.planilla.mockResolvedValue(PLANILLA_EJEMPLO); mocks.esAdmin = true; });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function Ruta() {
  const l = useLocation();
  return (
    <>
      <p data-testid="ruta">{l.pathname}{l.search}</p>
      <p data-testid="aviso">{(l.state as { aviso?: string } | null)?.aviso ?? ''}</p>
    </>
  );
}

function montar(url: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/planta/:id/evaluar/:individuoId" element={<><EvaluarIndividuoPage /><Ruta /></>} />
          <Route path="*" element={<Ruta />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('Efraín: el admin cierra el borrador ajeno de la P75 desde «Borradores» y sigue con el próximo borrador (P78), no con la P2', async () => {
  montar(conRecorrido('i75'));
  expect(await screen.findByText(/^Formulario 02-001-P75 · siguiente P78/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'finalizar y seguir' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(`/planta/p/evaluar/i78?filtro=borradores&planilla=${encodeURIComponent(URL_PLANILLA)}`);
});

it('si no quedan borradores después de la actual, vuelve a la planilla con un aviso en vez de saltar al principio', async () => {
  montar(conRecorrido('i78'));
  expect(await screen.findByText(/^Formulario 02-001-P78 · siguiente ninguno/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'finalizar y seguir' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(`${URL_PLANILLA}&desde=i78`);
  expect(screen.getByTestId('aviso')).toHaveTextContent('No quedan borradores después de P78');
});

it('el operario, desde «Borradores», sigue solo con sus propios borradores', async () => {
  mocks.esAdmin = false;
  mocks.planilla.mockResolvedValue(planilla([borradorMio(3), borradorAjeno(5), borradorMio(9)]));
  montar(conRecorrido('i3'));
  expect(await screen.findByText(/^Formulario 02-001-P3 · siguiente P9/)).toBeInTheDocument();
});

it('las flechas también siguen el filtro: el admin recorre los borradores de cualquier autor', async () => {
  montar(conRecorrido('i75'));
  expect(await screen.findByRole('button', { name: 'Anterior: 02-001-P73' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Siguiente: 02-001-P78' })).toBeInTheDocument();
});

it('desde «Sin empezar», el siguiente es la próxima sin empezar y no vuelve al principio', async () => {
  montar(conRecorrido('i80', 'pendientes'));
  expect(await screen.findByText(/^Formulario 02-001-P80 · siguiente ninguno/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'finalizar y seguir' }));
  expect(screen.getByTestId('aviso')).toHaveTextContent('No quedan plantas sin empezar después de P80');
});

it('dos acciones al cerrar: «Finalizar y volver a la planilla» vuelve a la planilla en la planta de la que se salió', async () => {
  montar(conRecorrido('i75'));
  expect(await screen.findByText(/volver Finalizar y volver a la planilla/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'finalizar y volver' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(`${URL_PLANILLA}&desde=i75`);
  expect(screen.getByTestId('aviso')).toHaveTextContent('');
});

it('guardar borrador o cerrar vuelven a la misma planilla (filtro, búsqueda y página) con la planta de la que se volvió', async () => {
  montar(conRecorrido('i73'));
  fireEvent.click(await screen.findByRole('button', { name: 'borrador' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(`${URL_PLANILLA}&desde=i73`);
  cleanup();
  montar(conRecorrido('i73'));
  fireEvent.click(await screen.findByRole('button', { name: 'cerrar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(`${URL_PLANILLA}&desde=i73`);
});

it('una «planilla» que no es de este cruce se ignora', async () => {
  montar(`/planta/p/evaluar/i75?filtro=borradores&planilla=${encodeURIComponent('/planta/otro?pestana=planilla')}`);
  fireEvent.click(await screen.findByRole('button', { name: 'cerrar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(/^\/planta\/p\?desde=i75$/);
});

it('sin filtro, la regla de siempre: el siguiente sin empezar por número (y si no hay después, desde el primero)', async () => {
  montar('/planta/p/evaluar/i80');
  expect(await screen.findByText(/^Formulario 02-001-P80 · siguiente P2/)).toBeInTheDocument();
});
