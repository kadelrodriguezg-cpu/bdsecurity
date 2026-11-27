/**
 * Bug A1 (pulido post-Prompt 7): Historial mostraba UUIDs crudos de catálogo
 * (contenedor_id/insumo_ids/predio_id) en vez del nombre. Este test prueba,
 * con datos reales de render (no solo lectura de código), que un evento de
 * Siembra con FKs de catálogo se muestra resuelto a nombre.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const CONTENEDOR_ID = '11111111-1111-1111-1111-111111111111';
const INSUMO_ID = '22222222-2222-2222-2222-222222222222';
const SUSTRATO_ID = '33333333-3333-3333-3333-333333333333';

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, esAdmin: false, cargando: false }),
}));

const EVENTO_BASE_FIXTURE = {
  id: 'ev1',
  planta_id: 'p1',
  tipo_evento: 'siembra_semilla',
  fecha: '2026-07-01',
  datos: {
    contenedor_id: CONTENEDOR_ID,
    insumo_ids: [INSUMO_ID],
    sustratos: [{ sustrato_id: SUSTRATO_ID, porcentaje: 60 }],
  },
  notas: null,
  created_by: 'u1',
  created_at: '2026-07-01T00:00:00Z',
  archivos: [],
};

const mockListarEventosDePlanta = vi.fn();
const mockActualizarEvento = vi.fn();
const mockSubirBinarioEvento = vi.fn();
const mockRegistrarArchivoDeEvento = vi.fn();
const mockEliminarArchivoDeEvento = vi.fn();
mockListarEventosDePlanta.mockResolvedValue([EVENTO_BASE_FIXTURE]);
mockActualizarEvento.mockResolvedValue(undefined);
mockSubirBinarioEvento.mockResolvedValue({ path: 'plantas/02-001/x/1-foto.jpg', tipo: 'foto' });
mockRegistrarArchivoDeEvento.mockResolvedValue({ id: 'a-nueva', storage_path: 'plantas/02-001/x/1-foto.jpg', tipo: 'foto' });
mockEliminarArchivoDeEvento.mockResolvedValue(undefined);

vi.mock('@/api/eventos', () => ({
  listarEventosDePlanta: (...args: unknown[]) => mockListarEventosDePlanta(...args),
  urlFirmada: vi.fn(async () => 'https://example.com/firmada.jpg'),
  actualizarEvento: (...args: unknown[]) => mockActualizarEvento(...args),
  eliminarEvento: vi.fn(),
  subirBinarioEvento: (...args: unknown[]) => mockSubirBinarioEvento(...args),
  registrarArchivoDeEvento: (...args: unknown[]) => mockRegistrarArchivoDeEvento(...args),
  eliminarArchivoDeEvento: (...args: unknown[]) => mockEliminarArchivoDeEvento(...args),
}));

vi.mock('@/api/catalogos', () => ({
  listarContenedores: vi.fn(async () => [{ id: CONTENEDOR_ID, nombre: 'Bandeja 128', activo: true }]),
  listarInsumos: vi.fn(async () => [{ id: INSUMO_ID, nombre: 'Fungicida X', tipo: 'fungicida', activo: true }]),
  listarPredios: vi.fn(async () => []),
  listarSustratos: vi.fn(async () => [{ id: SUSTRATO_ID, nombre: 'Turba', activo: true }]),
}));

import { EventosLista } from './EventosLista';

afterEach(() => {
  cleanup();
  mockListarEventosDePlanta.mockClear();
  mockListarEventosDePlanta.mockResolvedValue([EVENTO_BASE_FIXTURE]);
  mockActualizarEvento.mockClear();
  mockSubirBinarioEvento.mockClear();
  mockRegistrarArchivoDeEvento.mockClear();
  mockEliminarArchivoDeEvento.mockClear();
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const vista = render(
    <QueryClientProvider client={qc}>
      <EventosLista plantaId="p1" codigoSistema="02-001" estadoCruce="siembra_semilla" />
    </QueryClientProvider>,
  );
  return { ...vista, queryClient: qc };
}

function esperarInvalidacionesDerivadas(invalidar: ReturnType<typeof vi.spyOn>) {
  for (const queryKey of [
    ['eventos', 'p1'],
    ['auditoria', 'p1'],
    ['actividad-reciente', 'p1'],
    ['polinizacion-nota', 'p1'],
    ['siembra-nota', 'p1'],
  ]) {
    expect(invalidar).toHaveBeenCalledWith({ queryKey });
  }
}

describe('EventosLista — Historial resuelve catálogos a nombre (A1)', () => {
  it('muestra los nombres de contenedor/insumo/sustrato, no los UUIDs crudos', async () => {
    montar();

    // El evento más reciente arranca expandido automáticamente (EventosLista.tsx),
    // no hace falta clickear para ver el detalle. `expanded: true` desambigua
    // del chip de filtro "Siembra de semilla" (Paso 2), que comparte texto
    // pero no tiene aria-expanded.
    await screen.findByRole('button', { name: /siembra/i, expanded: true });

    expect(await screen.findByText(/Bandeja 128/)).toBeInTheDocument();
    expect(await screen.findByText(/Fungicida X/)).toBeInTheDocument();
    expect(await screen.findByText(/Turba \(60%\)/)).toBeInTheDocument();

    // Ningún UUID crudo debe aparecer en pantalla.
    expect(screen.queryByText(new RegExp(CONTENEDOR_ID))).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(INSUMO_ID))).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(SUSTRATO_ID))).not.toBeInTheDocument();
  });
});

describe('EventosLista — Bloque 4 Paso 1 (edición: adjuntos, notas opcionales, sin cambiar tipo)', () => {
  it('el formulario de edición ya no tiene selector de "Tipo de evento"', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /editar/i }));

    expect(screen.queryByLabelText(/tipo de evento/i)).not.toBeInTheDocument();
  });

  it('guarda sin escribir nota (Cosecha/Germinación nunca tuvieron notas al crearse)', async () => {
    const { queryClient } = montar();
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: /editar/i }));

    const guardar = await screen.findByRole('button', { name: /guardar cambios/i });
    expect(guardar).not.toBeDisabled(); // antes: deshabilitado con notas vacías

    fireEvent.click(guardar);
    await waitFor(() => expect(mockActualizarEvento).toHaveBeenCalled());
    expect(mockActualizarEvento).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ev1', tipo_evento: 'siembra_semilla', notas: undefined }),
    );
    esperarInvalidacionesDerivadas(invalidar);
  });

  it('agregar una foto a un evento existente la muestra en la lista de adjuntos', async () => {
    const { queryClient } = montar();
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: /editar/i }));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const archivo = new File(['contenido'], 'foto.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [archivo] } });

    await waitFor(() => expect(mockSubirBinarioEvento).toHaveBeenCalled());
    expect(mockSubirBinarioEvento).toHaveBeenCalledWith({ file: archivo, codigoSistema: '02-001' });
    expect(mockRegistrarArchivoDeEvento).toHaveBeenCalledWith(
      expect.objectContaining({ registroId: 'ev1', path: 'plantas/02-001/x/1-foto.jpg', tipo: 'foto' }),
    );
    esperarInvalidacionesDerivadas(invalidar);
  });

  it('quitar un adjunto existente llama a eliminarArchivoDeEvento con ese archivo', async () => {
    mockListarEventosDePlanta.mockResolvedValueOnce([
      {
        id: 'ev1',
        planta_id: 'p1',
        tipo_evento: 'cosecha',
        fecha: '2026-07-05',
        datos: {},
        notas: null,
        created_by: 'u1',
        created_at: '2026-07-05T00:00:00Z',
        archivos: [{ id: 'a1', storage_path: 'plantas/02-001/x/orig.jpg', tipo: 'foto' }],
      },
    ]);
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /editar/i }));

    fireEvent.click(await screen.findByRole('button', { name: /quitar adjunto/i }));
    await waitFor(() => expect(mockEliminarArchivoDeEvento).toHaveBeenCalled());
    expect(mockEliminarArchivoDeEvento).toHaveBeenCalledWith({ id: 'a1', storage_path: 'plantas/02-001/x/orig.jpg', tipo: 'foto' });
  });
});

describe('EventosLista — Bloque 4 Paso 2 (re-skin: chips, ver más, Sheet)', () => {
  it('editar abre un Sheet (dialog) en vez de expandirse inline', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /editar/i }));

    expect(await screen.findByRole('dialog', { name: /editar evento/i })).toBeInTheDocument();
  });

  it('chips de filtro: la fase actual viene preseleccionada y cambiar de chip cambia qué se ve', async () => {
    mockListarEventosDePlanta.mockResolvedValueOnce([
      { ...EVENTO_BASE_FIXTURE, id: 'ev-cosecha', tipo_evento: 'cosecha', fecha: '2026-07-05', datos: {} },
      { ...EVENTO_BASE_FIXTURE, id: 'ev-polin', tipo_evento: 'polinizacion', fecha: '2026-07-01', datos: {} },
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EventosLista plantaId="p1" codigoSistema="02-001" estadoCruce="cosecha" />
      </QueryClientProvider>,
    );

    // Fase actual = cosecha: arranca preseleccionada, solo se ve ese evento
    // (el chip "Polinización" sigue visible para poder cambiar, pero no hay
    // fila de Polinización montada).
    await screen.findByRole('button', { name: /cosecha/i, expanded: true });
    expect(screen.queryByRole('button', { name: /polinización/i, expanded: false })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Polinización' }));

    expect(await screen.findByRole('button', { name: /polinización/i, expanded: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cosecha/i, expanded: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cosecha/i, expanded: false })).not.toBeInTheDocument();
  });

  it('"Ver más" acota la lista a 5 eventos hasta que se hace clic', async () => {
    const muchos = Array.from({ length: 7 }, (_, i) => ({
      ...EVENTO_BASE_FIXTURE,
      id: `ev${i}`,
      fecha: `2026-07-0${i + 1}`,
      datos: {},
    }));
    mockListarEventosDePlanta.mockResolvedValueOnce(muchos);
    montar();

    // El más reciente arranca expandido; de los 5 visibles, 4 quedan
    // colapsados (`expanded: false` excluye el chip "Siembra de semilla",
    // que comparte texto pero no tiene aria-expanded).
    await screen.findByRole('button', { name: /siembra/i, expanded: true });
    expect(screen.getAllByRole('button', { name: /siembra/i, expanded: false })).toHaveLength(4);
    expect(screen.getByRole('button', { name: /ver más/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ver más/i }));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /siembra/i, expanded: false })).toHaveLength(6);
    });
    expect(screen.queryByRole('button', { name: /ver más/i })).not.toBeInTheDocument();
  });

  it('la fila colapsada muestra un contador de adjuntos sin necesidad de expandir', async () => {
    mockListarEventosDePlanta.mockResolvedValueOnce([
      {
        ...EVENTO_BASE_FIXTURE,
        id: 'ev-con-fotos',
        datos: {},
        archivos: [
          { id: 'a1', storage_path: 'x/1.jpg', tipo: 'foto' },
          { id: 'a2', storage_path: 'x/2.jpg', tipo: 'foto' },
        ],
      },
    ]);
    montar();

    // El contador de adjuntos vive en el botón del header del acordeón —
    // debe verse ahí sin depender de si la fila está expandida o no.
    await screen.findByRole('button', { name: /siembra/i, expanded: true });
    expect(screen.getByLabelText('2 adjunto(s)')).toBeInTheDocument();
  });

  it('sin adjuntos, no muestra ningún contador', async () => {
    montar(); // fixture por defecto: archivos: []
    await screen.findByRole('button', { name: /siembra/i, expanded: true });
    expect(screen.queryByLabelText(/adjunto/i)).not.toBeInTheDocument();
  });
});
