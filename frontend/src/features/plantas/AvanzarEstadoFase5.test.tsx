/**
 * Fase 5, hallazgo 1 de la guía (decisión G1): «Retroceder fase» para el admin aunque el cruce tenga plantas, con motivo
 * obligatorio; y, al pasar de Evaluación anual a Multisitio, un aviso con las plantas que tienen la poscosecha sin terminar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EstadoPlanta } from '@/types/domain';

const m = vi.hoisted(() => ({
  listarIndividuos: vi.fn(),
  actualizarEstado: vi.fn(async () => undefined),
  retroceder: vi.fn(),
  poscosecha: vi.fn(),
  sesion: { esAdmin: true },
}));

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: m.sesion.esAdmin }) }));
vi.mock('@/api/plantas', () => ({
  actualizarEstado: m.actualizarEstado,
  retrocederFase: (...a: unknown[]) => m.retroceder(...a),
  contarPoscosechaIncompleta: (...a: unknown[]) => m.poscosecha(...a),
}));
vi.mock('@/api/individuos', () => ({ listarIndividuosDePlanta: (...a: unknown[]) => m.listarIndividuos(...a) }));

import { AvanzarEstado } from './AvanzarEstado';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.sesion.esAdmin = true;
});

function montar(estadoActual: EstadoPlanta) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AvanzarEstado plantaId="p1" estadoActual={estadoActual} />
    </QueryClientProvider>,
  );
}

describe('AvanzarEstado — retroceder fase (hallazgo 1)', () => {
  it('con plantas creadas, el admin ve «Retroceder fase»; confirma solo con motivo y se llama a la función de la base', async () => {
    m.listarIndividuos.mockResolvedValue([{ id: 'i1' }]);
    m.retroceder.mockResolvedValue('trasplante');
    montar('crecimiento');
    fireEvent.click(await screen.findByRole('button', { name: 'Retroceder fase' }));
    expect(screen.getByText(/¿Volver de/)).toHaveTextContent('¿Volver de Crecimiento a Trasplante?');
    const confirmar = screen.getByRole('button', { name: 'Sí, retroceder' });
    expect(confirmar).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Se avanzó por error' } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(m.retroceder).toHaveBeenCalledWith('p1', 'crecimiento', 'Se avanzó por error'));
    expect(m.actualizarEstado).not.toHaveBeenCalled();
  });

  it('si la base lo bloquea por datos que quedarían huérfanos, muestra su explicación', async () => {
    m.listarIndividuos.mockResolvedValue([{ id: 'i1' }]);
    m.retroceder.mockRejectedValue(new Error('No se puede volver a Crecimiento: ya hay rondas de evaluación anual iniciadas en este cruce (3).'));
    montar('evaluacion_anual');
    fireEvent.click(await screen.findByRole('button', { name: 'Retroceder fase' }));
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Prueba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sí, retroceder' }));
    expect(await screen.findByText(/ya hay rondas de evaluación anual/)).toBeInTheDocument();
  });

  it('ya no dice «No se puede retroceder: este cruce ya tiene individuos creados»', async () => {
    m.listarIndividuos.mockResolvedValue([{ id: 'i1' }]);
    montar('trasplante');
    await screen.findByRole('button', { name: 'Retroceder fase' });
    expect(screen.queryByText(/ya tiene individuos creados/)).toBeNull();
  });

  it('el operario no ve «Retroceder fase»', async () => {
    m.sesion.esAdmin = false;
    montar('crecimiento');
    expect(screen.queryByRole('button', { name: 'Retroceder fase' })).toBeNull();
  });
});

describe('AvanzarEstado — aviso de poscosecha al pasar a Multisitio (hallazgo 1)', () => {
  it('con plantas con la poscosecha sin terminar, avisa cuántas antes de confirmar', async () => {
    m.listarIndividuos.mockResolvedValue([{ id: 'i1' }]);
    m.poscosecha.mockResolvedValue(7);
    montar('evaluacion_anual');
    fireEvent.click(await screen.findByRole('button', { name: /Avanzar a «Ensayos multisitio»/ }));
    expect(await screen.findByText(/7 plantas tienen la poscosecha sin terminar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sí, avanzar' })).toBeInTheDocument();
  });

  it('sin poscosecha pendiente no hay aviso', async () => {
    m.listarIndividuos.mockResolvedValue([{ id: 'i1' }]);
    m.poscosecha.mockResolvedValue(0);
    montar('evaluacion_anual');
    fireEvent.click(await screen.findByRole('button', { name: /Avanzar a «Ensayos multisitio»/ }));
    await waitFor(() => expect(m.poscosecha).toHaveBeenCalledWith('p1'));
    expect(screen.queryByText(/poscosecha sin terminar/)).toBeNull();
  });

  it('en otras fases no se consulta la poscosecha', async () => {
    m.listarIndividuos.mockResolvedValue([]);
    montar('cosecha');
    fireEvent.click(await screen.findByRole('button', { name: /Avanzar a/ }));
    expect(m.poscosecha).not.toHaveBeenCalled();
  });
});
