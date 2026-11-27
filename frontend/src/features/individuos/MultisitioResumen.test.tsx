/** N23: el historial territorial muestra las fechas `dd-mm-aaaa`, nunca ISO crudo. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/emplazamientos', () => ({
  listarEmplazamientos: vi.fn(async () => [
    { id: 'e2', individuo_id: 'i1', sector_id: 's2', sitio_nombre: 'Sitio B', predio_nombre: 'Predio 2', sector_nombre: 'Sector 7', fecha_inicio: '2026-09-15', fecha_fin: null },
    { id: 'e1', individuo_id: 'i1', sector_id: 's1', sitio_nombre: 'Sitio A', predio_nombre: 'Predio 1', sector_nombre: 'Sector 1', fecha_inicio: '2026-01-05', fecha_fin: '2026-09-14' },
  ]),
}));

import { MultisitioResumen } from './MultisitioResumen';

afterEach(cleanup);

describe('MultisitioResumen', () => {
  it('escribe las fechas de cada emplazamiento como dd-mm-aaaa y «actual» si no hay fin', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MultisitioResumen individuoId="i1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('15-09-2026 — actual')).toBeInTheDocument();
    expect(screen.getByText('05-01-2026 — 14-09-2026')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });
});
