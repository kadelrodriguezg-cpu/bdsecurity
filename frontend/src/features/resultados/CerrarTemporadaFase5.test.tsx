/** Fase 5, hallazgo 2 (G2): el cierre sugiere «Temporada AAAA-AAAA+1», el admin puede editar el nombre y, si ya existe, se avisa. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CerrarTemporada } from './CerrarTemporada';

const m = vi.hoisted(() => ({ sugerida: vi.fn(), cerrar: vi.fn(), lista: vi.fn() }));
vi.mock('@/api/rankingGrupos', async (original) => ({ ...(await original<typeof import('@/api/rankingGrupos')>()), obtenerTemporadaSugerida: m.sugerida, cerrarTemporada: m.cerrar }));
vi.mock('@/api/snapshots', () => ({ listarSnapshotsRanking: m.lista }));

beforeEach(() => {
  m.sugerida.mockResolvedValue('2025-2026');
  m.cerrar.mockImplementation(async (_e: string, _n: number, nombre: string) => ({ snapshot_id: 's-nuevo', nombre, poblacion: 12 }));
  m.lista.mockResolvedValue({ items: [{ id: 's-viejo', nombre: 'Temporada 2025-2026' }] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const montar = (onCongelado = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CerrarTemporada especieId="esp" especieNombre="Arándano" numeroRonda={1} onCongelado={onCongelado} /></QueryClientProvider>);
  return onCongelado;
};

it('sugiere «Temporada 2025-2026» en un campo editable y envía el nombre escrito', async () => {
  const onCongelado = montar();
  fireEvent.click(screen.getByRole('button', { name: /Cerrar temporada y congelar ranking/ }));
  const hoja = await screen.findByRole('dialog', { name: '¿Cerrar la temporada 2025-2026 de Arándano?' });
  const campo = await within(hoja).findByLabelText('Nombre del ranking congelado');
  expect(campo).toHaveValue('Temporada 2025-2026');
  fireEvent.change(campo, { target: { value: 'Temporada 2025-2026 · cierre definitivo' } });
  fireEvent.click(within(hoja).getByRole('button', { name: 'Cerrar temporada' }));
  await waitFor(() => expect(m.cerrar).toHaveBeenCalledWith('esp', 1, 'Temporada 2025-2026 · cierre definitivo'));
  expect(onCongelado).toHaveBeenCalledWith('s-nuevo');
});

it('con el nombre vacío no se puede confirmar', async () => {
  montar();
  fireEvent.click(screen.getByRole('button', { name: /Cerrar temporada y congelar ranking/ }));
  const hoja = await screen.findByRole('dialog');
  fireEvent.change(await within(hoja).findByLabelText('Nombre del ranking congelado'), { target: { value: '   ' } });
  expect(within(hoja).getByRole('button', { name: 'Cerrar temporada' })).toBeDisabled();
});

it('si ya existe ese nombre en la especie, avisa y ofrece abrirlo', async () => {
  const { CierreYaExiste } = await import('@/api/rankingGrupos');
  m.cerrar.mockRejectedValue(new CierreYaExiste('Ya existe'));
  const onCongelado = montar();
  fireEvent.click(screen.getByRole('button', { name: /Cerrar temporada y congelar ranking/ }));
  const hoja = await screen.findByRole('dialog');
  const nombre = await within(hoja).findByLabelText('Nombre del ranking congelado');
  // Con toda la suite corriendo, el nombre sugerido puede tardar: se espera a que esté antes de cerrar.
  await waitFor(() => expect(nombre).toHaveValue('Temporada 2025-2026'), { timeout: 5000 });
  fireEvent.click(within(hoja).getByRole('button', { name: 'Cerrar temporada' }));
  expect(await within(hoja).findByText('Ya existe «Temporada 2025-2026» en Arándano. No se creó otro.', undefined, { timeout: 5000 })).toBeInTheDocument();
  fireEvent.click(within(hoja).getByRole('button', { name: 'Ver ese ranking' }));
  await waitFor(() => expect(onCongelado).toHaveBeenCalledWith('s-viejo'));
});
