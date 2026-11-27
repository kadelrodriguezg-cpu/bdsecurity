/**
 * Avanzar de fase (solo admin, U-03). El retroceso con motivo de la fase 5 (G1) se prueba en AvanzarEstadoFase5.test.tsx.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockListarIndividuos, mockActualizarEstado, sesion } = vi.hoisted(() => ({
  mockListarIndividuos: vi.fn(),
  mockActualizarEstado: vi.fn(async () => undefined),
  sesion: { esAdmin: true },
}));

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: sesion.esAdmin }) }));

vi.mock('@/api/plantas', () => ({ actualizarEstado: mockActualizarEstado, retrocederFase: vi.fn(), contarPoscosechaIncompleta: vi.fn(async () => 0) }));
vi.mock('@/api/individuos', () => ({ listarIndividuosDePlanta: (...args: unknown[]) => mockListarIndividuos(...args) }));

import { qk } from '@/lib/queryKeys';
import { AvanzarEstado } from './AvanzarEstado';

afterEach(() => {
  cleanup();
  sesion.esAdmin = true;
  mockListarIndividuos.mockReset();
  mockActualizarEstado.mockClear();
});

function montar(estadoActual: 'germinacion' | 'trasplante', formTocado = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const vista = render(
    <QueryClientProvider client={qc}>
      <AvanzarEstado plantaId="p1" estadoActual={estadoActual} formTocado={formTocado} />
    </QueryClientProvider>,
  );
  return { qc, ...vista };
}

describe('AvanzarEstado — avanzar de fase', () => {
  // Fase 5 (G1): las pruebas del «Anterior» que dependía de que el cruce no tuviera individuos se retiraron; el nuevo
  // «Retroceder fase» (con motivo y validado por la base) se prueba en AvanzarEstadoFase5.test.tsx.
  it('no permite avanzar mientras existan cambios del formulario sin guardar', async () => {
    mockListarIndividuos.mockResolvedValue([]);
    montar('germinacion', true);
    const avanzar = await screen.findByRole('button', { name: /avanzar a/i });
    expect(avanzar).toBeDisabled();
    expect(screen.getByText(/guarda o descarta los cambios/i)).toBeInTheDocument();
  });

  it('invalida el dashboard científico después de avanzar de fase', async () => {
    mockListarIndividuos.mockResolvedValue([]);
    const { qc } = montar('germinacion');
    const invalidar = vi.spyOn(qc, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: /avanzar a/i }));
    fireEvent.click(screen.getByRole('button', { name: /sí, avanzar/i }));

    await waitFor(() => expect(mockActualizarEstado).toHaveBeenCalledWith('p1', 'trasplante', 'germinacion'));
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['dashboard-cientifico'] });
  });
});

it('A1-025: un conflicto de estado muestra el error y refresca la ficha sin repetir la escritura', async () => {
  mockListarIndividuos.mockResolvedValue([]);
  mockActualizarEstado.mockRejectedValueOnce(new Error('La ficha cambió desde otra sesión. Recarga sus datos.'));
  const { qc } = montar('germinacion'); const invalidar = vi.spyOn(qc, 'invalidateQueries');
  fireEvent.click(await screen.findByRole('button', { name: /avanzar a/i }));
  fireEvent.click(screen.getByRole('button', { name: /sí, avanzar/i }));
  expect(await screen.findByText(/La ficha cambió desde otra sesión/)).toBeInTheDocument();
  expect(mockActualizarEstado).toHaveBeenCalledTimes(1);
  expect(mockActualizarEstado).toHaveBeenCalledWith('p1', 'trasplante', 'germinacion');
  expect(invalidar).toHaveBeenCalledWith({ queryKey: qk.planta.detalle('p1') });
});

describe('AvanzarEstado — U-03: solo un admin cambia la fase', () => {
  it('el operario no ve «Avanzar», «Anterior» ni el aviso de retroceso: solo la fase actual', async () => {
    sesion.esAdmin = false;
    mockListarIndividuos.mockResolvedValue([{ id: 'ind1' }]);
    montar('trasplante');
    expect(screen.getByText(/fase actual/i)).toHaveTextContent('Fase actual: Trasplante. Solo un admin puede cambiar la fase.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/no se puede retroceder/i)).not.toBeInTheDocument();
    expect(mockListarIndividuos).not.toHaveBeenCalled();
  });

  it('el admin sí ve «Avanzar a…»', async () => {
    mockListarIndividuos.mockResolvedValue([]);
    montar('germinacion');
    expect(await screen.findByRole('button', { name: /avanzar a «trasplante»/i })).toBeInTheDocument();
  });
});
