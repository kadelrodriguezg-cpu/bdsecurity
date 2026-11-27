import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilaPlanilla, PlanillaRonda } from '@/api/protocolo';
import { PlanillaMultisitio } from './PlanillaMultisitio';

const mocks = vi.hoisted(() => ({ planilla: vi.fn(), resumen: vi.fn(), iniciarMulti: vi.fn(), iniciarAnual: vi.fn(), admin: { valor: false } }));
vi.mock('@/api/protocolo', () => ({ obtenerPlanillaRonda: mocks.planilla }));
vi.mock('@/api/individuos', () => ({ obtenerResumenIndividuos: mocks.resumen }));
vi.mock('@/api/rondas', () => ({ iniciarRonda: mocks.iniciarAnual, iniciarRondaMultisitio: mocks.iniciarMulti }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: mocks.admin.valor }) }));

const fila = (n: number, extra: Partial<FilaPlanilla> = {}): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `90-901-P${n}`, numero: n, ronda_id: `r${n}`, estado: 'completa',
  evaluacion_id: `e${n}`, evaluacion_updated_at: '2026-10-20T12:00:00Z', fecha: '2026-10-20', evaluador: 'J. Pérez',
  es_mia: true, protocolo_id: null, protocolo_distinto: false,
  estados: { brotacion: 'medido' }, conteo: { medido: 1, falto: 0, no_evaluado: 27, marcado: 0 }, ...extra,
});
const pendiente = (n: number, extra: Partial<FilaPlanilla> = {}) => fila(n, { estado: 'sin_iniciar', evaluacion_id: null, evaluacion_updated_at: null, evaluador: null, estados: null, conteo: null, ...extra });

// Los Robles: 4 (2 completas, 1 borrador, 1 pendiente) · El Boldo: 2 (1 completa, 1 pendiente) · sin predio: 1 sin ronda.
const individuos: FilaPlanilla[] = [
  fila(1), fila(2), fila(3, { estado: 'borrador' }), pendiente(4), fila(5), pendiente(6),
  pendiente(7, { estado: 'sin_ronda', ronda_id: null }),
];
const planilla: PlanillaRonda = {
  planta_id: 'p', tipo_ronda: 'multisitio', numero_ronda: 1, protocolo: null,
  avance: { vivos: 7, sin_ronda: 1, sin_iniciar: 2, borrador: 1, completa: 3 }, individuos,
};
const resumen = (predio: string | null) => ({ emplazamiento_predio_nombre: predio, emplazamiento_sector_nombre: predio ? 'Sector principal' : null });

beforeEach(() => {
  mocks.admin.valor = false;
  mocks.planilla.mockResolvedValue(planilla);
  mocks.resumen.mockResolvedValue({
    i1: resumen('Los Robles'), i2: resumen('Los Robles'), i3: resumen('Los Robles'), i4: resumen('Los Robles'),
    i5: resumen('El Boldo'), i6: resumen('El Boldo'), i7: resumen(null),
  });
  mocks.iniciarMulti.mockResolvedValue({ ronda_id: 'r', numero_ronda: 1 });
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
          <Route path="/planta/:id" element={<><PlanillaMultisitio plantaId="p" onAbrir={onAbrir} /><Ruta /></>} />
          <Route path="*" element={<Ruta />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onAbrir;
}

it('pide la planilla de la serie multisitio y encabeza con el avance de toda la ronda', async () => {
  montar();
  expect(await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '3 de 7 cerradas')).toBeInTheDocument();
  expect(mocks.planilla).toHaveBeenCalledWith('p', undefined, 'multisitio');
  expect(screen.getByText(/multisitio/, { selector: 'span' })).toBeInTheDocument();
});

it('muestra el avance de cada predio: cuántos individuos con evaluación completa, borradores y última actividad', async () => {
  montar();
  const predios = within(await screen.findByRole('list', { name: 'Avance por predio' }));
  const robles = within(predios.getByText('Los Robles').closest('li') as HTMLElement);
  expect(robles.getByText((_, el) => el?.tagName === 'P' && el.textContent === '2 de 4 cerradas · 1 borrador')).toBeInTheDocument();
  expect(robles.getByRole('img', { name: '2 cerradas y 1 borrador de 4' })).toBeInTheDocument();
  expect(robles.getByText(/Última actividad .* · J\. Pérez/)).toBeInTheDocument();
  const boldo = within(predios.getByText('El Boldo').closest('li') as HTMLElement);
  expect(boldo.getByText((_, el) => el?.tagName === 'P' && el.textContent === '1 de 2 cerradas')).toBeInTheDocument();
  // Los que aún no tienen emplazamiento van aparte, al final.
  const nombres = predios.getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent);
  expect(nombres).toEqual(['El Boldo', 'Los Robles', 'Sin predio']);
});

it('filtra por predio con píldoras (con cuenta) y los filtros de estado se aplican dentro del predio', async () => {
  montar();
  const porPredio = within(await screen.findByRole('group', { name: 'Filtrar por predio' }));
  expect(porPredio.getByRole('button', { name: /Todos los predios 7/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(porPredio.getByRole('button', { name: /El Boldo 2/ }));
  const tabla = screen.getByRole('table');
  expect(within(tabla).getByRole('button', { name: 'P5' })).toBeInTheDocument();
  expect(within(tabla).getByRole('button', { name: 'P6' })).toBeInTheDocument();
  expect(within(tabla).queryByRole('button', { name: 'P1' })).not.toBeInTheDocument();
  const estados = within(screen.getByRole('group', { name: 'Filtrar individuos' }));
  expect(estados.getByRole('button', { name: /Todos 2/ })).toBeInTheDocument();
  expect(estados.getByRole('button', { name: /Sin empezar 1/ })).toBeInTheDocument();
  // Con un predio elegido ya no hace falta la columna Predio.
  expect(within(tabla).queryByRole('columnheader', { name: 'Predio' })).not.toBeInTheDocument();
});

it('en «Todos los predios» la tabla indica el predio de cada individuo', async () => {
  montar();
  const tabla = await screen.findByRole('table');
  expect(within(tabla).getByRole('columnheader', { name: 'Predio' })).toBeInTheDocument();
  const filaP5 = within(tabla).getByRole('button', { name: 'P5' }).closest('tr') as HTMLElement;
  expect(within(filaP5).getByText('El Boldo')).toBeInTheDocument();
});

it('quien aún no tiene predio ofrece registrar su traslado en vez de iniciar su ronda', async () => {
  const onAbrir = montar();
  const tabla = await screen.findByRole('table');
  const fila7 = within(tabla).getByRole('button', { name: 'P7' }).closest('tr') as HTMLElement;
  expect(within(fila7).queryByRole('button', { name: /Iniciar ronda/ })).not.toBeInTheDocument();
  fireEvent.click(within(fila7).getByRole('button', { name: 'Registrar traslado' }));
  expect(onAbrir).toHaveBeenCalledWith('i7');
});

it('no hay ranking ni comparación de puntajes entre predios', async () => {
  montar();
  await screen.findByRole('list', { name: 'Avance por predio' });
  expect(screen.queryByText(/ranking/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/puntaje/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/promedio entre predios|estabilidad|depende del predio|hipótesis/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: /promedio|variación|lectura/i })).not.toBeInTheDocument();
});

it('evaluar abre la pantalla completa multisitio y «Evaluar siguiente» va al primer pendiente', async () => {
  montar();
  fireEvent.click(await screen.findByRole('button', { name: /Evaluar siguiente/ }));
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/multisitio/i4');
});

it('el inicio de ronda en lote es solo del admin, usa la serie multisitio y deja fuera a quien no tiene predio', async () => {
  montar();
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: /Iniciar ronda multisitio/ })).not.toBeInTheDocument();
  cleanup();
  mocks.admin.valor = true;
  mocks.planilla.mockResolvedValue({ ...planilla, individuos: [...individuos, pendiente(8, { estado: 'sin_ronda', ronda_id: null })] });
  mocks.resumen.mockResolvedValue({
    i1: resumen('Los Robles'), i2: resumen('Los Robles'), i3: resumen('Los Robles'), i4: resumen('Los Robles'),
    i5: resumen('El Boldo'), i6: resumen('El Boldo'), i7: resumen(null), i8: resumen('El Boldo'),
  });
  montar();
  // De los dos sin ronda (P7 sin predio, P8 en El Boldo) solo entra P8.
  fireEvent.click(await screen.findByRole('button', { name: 'Iniciar ronda multisitio 1 para los 1 individuos vivos sin ronda' }));
  expect(await screen.findByText(/Quedan? fuera 1 individuo|Queda fuera 1 individuo/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Iniciar ronda multisitio 1 para 1' }));
  await waitFor(() => expect(mocks.iniciarMulti).toHaveBeenCalledWith('i8', 1));
  expect(mocks.iniciarAnual).not.toHaveBeenCalled();
  expect(mocks.iniciarMulti).toHaveBeenCalledTimes(1);
});

it('la ronda N+1 omitida por no tener la N cerrada se informa como omitida, con el motivo de la base', async () => {
  mocks.admin.valor = true;
  mocks.planilla.mockResolvedValue({ ...planilla, numero_ronda: 2, individuos: [pendiente(1, { estado: 'sin_ronda', ronda_id: null }), pendiente(2, { estado: 'sin_ronda', ronda_id: null })] });
  mocks.resumen.mockResolvedValue({ i1: resumen('Los Robles'), i2: resumen('Los Robles') });
  mocks.iniciarMulti.mockImplementation(async (id: string) => {
    if (id === 'i2') throw Object.assign(new Error('La ronda multisitio 1 todavía no tiene una evaluación completa. Ciérrala antes de iniciar la siguiente.'), { code: '55000' });
    return { ronda_id: 'r', numero_ronda: 2 };
  });
  montar();
  fireEvent.click(await screen.findByRole('button', { name: /Iniciar ronda multisitio 2 para los 2/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Iniciar ronda multisitio 2 para 2' }));
  const omitidas = await screen.findByRole('list', { name: 'Omitidas' });
  expect(within(omitidas).getByText(/P2/)).toBeInTheDocument();
  expect(omitidas).toHaveTextContent('La ronda multisitio 1 todavía no tiene una evaluación completa');
  expect(screen.getByText('1 omitidas')).toBeInTheDocument();
});

it('si no se pueden leer los predios, muestra la planilla sin el avance por predio', async () => {
  mocks.resumen.mockRejectedValue(new Error('sin red'));
  montar();
  expect(await screen.findByText(/sin el avance por predio/)).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Avance por predio' })).not.toBeInTheDocument();
  expect(await screen.findByRole('table')).toBeInTheDocument();
});
