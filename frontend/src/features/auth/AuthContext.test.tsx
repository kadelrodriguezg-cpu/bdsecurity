import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  miPerfil: vi.fn(),
  listener: null as ((evento: string, session: { user: User } | null) => void) | null,
}));

vi.mock('@/api/client', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
  },
}));

vi.mock('@/api/perfiles', () => ({ miPerfil: mocks.miPerfil }));

import { useBorradorLocal } from '@/lib/useBorradorLocal';
import { AuthProvider, useAuth } from './AuthContext';
import { ProtectedRoute } from '@/router/ProtectedRoute';

const USUARIO_A = { id: 'usuario-a', email: 'a@ejemplo.cl' } as User;
const USUARIO_B = { id: 'usuario-b', email: 'b@ejemplo.cl' } as User;

function FormularioEnEdicion() {
  const { user } = useAuth();
  const borrador = useBorradorLocal('borrador:prueba-auth', { nota: '' });
  return (
    <>
      <output data-testid="usuario-activo">{user?.id}</output>
      <label htmlFor="nota">Nota de trasplante</label>
      <input id="nota" defaultValue="" onChange={(e) => borrador.setValor({ nota: e.target.value })} />
    </>
  );
}

const estados: Array<{ user: string | null; perfil: string | null; cargando: boolean }> = [];
let capturarActual: () => () => boolean;
function Observar() {
  const { user, perfil, cargando, capturarVigenciaSesion } = useAuth();
  capturarActual = capturarVigenciaSesion;
  estados.push({ user: user?.id ?? null, perfil: perfil?.id ?? null, cargando });
  return null;
}
function diferido<T>() {
  let resolve!: (valor: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Observar />
        <MemoryRouter initialEntries={['/formulario']}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/formulario" element={<FormularioEnEdicion />} />
            </Route>
            <Route path="/login" element={<div>LOGIN</div>} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function emitir(evento: string, user: User | null) {
  if (!mocks.listener) throw new Error('El listener de Auth no fue registrado');
  mocks.listener(evento, user ? { user } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  estados.length = 0;
  localStorage.clear();
  mocks.listener = null;
  mocks.getSession.mockResolvedValue({ data: { session: { user: USUARIO_A } } });
  mocks.onAuthStateChange.mockImplementation((listener) => {
    mocks.listener = listener;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  mocks.miPerfil.mockResolvedValue({ id: USUARIO_A.id, nombre: 'Usuario A', rol: 'operario', puede_ver_linaje: false });
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AuthProvider — revalidación al recuperar foco', () => {
  it.each(['SIGNED_IN', 'TOKEN_REFRESHED'])('mantiene un formulario montado y no recarga el perfil ante %s del mismo usuario', async (evento) => {
    const qc = montar();
    const nota = await screen.findByLabelText('Nota de trasplante');
    qc.setQueryData(['misma-sesion'], 'conservar');
    fireEvent.change(nota, { target: { value: 'raíces sanas, trasplante pendiente' } });

    emitir(evento, { ...USUARIO_A });

    expect(screen.getByLabelText('Nota de trasplante')).toHaveValue('raíces sanas, trasplante pendiente');
    expect(screen.getByTestId('usuario-activo')).toHaveTextContent(USUARIO_A.id);
    expect(mocks.miPerfil).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(['misma-sesion'])).toBe('conservar');
    expect(screen.getByLabelText('Nota de trasplante')).toBe(nota);
  });

  it('recarga el perfil cuando llega un usuario distinto', async () => {
    montar();
    await screen.findByLabelText('Nota de trasplante');
    mocks.miPerfil.mockResolvedValueOnce({ id: USUARIO_B.id, nombre: 'Usuario B', rol: 'operario', puede_ver_linaje: false });

    emitir('SIGNED_IN', USUARIO_B);

    await waitFor(() => expect(screen.getByTestId('usuario-activo')).toHaveTextContent(USUARIO_B.id));
    expect(mocks.miPerfil).toHaveBeenCalledTimes(2);
  });

  it('cierra la UI y redirige a login cuando llega SIGNED_OUT, sin borrar borradores (U-01)', async () => {
    const queryClient = montar();
    await screen.findByLabelText('Nota de trasplante');
    queryClient.setQueryData(['privado', 'usuario-a'], { linaje: 'sensible' });
    localStorage.setItem('borrador:usuario:usuario-a:evaluacion:r1', '{"valor":{}}');
    localStorage.setItem('preferencia:vista', 'tarjetas');

    emitir('SIGNED_OUT', null);

    await screen.findByText('LOGIN');
    expect(screen.queryByLabelText('Nota de trasplante')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['privado', 'usuario-a'])).toBeUndefined();
    expect(localStorage.getItem('borrador:usuario:usuario-a:evaluacion:r1')).toBe('{"valor":{}}');
    expect(localStorage.getItem('preferencia:vista')).toBe('tarjetas');
  });
});


it('cambio directo A→B limpia caché y perfil antes de exponer B, incluso si su perfil tarda', async () => {
  const qc = montar();
  await screen.findByLabelText('Nota de trasplante');
  qc.setQueryData(['privado'], { dato: 'solo-a' });
  const perfilB = diferido<{ id: string; rol: string }>();
  mocks.miPerfil.mockReturnValueOnce(perfilB.promise);
  estados.length = 0;
  act(() => emitir('SIGNED_IN', USUARIO_B));
  expect(qc.getQueryData(['privado'])).toBeUndefined();
  expect(screen.queryByLabelText('Nota de trasplante')).not.toBeInTheDocument();
  expect(estados.filter((s) => s.user === USUARIO_B.id).every((s) => s.perfil === null && s.cargando)).toBe(true);
  await act(async () => perfilB.resolve({ id: USUARIO_B.id, rol: 'operario' }));
  expect(await screen.findByTestId('usuario-activo')).toHaveTextContent(USUARIO_B.id);
});

it('ignora getSession tardío cuando ya llegó un evento de autenticación', async () => {
  const inicial = diferido<{ data: { session: { user: User } } }>();
  mocks.getSession.mockReturnValueOnce(inicial.promise);
  mocks.miPerfil.mockResolvedValue({ id: USUARIO_B.id, rol: 'operario' });
  montar();
  act(() => emitir('SIGNED_IN', USUARIO_B));
  await screen.findByLabelText('Nota de trasplante');
  await act(async () => inicial.resolve({ data: { session: { user: USUARIO_A } } }));
  expect(screen.getByTestId('usuario-activo')).toHaveTextContent(USUARIO_B.id);
  expect(mocks.miPerfil).toHaveBeenCalledTimes(1);
});

it('ignora respuestas de perfiles antiguos en la secuencia A→B→A', async () => {
  const a1 = diferido<{ id: string; nombre: string }>();
  const b = diferido<{ id: string; nombre: string }>();
  const a2 = diferido<{ id: string; nombre: string }>();
  mocks.miPerfil.mockReturnValueOnce(a1.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(a2.promise);
  montar();
  await waitFor(() => expect(mocks.miPerfil).toHaveBeenCalledTimes(1));
  act(() => emitir('SIGNED_IN', USUARIO_B));
  await waitFor(() => expect(mocks.miPerfil).toHaveBeenCalledTimes(2));
  act(() => emitir('SIGNED_IN', USUARIO_A));
  await waitFor(() => expect(mocks.miPerfil).toHaveBeenCalledTimes(3));
  await act(async () => { a1.resolve({id: USUARIO_A.id, nombre:'Viejo'}); b.resolve({id: USUARIO_B.id, nombre:'B'}); });
  expect(screen.queryByLabelText('Nota de trasplante')).not.toBeInTheDocument();
  expect(estados.at(-1)).toMatchObject({user:USUARIO_A.id, perfil:null, cargando:true});
  await act(async () => a2.resolve({id: USUARIO_A.id, nombre:'Actual'}));
  expect(await screen.findByTestId('usuario-activo')).toHaveTextContent(USUARIO_A.id);
});

it('SIGNED_OUT cierra la UI aunque Storage falle y cancela autosave pendiente', async () => {
  const qc = montar();
  const nota = await screen.findByLabelText('Nota de trasplante');
  localStorage.setItem('borrador:legado', '{}');
  const guardar = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage bloqueado'); });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage bloqueado'); });
  vi.useFakeTimers();
  fireEvent.change(nota, {target:{value:'pendiente'}});
  act(() => emitir('SIGNED_OUT', null));
  expect(screen.getByText('LOGIN')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(2000));
  // El único intento de escritura es el aviso de sesión expirada (sessionStorage), nunca el autosave.
  expect(guardar.mock.calls.filter(([clave]) => String(clave).startsWith('borrador:'))).toHaveLength(0);
  expect(estados.at(-1)).toEqual({ user:null, perfil:null, cargando:false });
  expect(qc.getQueryCache().getAll()).toHaveLength(0);
});

it('recarga perfil al volver al mismo objeto A dentro del mismo batch A→B→A', async () => {
  montar();
  await screen.findByLabelText('Nota de trasplante');
  const perfilActual = diferido<{ id: string; nombre: string }>();
  mocks.miPerfil.mockReturnValueOnce(perfilActual.promise);
  act(() => {
    emitir('SIGNED_IN', USUARIO_B);
    emitir('SIGNED_IN', USUARIO_A);
  });
  expect(screen.queryByLabelText('Nota de trasplante')).not.toBeInTheDocument();
  await waitFor(() => expect(mocks.miPerfil).toHaveBeenCalledTimes(2));
  await act(async () => perfilActual.resolve({ id: USUARIO_A.id, nombre: 'Actual' }));
  expect(await screen.findByTestId('usuario-activo')).toHaveTextContent(USUARIO_A.id);
  expect(estados.at(-1)).toEqual({ user: USUARIO_A.id, perfil: USUARIO_A.id, cargando: false });
});

it('las capturas de vigencia distinguen generaciones ABA y sobreviven eventos de la misma cuenta', async () => {
  montar();
  await screen.findByLabelText('Nota de trasplante');
  const getter = capturarActual;
  const antigua = getter();
  act(() => emitir('TOKEN_REFRESHED', {...USUARIO_A}));
  expect(antigua()).toBe(true);
  expect(capturarActual).toBe(getter);
  act(() => { emitir('SIGNED_IN', USUARIO_B); emitir('SIGNED_IN', USUARIO_A); });
  expect(antigua()).toBe(false);
  await screen.findByLabelText('Nota de trasplante');
  const nueva = capturarActual();
  expect(nueva()).toBe(true);
  act(() => emitir('SIGNED_OUT', null));
  expect(nueva()).toBe(false);
});

function EstadoPerfil() {
  const { perfil, errorPerfil, reintentarPerfil } = useAuth();
  return (
    <>
      <output data-testid="perfil-rol">{perfil?.rol ?? 'sin-perfil'}</output>
      {errorPerfil && <p role="alert">{errorPerfil}</p>}
      <button type="button" onClick={reintentarPerfil}>Reintentar perfil</button>
    </>
  );
}

it('si falla la carga del perfil lo avisa sin cerrar sesión y permite reintentar', async () => {
  mocks.miPerfil
    .mockRejectedValueOnce(new Error('fallo de red'))
    .mockResolvedValueOnce({ id: USUARIO_A.id, nombre: 'Usuario A', rol: 'admin', puede_ver_linaje: true });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider><EstadoPerfil /></AuthProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar tu perfil');
  expect(screen.getByRole('alert')).not.toHaveTextContent('fallo de red');
  expect(screen.getByTestId('perfil-rol')).toHaveTextContent('sin-perfil');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar perfil' }));
  await waitFor(() => expect(screen.getByTestId('perfil-rol')).toHaveTextContent('admin'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mocks.miPerfil).toHaveBeenCalledTimes(2);
});
