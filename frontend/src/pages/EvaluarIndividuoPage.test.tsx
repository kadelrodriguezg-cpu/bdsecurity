import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilaPlanilla, PlanillaRonda } from '@/api/protocolo';
import { EvaluarIndividuoPage } from './EvaluarIndividuoPage';

const mocks = vi.hoisted(() => ({ planilla: vi.fn() }));
vi.mock('@/api/protocolo', () => ({ obtenerPlanillaRonda: mocks.planilla }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: false }) }));
// El formulario tiene sus propias pruebas; acá basta ver qué recibe y qué hace la página al guardar.
vi.mock('@/features/individuos/EvaluacionForm', () => ({
  EvaluacionForm: (p: { codigoIndividuo: string; rondaId: string; siguiente?: string; avisoVisitaNueva?: string; barraDerecha?: React.ReactNode; onGuardado: (e: 'borrador' | 'completa', resumen?: { llenos: number; total: number }) => void }) => (
    <div>
      <p>Formulario {p.codigoIndividuo} · {p.rondaId} · siguiente {p.siguiente ?? 'ninguno'}</p>
      {p.avisoVisitaNueva && <p role="status">{p.avisoVisitaNueva}</p>}
      {p.barraDerecha}
      <button type="button" onClick={() => p.onGuardado('completa', { llenos: 15, total: 15 })}>finalizar</button>
      <button type="button" onClick={() => p.onGuardado('borrador')}>borrador</button>
    </div>
  ),
}));

const fila = (n: number, extra: Partial<FilaPlanilla> = {}): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `90-901-P${n}`, numero: n, ronda_id: `r${n}`, estado: 'sin_iniciar',
  evaluacion_id: null, evaluacion_updated_at: null, fecha: null, evaluador: null, es_mia: false,
  protocolo_id: null, protocolo_distinto: false, estados: null, conteo: null, ...extra,
});

const planilla: PlanillaRonda = {
  planta_id: 'p', tipo_ronda: 'anual', numero_ronda: 1, protocolo: null,
  avance: { vivos: 4, sin_ronda: 1, sin_iniciar: 2, borrador: 0, completa: 1 },
  individuos: [fila(1, { estado: 'completa', evaluacion_id: 'e1' }), fila(2), fila(3, { estado: 'completa', evaluacion_id: 'e3' }), fila(4), fila(5, { estado: 'sin_ronda', ronda_id: null })],
};

beforeEach(() => { mocks.planilla.mockResolvedValue(planilla); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function Ruta() {
  return <p data-testid="ruta">{useLocation().pathname}</p>;
}

function montar(individuo: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/planta/p/evaluar/${individuo}`]}>
        <Routes>
          <Route path="/planta/:id/evaluar/:individuoId" element={<><EvaluarIndividuoPage /><Ruta /></>} />
          <Route path="*" element={<Ruta />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('abre el formulario de la ronda del individuo y ofrece el siguiente sin evaluar por número', async () => {
  montar('i2');
  expect(await screen.findByText('Formulario 90-901-P2 · r2 · siguiente P4')).toBeInTheDocument();
  // U-09: P1 y P3 ya están cerradas, así que las flechas las saltan: antes de P2 no hay nada y después va P4.
  expect(screen.queryByRole('button', { name: /Anterior:/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Siguiente: 90-901-P4' })).toBeInTheDocument();
});

it('«Finalizar y seguir» lleva al siguiente sin evaluar; el borrador vuelve a la planilla', async () => {
  montar('i2');
  fireEvent.click(await screen.findByRole('button', { name: 'finalizar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/evaluar/i4');
  fireEvent.click(await screen.findByRole('button', { name: 'borrador' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(/^\/planta\/p$/);
});

it('U-19: «Finalizar y seguir» abre el siguiente con un aviso breve «P2 guardada · 15/15» (role=status)', async () => {
  montar('i2');
  expect(screen.queryByText(/guardada/)).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'finalizar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/evaluar/i4');
  expect(screen.getByRole('status')).toHaveTextContent('P2 guardada · 15/15');
});

it('U-09: abrir un individuo con la ronda cerrada abre una visita nueva con el aviso arriba, sin redirigir a la lectura', async () => {
  mocks.planilla.mockResolvedValue({ ...planilla, individuos: planilla.individuos.map((f) => (f.individuo_id === 'i1' ? { ...f, fecha: '2026-10-20' } : f)) });
  montar('i1');
  expect(await screen.findByText('90-901-P1 · r1', { exact: false })).toBeInTheDocument();
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/evaluar/i1');
  expect(screen.getByText('Esta ronda ya tiene una evaluación cerrada (20-10-2026). Estás agregando una nueva.')).toHaveAttribute('role', 'status');
});

it('U-09: un individuo sin evaluación cerrada no muestra el aviso de visita nueva', async () => {
  montar('i2');
  expect(await screen.findByText(/^Formulario 90-901-P2/)).toBeInTheDocument();
  expect(screen.queryByText(/Estás agregando una nueva/)).not.toBeInTheDocument();
});

it('U-09: las flechas recorren pendientes y borradores propios, no cerradas ni borradores ajenos', async () => {
  mocks.planilla.mockResolvedValue({
    ...planilla,
    individuos: [
      fila(1, { estado: 'borrador', es_mia: true }),
      fila(2, { estado: 'borrador', es_mia: false }),
      fila(3, { estado: 'completa', evaluacion_id: 'e3' }),
      fila(4),
      fila(5, { estado: 'borrador', es_mia: true }),
    ],
  });
  montar('i4');
  expect(await screen.findByRole('button', { name: 'Anterior: 90-901-P1' })).toBeInTheDocument(); // salta la ajena (P2) y la cerrada (P3)
  expect(screen.getByRole('button', { name: 'Siguiente: 90-901-P5' })).toBeInTheDocument();
});

it('al terminar el último pendiente vuelve a la planilla y, pasado el último número, retoma desde el primero', async () => {
  mocks.planilla.mockResolvedValue({ ...planilla, individuos: planilla.individuos.map((f) => (f.individuo_id === 'i4' ? { ...f, estado: 'completa' as const } : f)) });
  montar('i2');
  expect(await screen.findByText(/siguiente ninguno/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'finalizar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(/^\/planta\/p$/);
  cleanup();
  montar('i4');
  expect(await screen.findByText(/siguiente P2/)).toBeInTheDocument();
});

it('sin la ronda iniciada no abre el formulario y lo explica', async () => {
  montar('i5');
  expect(await screen.findByText(/no tiene la ronda 1 iniciada/)).toBeInTheDocument();
  expect(screen.queryByText(/^Formulario/)).not.toBeInTheDocument();
});

function RutaCompleta() {
  const { pathname, search } = useLocation();
  return <p data-testid="ruta">{pathname + search}</p>;
}

it('desde el expediente (Sprint 1.2): pide la planilla de esa ronda, sin recorrido, y al cerrar o finalizar vuelve al individuo', async () => {
  const volver = '/planta/p?pestana=individuos&individuo=i2';
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/planta/p/evaluar/i2?ronda=1&volver=${encodeURIComponent(volver)}`]}>
        <Routes>
          <Route path="/planta/:id/evaluar/:individuoId" element={<EvaluarIndividuoPage />} />
          <Route path="*" element={<RutaCompleta />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Formulario 90-901-P2 · r2 · siguiente ninguno')).toBeInTheDocument();
  expect(mocks.planilla).toHaveBeenCalledWith('p', 1);
  expect(screen.queryByRole('button', { name: /Anterior:/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Siguiente:/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'finalizar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(volver);
});

it('un «volver» que no es de este cruce se ignora y vuelve a la planilla', async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/planta/p/evaluar/i2?volver=${encodeURIComponent('//sitio-ajeno.example/x')}`]}>
        <Routes>
          <Route path="/planta/:id/evaluar/:individuoId" element={<EvaluarIndividuoPage />} />
          <Route path="*" element={<RutaCompleta />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'borrador' }));
  // Fase 5 (G13): vuelve a la planilla diciendo de qué planta se volvió.
  expect(screen.getByTestId('ruta')).toHaveTextContent(/^\/planta\/p\?desde=i2$/);
});

it('U-09: las flechas incluyen la fila cerrada con un borrador de visita nueva propio, pero no la de otra persona', async () => {
  mocks.planilla.mockResolvedValue({
    ...planilla,
    individuos: [
      fila(1, { estado: 'completa', evaluacion_id: 'e1', hay_borrador: true, borrador_mio: true }),
      fila(2, { estado: 'completa', evaluacion_id: 'e2', hay_borrador: true, borrador_mio: false }),
      fila(3),
      fila(4, { estado: 'completa', evaluacion_id: 'e4', hay_borrador: true, borrador_mio: true }),
    ],
  });
  montar('i3');
  expect(await screen.findByRole('button', { name: 'Anterior: 90-901-P1' })).toBeInTheDocument(); // salta P2 (visita nueva ajena)
  expect(screen.getByRole('button', { name: 'Siguiente: 90-901-P4' })).toBeInTheDocument();
});

it('hallazgo 3 (G3): al evaluar plantas atrasadas en la ronda 1 (?ronda=1), «Finalizar y seguir» sigue en esa ronda', async () => {
  function RutaCompleta() { const l = useLocation(); return <p data-testid="ruta-completa">{l.pathname}{l.search}</p>; }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/planta/p/evaluar/i2?ronda=1']}>
        <Routes>
          <Route path="/planta/:id/evaluar/:individuoId" element={<><EvaluarIndividuoPage /><RutaCompleta /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'finalizar' }));
  expect(screen.getByTestId('ruta-completa')).toHaveTextContent('/planta/p/evaluar/i4?ronda=1');
  expect(mocks.planilla).toHaveBeenCalledWith('p', 1);
});
