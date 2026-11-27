import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ previsualizar: vi.fn(), darBaja: vi.fn() }));

vi.mock('@/api/individuos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/individuos')>()),
  previsualizarBajaEnLote: api.previsualizar,
  darBajaEnLote: api.darBaja,
}));

import { RevisionBajaLote } from './RevisionBajaLote';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PREVIEW = {
  limite: 500,
  procesables: [
    { id: 'i1', codigo_display: 'X-P1', planta_id: 'p1' },
    { id: 'i2', codigo_display: 'X-P2', planta_id: 'p1' },
  ],
  excluidos: [{ id: 'i3', codigo_display: 'X-P3', motivo: 'ya_de_baja' }],
};

function renderRevision(onConfirmado = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidar = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <RevisionBajaLote abierto onCerrar={vi.fn()} ids={['i1', 'i2', 'i3']} onConfirmado={onConfirmado} />
    </QueryClientProvider>,
  );
  return { invalidar, onConfirmado };
}

describe('RevisionBajaLote', () => {
  it('lista los que se procesarán y los excluidos con su motivo, y avisa que no se puede deshacer', async () => {
    api.previsualizar.mockResolvedValue(PREVIEW);
    renderRevision();
    expect(await screen.findByText('Se darán de baja 2 individuo(s)')).toBeInTheDocument();
    expect(api.previsualizar).toHaveBeenCalledWith(['i1', 'i2', 'i3']);
    expect(screen.getByRole('list', { name: 'Individuos que se procesarán' })).toHaveTextContent('X-P1X-P2');
    expect(screen.getByRole('list', { name: 'Individuos excluidos' })).toHaveTextContent('X-P3: Ya está de baja');
    expect(screen.getByText(/no se puede deshacer/i)).toBeInTheDocument();
  });

  it('exige criterio y escribir la cantidad; envía solo los procesables e invalida las consultas afectadas', async () => {
    api.previsualizar.mockResolvedValue(PREVIEW);
    api.darBaja.mockResolvedValue({ procesados: 2, repetido: false });
    const { invalidar, onConfirmado } = renderRevision();
    const confirmar = await screen.findByRole('button', { name: 'Dar de baja 2 individuo(s)' });
    expect(confirmar).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Vigor' }));
    fireEvent.change(screen.getByLabelText(/escribe la cantidad de individuos/i), { target: { value: '3' } });
    expect(confirmar).toBeDisabled(); // cantidad equivocada
    fireEvent.change(screen.getByLabelText(/escribe la cantidad de individuos/i), { target: { value: '2' } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() => expect(onConfirmado).toHaveBeenCalledWith(2));
    expect(api.darBaja).toHaveBeenCalledWith(
      expect.objectContaining({ ids: ['i1', 'i2'], estado_vital: 'descartado', criterios: ['vigor'] }),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    for (const queryKey of [['individuos'], ['plantas'], ['resumen-final'], ['planta', 'p1'], ['ranking'], ['baja-motivos', 'i1']]) {
      expect(invalidar).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('si la selección supera el tope, no deja confirmar', async () => {
    api.previsualizar.mockResolvedValue({ ...PREVIEW, limite: 1, excluidos: [] });
    renderRevision();
    expect(await screen.findByText(/el máximo por lote es 1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dar de baja 2/i })).not.toBeInTheDocument();
  });
});
