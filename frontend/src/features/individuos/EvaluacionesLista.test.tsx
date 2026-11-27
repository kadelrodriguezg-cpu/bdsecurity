/** v3 paso 3: una sola lectura de evaluación. La lista de una ronda lleva a /planta/:id/evaluacion/:id; no despliega un detalle propio. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

vi.mock('@/api/rondas', () => ({
  listarEvaluacionesDeRonda: vi.fn(async () => [
    { id: 'ev-1', fecha: '2026-10-10', anio: 2026, estado: 'completa', evaluador: 'M. Soto' },
  ]),
}));
vi.mock('./DetalleEvaluacion', () => ({
  ESTADO_EVALUACION_LABEL: { completa: 'Completa', corregida: 'Corregida', borrador: 'Borrador', anulada: 'Anulada' },
  resumenDescriptores: () => '3 de 26 descriptores',
  DetalleEvaluacion: () => <p>DETALLE PROPIO</p>,
}));

import { EvaluacionesLista } from './EvaluacionesLista';

afterEach(cleanup);

function montar(plantaId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/planta/c1?pestana=individuos']}>
        <EvaluacionesLista rondaId="r1" plantaId={plantaId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EvaluacionesLista', () => {
  it('cada evaluación es un enlace a LA lectura de evaluación', async () => {
    montar('c1');
    const enlace = await screen.findByRole('link', { name: 'Ver la evaluación del 10-10-2026' });
    expect(enlace).toHaveAttribute('href', '/planta/c1/evaluacion/ev-1');
    // N23: la fecha se lee `dd-mm-aaaa`, nunca ISO crudo.
    expect(enlace).toHaveTextContent('10-10-2026');
    expect(enlace).not.toHaveTextContent('2026-10-10');
    expect(screen.queryByText('DETALLE PROPIO')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('sin cruce conocido muestra el resumen sin enlace', async () => {
    montar();
    expect(await screen.findByText('3 de 26 descriptores', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
