import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CruceAdmin } from '@/api/cruzamientosAdmin';
import { MemoryRouter } from 'react-router';
import { CruzamientosAdminPage, PanelBorrar, PanelRestaurar } from './CruzamientosAdminPage';

const { borrarCruzamiento, listarTodosLosCruces, restaurarCruzamiento } = vi.hoisted(() => ({
  borrarCruzamiento: vi.fn(async () => undefined),
  listarTodosLosCruces: vi.fn<() => Promise<CruceAdmin[]>>(async () => []),
  restaurarCruzamiento: vi.fn(async () => ({
    planta_id: 'cruce-1',
    codigo_sistema: '02-001',
    eliminado_at_anterior: '2026-07-01T00:00:00Z',
    n_individuos: 3,
    n_evaluaciones: 5,
    n_emplazamientos: 2,
    restaurado_at: '2026-07-17T00:00:00Z',
  })),
}));

vi.mock('@/api/cruzamientosAdmin', () => ({
  restaurarCruzamiento,
  listarTodosLosCruces,
  reiniciarCruzamiento: vi.fn(),
  borrarCruzamiento,
  resumenParaBorrado: vi.fn(),
}));

afterEach(cleanup);

describe('PanelRestaurar', () => {
  it('restaura desde administración y muestra que las relaciones se conservaron', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PanelRestaurar cruce={{ id: 'cruce-1', codigo_sistema: '02-001', estado: 'cosecha', eliminado_at: '2026-07-01T00:00:00Z', es_prueba: false }} onCerrar={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirmar restauración/i }));
    expect(await screen.findByText(/fue restaurado sin alterar sus relaciones/i)).toBeInTheDocument();
    expect(screen.getByText(/3 individuos, 5 evaluaciones y 2 emplazamientos/i)).toBeInTheDocument();
    expect(restaurarCruzamiento).toHaveBeenCalledWith('cruce-1');
  });
});

describe('PanelBorrar', () => {
  it('invalida el ranking al archivar un cruce', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <PanelBorrar cruce={{ id: 'cruce-1', codigo_sistema: '02-001', estado: 'cosecha', eliminado_at: null, es_prueba: false }} onCerrar={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /archivar \(recuperable\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar archivo/i }));

    await waitFor(() => expect(borrarCruzamiento).toHaveBeenCalledWith('cruce-1', 'soft'));
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['ranking'] });
  });
});

describe('CruzamientosAdminPage', () => {
  it('no expone acciones destructivas hasta seleccionar un cruce', async () => {
    listarTodosLosCruces.mockResolvedValueOnce([
      { id: 'cruce-1', codigo_sistema: '02-001', estado: 'cosecha', eliminado_at: null, es_prueba: false },
      { id: 'cruce-2', codigo_sistema: '02-002', estado: 'trasplante', eliminado_at: null, es_prueba: false },
    ]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><CruzamientosAdminPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/selecciona un cruce para ver sus acciones/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reiniciar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /02-001/i }));
    expect(screen.getByRole('button', { name: 'Reiniciar' })).toBeInTheDocument();
  });

  it('v3: «Nuevo cruce» abre el único formulario de alta y la ficha llega con el cruce ya elegido (?cruce=)', async () => {
    listarTodosLosCruces.mockResolvedValueOnce([
      { id: 'cruce-1', codigo_sistema: '02-001', estado: 'cosecha', eliminado_at: null, es_prueba: false },
      { id: 'cruce-2', codigo_sistema: '02-002', estado: 'trasplante', eliminado_at: null, es_prueba: true },
    ]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/cruzamientos?cruce=cruce-2']}><CruzamientosAdminPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Administrar cruces' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Nuevo cruce/ })).toHaveAttribute('href', '/nueva-planta');
    expect(await screen.findByRole('button', { name: 'Reiniciar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /02-002/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /02-001/ })).not.toBeInTheDocument();
  });
});
