import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorApi } from '@/api/client';

const mocks = vi.hoisted(() => ({ resolver: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/api/individuos', () => ({ resolverIndividuo: mocks.resolver }));

import { IndividuoDestinoPage } from './IndividuoDestinoPage';

const IND = '11111111-2222-3333-4444-555555555555';
const CRUCE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

afterEach(cleanup);
beforeEach(() => {
  mocks.resolver.mockReset();
});

function Ficha() {
  const l = useLocation();
  return <output data-testid="ficha">{l.pathname}{l.search}|{(l.state as { volverA?: string } | null)?.volverA ?? 'sin volverA'}</output>;
}

function montar(id = IND, state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: `/individuo/${id}`, state }]}>
        <Routes>
          <Route path="/individuo/:id" element={<IndividuoDestinoPage />} />
          <Route path="/planta/:id" element={<Ficha />} />
          <Route path="*" element={<output data-testid="otro">otra ruta</output>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IndividuoDestinoPage (/individuo/:id)', () => {
  it('resuelve el individuo y abre la ficha de su cruce posicionada en él, reemplazando la entrada del historial', async () => {
    mocks.resolver.mockResolvedValue({ id: IND, planta_id: CRUCE, codigo_display: '02-001-P7', estado_vital: 'vivo' });
    montar();
    expect(await screen.findByTestId('ficha')).toHaveTextContent(`/planta/${CRUCE}?individuo=${IND}|sin volverA`);
    expect(mocks.resolver).toHaveBeenCalledWith(IND);
  });

  it('normaliza el UUID a minúsculas antes de consultar', async () => {
    mocks.resolver.mockResolvedValue({ id: IND, planta_id: CRUCE, codigo_display: 'x', estado_vital: 'vivo' });
    montar(IND.toUpperCase());
    await screen.findByTestId('ficha');
    expect(mocks.resolver).toHaveBeenCalledWith(IND);
  });

  it('un individuo dado de baja también se abre (la lectura nunca se bloquea)', async () => {
    mocks.resolver.mockResolvedValue({ id: IND, planta_id: CRUCE, codigo_display: '02-001-P7', estado_vital: 'muerto' });
    montar();
    expect(await screen.findByTestId('ficha')).toHaveTextContent(`?individuo=${IND}`);
  });

  it('conserva un volverA interno recibido y descarta uno externo', async () => {
    mocks.resolver.mockResolvedValue({ id: IND, planta_id: CRUCE, codigo_display: 'x', estado_vital: 'vivo' });
    const { unmount } = montar(IND, { volverA: '/escanear' });
    expect(await screen.findByTestId('ficha')).toHaveTextContent('|/escanear');
    unmount();
    montar(IND, { volverA: 'https://malicioso.example/robo' });
    expect(await screen.findByTestId('ficha')).toHaveTextContent('|/plantas');
  });

  it('individuo inexistente: mensaje claro y enlace para escanear otro, sin navegar', async () => {
    mocks.resolver.mockResolvedValue(null);
    montar();
    expect(await screen.findByRole('heading', { name: 'Individuo no encontrado' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Escanear otra etiqueta' })).toHaveAttribute('href', '/escanear');
    expect(screen.queryByTestId('ficha')).not.toBeInTheDocument();
  });

  it('UUID inválido: no consulta nada', () => {
    montar('no-es-un-uuid');
    expect(screen.getByRole('heading', { name: 'Código no válido' })).toBeInTheDocument();
    expect(mocks.resolver).not.toHaveBeenCalled();
  });

  it.each([
    ['sin_permiso', 'No tienes permiso para ver este individuo', false],
    ['sin_sesion', 'Vuelve a iniciar sesión', false],
    ['red', 'No se pudo conectar', true],
    ['desconocido', 'No se pudo abrir el individuo', true],
  ] as const)('error %s: mensaje seguro (sin datos crudos)', async (tipo, titulo, reintentable) => {
    mocks.resolver.mockRejectedValue(new ErrorApi('detalle interno del servidor', tipo));
    montar();
    expect(await screen.findByRole('heading', { name: titulo })).toBeInTheDocument();
    expect(screen.queryByText(/detalle interno/)).not.toBeInTheDocument();
    expect(!!screen.queryByRole('button', { name: 'Reintentar' })).toBe(reintentable);
  });

  it('sin sesión ofrece iniciar sesión conservando este destino', async () => {
    mocks.resolver.mockRejectedValue(new ErrorApi('x', 'sin_sesion'));
    montar();
    const enlace = await screen.findByRole('link', { name: 'Iniciar sesión' });
    expect(decodeURIComponent(enlace.getAttribute('href') ?? '')).toContain(`/individuo/${IND}`);
  });

  it('permite reintentar tras una falla de red', async () => {
    mocks.resolver.mockRejectedValueOnce(new ErrorApi('x', 'red'));
    montar();
    const reintentar = await screen.findByRole('button', { name: 'Reintentar' });
    mocks.resolver.mockResolvedValue({ id: IND, planta_id: CRUCE, codigo_display: 'x', estado_vital: 'vivo' });
    fireEvent.click(reintentar);
    await waitFor(() => expect(screen.getByTestId('ficha')).toHaveTextContent(`?individuo=${IND}`));
  });
});
