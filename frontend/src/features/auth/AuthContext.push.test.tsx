import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';

const orden: string[] = [];
const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  olvidarPush: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'usuario-a', email: 'a@ejemplo.cl' } as User } } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: mocks.signOut,
    },
  },
}));
vi.mock('@/api/perfiles', () => ({ miPerfil: vi.fn().mockResolvedValue({ id: 'usuario-a', nombre: 'A', rol: 'operario', puede_ver_linaje: false }) }));
vi.mock('@/api/push', () => ({ push: { registrarSuscripcion: vi.fn(), eliminarSuscripcion: vi.fn() } }));
vi.mock('@/lib/push/dispositivo', () => ({ olvidarPushAlCerrarSesion: mocks.olvidarPush }));

import { AuthProvider, useAuth } from './AuthContext';

function BotonSalir() {
  const { user, logout } = useAuth();
  return user ? <button type="button" onClick={() => void logout()}>Salir</button> : <p>Sin sesión</p>;
}

afterEach(() => { cleanup(); orden.length = 0; });

it('el cierre de sesión elimina la suscripción push del dispositivo, antes del signOut', async () => {
  mocks.olvidarPush.mockImplementation(async () => { orden.push('push'); });
  mocks.signOut.mockImplementation(async () => { orden.push('signOut'); return { error: null }; });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider><BotonSalir /></AuthProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Salir' }));
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
  expect(mocks.olvidarPush).toHaveBeenCalledOnce();
  expect(orden).toEqual(['push', 'signOut']);
});
