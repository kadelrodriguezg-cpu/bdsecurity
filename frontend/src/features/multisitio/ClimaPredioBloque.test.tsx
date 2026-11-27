import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ClimaPredioBloque } from './ClimaPredioBloque';
import { obtenerClimaPredio } from '@/api/emplazamientos';
import { qk } from '@/lib/queryKeys';
vi.mock('@/api/emplazamientos', () => ({ obtenerClimaPredio: vi.fn(async () => ({ predios: [] })) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('al reducir predios mantiene selección, panel e IDs coherentes sin activar con flechas', async () => {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const predios = [1, 2, 3].map((n) => ({ predio_id: String(n), predio_nombre: 'Predio ' + n, tiene_coordenada: false, sincronizando: false, meses: [] }));
  cliente.setQueryData(qk.territorio.climaCruce('p1'), { predios });
  render(<QueryClientProvider client={cliente}><ClimaPredioBloque plantaId="p1" /></QueryClientProvider>);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Predio 1' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Predio 1' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Predio 3' }));
  act(() => cliente.setQueryData(qk.territorio.climaCruce('p1'), { predios: predios.slice(0, 2) }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Predio 2' })).toHaveAttribute('aria-selected', 'true'));
  for (const tab of screen.getAllByRole('tab')) {
    const panel = document.getElementById(tab.getAttribute('aria-controls')!);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  }
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Predio 2');
});

it('un error de actualización conserva el mismo panel y predio seleccionado', async () => {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const predios = [1, 2].map((n) => ({ predio_id: String(n), predio_nombre: 'Predio ' + n, tiene_coordenada: false, sincronizando: false, meses: [] }));
  cliente.setQueryData(qk.territorio.climaCruce('p1'), { predios });
  vi.mocked(obtenerClimaPredio).mockRejectedValueOnce(new Error('datos internos'));
  render(<QueryClientProvider client={cliente}><ClimaPredioBloque plantaId="p1" /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('tab', { name: 'Predio 2' }));
  const panel = screen.getByRole('tabpanel');
  await act(async () => { await cliente.invalidateQueries({ queryKey: qk.territorio.climaCruce('p1') }); });
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo actualizar');
  expect(screen.getByRole('tabpanel')).toBe(panel);
  expect(screen.getByRole('tab', { name: 'Predio 2' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByText('datos internos')).not.toBeInTheDocument();
});
