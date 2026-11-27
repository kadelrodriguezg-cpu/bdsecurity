/**
 * ResumenFinal — bloque de individuos.
 *
 * Desde B8 el bloque de individuos viene de una sola RPC agregada
 * (resumenIndividuosDeCruce) en vez de un N+1 de consultas por individuo y por
 * ronda. La garantía de Fase 0 (un borrador o una anulada NO cuentan como
 * evaluación) ahora vive en la RPC y se prueba contra la base local en
 * tests/rls/escala-listados.test.ts. Acá se fija que la vista muestre lo que
 * la RPC entrega, sin re-contar ni pedir nada por individuo.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResumenFinal } from './ResumenFinal';
import type { FichaPlanta } from '@/types/domain';
import type { ResumenIndividuoCruce } from '@/api/individuos';

afterEach(() => cleanup());

const mockResumenIndividuos = vi.fn();

vi.mock('@/api/fases', () => ({
  obtenerDatosFase: vi.fn(async () => ({ contenedor_id: null, predio_id: null, fecha_cosecha: null, escarificacion_subtipo: null, semillas_sembradas: null })),
  listarPolinizacionEventos: vi.fn(async () => []),
  listarCosechaFrutos: vi.fn(async () => []),
  listarGerminacionEventos: vi.fn(async () => []),
  listarInsumoIdsDePlanta: vi.fn(async () => []),
  listarSustratosDePlanta: vi.fn(async () => []),
  ESCARIFICACION_SUBTIPO_LABEL: {},
}));

vi.mock('@/api/individuos', () => ({
  resumenIndividuosDeCruce: (...args: unknown[]) => mockResumenIndividuos(...args),
  ESTADO_VITAL_LABEL: { vivo: 'Vivo', descartado: 'Descartado', muerto: 'Muerto' },
  CRITERIO_BAJA_LABEL: { vigor: 'Vigor' },
}));

vi.mock('@/api/catalogos', () => ({
  listarContenedores: vi.fn(async () => []),
  listarInsumos: vi.fn(async () => []),
  listarPredios: vi.fn(async () => []),
  listarSustratos: vi.fn(async () => []),
}));

const ficha: FichaPlanta = {
  id: 'p1', codigo_sistema: '02-001', especie_id: 'esp-1', estado: 'proceso_finalizado',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

function renderResumen() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ResumenFinal ficha={ficha} especieNombre="Arándano" />
    </QueryClientProvider>,
  );
}

const resumen = (parcial: Partial<ResumenIndividuoCruce>): ResumenIndividuoCruce => ({
  individuo_id: 'ind-1', codigo_display: 'IND-001', estado_vital: 'vivo',
  evaluaciones_count: 0, pcr_count: 0, observaciones: [],
  tiene_emplazamiento: false, predio_nombre: null, sector_nombre: null,
  ...parcial,
});

describe('ResumenFinal — individuos desde la RPC agregada (B8)', () => {
  it('pide el resumen una sola vez para el cruce', async () => {
    mockResumenIndividuos.mockResolvedValue([resumen({ evaluaciones_count: 2, pcr_count: 1 })]);

    renderResumen();

    expect(await screen.findByText('2 evaluación(es) · 1 PCR')).toBeInTheDocument();
    expect(mockResumenIndividuos).toHaveBeenCalledTimes(1);
    expect(mockResumenIndividuos).toHaveBeenCalledWith('p1');
  });

  it('muestra el emplazamiento actual y las observaciones de baja', async () => {
    mockResumenIndividuos.mockResolvedValue([
      resumen({
        estado_vital: 'descartado',
        observaciones: [{ criterio: 'vigor', nota: 'Bajo vigor' }],
        tiene_emplazamiento: true, predio_nombre: 'Predio Norte', sector_nombre: 'Sector 2',
      }),
    ]);

    renderResumen();

    expect(await screen.findByText('Emplazamiento actual: Predio Norte · Sector 2')).toBeInTheDocument();
    expect(screen.getByText('Obs.: Vigor: Bajo vigor')).toBeInTheDocument();
    expect(screen.getByText('Descartado')).toBeInTheDocument();
  });

  it('sin individuos muestra el aviso de que el cruce no se individualizó', async () => {
    mockResumenIndividuos.mockResolvedValue([]);

    renderResumen();

    expect(await screen.findByText('Este cruce no llegó a individualizarse.')).toBeInTheDocument();
  });
});
