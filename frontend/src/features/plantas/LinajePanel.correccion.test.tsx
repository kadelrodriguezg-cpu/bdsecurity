import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import type { FichaPlanta } from '@/types/domain';

const mocks = vi.hoisted(() => ({ guardar: vi.fn(), listar: vi.fn() }));
vi.mock('@/api/linaje', () => ({ actualizarLinaje: mocks.guardar }));
vi.mock('@/api/variedades', () => ({ listarVariedades: mocks.listar, crearVariedad: vi.fn() }));
import { LinajePanel } from './LinajePanel';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('montaje/refetch conserva ids; cambiar ficha descarta la edición y carga su propio linaje', async () => {
  mocks.listar.mockImplementation(async (especie: string) => [
    { id: `m-${especie}`, especie_id: especie, nombre: `Madre ${especie}`, activo: true },
    { id: `p-${especie}`, especie_id: especie, nombre: `Padre ${especie}`, activo: true },
  ]);
  mocks.guardar.mockResolvedValue({});
  const ficha = (id: string, especie: string): FichaPlanta => ({
    id, especie_id: especie, codigo_sistema: id, estado: 'polinizacion', created_at: '', updated_at: '',
    mama_id: `m-${especie}`, papa_id: `p-${especie}`, mama_nombre: `Madre ${especie}`, papa_nombre: `Padre ${especie}`,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const arbol = (f: FichaPlanta) => <QueryClientProvider client={client}><LinajePanel ficha={f} /></QueryClientProvider>;
  const { rerender } = render(arbol(ficha('A', 'uno')));
  fireEvent.click(screen.getByRole('button', { name: 'Editar linaje' }));
  await screen.findByDisplayValue('Madre uno');
  expect(screen.getByLabelText('Papá')).toHaveValue('Padre uno');
  rerender(arbol({ ...ficha('A', 'uno'), updated_at: 'refetch' }));
  expect(screen.getByLabelText('Mamá')).toHaveValue('Madre uno');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar linaje' }));
  await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith(expect.objectContaining({ plantaId: 'A', mamaId: 'm-uno', papaId: 'p-uno' })));
  await screen.findByRole('button', { name: 'Editar linaje' });
  fireEvent.click(screen.getByRole('button', { name: 'Editar linaje' }));
  rerender(arbol(ficha('B', 'dos')));
  expect(screen.queryByRole('button', { name: 'Guardar linaje' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Editar linaje' }));
  await screen.findByDisplayValue('Madre dos');
  expect(screen.getByLabelText('Papá')).toHaveValue('Padre dos');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar linaje' }));
  await waitFor(() => expect(mocks.guardar).toHaveBeenLastCalledWith(expect.objectContaining({ plantaId: 'B', mamaId: 'm-dos', papaId: 'p-dos' })));
});
