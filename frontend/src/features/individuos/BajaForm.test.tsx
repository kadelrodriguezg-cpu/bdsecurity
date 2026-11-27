import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { marcarBaja } = vi.hoisted(() => ({ marcarBaja: vi.fn(async () => undefined) }));

vi.mock('@/api/individuos', () => ({
  marcarBaja,
  CRITERIO_BAJA_LABEL: { vigor_bajo: 'Vigor bajo' },
}));

import { BajaForm } from './BajaForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BajaForm — sincronización', () => {
  it('invalida dashboard y ranking después de registrar la baja', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <BajaForm individuoId="ind-1" plantaId="planta-1" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /marcar baja/i }));

    await waitFor(() => expect(marcarBaja).toHaveBeenCalledTimes(1));
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['ranking'] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['dashboard-cientifico'] });
  });
});
