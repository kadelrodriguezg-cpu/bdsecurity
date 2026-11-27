import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actualizarMiNombre: vi.fn(),
  cambiarMiPassword: vi.fn(),
  recargarPerfil: vi.fn(),
}));

vi.mock('@/api/perfiles', () => ({
  actualizarMiNombre: (...args: unknown[]) => mocks.actualizarMiNombre(...args),
  cambiarMiPassword: (...args: unknown[]) => mocks.cambiarMiPassword(...args),
}));

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'carolina.flores@ejemplo.cl' },
    perfil: { nombre: 'carolina.flores', rol: 'operario', puede_ver_linaje: false },
    recargarPerfil: mocks.recargarPerfil,
  }),
}));

import { PerfilPage } from './PerfilPage';

beforeEach(() => {
  mocks.actualizarMiNombre.mockResolvedValue(undefined);
  mocks.cambiarMiPassword.mockResolvedValue(undefined);
  mocks.recargarPerfil.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PerfilPage', () => {
  it('actualiza el nombre visible y refresca el perfil de la sesión', async () => {
    render(<PerfilPage />);

    const nombre = screen.getByLabelText('Nombre visible');
    expect(nombre).toHaveValue('carolina.flores');
    fireEvent.change(nombre, { target: { value: 'Carolina Flores' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    await waitFor(() => expect(mocks.actualizarMiNombre).toHaveBeenCalledWith('Carolina Flores'));
    expect(mocks.recargarPerfil).toHaveBeenCalledOnce();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nombre actualizado.');
  });

  it('valida la confirmación antes de cambiar la contraseña', async () => {
    render(<PerfilPage />);

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'segura123' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'distinta123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    expect(mocks.cambiarMiPassword).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'segura123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    await waitFor(() => expect(mocks.cambiarMiPassword).toHaveBeenCalledWith('segura123'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Contraseña actualizada.');
  });
});
