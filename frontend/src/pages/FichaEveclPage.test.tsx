import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { FichaEveclPage } from './FichaEveclPage';

const mocks = vi.hoisted(() => ({ ficha: vi.fn(), catalogo: vi.fn() }));
vi.mock('@/api/evecl', () => ({ obtenerFichaEvecl: mocks.ficha, obtenerCatalogoEvecl: mocks.catalogo, obtenerUrlFirmadaFotoEvecl: vi.fn() }));

afterEach(cleanup);

describe('FichaEveclPage con el contrato v3', () => {
  it('escribe las fechas en dd-mm-aaaa, nunca aaaa-mm-dd, y usa el encabezado del contrato', async () => {
    mocks.ficha.mockResolvedValue({
      id: 7, ensayo_id: 1, ensayo: { codigo_parcela: 'P-01' }, variedad: 'Duke', tipo: 'evaluacion', numero_repeticion: 1,
      codigo_planta: 'D-01', codigo_genotipo: null, origen_cruza: null, encargado: null, notas: null,
      fecha_evaluacion: '2026-08-11', fecha_siembra: '2025-03-02', respuestas: [],
    });
    mocks.catalogo.mockResolvedValue([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/evecl/fichas/7']}><Routes><Route path="/evecl/fichas/:id" element={<FichaEveclPage />} /></Routes></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Duke' })).toBeInTheDocument();
    expect(screen.getByText('11-08-2026')).toBeInTheDocument();
    expect(screen.getByText('02-03-2025')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
