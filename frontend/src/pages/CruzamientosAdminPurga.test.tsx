/**
 * Purga irreversible de cruces de prueba — comportamiento de la UI.
 *
 * Lo que se verifica acá es que la puerta de `es_prueba` sea REAL en la
 * interfaz, no una advertencia: para un cruce real el control no existe en el
 * DOM (no está deshabilitado, no está). El backend rechaza igual
 * (`borrar_cruzamiento`, migración 20260907001000); esto cubre el otro lado.
 *
 * La verificación empírica contra la base — que el RPC rechace, que no queden
 * huérfanos y que el audit_log tenga el detalle — vive en
 * `tests/rls/purga-cruce-prueba.test.ts`, contra Postgres real.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CruceAdmin, ResumenBorrado } from '@/api/cruzamientosAdmin';
import { PanelBorrar } from './CruzamientosAdminPage';

const { borrarCruzamiento, resumenParaBorrado } = vi.hoisted(() => ({
  borrarCruzamiento: vi.fn(async () => undefined),
  resumenParaBorrado: vi.fn<() => Promise<ResumenBorrado>>(),
}));

vi.mock('@/api/cruzamientosAdmin', () => ({
  restaurarCruzamiento: vi.fn(),
  listarTodosLosCruces: vi.fn(),
  reiniciarCruzamiento: vi.fn(),
  borrarCruzamiento,
  resumenParaBorrado,
}));

const RESUMEN_LIMPIO: ResumenBorrado = {
  n_individuos: 2,
  n_evaluaciones: 3,
  n_pcr: 0,
  n_registros_evento: 4,
  n_emplazamientos: 0,
  n_evaluaciones_terminadas: 0,
};

const CRUCE_REAL: CruceAdmin = {
  id: 'cruce-real',
  codigo_sistema: '02-001',
  estado: 'cosecha',
  eliminado_at: null,
  es_prueba: false,
};

const CRUCE_PRUEBA: CruceAdmin = {
  id: 'cruce-prueba',
  codigo_sistema: 'TEST-VERIF-20260716',
  estado: 'cosecha',
  eliminado_at: null,
  es_prueba: true,
};

function montar(cruce: CruceAdmin) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PanelBorrar cruce={cruce} onCerrar={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  borrarCruzamiento.mockClear();
  resumenParaBorrado.mockReset();
  resumenParaBorrado.mockResolvedValue(RESUMEN_LIMPIO);
});

afterEach(cleanup);

describe('PanelBorrar — la purga solo existe para cruces de prueba', () => {
  it('en un cruce REAL el control de purga no aparece en el DOM', () => {
    montar(CRUCE_REAL);

    expect(screen.getByRole('button', { name: /archivar \(recuperable\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /purgar/i })).not.toBeInTheDocument();
    // Y se explica por qué, en vez de dejar al admin buscando el botón.
    expect(screen.getByText(/no está marcado como cruce de prueba/i)).toBeInTheDocument();
  });

  it('en un cruce de PRUEBA el control aparece, junto al de archivar', () => {
    montar(CRUCE_PRUEBA);

    expect(screen.getByRole('button', { name: /archivar \(recuperable\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /purgar cruce de prueba/i })).toBeInTheDocument();
  });
});

describe('PanelBorrar — fricción de confirmación', () => {
  it('con el código equivocado no deja purgar; con el exacto, sí', async () => {
    montar(CRUCE_PRUEBA);
    fireEvent.click(screen.getByRole('button', { name: /purgar cruce de prueba/i }));

    const confirmar = await screen.findByRole('button', { name: /purgar permanentemente/i });
    expect(confirmar).toBeDisabled();

    const campo = screen.getByLabelText(/escribe el código del cruce/i);

    // Un prefijo correcto no alcanza: la comparación es exacta.
    fireEvent.change(campo, { target: { value: 'TEST-VERIF' } });
    expect(confirmar).toBeDisabled();

    // Ni el mismo código con otra caja.
    fireEvent.change(campo, { target: { value: 'test-verif-20260716' } });
    expect(confirmar).toBeDisabled();

    fireEvent.change(campo, { target: { value: 'TEST-VERIF-20260716' } });
    expect(confirmar).toBeEnabled();

    fireEvent.click(confirmar);
    await waitFor(() => expect(borrarCruzamiento).toHaveBeenCalledWith('cruce-prueba', 'hard'));
  });

  it('muestra el conteo de lo que se va a perder antes de pedir el código', async () => {
    montar(CRUCE_PRUEBA);
    fireEvent.click(screen.getByRole('button', { name: /purgar cruce de prueba/i }));

    expect(await screen.findByText(/2 individuo\(s\), 3 evaluación\(es\)/i)).toBeInTheDocument();
  });
});

describe('PanelBorrar — bloqueo por datos reales colados en un cruce de prueba', () => {
  it('con evaluaciones terminadas rechaza la purga y no ofrece confirmación', async () => {
    // El caso que motiva el bloqueo: el cruce está marcado como prueba, pero
    // alguien registró evaluaciones de verdad sobre sus individuos.
    resumenParaBorrado.mockResolvedValue({ ...RESUMEN_LIMPIO, n_evaluaciones_terminadas: 2 });
    montar(CRUCE_PRUEBA);
    fireEvent.click(screen.getByRole('button', { name: /purgar cruce de prueba/i }));

    expect(await screen.findByText(/alguien registró datos reales sobre él/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /purgar permanentemente/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/escribe el código del cruce/i)).not.toBeInTheDocument();
    // El conteo sigue a la vista: es con eso que el humano decide qué hacer.
    expect(screen.getByText(/2 terminada\(s\)/i)).toBeInTheDocument();
  });

  it('con historial territorial rechaza la purga (invariante append-only preexistente)', async () => {
    resumenParaBorrado.mockResolvedValue({ ...RESUMEN_LIMPIO, n_emplazamientos: 3 });
    montar(CRUCE_PRUEBA);
    fireEvent.click(screen.getByRole('button', { name: /purgar cruce de prueba/i }));

    expect(await screen.findByText(/historial territorial/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /purgar permanentemente/i })).not.toBeInTheDocument();
  });
});
