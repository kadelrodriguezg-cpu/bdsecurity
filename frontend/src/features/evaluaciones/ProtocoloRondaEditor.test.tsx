import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ProtocoloRondaEditor } from './ProtocoloRondaEditor';

const mocks = vi.hoisted(() => ({ definir: vi.fn(async () => 'nuevo') }));
vi.mock('@/api/protocolo', () => ({ definirProtocoloRonda: mocks.definir }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function montar(actual: Record<string, 'obligatorio' | 'opcional'> | null = null) {
  const onGuardado = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProtocoloRondaEditor plantaId="p" numeroRonda={2} actual={actual} onGuardado={onGuardado} onCancelar={vi.fn()} />
    </QueryClientProvider>,
  );
  return { onGuardado };
}

it('define el nivel por sección y guarda solo lo que se evalúa', async () => {
  const { onGuardado } = montar();
  fireEvent.click(within(screen.getByRole('group', { name: 'Nivel de Fenología' })).getByRole('button', { name: 'Obligatoria' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Nivel de Fruto / Calidad' })).getByRole('button', { name: 'Opcional' }));
  // Fenología vuelve a tener 7 descriptores: la distribución de flores y frutos está en Brotes y varas (S15). Fruto tiene 6 desde la cicatriz (G9).
  expect(screen.getByText(/7 obligatorios · 6 opcionales/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar protocolo' }));
  await waitFor(() => expect(onGuardado).toHaveBeenCalled());
  const enviado = (mocks.definir.mock.calls[0] as unknown as [{ descriptores: Record<string, string>; numeroRonda: number }])[0];
  expect(enviado.numeroRonda).toBe(2);
  expect(enviado.descriptores.brotacion).toBe('obligatorio');
  expect(enviado.descriptores.calibre_mm).toBe('opcional');
  expect(enviado.descriptores).not.toHaveProperty('distribucion_flores_frutos'); // vive en Brotes y varas, que no se marcó
  expect(enviado.descriptores).not.toHaveProperty('dano_calor');
  expect(enviado.descriptores).not.toHaveProperty('pct_flores'); // derivados nunca
});

it('la distribución de flores y frutos se protocoliza con la sección Brotes y varas', async () => {
  const { onGuardado } = montar();
  fireEvent.click(within(screen.getByRole('group', { name: 'Nivel de Brotes y varas basales' })).getByRole('button', { name: 'Obligatoria' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar protocolo' }));
  await waitFor(() => expect(onGuardado).toHaveBeenCalled());
  const enviado = (mocks.definir.mock.calls[0] as unknown as [{ descriptores: Record<string, string> }])[0];
  expect(enviado.descriptores.distribucion_flores_frutos).toBe('obligatorio');
  expect(enviado.descriptores.color_follaje).toBe('obligatorio');
  expect(enviado.descriptores).not.toHaveProperty('brotacion');
});

it('parte del protocolo actual y permite ajustar descriptor por descriptor', () => {
  montar({ brotacion: 'obligatorio', floracion: 'opcional' });
  expect(within(screen.getByRole('group', { name: 'Nivel de Brotación' })).getByRole('button', { name: 'Obligatoria' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByText('Mixta').length).toBeGreaterThan(0);
});

it('no guarda un protocolo vacío', () => {
  montar();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar protocolo' }));
  expect(screen.getByText('El protocolo debe incluir al menos un descriptor.')).toBeInTheDocument();
  expect(mocks.definir).not.toHaveBeenCalled();
});

it('ofrece la distribución de flores y frutos y no ofrece los campos desactivados (rend_t_ha)', () => {
  montar();
  expect(screen.getByText('Distribución de flores y frutos en la vara')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Nivel de Distribución de flores y frutos en la vara' })).toBeInTheDocument();
  expect(screen.queryByText('Rendimiento por hectárea')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Nivel de Rendimiento por hectárea' })).not.toBeInTheDocument();
});

it('un protocolo antiguo con rend_t_ha no lo conserva al guardar uno nuevo', async () => {
  const { onGuardado } = montar({ brotacion: 'obligatorio', rend_t_ha: 'opcional' } as Record<string, 'obligatorio' | 'opcional'>);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar protocolo' }));
  await waitFor(() => expect(onGuardado).toHaveBeenCalled());
  const enviado = (mocks.definir.mock.calls[0] as unknown as [{ descriptores: Record<string, string> }])[0];
  expect(enviado.descriptores).toEqual({ brotacion: 'obligatorio' });
});

it('hallazgo 2 (G2): el nombre sugerido de un protocolo nuevo usa la temporada de julio a junio', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T15:00:00Z'));
  try {
    montar();
    expect(await screen.findByLabelText('Nombre del protocolo')).toHaveValue('Ronda 2 anual · Temporada 2026-2027');
  } finally {
    vi.useRealTimers();
  }
});
