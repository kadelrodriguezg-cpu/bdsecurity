import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Individuo } from '@/api/individuos';
import type { EvaluacionReducidaDeCruce } from '@/api/evaluacionReducida';
import { PlanillaCrecimiento } from './PlanillaCrecimiento';

const mocks = vi.hoisted(() => ({ individuos: vi.fn(), evaluaciones: vi.fn() }));
vi.mock('@/api/individuos', () => ({ listarIndividuosDePlanta: mocks.individuos }));
vi.mock('@/api/evaluacionReducida', () => ({ listarEvaluacionesReducidasDeCruce: mocks.evaluaciones }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'yo' }, esAdmin: false }) }));

const individuo = (n: number, extra: Partial<Individuo> = {}): Individuo => ({
  id: `i${n}`, planta_id: 'p', codigo_display: `90-901-P${n}`, clon_de_id: null, estado_vital: 'vivo', fecha_baja: null, created_at: '2026-01-01', ...extra,
});
const evaluacion = (n: number, extra: Partial<EvaluacionReducidaDeCruce> = {}): EvaluacionReducidaDeCruce => ({
  id: `e${n}`, individuo_id: `i${n}`, fase: 'crecimiento', talla: 34, vigor: 4, created_at: '2026-10-20T12:00:00Z', created_by: 'yo', autor_nombre: 'Ana Rojas', ...extra,
});

beforeEach(() => {
  mocks.individuos.mockResolvedValue([individuo(1), individuo(2), individuo(3), individuo(4), individuo(5, { estado_vital: 'muerto' })]);
  mocks.evaluaciones.mockResolvedValue([
    evaluacion(1),
    evaluacion(3, { created_by: 'otra', autor_nombre: null, talla: undefined, vigor: 2, multibrotes: 3 }),
    evaluacion(3, { id: 'e3b', created_at: '2026-10-01T12:00:00Z', vigor: 5 }),
    evaluacion(5),
  ]);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function Ruta() {
  const l = useLocation();
  return <p data-testid="ruta">{l.pathname + l.search}</p>;
}

function montar() {
  const onAbrir = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/planta/p']}>
        <Routes>
          <Route path="/planta/:id" element={<><PlanillaCrecimiento plantaId="p" onAbrir={onAbrir} /><Ruta /></>} />
          <Route path="*" element={<Ruta />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onAbrir;
}

it('mide el avance por individuos evaluados (solo vivos) y muestra los filtros con su cuenta', async () => {
  montar();
  expect(await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '2 de 4 evaluados')).toBeInTheDocument();
  const filtros = within(screen.getByRole('group', { name: 'Filtrar individuos' }));
  expect(filtros.getByRole('button', { name: /Todos 4/ })).toHaveAttribute('aria-pressed', 'true');
  expect(filtros.getByRole('button', { name: /Pendientes 2/ })).toHaveAttribute('aria-pressed', 'false');
  expect(filtros.getByRole('button', { name: /Hechas 2/ })).toBeInTheDocument();
  // El muerto (P5) no cuenta ni aparece.
  expect(screen.queryByText('P5')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Filtrar individuos' })?.textContent).not.toMatch(/borrador/i);
});

it('cada fila dice su estado, lo medido, quién la cargó y la fecha de la última evaluación', async () => {
  montar();
  const tabla = await screen.findByRole('table');
  const fila = (corto: string) => within(tabla).getByRole('button', { name: corto }).closest('tr') as HTMLElement;
  expect(within(fila('P1')).getByText('Hecha')).toBeInTheDocument();
  expect(within(fila('P1')).getByText('Talla 34 · Vigor 4')).toBeInTheDocument();
  expect(within(fila('P1')).getByText('Tú')).toBeInTheDocument();
  expect(within(fila('P3')).getByText('Vigor 2 · Multibrotes 3')).toBeInTheDocument();
  expect(within(fila('P3')).getByText('Otra persona')).toBeInTheDocument();
  expect(within(fila('P2')).getByText('Pendiente')).toBeInTheDocument();
});

it('el filtro «Pendientes» deja solo los sin evaluar', async () => {
  montar();
  fireEvent.click(await screen.findByRole('button', { name: /Pendientes 2/ }));
  const tabla = screen.getByRole('table');
  expect(within(tabla).getByRole('button', { name: 'P2' })).toBeInTheDocument();
  expect(within(tabla).getByRole('button', { name: 'P4' })).toBeInTheDocument();
  expect(within(tabla).queryByRole('button', { name: 'P1' })).not.toBeInTheDocument();
});

it('«Evaluar siguiente» abre la pantalla completa del primer pendiente por número de planta', async () => {
  montar();
  fireEvent.click(await screen.findByRole('button', { name: /Evaluar siguiente/ }));
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/crecimiento/i2');
});

it('una hecha se abre en su expediente («Ver») y una pendiente se evalúa', async () => {
  const onAbrir = montar();
  const tabla = await screen.findByRole('table');
  fireEvent.click(within(within(tabla).getByRole('button', { name: 'P1' }).closest('tr') as HTMLElement).getByRole('button', { name: 'Ver' }));
  expect(onAbrir).toHaveBeenCalledWith('i1');
  fireEvent.click(within(within(tabla).getByRole('button', { name: 'P4' }).closest('tr') as HTMLElement).getByRole('button', { name: 'Evaluar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/crecimiento/i4');
});

it('con muchos individuos pagina de a 50 y los conteos siguen siendo del cruce completo', async () => {
  mocks.individuos.mockResolvedValue(Array.from({ length: 120 }, (_, k) => individuo(k + 1)));
  mocks.evaluaciones.mockResolvedValue([]);
  montar();
  // G18: paginación numerada en lugar de «Mostrar más».
  expect(await screen.findByText('Mostrando 1–50 de 120')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Pendientes 120/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Página 2' }));
  expect(screen.getByText('Mostrando 51–100 de 120')).toBeInTheDocument();
});

it('si falla la carga ofrece reintentar y no inventa un avance', async () => {
  mocks.evaluaciones.mockRejectedValue(new Error('sin red'));
  montar();
  expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  expect(screen.queryByText(/evaluados/)).not.toBeInTheDocument();
});
