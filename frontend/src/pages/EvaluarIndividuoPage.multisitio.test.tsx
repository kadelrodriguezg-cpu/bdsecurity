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
vi.mock('@/features/individuos/EvaluacionForm', () => ({
  EvaluacionForm: (p: { codigoIndividuo: string; rondaId: string; tipoRonda?: string; siguiente?: string; barraDerecha?: React.ReactNode; onGuardado: (e: 'borrador' | 'completa') => void }) => (
    <div>
      <p>Formulario {p.codigoIndividuo} · {p.rondaId} · serie {p.tipoRonda} · siguiente {p.siguiente ?? 'ninguno'}</p>
      {p.barraDerecha}
      <button type="button" onClick={() => p.onGuardado('completa')}>finalizar</button>
    </div>
  ),
}));

const fila = (n: number, extra: Partial<FilaPlanilla> = {}): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `90-901-P${n}`, numero: n, ronda_id: `r${n}`, estado: 'sin_iniciar',
  evaluacion_id: null, evaluacion_updated_at: null, fecha: null, evaluador: null, es_mia: false,
  protocolo_id: null, protocolo_distinto: false, estados: null, conteo: null, ...extra,
});
const planilla: PlanillaRonda = {
  planta_id: 'p', tipo_ronda: 'multisitio', numero_ronda: 1, protocolo: null,
  avance: { vivos: 3, sin_ronda: 0, sin_iniciar: 2, borrador: 0, completa: 1 },
  individuos: [fila(1, { estado: 'completa' }), fila(2), fila(3)],
};

beforeEach(() => { mocks.planilla.mockResolvedValue(planilla); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function Ruta() {
  const l = useLocation();
  return <p data-testid="ruta">{l.pathname + l.search}</p>;
}

function montar(ruta: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/planta/:id/multisitio/:individuoId" element={<><EvaluarIndividuoPage tipo="multisitio" /><Ruta /></>} />
          <Route path="*" element={<Ruta />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('pide la planilla de la serie multisitio, pasa la serie al formulario y recorre por la ruta multisitio', async () => {
  montar('/planta/p/multisitio/i2');
  expect(await screen.findByText('Formulario 90-901-P2 · r2 · serie multisitio · siguiente P3')).toBeInTheDocument();
  expect(mocks.planilla).toHaveBeenCalledWith('p', undefined, 'multisitio');
  fireEvent.click(screen.getByRole('button', { name: 'finalizar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/multisitio/i3');
  fireEvent.click(await screen.findByRole('button', { name: 'Anterior: 90-901-P2' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/multisitio/i2');
});

it('desde el expediente pide la ronda indicada, no hay recorrido y al finalizar vuelve al individuo', async () => {
  const volver = '/planta/p?pestana=individuos&individuo=i2';
  montar(`/planta/p/multisitio/i2?ronda=2&volver=${encodeURIComponent(volver)}`);
  expect(await screen.findByText(/serie multisitio · siguiente ninguno/)).toBeInTheDocument();
  expect(mocks.planilla).toHaveBeenCalledWith('p', 2, 'multisitio');
  expect(screen.queryByRole('button', { name: /Anterior:/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'finalizar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(volver);
});

it('un «volver» que no es de este cruce se ignora: se recorre la planilla', async () => {
  montar(`/planta/p/multisitio/i2?volver=${encodeURIComponent('//sitio-ajeno.example')}`);
  expect(await screen.findByText(/siguiente P3/)).toBeInTheDocument();
});
