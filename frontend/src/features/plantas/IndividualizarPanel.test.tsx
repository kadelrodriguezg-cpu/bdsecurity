import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ crear: vi.fn(), listar: vi.fn() }));
vi.mock('@/api/individuos', () => ({ listarIndividuosDePlanta: mocks.listar, individualizarPlantas: mocks.crear }));
import { IndividualizarPanel, MAX_INDIVIDUOS_POR_LLAMADA } from './IndividualizarPanel';

beforeEach(() => {
  mocks.listar.mockResolvedValue([]);
  mocks.crear.mockResolvedValue({ codigos: ['02-001-A'] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function montar(cantidad: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><IndividualizarPanel plantaId="cruce-1" /></QueryClientProvider>);
  const campo = screen.getByLabelText('Cantidad a individualizar');
  fireEvent.change(campo, { target: { value: String(cantidad) } });
  return campo;
}

it('400 se envía sin confirmación y el input publica el tope de 1000', async () => {
  const confirmar = vi.spyOn(window, 'confirm');
  const campo = montar(400);
  expect(campo).toHaveAttribute('max', String(MAX_INDIVIDUOS_POR_LLAMADA));
  fireEvent.click(screen.getByRole('button', { name: 'Individualizar 400 plantas' }));
  await waitFor(() => expect(mocks.crear).toHaveBeenCalledWith('cruce-1', 400));
  expect(confirmar).not.toHaveBeenCalled();
});

it.each([401, 1000])('confirmar %i repite la cantidad y envía esa misma cantidad', async (cantidad) => {
  const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
  montar(cantidad);
  fireEvent.click(screen.getByRole('button', { name: `Individualizar ${cantidad} plantas` }));
  expect(confirmar).toHaveBeenCalledWith(expect.stringContaining(`Se agregarán ${cantidad} individuos`));
  await waitFor(() => expect(mocks.crear).toHaveBeenCalledWith('cruce-1', cantidad));
});

it('cancelar la confirmación conserva el campo y no llama a la RPC', () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const campo = montar(401);
  fireEvent.click(screen.getByRole('button', { name: 'Individualizar 401 plantas' }));
  expect(mocks.crear).not.toHaveBeenCalled();
  expect(campo).toHaveValue(401);
});

it('ante una respuesta perdida refresca los individuos para mostrar lo que llegó a crearse', async () => {
  mocks.listar.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'creado' }]);
  mocks.crear.mockRejectedValueOnce(new Error('Respuesta perdida'));
  montar(1);
  await waitFor(() => expect(mocks.listar).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Individualizar 1 planta' }));
  expect(await screen.findByText('Respuesta perdida')).toBeInTheDocument();
  expect(await screen.findByText('1', { selector: 'strong' })).toBeInTheDocument();
  expect(mocks.listar).toHaveBeenCalledTimes(2);
});

it.each([1001, 1.5])('el submit programático también rechaza %i sin llamar a la RPC', (cantidad) => {
  const campo = montar(cantidad);
  fireEvent.submit(campo.closest('form')!);
  expect(screen.getByRole('alert')).toHaveTextContent('entre 1 y 1000');
  expect(mocks.crear).not.toHaveBeenCalled();
});
