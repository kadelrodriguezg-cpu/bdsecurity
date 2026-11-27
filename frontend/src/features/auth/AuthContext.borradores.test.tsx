/**
 * U-01 y U-45 (docs/revision_ux/informe.md): una sesión que caduca o se revoca
 * conserva los borradores y deja el aviso para el login; el cierre manual usa
 * scope local y borra solo los borradores de quien cierra.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  miPerfil: vi.fn(),
  listener: null as ((evento: string, session: { user: User } | null) => void) | null,
}));

vi.mock('@/api/client', () => ({
  supabase: { auth: { getSession: mocks.getSession, onAuthStateChange: mocks.onAuthStateChange, signOut: mocks.signOut } },
}));
vi.mock('@/api/perfiles', () => ({ miPerfil: mocks.miPerfil }));

import { AuthProvider, useAuth } from './AuthContext';
import { leerSesionExpirada } from '@/lib/borradoresSesion';

const USUARIO_A = { id: 'usuario-a' } as User;
const CLAVE_A = 'borrador:usuario:usuario-a:evaluacion:r1';
const CLAVE_B = 'borrador:usuario:usuario-b:evaluacion:r1';

let auth: ReturnType<typeof useAuth>;
function Capturar() {
  auth = useAuth();
  return <output data-testid="usuario">{auth.user?.id ?? 'sin-usuario'}</output>;
}

function montar() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider><Capturar /></AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.getSession.mockResolvedValue({ data: { session: { user: USUARIO_A } } });
  mocks.onAuthStateChange.mockImplementation((listener) => {
    mocks.listener = listener;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  // Como supabase-js: quitar la sesión local emite SIGNED_OUT antes de resolver.
  mocks.signOut.mockImplementation(async () => {
    mocks.listener?.('SIGNED_OUT', null);
    return { error: null };
  });
  mocks.miPerfil.mockResolvedValue({ id: USUARIO_A.id, nombre: 'Usuario A', rol: 'operario', puede_ver_linaje: false });
});
afterEach(cleanup);

it('sesión revocada (SIGNED_OUT involuntario): el borrador queda intacto y se deja el aviso para el login', async () => {
  montar();
  await waitFor(() => expect(screen.getByTestId('usuario')).toHaveTextContent('usuario-a'));
  localStorage.setItem(CLAVE_A, '{"valor":{"brix":"12"},"guardadoEn":1}');

  act(() => mocks.listener?.('SIGNED_OUT', null));

  expect(screen.getByTestId('usuario')).toHaveTextContent('sin-usuario');
  expect(localStorage.getItem(CLAVE_A)).toBe('{"valor":{"brix":"12"},"guardadoEn":1}');
  expect(leerSesionExpirada()).toEqual({ usuarioId: 'usuario-a' });
});

it('al volver a entrar se olvida el aviso de sesión expirada', async () => {
  montar();
  await waitFor(() => expect(screen.getByTestId('usuario')).toHaveTextContent('usuario-a'));
  act(() => mocks.listener?.('SIGNED_OUT', null));
  expect(leerSesionExpirada()).not.toBeNull();
  act(() => mocks.listener?.('SIGNED_IN', { user: USUARIO_A } as never));
  expect(leerSesionExpirada()).toBeNull();
});

it('cierre manual: signOut con scope local, borra los borradores de quien cierra y los legados, no los de otra persona', async () => {
  montar();
  await waitFor(() => expect(screen.getByTestId('usuario')).toHaveTextContent('usuario-a'));
  localStorage.setItem(CLAVE_A, '{}');
  localStorage.setItem(CLAVE_B, '{}');
  localStorage.setItem('borrador:evaluacion:legado', '{}');
  localStorage.setItem('preferencia:vista', 'tarjetas');

  await act(async () => { await auth.logout(); });

  expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(localStorage.getItem(CLAVE_A)).toBeNull();
  expect(localStorage.getItem('borrador:evaluacion:legado')).toBeNull();
  expect(localStorage.getItem(CLAVE_B)).toBe('{}');
  expect(localStorage.getItem('preferencia:vista')).toBe('tarjetas');
  // Un cierre manual no es una sesión expirada: el login no debe avisar nada.
  expect(leerSesionExpirada()).toBeNull();
});

it('si la llamada de cierre falla, supabase-js igual quita la sesión local y los borradores de quien cerró se borran', async () => {
  mocks.signOut.mockImplementationOnce(async () => {
    mocks.listener?.('SIGNED_OUT', null);
    return { error: new Error('Failed to fetch') };
  });
  montar();
  await waitFor(() => expect(screen.getByTestId('usuario')).toHaveTextContent('usuario-a'));
  localStorage.setItem(CLAVE_A, '{}');
  await act(async () => { await auth.logout(); });
  expect(localStorage.getItem(CLAVE_A)).toBeNull();
  expect(screen.getByTestId('usuario')).toHaveTextContent('sin-usuario');
});
