import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listarProcedimientos: vi.fn(),
  crearProcedimiento: vi.fn(),
  actualizarProcedimiento: vi.fn(),
  reasignarProcedimiento: vi.fn(),
  listarPrediosActivosCruce: vi.fn(),
  listarInsumos: vi.fn(),
  listarIndividuos: vi.fn(),
  listarPerfiles: vi.fn(),
}));

vi.mock('@/api/procedimientos', async () => {
  const actual = await vi.importActual<typeof import('@/api/procedimientos')>('@/api/procedimientos');
  return {
    ...actual,
    listarProcedimientos: mocks.listarProcedimientos,
    crearProcedimiento: mocks.crearProcedimiento,
    actualizarProcedimiento: mocks.actualizarProcedimiento,
    reasignarProcedimiento: mocks.reasignarProcedimiento,
    listarPrediosActivosCruce: mocks.listarPrediosActivosCruce,
  };
});
vi.mock('@/api/catalogos', () => ({
  listarInsumos: mocks.listarInsumos,
  TIPO_INSUMO_LABEL: { fungicida: 'Fungicida', insecticida: 'Insecticida', escarificante: 'Escarificante', otro: 'Otro' },
}));
vi.mock('@/api/individuos', () => ({ listarIndividuosDePlanta: mocks.listarIndividuos }));
vi.mock('@/api/perfiles', () => ({ listarPerfiles: mocks.listarPerfiles }));
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ generacionSesion: 0, capturarVigenciaSesion: () => () => true, user: { id: 'admin-1' }, esAdmin: true }),
}));

import { ProcedimientosSeccion } from './ProcedimientosSeccion';
import type { Procedimiento } from '@/api/procedimientos';

const procedimiento: Procedimiento = {
  id: 'proc-1',
  nombre: 'Poda sanitaria',
  tipo: 'poda',
  estado: 'planificado',
  fecha_inicio: '2026-07-27',
  fecha_fin: null,
  notas: null,
  responsable_id: 'admin-1',
  created_by: 'admin-1',
  objetivos: [{ tipo: 'cruzamiento', id: 'planta-1' }],
  insumos: [],
};

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const vista = render(
    <QueryClientProvider client={client}>
      <ProcedimientosSeccion plantaId="planta-1" />
    </QueryClientProvider>,
  );
  return { client, ...vista };
}

beforeEach(() => {
  localStorage.clear();
  mocks.listarProcedimientos.mockResolvedValue([procedimiento]);
  mocks.crearProcedimiento.mockResolvedValue('proc-nuevo');
  mocks.actualizarProcedimiento.mockResolvedValue(undefined);
  mocks.reasignarProcedimiento.mockResolvedValue(undefined);
  mocks.listarPrediosActivosCruce.mockResolvedValue([
    { predio_id: 'predio-1', predio_nombre: 'Predio Norte', individuos_activos: 2 },
    { predio_id: 'predio-2', predio_nombre: 'Predio Sur', individuos_activos: 1 },
  ]);
  mocks.listarInsumos.mockResolvedValue([]);
  mocks.listarIndividuos.mockResolvedValue([
    { id: 'ind-1', codigo_display: '02-001-P01', planta_id: 'planta-1', estado_vital: 'vivo' },
  ]);
  mocks.listarPerfiles.mockResolvedValue([
    { id: 'admin-1', nombre: 'Admin Uno', rol: 'admin' },
    { id: 'operario-1', nombre: 'Operario Uno', rol: 'operario' },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProcedimientosSeccion — contrato', () => {
  it('crea un procedimiento con objetivo adicional sin regenerar la key durante el llenado', async () => {
    const { client } = montar();
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Fertilización inicial' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'fertilizacion' } });
    fireEvent.change(screen.getByLabelText('Objetivo adicional por individuo'), { target: { value: 'ind-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar procedimiento' }));

    await waitFor(() => expect(mocks.crearProcedimiento).toHaveBeenCalledTimes(1));
    expect(mocks.crearProcedimiento).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: 'Fertilización inicial',
        objetivos: [
          { tipo: 'cruzamiento', id: 'planta-1' },
          { tipo: 'individuo', id: 'ind-1', nota: undefined },
        ],
      }),
      expect.any(String),
    );
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['dashboard-cientifico'] });
  });

  it('edita el estado temprano del procedimiento existente', async () => {
    montar();
    const selectorEstado = await screen.findByDisplayValue('Planificado');
    fireEvent.change(selectorEstado, { target: { value: 'en_curso' } });

    await waitFor(() => expect(mocks.actualizarProcedimiento).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proc-1', estado: 'en_curso' }),
    ));
  });

  it('reasigna el responsable desde el selector administrativo', async () => {
    montar();
    const selectorResponsable = await screen.findByLabelText('Responsable de Poda sanitaria');
    fireEvent.change(selectorResponsable, { target: { value: 'operario-1' } });

    await waitFor(() => expect(mocks.reasignarProcedimiento).toHaveBeenCalledWith('proc-1', 'operario-1'));
  });
});

describe('ProcedimientosSeccion — hallazgo 9', () => {
  it('el tipo se lee «Poda», «Fertilización» y «Aplicación» en el selector y en la lista', async () => {
    montar();
    const tipo = await screen.findByLabelText('Tipo');
    expect(within(tipo).getByRole('option', { name: 'Fertilización' })).toBeInTheDocument();
    expect(within(tipo).getByRole('option', { name: 'Aplicación' })).toBeInTheDocument();
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && /^Poda · /.test(el.textContent ?? ''))).toBeInTheDocument();
  });
});
