/** U-01: cerrar sesión con borradores pendientes pide confirmación en la página antes de borrarlos (ahora desde el menú de cuenta). */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { prefijoBorradoresDe } from '@/lib/borradoresSesion';

const mocks = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'usuario-a' }, perfil: { nombre: 'Operario' }, esAdmin: false, logout: mocks.logout }),
}));
vi.mock('@/features/chat/ChatPanelContext', () => ({
  ChatPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ControlesChat: () => null,
}));
import { AppShell } from './AppShell';

function montar() {
  render(
    <MemoryRouter>
      <Routes><Route element={<AppShell />}><Route path="*" element={<p>Contenido</p>} /></Route></Routes>
    </MemoryRouter>,
  );
}

function cerrarSesionDesdeElMenu() {
  fireEvent.click(screen.getByRole('button', { name: /menú de cuenta/i }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Cuenta' })).getByRole('button', { name: 'Cerrar sesión' }));
}

beforeEach(() => { localStorage.clear(); mocks.logout.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

it('sin borradores cierra sesión directo', () => {
  montar();
  cerrarSesionDesdeElMenu();
  expect(mocks.logout).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('con borradores pregunta; «Volver» no cierra y «Cerrar sesión y borrar» sí', () => {
  localStorage.setItem(prefijoBorradoresDe('usuario-a') + 'evaluacion:r1', '{}');
  localStorage.setItem(prefijoBorradoresDe('usuario-a') + 'evaluacion:r2', '{}');
  localStorage.setItem(prefijoBorradoresDe('usuario-b') + 'evaluacion:r1', '{}');
  montar();

  cerrarSesionDesdeElMenu();
  const dialogo = screen.getByRole('dialog', { name: '¿Cerrar sesión?' });
  expect(dialogo).toHaveTextContent('Tienes 2 evaluaciones sin enviar en este equipo. Si cierras sesión se borran.');
  expect(mocks.logout).not.toHaveBeenCalled();

  fireEvent.click(within(dialogo).getByRole('button', { name: 'Volver' }));
  expect(mocks.logout).not.toHaveBeenCalled();

  cerrarSesionDesdeElMenu();
  fireEvent.click(within(screen.getByRole('dialog', { name: '¿Cerrar sesión?' })).getByRole('button', { name: 'Cerrar sesión y borrar' }));
  expect(mocks.logout).toHaveBeenCalledTimes(1);
});

it('con un solo borrador usa el singular', () => {
  localStorage.setItem(prefijoBorradoresDe('usuario-a') + 'evaluacion:r1', '{}');
  montar();
  cerrarSesionDesdeElMenu();
  expect(screen.getByRole('dialog', { name: '¿Cerrar sesión?' })).toHaveTextContent('Tienes 1 evaluación sin enviar en este equipo.');
});
