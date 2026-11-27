import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EspacioEspecieLayout, useCambioAutomaticoEspecie, useEspacioEspecie } from './EspacioEspecie';

const ARANDANO = { id: '11111111-1111-4111-8111-111111111111', nombre: 'Arándano', nombre_cientifico: null };
const FRUTILLA = { id: '22222222-2222-4222-8222-222222222222', nombre: 'Frutilla', nombre_cientifico: null };
const MORA = { id: '33333333-3333-4333-8333-333333333333', nombre: 'Mora', nombre_cientifico: null };
const panorama = (id: string, nombre: string, cruces: number, activos: number) => ({
  id, nombre, cruces, cruces_activos: activos, individuos_vivos: 0, sin_evaluacion_cerrada: 0, evaluaciones_cerradas: 0,
  cruces_con_pendientes: 0, cruces_por_fase: {}, fases_con_pendientes: {}, ultima_actividad: null, ultima_actividad_por: null,
});

const m = vi.hoisted(() => ({ especies: vi.fn(), panorama: vi.fn(), usuario: 'u1' }));
vi.mock('@/api/especies', () => ({ listarEspecies: m.especies, obtenerPanoramaEspecies: m.panorama }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: m.usuario }, esAdmin: false }) }));

beforeEach(() => {
  window.localStorage.clear();
  m.especies.mockResolvedValue([ARANDANO, FRUTILLA, MORA]);
  m.panorama.mockResolvedValue([panorama(ARANDANO.id, 'Arándano', 18, 15), panorama(FRUTILLA.id, 'Frutilla', 4, 3), panorama(MORA.id, 'Mora', 0, 0)]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function Sonda() {
  const { activa, listo, cambiar } = useEspacioEspecie();
  const { pathname, search } = useLocation();
  return (
    <>
      <p data-testid="activa">{listo ? (activa?.nombre ?? 'Todas') : '…'}</p>
      <p data-testid="url">{`${pathname}${search}`}</p>
      <button type="button" onClick={() => cambiar(FRUTILLA.id)}>Frutilla</button>
      <button type="button" onClick={() => cambiar(null)}>Todas</button>
    </>
  );
}

function FichaDeFrutilla() {
  useCambioAutomaticoEspecie(FRUTILLA.id);
  return <Sonda />;
}

const montar = (ruta: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route element={<EspacioEspecieLayout />}>
          <Route path="/" element={<Sonda />} />
          <Route path="/plantas" element={<Sonda />} />
          <Route path="/perfil" element={<Sonda />} />
          <Route path="/planta/:id" element={<FichaDeFrutilla />} />
        </Route>
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);

it('sin URL ni memoria entra en la especie con más cruces activos y la escribe en la URL con su nombre', async () => {
  montar('/');
  await waitFor(() => expect(screen.getByTestId('activa')).toHaveTextContent('Arándano'));
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/?especie=arandano'));
});

it('un enlace compartido abre el mismo contexto (la URL manda) y se recuerda', async () => {
  window.localStorage.setItem('bds:especie:u1', ARANDANO.id);
  montar('/plantas?especie=frutilla&etapa=crecimiento');
  await waitFor(() => expect(screen.getByTestId('activa')).toHaveTextContent('Frutilla'));
  expect(screen.getByTestId('url')).toHaveTextContent('/plantas?especie=frutilla&etapa=crecimiento');
  await waitFor(() => expect(window.localStorage.getItem('bds:especie:u1')).toBe(FRUTILLA.id));
});

it('los enlaces viejos con el id de la especie siguen funcionando y pasan al nombre', async () => {
  montar(`/plantas?especie=${MORA.id}`);
  await waitFor(() => expect(screen.getByTestId('activa')).toHaveTextContent('Mora'));
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/plantas?especie=mora'));
});

it('«todas» es el panorama', async () => {
  montar('/?especie=todas');
  await waitFor(() => expect(screen.getByTestId('activa')).toHaveTextContent('Todas'));
});

it('se recuerda la última especie por usuario y equipo (también donde la URL no la lleva)', async () => {
  window.localStorage.setItem('bds:especie:u1', FRUTILLA.id);
  window.localStorage.setItem('bds:especie:otro', MORA.id);
  montar('/perfil');
  await waitFor(() => expect(screen.getByTestId('activa')).toHaveTextContent('Frutilla'));
  expect(screen.getByTestId('url')).toHaveTextContent('/perfil');
});

it('cambiar de especie no arrastra los filtros de la otra y se recuerda', async () => {
  montar('/plantas?especie=arandano&etapa=crecimiento&pagina=2');
  await waitFor(() => expect(screen.getByTestId('activa')).toHaveTextContent('Arándano'));
  fireEvent.click(screen.getByRole('button', { name: 'Frutilla' }));
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/plantas\?especie=frutilla$/));
  expect(screen.getByTestId('activa')).toHaveTextContent('Frutilla');
  expect(window.localStorage.getItem('bds:especie:u1')).toBe(FRUTILLA.id);
  fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/plantas\?especie=todas$/));
  expect(window.localStorage.getItem('bds:especie:u1')).toBe('todas');
});

it('al abrir un cruce de otra especie el espacio cambia solo, se avisa y no se sale de la ficha', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.localStorage.setItem('bds:especie:u1', ARANDANO.id);
  montar('/planta/abc');
  await waitFor(() => expect(screen.getByTestId('activa')).toHaveTextContent('Frutilla'));
  expect(screen.getByRole('status')).toHaveTextContent('Ahora estás en Frutilla');
  expect(screen.getByTestId('url')).toHaveTextContent('/planta/abc');
  expect(window.localStorage.getItem('bds:especie:u1')).toBe(FRUTILLA.id);
  act(() => { vi.advanceTimersByTime(5100); });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  vi.useRealTimers();
});

it('una especie recordada que ya no existe se vuelve a elegir', async () => {
  window.localStorage.setItem('bds:especie:u1', '99999999-9999-4999-8999-999999999999');
  montar('/perfil');
  await waitFor(() => expect(screen.getByTestId('activa')).toHaveTextContent('Arándano'));
});
