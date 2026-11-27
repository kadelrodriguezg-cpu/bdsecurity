import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { CanalChat, DestinoChat } from '@/types/chat';

const mocks = vi.hoisted(() => ({
  usuario: { id: 'usuario-1' } as { id: string } | null,
  listarCanales: vi.fn(),
  observarResumen: vi.fn(),
  cerrarResumen: vi.fn(),
  listarNotificaciones: vi.fn(),
  marcarNotificacionLeida: vi.fn(),
  marcarTodasNotificacionesLeidas: vi.fn(),
}));

vi.mock('@/api/chat', () => ({
  chat: {
    listarCanales: mocks.listarCanales,
    observarResumen: mocks.observarResumen,
    listarNotificaciones: mocks.listarNotificaciones,
    marcarNotificacionLeida: mocks.marcarNotificacionLeida,
    marcarTodasNotificacionesLeidas: mocks.marcarTodasNotificacionesLeidas,
  },
}));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mocks.usuario }) }));
vi.mock('@/api/catalogos', () => ({
  listarPredios: vi.fn(async () => [{ id: 'predio-1', nombre: 'Predio Norte', activo: true, latitud: null, longitud: null, region: 'Maule' }]),
  crearPredio: vi.fn(), actualizarPredio: vi.fn(),
}));

vi.mock('./ChatWorkspace', () => ({
  ChatWorkspace: ({ destinoInicial, canalInicialId, mensajeInicialId }: {
    destinoInicial?: DestinoChat; canalInicialId?: string | null; mensajeInicialId?: string | null;
  }) => (
    <div data-testid="destino-chat">
      {canalInicialId ? `canal:${canalInicialId}:mensaje:${mensajeInicialId}` : (destinoInicial?.tipo ?? 'sin-destino')}
      {destinoInicial && destinoInicial.tipo !== 'general' ? `:${destinoInicial.entidadId}` : ''}
    </div>
  ),
}));

import { ChatPanelProvider, ControlesChat } from './ChatPanelContext';
import { PrediosCatalogo } from '@/features/catalogos/predios/PrediosCatalogo';

const GENERAL: CanalChat = {
  id: 'general', tipo: 'general', entidad_id: null, entidad_nombre: null,
  ultima_posicion: 0, ultima_lectura: 0, no_leidos: 0,
  ultima_actividad_at: '2026-09-07T12:00:00.000Z', archivado: false,
  creado_por: null, oculto_desde: 0, puede_gestionar: false,
  creado_at: '2026-09-07T12:00:00.000Z',
};

afterEach(() => {
  cleanup();
  mocks.usuario = { id: 'usuario-1' };
  vi.clearAllMocks();
});

function renderPanel(ruta: string, contenido: React.ReactNode = <p>Pantalla</p>) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <ChatPanelProvider><ControlesChat />{contenido}</ChatPanelProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('acceso persistente al chat', () => {
  beforeEach(() => {
    mocks.listarCanales.mockResolvedValue([GENERAL]);
    mocks.listarNotificaciones.mockResolvedValue([]);
    mocks.marcarNotificacionLeida.mockResolvedValue(undefined);
    mocks.marcarTodasNotificacionesLeidas.mockResolvedValue(undefined);
    mocks.observarResumen.mockResolvedValue({ cerrar: mocks.cerrarResumen, resincronizar: vi.fn() });
  });

  it.each(['/chat', '/plantas', '/chat/planta/00000000-0000-4000-8000-000000000000'])('shell: la campana y el botón del chat están en %s (viven en el encabezado, ya no tapan «Enviar mensaje»)', (ruta) => {
    renderPanel(ruta);
    expect(screen.getByRole('button', { name: 'Abrir chat del equipo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Abrir notificaciones/ })).toBeInTheDocument();
  });

  it('sin sesión no se muestran ni la campana ni el chat', () => {
    mocks.usuario = null;
    renderPanel('/plantas');
    expect(screen.queryByRole('button', { name: /Abrir chat del equipo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir notificaciones/ })).not.toBeInTheDocument();
  });

  it('el panel de notificaciones se cierra con Escape y al pulsar fuera', async () => {
    renderPanel('/plantas');
    const campana = screen.getByRole('button', { name: /Abrir notificaciones/ });
    fireEvent.click(campana);
    expect(await screen.findByRole('region', { name: 'Centro de notificaciones' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Centro de notificaciones' })).not.toBeInTheDocument();
    fireEvent.click(campana);
    expect(await screen.findByRole('region', { name: 'Centro de notificaciones' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('Pantalla'));
    expect(screen.queryByRole('region', { name: 'Centro de notificaciones' })).not.toBeInTheDocument();
  });

  it.each(['/dashboard', '/ranking'])('abre General sin salir de %s', async (ruta) => {
    renderPanel(ruta);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat del equipo' }));
    expect(await screen.findByTestId('destino-chat')).toHaveTextContent('general');
  });

  it('abre el cruce contextual desde su ficha', async () => {
    const id = '0fefd6f5-e839-462a-8875-08ad45a3d468';
    renderPanel(`/planta/${id}`);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat del equipo' }));
    expect(await screen.findByTestId('destino-chat')).toHaveTextContent(`cruce:${id}`);
  });

  it('abre el predio elegido desde su fila de catálogo', async () => {
    renderPanel('/catalogos', <PrediosCatalogo />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Chat de Predio Norte' }))[0]);
    expect(await screen.findByTestId('destino-chat')).toHaveTextContent('predio:predio-1');
  });

  it('muestra el total de no leídos aunque el panel esté cerrado', async () => {
    mocks.listarCanales.mockResolvedValueOnce([
      { ...GENERAL, ultima_posicion: 2, no_leidos: 2 },
      {
        ...GENERAL, id: 'predio', tipo: 'predio', entidad_id: 'predio-1', entidad_nombre: 'Predio Norte',
        ultima_posicion: 3, no_leidos: 3, ultima_actividad_at: '2026-09-07T12:03:00.000Z',
      },
    ]);
    renderPanel('/dashboard');

    expect(await screen.findByRole('button', { name: 'Abrir chat del equipo, 5 sin leer' })).toHaveTextContent('5');
  });

  it('cierra la suscripción persistente cuando termina la sesión', async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const vista = () => (
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <ChatPanelProvider><ControlesChat /><p>Pantalla</p></ChatPanelProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const resultado = render(vista());
    await waitFor(() => expect(mocks.observarResumen).toHaveBeenCalledOnce());

    mocks.usuario = null;
    resultado.rerender(vista());

    await waitFor(() => expect(mocks.cerrarResumen).toHaveBeenCalledOnce());
  });

  it('abre una mención en su canal y mensaje exactos, y la marca leída', async () => {
    mocks.listarNotificaciones.mockResolvedValueOnce([{
      mensaje_id: 'mensaje-9', canal_id: 'canal-2', canal_tipo: 'libre', canal_nombre: 'Equipo Norte',
      autor_nombre: 'Carolina Flores', contenido: 'Revisa este registro', tipo: 'directa',
      creado_at: '2026-09-07T13:00:00.000Z', leida_at: null,
    }]);
    renderPanel('/dashboard');

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir notificaciones, 1 pendientes' }));
    fireEvent.click(screen.getByText('Carolina Flores').closest('button')!);

    await waitFor(() => expect(mocks.marcarNotificacionLeida).toHaveBeenCalledWith('mensaje-9'));
    expect(await screen.findByTestId('destino-chat')).toHaveTextContent('canal:canal-2:mensaje:mensaje-9');
  });

  it('marca todas las notificaciones pendientes desde el centro', async () => {
    mocks.listarNotificaciones.mockResolvedValueOnce([{
      mensaje_id: 'mensaje-10', canal_id: 'general', canal_tipo: 'general', canal_nombre: 'General',
      autor_nombre: 'Efraín Rodríguez', contenido: '@all Reunión', tipo: 'todos',
      creado_at: '2026-09-07T13:10:00.000Z', leida_at: null,
    }]);
    renderPanel('/dashboard');

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir notificaciones, 1 pendientes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todo' }));

    await waitFor(() => expect(mocks.marcarTodasNotificacionesLeidas).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Abrir notificaciones' })).toBeInTheDocument();
  });
});
