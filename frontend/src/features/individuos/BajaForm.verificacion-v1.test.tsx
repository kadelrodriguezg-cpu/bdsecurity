/**
 * Verificación independiente (Fase 2, Corrida 1) de A1-G4-20. Describe el comportamiento ACTUAL de
 * BajaForm: sin advertencia de irreversibilidad ni confirmación; un clic en «Marcar baja» llama
 * directo a la RPC. Si estas pruebas dejan de pasar, el hallazgo se corrigió.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { marcarBaja } = vi.hoisted(() => ({
  marcarBaja: vi.fn(async (_input: { individuo_id: string; estado_vital: string; criterios: string[] }) => undefined),
}));
vi.mock('@/api/individuos', () => ({
  marcarBaja,
  CRITERIO_BAJA_LABEL: { vigor: 'Vigor', sanidad: 'Sanidad' },
}));

import { BajaForm } from './BajaForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function montar() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BajaForm individuoId="ind-1" plantaId="planta-1" />
    </QueryClientProvider>,
  );
}

describe('A1-G4-20 BajaForm (estado actual verificado)', () => {
  it('no muestra ninguna advertencia de que la baja no se puede deshacer', () => {
    const { container } = montar();
    expect(container.textContent ?? '').not.toMatch(/deshacer|permanente|irreversible|definitiv|para siempre/i);
  });

  it('elegir un criterio y pulsar «Marcar baja» llama una sola vez a la RPC, sin paso de confirmación', async () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Vigor' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /marcar baja/i }));
    await waitFor(() => expect(marcarBaja).toHaveBeenCalledTimes(1));
    expect(marcarBaja.mock.calls[0][0]).toMatchObject({ individuo_id: 'ind-1', estado_vital: 'descartado', criterios: ['vigor'] });
    expect(screen.getByText('Baja registrada.')).toBeInTheDocument();
  });

  it('el cliente no valida el criterio: lo hace solo el servidor (22023)', async () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /marcar baja/i }));
    await waitFor(() => expect(marcarBaja).toHaveBeenCalledTimes(1));
    expect(marcarBaja.mock.calls[0]?.[0].criterios).toEqual([]);
  });
});
