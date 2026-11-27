import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const { actualizarEspecieMock, crearEspecieMock } = vi.hoisted(() => ({
  actualizarEspecieMock: vi.fn(async () => ({ id: 'e1', nombre: 'Mora', nombre_cientifico: null })),
  crearEspecieMock: vi.fn(async () => ({ id: 'e2', nombre: 'Frutilla', nombre_cientifico: null })),
}));

vi.mock('@/api/especies', () => ({
  listarEspecies: vi.fn(async () => [{ id: 'e1', nombre: 'mora', nombre_cientifico: null }]),
  crearEspecie: crearEspecieMock,
  actualizarEspecie: actualizarEspecieMock,
}));

import { EspeciesCatalogo } from './EspeciesCatalogo';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const montar = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><EspeciesCatalogo /></MemoryRouter></QueryClientProvider>);

describe('EspeciesCatalogo', () => {
  it('permite corregir el nombre de una especie existente', async () => {
    montar();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Editar mora' }))[0]);
    const hoja = await screen.findByRole('dialog', { name: 'Editar especie' });
    fireEvent.change(within(hoja).getByLabelText('Nombre'), { target: { value: 'Mora' } });
    fireEvent.click(within(hoja).getByRole('button', { name: /^guardar$/i }));
    await waitFor(() => expect(actualizarEspecieMock).toHaveBeenCalledWith('e1', { nombre: 'Mora', nombreCientifico: null }));
  });

  it('agrega una especie nueva y cada fila lleva a configurar sus descriptores', async () => {
    montar();
    expect((await screen.findAllByRole('link', { name: /Descriptores/ }))[0]).toHaveAttribute('href', '/catalogos?tipo=descriptores&especie=e1');
    fireEvent.click(screen.getAllByRole('button', { name: /Agregar especie/ })[0]);
    const hoja = await screen.findByRole('dialog', { name: 'Nueva especie' });
    fireEvent.change(within(hoja).getByLabelText('Nombre'), { target: { value: 'Frutilla' } });
    fireEvent.click(within(hoja).getByRole('button', { name: /^guardar$/i }));
    await waitFor(() => expect(crearEspecieMock).toHaveBeenCalledWith('Frutilla', undefined));
  });
});
