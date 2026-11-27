import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actualizarContenedor: vi.fn(async (..._args: unknown[]) => undefined),
  listarContenedores: vi.fn(),
  listarInsumos: vi.fn(),
  listarSustratos: vi.fn(),
}));

vi.mock('@/api/catalogos', () => ({
  listarContenedores: (...args: unknown[]) => mocks.listarContenedores(...args),
  crearContenedor: vi.fn(),
  actualizarContenedor: (...args: unknown[]) => mocks.actualizarContenedor(...args),
  listarInsumos: (...args: unknown[]) => mocks.listarInsumos(...args),
  crearInsumo: vi.fn(),
  actualizarInsumo: vi.fn(),
  listarSustratos: (...args: unknown[]) => mocks.listarSustratos(...args),
  crearSustrato: vi.fn(),
  actualizarSustrato: vi.fn(),
  TIPO_INSUMO_LABEL: { otro: 'Otro' },
}));

vi.mock('@/features/catalogos/predios/PrediosCatalogo', () => ({
  PrediosCatalogo: () => <div>Predios aislados para esta prueba</div>,
}));

vi.mock('@/api/especies', () => ({
  listarEspecies: vi.fn(async () => [{ id: 'e1', nombre: 'Arándano', nombre_cientifico: null }]),
  crearEspecie: vi.fn(),
  actualizarEspecie: vi.fn(),
}));

import { MemoryRouter } from 'react-router';
import { CatalogosPage } from './CatalogosPage';

beforeEach(() => {
  mocks.listarContenedores.mockResolvedValue([]);
  mocks.listarInsumos.mockResolvedValue([]);
  mocks.listarSustratos.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function montar(url = '/catalogos?tipo=contenedores') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[url]}><CatalogosPage /></MemoryRouter></QueryClientProvider>);
}

describe('CatalogosPage — errores de listas', () => {
  it('muestra un error reintentable y no deja agregar mientras falla la lista', async () => {
    mocks.listarContenedores.mockRejectedValueOnce(new Error('Failed to fetch'));
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar para cargar los contenedores.');
    expect(screen.getAllByRole('button', { name: /Agregar contenedor/ })[0]).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(mocks.listarContenedores).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Agregar contenedor/ })[0]).toBeEnabled());
  });
});

describe('CatalogosPage — Contenedores: la capacidad se muestra una sola vez', () => {
  const MACETEROS = { id: 'c1', nombre: 'Maceteros  (10 L)', capacidad_litros: 10, activo: true };
  const BANDEJA = { id: 'c2', nombre: 'Bandeja 288 (0,005 L)', capacidad_litros: null, activo: true };
  const VIEJO = { id: 'c3', nombre: 'ULTRASOL INI', capacidad_litros: null, activo: false };

  it('muestra el nombre sin la capacidad repetida, la capacidad en su columna y ofrece limpiar el nombre', async () => {
    mocks.listarContenedores.mockResolvedValue([MACETEROS, BANDEJA, VIEJO]);
    montar();
    const tabla = await screen.findByRole('region', { name: 'Tabla de contenedores' });
    const fila = within(tabla).getByRole('rowheader', { name: /^Maceteros/ }).closest('tr')!;
    expect(within(fila).getByText('Maceteros')).toBeInTheDocument();
    expect(within(fila).getByText('10 L')).toBeInTheDocument();
    expect(fila).toHaveTextContent('Nombre guardado: «Maceteros (10 L)»');
    expect(screen.getByText(/1 nombre repite la capacidad/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitarla del nombre' }));
    await waitFor(() => expect(mocks.actualizarContenedor).toHaveBeenCalledWith('c1', { nombre: 'Maceteros' }));
  });

  it('si el nombre trae una capacidad que no está cargada, la pasa a la capacidad', async () => {
    mocks.listarContenedores.mockResolvedValue([BANDEJA]);
    montar();
    const tabla = await screen.findByRole('region', { name: 'Tabla de contenedores' });
    expect(within(tabla).getByText('Sin capacidad')).toBeInTheDocument();
    fireEvent.click(within(tabla).getByRole('button', { name: 'Usarla como capacidad' }));
    await waitFor(() => expect(mocks.actualizarContenedor).toHaveBeenCalledWith('c2', { capacidad_litros: 0.005, nombre: 'Bandeja 288' }));
  });

  it('los inactivos se ocultan hasta pedirlos', async () => {
    mocks.listarContenedores.mockResolvedValue([MACETEROS, VIEJO]);
    montar();
    const tabla = await screen.findByRole('region', { name: 'Tabla de contenedores' });
    expect(within(tabla).queryByText('ULTRASOL INI')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar inactivos (1)' }));
    expect(await within(screen.getByRole('region', { name: 'Tabla de contenedores' })).findByText('ULTRASOL INI')).toBeInTheDocument();
  });

  it('al agregar, la vista previa muestra cómo se verá y el aviso ofrece quitar la capacidad del nombre', async () => {
    montar();
    fireEvent.click((await screen.findAllByRole('button', { name: /Agregar contenedor/ }))[0]);
    const hoja = await screen.findByRole('dialog', { name: 'Agregar contenedor' });
    fireEvent.change(within(hoja).getByLabelText('Nombre'), { target: { value: 'Bolsa (20 L)' } });
    expect(hoja).toHaveTextContent('El nombre dice 20 L.');
    fireEvent.click(within(hoja).getByRole('button', { name: 'Usarla como capacidad' }));
    expect(within(hoja).getByLabelText('Nombre')).toHaveValue('Bolsa');
    expect(within(hoja).getByLabelText('Capacidad (litros)')).toHaveValue('20');
    expect(hoja).toHaveTextContent('Se mostrará así: Bolsa · 20 L');
  });
});

describe('CatalogosPage — Especies (v3 paso 6)', () => {
  it('Especies es la primera pestaña y la de entrada; la pestaña elegida queda en la URL', async () => {
    montar('/catalogos');
    const pestanas = screen.getAllByRole('tab');
    expect(pestanas[0]).toHaveTextContent('Especies');
    expect(pestanas[0]).toHaveAttribute('aria-selected', 'true');
    expect((await screen.findAllByText('Arándano')).length).toBeGreaterThan(0);
  });

  it('?tipo=predios abre esa pestaña', () => {
    montar('/catalogos?tipo=predios');
    expect(screen.getByRole('tab', { name: 'Predios' })).toHaveAttribute('aria-selected', 'true');
  });
});
