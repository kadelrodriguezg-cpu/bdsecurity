/** v3 paso 4: acciones propias de cada fase dentro del expediente, con los mismos permisos por rol que la lista vieja. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const mocks = vi.hoisted(() => ({ esAdmin: false, resumen: {} as Record<string, unknown> }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: mocks.esAdmin }) }));
vi.mock('@/api/individuos', () => ({ obtenerResumenIndividuos: vi.fn(async () => mocks.resumen) }));
vi.mock('./EvaluacionReducidaResumen', () => ({ EvaluacionReducidaResumen: ({ fase }: { fase: string }) => <p>resumen {fase}</p> }));
vi.mock('./MultisitioResumen', () => ({ MultisitioResumen: () => <p>emplazamiento</p> }));
vi.mock('./EvaluacionReducidaForm', () => ({ EvaluacionReducidaForm: ({ fase }: { fase: string }) => <p>formulario reducido {fase}</p> }));
vi.mock('./MultisitioForm', () => ({ MultisitioForm: () => <p>formulario de traslado</p> }));
vi.mock('./RondasSeccion', () => ({ RondasSeccion: ({ puedeIniciar }: { puedeIniciar: boolean }) => <p>rondas multisitio {puedeIniciar ? 'abiertas' : 'solo lectura'}</p> }));

import { AccionesFaseIndividuo } from './AccionesFaseIndividuo';
import type { Individuo } from '@/api/individuos';

const vivo: Individuo = { id: 'i1', planta_id: 'p1', codigo_display: 'TEST-P1', clon_de_id: null, estado_vital: 'vivo', fecha_baja: null, created_at: '2026-10-01' } as Individuo;
afterEach(() => { cleanup(); mocks.esAdmin = false; mocks.resumen = {}; });

function montar(estadoCruce: 'trasplante' | 'crecimiento' | 'traslado_destino' | 'proceso_finalizado', individuo = vivo) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AccionesFaseIndividuo individuo={individuo} plantaId="p1" codigoSistema="TEST" estadoCruce={estadoCruce} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccionesFaseIndividuo', () => {
  it('Crecimiento: cualquier usuario evalúa a un individuo vivo', async () => {
    montar('crecimiento');
    expect(await screen.findByRole('button', { name: '+ Evaluación Crecimiento' })).toBeInTheDocument();
    expect(screen.getByText('resumen crecimiento')).toBeInTheDocument();
  });

  it('Multisitio, operario: inicia rondas multisitio pero NO registra traslados (solo admin, como antes)', async () => {
    montar('traslado_destino');
    expect(await screen.findByText('rondas multisitio abiertas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Registrar traslado' })).not.toBeInTheDocument();
  });

  it('Multisitio, admin: sí registra traslados', async () => {
    mocks.esAdmin = true;
    montar('traslado_destino');
    expect(await screen.findByRole('button', { name: '+ Registrar traslado' })).toBeInTheDocument();
  });

  it('Proceso finalizado: solo lectura de lo registrado, sin botones', async () => {
    mocks.esAdmin = true;
    mocks.resumen = { i1: { count_eval_trasplante: 1, count_eval_crecimiento: 2, rondas_multisitio_count: 1, emplazamiento_count: 1 } };
    montar('proceso_finalizado');
    expect(await screen.findByText(/Evaluación reducida — Crecimiento/)).toBeInTheDocument();
    expect(screen.getByText(/Ensayos multisitio/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+ /})).not.toBeInTheDocument();
  });

  it('un individuo de baja no recibe acciones nuevas', async () => {
    mocks.esAdmin = true;
    montar('crecimiento', { ...vivo, estado_vital: 'muerto' as const });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: '+ Evaluación Crecimiento' })).not.toBeInTheDocument();
  });
});

describe('AccionesFaseIndividuo — Trasplante (paso 5, N22)', () => {
  it('cualquier usuario agrega la evaluación de Trasplante de un individuo vivo, en un modal', async () => {
    montar('trasplante');
    const boton = await screen.findByRole('button', { name: '+ Evaluación Trasplante' });
    expect(screen.queryByText('formulario reducido trasplante')).not.toBeInTheDocument();
    boton.click();
    expect(await screen.findByText('formulario reducido trasplante')).toBeInTheDocument();
  });

  it('en Trasplante no aparecen Crecimiento ni Multisitio (como en la lista vieja, D.2)', async () => {
    montar('trasplante');
    await screen.findByRole('button', { name: '+ Evaluación Trasplante' });
    expect(screen.queryByText(/Evaluación reducida — Crecimiento/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ensayos multisitio/)).not.toBeInTheDocument();
  });

  it('dado de baja con Trasplante cargado: solo la lectura de Trasplante, sin botones (D.1)', async () => {
    mocks.resumen = { i1: { count_eval_trasplante: 1 } };
    montar('crecimiento', { ...vivo, estado_vital: 'descartado' } as Individuo);
    expect(await screen.findByText(/Evaluación reducida — Trasplante/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ / })).not.toBeInTheDocument();
    expect(screen.queryByText(/Evaluación reducida — Crecimiento/)).not.toBeInTheDocument();
  });
});
