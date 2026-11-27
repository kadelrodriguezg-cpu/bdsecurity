import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actualizarPermisos: vi.fn(),
  listarPerfiles: vi.fn(),
}));

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-actual' } }),
}));

vi.mock('@/api/perfiles', () => ({
  listarPerfiles: () => mocks.listarPerfiles(),
  actualizarPermisos: (...args: unknown[]) => mocks.actualizarPermisos(...args),
}));

import { UsuariosPage } from './UsuariosPage';

let resolverGuardado: (() => void) | undefined;

beforeEach(() => {
  mocks.listarPerfiles.mockResolvedValue([
    { id: 'admin-actual', nombre: 'Kadel', rol: 'admin', puede_ver_linaje: true },
    { id: 'operario-1', nombre: 'Operario Uno', rol: 'operario', puede_ver_linaje: false },
  ]);
  mocks.actualizarPermisos.mockImplementation(() => new Promise<void>((resolve) => {
    resolverGuardado = resolve;
  }));
});

afterEach(() => {
  resolverGuardado = undefined;
  cleanup();
  vi.clearAllMocks();
});

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UsuariosPage />
    </QueryClientProvider>,
  );
}

describe('UsuariosPage — confirmación de cambio de rol', () => {
  it('mantiene el rol anterior hasta confirmar y bloquea acciones mientras guarda', async () => {
    montar();
    const selector = await screen.findByRole('combobox', { name: 'Rol de Operario Uno' });

    fireEvent.change(selector, { target: { value: 'admin' } });

    expect(selector).toHaveValue('operario');
    expect(mocks.actualizarPermisos).not.toHaveBeenCalled();
    const dialogo = await screen.findByRole('dialog', { name: 'Confirmar cambio de rol' });
    expect(within(dialogo).getByText('Operario Uno')).toBeInTheDocument();
    expect(within(dialogo).getByText('Rol actual').nextElementSibling).toHaveTextContent('Operario');
    expect(within(dialogo).getByText('Rol nuevo').nextElementSibling).toHaveTextContent('Administrador');

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar y guardar' }));

    await waitFor(() => expect(mocks.actualizarPermisos).toHaveBeenCalledWith('operario-1', { rol: 'admin' }));
    expect(selector).toHaveValue('operario');
    expect(selector).toBeDisabled();
    expect(within(dialogo).getByRole('button', { name: 'Guardando…' })).toBeDisabled();

    resolverGuardado?.();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirmar cambio de rol' })).not.toBeInTheDocument());
  });

  it('muestra un error recuperable cuando la lista de perfiles falla', async () => {
    mocks.listarPerfiles.mockRejectedValueOnce(new Error('Failed to fetch'));
    montar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar para cargar los perfiles.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(mocks.listarPerfiles).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('combobox', { name: 'Rol de Operario Uno' })).toBeEnabled();
  });
});

describe('UsuariosPage — hallazgo 9', () => {
  it('muestra los roles como «Administrador» y «Operario» en la lista, el selector y la confirmación', async () => {
    montar();
    const selector = await screen.findByRole('combobox', { name: 'Rol de Operario Uno' });
    expect(screen.getAllByText('Administrador').length).toBeGreaterThan(0);
    expect(within(selector).getByRole('option', { name: 'Operario' })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Administrador' })).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: 'admin' } });
    const dialogo = await screen.findByRole('dialog', { name: 'Confirmar cambio de rol' });
    expect(within(dialogo).getByText('Rol actual').nextElementSibling).toHaveTextContent('Operario');
  });
});
