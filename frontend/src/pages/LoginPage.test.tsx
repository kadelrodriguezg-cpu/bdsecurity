import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
const mocks = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ login: mocks.login }) }));
import { LoginPage } from './LoginPage';
afterEach(cleanup);
beforeEach(() => { mocks.login.mockReset().mockResolvedValue(undefined); });
function Destino() { const l = useLocation(); return <output>{l.pathname}{l.search}{l.hash}</output>; }
function montar(next?: string) {
  render(<MemoryRouter initialEntries={[`/login${next ? `?${new URLSearchParams({ next })}` : ''}`]}><Routes>
    <Route path="/login" element={<LoginPage />} /><Route path="*" element={<Destino />} />
  </Routes></MemoryRouter>);
}
function ingresar() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sintetico@ejemplo.cl' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'solo-test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
}
describe('LoginPage', () => {
  it('reanuda un destino conservado en la URL después de recargar login', async () => {
    montar('/planta/uuid?etapa=siembra#historial');
    ingresar();
    expect(await screen.findByRole('status')).toHaveTextContent('/planta/uuid?etapa=siembra#historial');
  });
  it.each(['//externo.cl', 'https://externo.cl', '/login?next=/plantas'])('descarta destino inseguro %s', async (next) => {
    montar(next); ingresar();
    expect(await screen.findByRole('status')).toHaveTextContent(/^\/$/);
  });
  it('asocia errores y enfoca el primer campo inválido sin autenticar', async () => {
    montar(); fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    await screen.findByText('Ingresa un email válido');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Ingresa un email válido');
    expect(screen.getByLabelText('Contraseña')).toHaveAccessibleDescription('Ingresa tu contraseña');
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus());
    expect(mocks.login).not.toHaveBeenCalled();
  });
  it('anuncia fallo de login sin mostrar detalles crudos y permite reintentar', async () => {
    mocks.login.mockRejectedValueOnce(new Error('detalle sensible del servidor'));
    montar('/plantas'); ingresar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo iniciar sesión');
    expect(screen.queryByText(/detalle sensible/)).not.toBeInTheDocument();
    ingresar();
    expect(await screen.findByRole('status')).toHaveTextContent('/plantas');
  });
  it('conserva únicamente el mensaje conocido de credenciales incorrectas', async () => {
    mocks.login.mockRejectedValueOnce(new Error('Email o contraseña incorrectos.'));
    montar(); ingresar();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email o contraseña incorrectos.');
  });
});
