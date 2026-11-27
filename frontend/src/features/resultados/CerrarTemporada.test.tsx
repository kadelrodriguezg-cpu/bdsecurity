/** Fase 4: «Cerrar temporada y congelar ranking» (solo admin): sin temporada elegida no se puede cerrar. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CerrarTemporada } from './CerrarTemporada';

const m = vi.hoisted(() => ({ anio: vi.fn(), cerrar: vi.fn(), lista: vi.fn() }));
vi.mock('@/api/rankingGrupos', async (original) => ({ ...(await original<typeof import('@/api/rankingGrupos')>()), obtenerAnioTemporada: m.anio, cerrarTemporada: m.cerrar }));
vi.mock('@/api/snapshots', () => ({ listarSnapshotsRanking: m.lista }));

beforeEach(() => {
  m.anio.mockResolvedValue(2026);
  m.cerrar.mockResolvedValue({ snapshot_id: 's-nuevo', nombre: 'Cierre temporada 2026', poblacion: 12 });
  m.lista.mockResolvedValue({ items: [{ id: 's-viejo', nombre: 'Cierre temporada 2026' }] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const montar = (numeroRonda: number | null, onCongelado = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CerrarTemporada especieId="esp" especieNombre="Arándano" numeroRonda={numeroRonda} onCongelado={onCongelado} /></QueryClientProvider>);
  return onCongelado;
};

it('sin temporada elegida no se puede cerrar', () => {
  montar(null);
  expect(screen.getByRole('button', { name: /Cerrar temporada y congelar ranking/ })).toBeDisabled();
});

// Fase 5 (G2): la confirmación con el nombre sugerido y editable, y el aviso de nombre repetido, están en CerrarTemporadaFase5.test.tsx.
