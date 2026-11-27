/**
 * Auditoría integral, Corrida 1, G7 (R01): comportamientos del formulario de predios. Las dos pruebas que antes eran `it.fails`
 * (A1-G7-11) pasan desde el rediseño de catálogos (26-10-2026): el formulario vive en una hoja que se cierra y se vacía al guardar.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { PrediosCatalogo } from './PrediosCatalogo';

const { crearPredio } = vi.hoisted(() => ({ crearPredio: vi.fn(async () => ({})) }));
vi.mock('@/api/catalogos', () => ({ crearPredio, actualizarPredio: vi.fn(async () => undefined), listarPredios: vi.fn(async () => []) }));
vi.mock('./PredioLocationPicker', () => ({ PredioLocationPicker: () => <div /> }));
vi.mock('@/features/chat/ChatPanelContext', () => ({ useChatPanel: () => ({ abrirChat: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function abrirFormulario() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cliente}><PrediosCatalogo /></QueryClientProvider>);
  fireEvent.click((await screen.findAllByRole('button', { name: /Agregar predio/ }))[0]);
  return screen.findByRole('dialog', { name: 'Agregar predio' });
}

it('A1-G7-11: crear un predio con un nombre válido llama una vez a crearPredio con el nombre recortado', async () => {
  await abrirFormulario();
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '  Vivero Norte  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar predio' }));
  await waitFor(() => expect(crearPredio).toHaveBeenCalledTimes(1));
  expect(crearPredio).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Vivero Norte' }));
});

it('A1-G7-11: tras crear con éxito, la hoja se cierra y al volver a abrirla el formulario está vacío (no se duplica)', async () => {
  await abrirFormulario();
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Vivero Norte' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar predio' }));
  await waitFor(() => expect(crearPredio).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar predio' })).not.toBeInTheDocument());
  fireEvent.click(screen.getAllByRole('button', { name: /Agregar predio/ })[0]);
  expect((await screen.findByLabelText('Nombre') as HTMLInputElement).value).toBe('');
});

it('A1-G7-11: un nombre de solo espacios no se envía', async () => {
  await abrirFormulario();
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar predio' }));
  await new Promise((resolver) => setTimeout(resolver, 50));
  expect(crearPredio).not.toHaveBeenCalled();
});
