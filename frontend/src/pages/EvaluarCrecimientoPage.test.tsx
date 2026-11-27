import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Individuo } from '@/api/individuos';
import { EvaluarCrecimientoPage } from './EvaluarCrecimientoPage';

const mocks = vi.hoisted(() => ({ individuos: vi.fn(), evaluaciones: vi.fn() }));
vi.mock('@/api/individuos', () => ({ listarIndividuosDePlanta: mocks.individuos }));
vi.mock('@/api/evaluacionReducida', () => ({ listarEvaluacionesReducidasDeCruce: mocks.evaluaciones }));
// El formulario y el resumen tienen sus propias pruebas; acá basta ver qué recibe y qué hace la página al guardar.
vi.mock('@/features/individuos/EvaluacionReducidaForm', () => ({
  EvaluacionReducidaForm: (p: { individuoId: string; fase: string; variante: string; siguiente?: string; onGuardado: () => void; onCerrar: () => void }) => (
    <div>
      <p>Formulario {p.individuoId} · {p.fase} · {p.variante} · siguiente {p.siguiente ?? 'ninguno'}</p>
      <button type="button" onClick={p.onGuardado}>guardar</button>
      <button type="button" onClick={p.onCerrar}>cancelar</button>
    </div>
  ),
}));
vi.mock('@/features/individuos/EvaluacionReducidaResumen', () => ({ EvaluacionReducidaResumen: () => <p>resumen previo</p> }));

const individuo = (n: number, extra: Partial<Individuo> = {}): Individuo => ({
  id: `i${n}`, planta_id: 'p', codigo_display: `90-901-P${n}`, clon_de_id: null, estado_vital: 'vivo', fecha_baja: null, created_at: '2026-01-01', ...extra,
});
const evaluacion = (n: number) => ({ id: `e${n}`, individuo_id: `i${n}`, fase: 'crecimiento', talla: 30, created_at: '2026-10-20T12:00:00Z', created_by: 'yo', autor_nombre: null });

beforeEach(() => {
  mocks.individuos.mockResolvedValue([individuo(1), individuo(2), individuo(3), individuo(4), individuo(5, { estado_vital: 'descartado' })]);
  mocks.evaluaciones.mockResolvedValue([evaluacion(1), evaluacion(3)]);
});
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
          <Route path="/planta/:id/crecimiento/:individuoId" element={<><EvaluarCrecimientoPage /><Ruta /></>} />
          <Route path="*" element={<Ruta />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('abre el formulario de pantalla completa del individuo y ofrece el siguiente sin evaluar por número', async () => {
  montar('/planta/p/crecimiento/i2');
  expect(await screen.findByText('Formulario i2 · crecimiento · pantalla · siguiente P4')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Anterior: 90-901-P1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Siguiente: 90-901-P3' })).toBeInTheDocument();
  expect(screen.getByText('resumen previo')).toBeInTheDocument();
});

it('«Guardar y seguir» lleva al siguiente sin evaluar; el último pendiente vuelve a la planilla', async () => {
  montar('/planta/p/crecimiento/i2');
  fireEvent.click(await screen.findByRole('button', { name: 'guardar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/crecimiento/i4');
  cleanup();
  mocks.evaluaciones.mockResolvedValue([evaluacion(1), evaluacion(2), evaluacion(3)]);
  montar('/planta/p/crecimiento/i4');
  expect(await screen.findByText(/siguiente ninguno/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'guardar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(/^\/planta\/p$/);
});

it('desde el expediente no hay recorrido y cerrar o guardar vuelve a la ficha pedida', async () => {
  const volver = '/planta/p?pestana=individuos&individuo=i2';
  montar(`/planta/p/crecimiento/i2?volver=${encodeURIComponent(volver)}`);
  expect(await screen.findByText('Formulario i2 · crecimiento · pantalla · siguiente ninguno')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Anterior:/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Individuo/ })).toHaveAttribute('href', volver);
  fireEvent.click(screen.getByRole('button', { name: 'guardar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(volver);
  cleanup();
  montar(`/planta/p/crecimiento/i2?volver=${encodeURIComponent(volver)}`);
  fireEvent.click(await screen.findByRole('button', { name: 'cancelar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(volver);
});

it.each([
  ['//sitio-ajeno.example/x'],
  ['https://sitio-ajeno.example/planta/p'],
  ['/planta/otro-cruce?pestana=individuos'],
  ['/planta/p/../../login'],
  ['/planta/pirata'],
])('un «volver» que no es de este cruce (%s) se ignora y vuelve a la planilla', async (volver) => {
  montar(`/planta/p/crecimiento/i2?volver=${encodeURIComponent(volver)}`);
  fireEvent.click(await screen.findByRole('button', { name: 'cancelar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent(/^\/planta\/p$/);
});

it('un individuo que no está vivo o no es de este cruce no abre el formulario y lo explica', async () => {
  montar('/planta/p/crecimiento/i5');
  expect(await screen.findByText(/no está vivo o no pertenece a este cruce/)).toBeInTheDocument();
  expect(screen.queryByText(/^Formulario/)).not.toBeInTheDocument();
  cleanup();
  montar('/planta/p/crecimiento/ajeno');
  expect(await screen.findByText(/no está vivo o no pertenece a este cruce/)).toBeInTheDocument();
});

it('si la carga falla ofrece reintentar y no abre el formulario', async () => {
  mocks.evaluaciones.mockRejectedValue(new Error('sin red'));
  montar('/planta/p/crecimiento/i2');
  expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  expect(screen.queryByText(/^Formulario/)).not.toBeInTheDocument();
});
