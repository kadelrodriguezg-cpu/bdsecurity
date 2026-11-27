import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import type { CanalChat, DestinoChat, NotificacionChat } from '@/types/chat';

const mocks = vi.hoisted(() => ({
  listarCanales: vi.fn(),
  observarResumen: vi.fn(),
  listarNotificaciones: vi.fn(),
  marcarNotificacionLeida: vi.fn(),
  tocarTonoMencion: vi.fn(() => true),
  sincronizarSuscripcion: vi.fn(async () => undefined),
  alCambiar: null as null | (() => void),
}));

vi.mock('@/api/chat', () => ({
  chat: {
    listarCanales: mocks.listarCanales,
    observarResumen: mocks.observarResumen,
    listarNotificaciones: mocks.listarNotificaciones,
    marcarNotificacionLeida: mocks.marcarNotificacionLeida,
    marcarTodasNotificacionesLeidas: vi.fn(),
  },
}));
vi.mock('@/api/push', () => ({ push: { registrarSuscripcion: vi.fn(), eliminarSuscripcion: vi.fn() } }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'usuario-1' } }) }));
vi.mock('@/features/push/NotificacionesDispositivo', () => ({ NotificacionesDispositivo: () => <p>Botón push</p> }));
vi.mock('@/lib/push/dispositivo', () => ({
  pushActivoEnEsteDispositivo: () => false,
  sincronizarSuscripcion: mocks.sincronizarSuscripcion,
}));
vi.mock('@/lib/push/sonido', async (original) => ({
  ...(await original<typeof import('@/lib/push/sonido')>()),
  tocarTonoMencion: mocks.tocarTonoMencion,
}));
vi.mock('./ChatWorkspace', () => ({
  ChatWorkspace: ({ canalInicialId, mensajeInicialId }: { destinoInicial?: DestinoChat; canalInicialId?: string | null; mensajeInicialId?: string | null }) => (
    <div data-testid="destino-chat">{`canal:${canalInicialId}:mensaje:${mensajeInicialId}`}</div>
  ),
}));

import { ChatPanelProvider, ControlesChat, destinoDesdeNotificacion, mencionesNuevas } from './ChatPanelContext';

const CANAL = '0fefd6f5-e839-462a-8875-08ad45a3d468';
const MENSAJE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const GENERAL: CanalChat = {
  id: 'general', tipo: 'general', entidad_id: null, entidad_nombre: null, ultima_posicion: 0, ultima_lectura: 0, no_leidos: 0,
  ultima_actividad_at: '2026-10-30T12:00:00.000Z', archivado: false, creado_por: null, oculto_desde: 0, puede_gestionar: false,
  creado_at: '2026-10-30T12:00:00.000Z',
};
const mencion = (id: string, tipo: 'directa' | 'todos' = 'directa'): NotificacionChat => ({
  mensaje_id: id, canal_id: CANAL, canal_tipo: 'libre', canal_nombre: 'Equipo Norte', autor_nombre: 'Ana', contenido: 'x',
  tipo, creado_at: '2026-10-30T12:00:00.000Z', leida_at: null,
});

let visibilidad: DocumentVisibilityState = 'visible';

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <p data-testid="ubicacion">{pathname + search}</p>;
}

function renderPanel(ruta = '/dashboard') {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <ChatPanelProvider><ControlesChat /><Ubicacion /></ChatPanelProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  visibilidad = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilidad);
  mocks.listarCanales.mockResolvedValue([GENERAL]);
  mocks.marcarNotificacionLeida.mockResolvedValue(undefined);
  mocks.observarResumen.mockImplementation(async (alCambiar: () => void) => {
    mocks.alCambiar = alCambiar;
    return { cerrar: vi.fn(), resincronizar: vi.fn() };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.alCambiar = null;
});

async function llegaMencion(lista: NotificacionChat[]) {
  await waitFor(() => expect(mocks.alCambiar).not.toBeNull());
  mocks.listarNotificaciones.mockResolvedValue(lista);
  await act(async () => { mocks.alCambiar?.(); });
}

describe('sonido de mención en la app', () => {
  it('no suena por las menciones que ya estaban al cargar; suena por una nueva con la página a la vista', async () => {
    mocks.listarNotificaciones.mockResolvedValue([mencion('vieja')]);
    renderPanel();
    await waitFor(() => expect(mocks.observarResumen).toHaveBeenCalled());
    await waitFor(() => expect(mocks.listarNotificaciones).toHaveBeenCalled());
    expect(mocks.tocarTonoMencion).not.toHaveBeenCalled();

    await llegaMencion([mencion('nueva'), mencion('vieja')]);
    await waitFor(() => expect(mocks.tocarTonoMencion).toHaveBeenCalledWith('directa'));
    expect(mocks.tocarTonoMencion).toHaveBeenCalledOnce();
  });

  it('@all usa el tono suave', async () => {
    mocks.listarNotificaciones.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(mocks.listarNotificaciones).toHaveBeenCalled());
    await llegaMencion([mencion('todos-1', 'todos')]);
    await waitFor(() => expect(mocks.tocarTonoMencion).toHaveBeenCalledWith('todos'));
  });

  it('con la página oculta no suena', async () => {
    mocks.listarNotificaciones.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(mocks.listarNotificaciones).toHaveBeenCalled());
    visibilidad = 'hidden';
    await llegaMencion([mencion('oculta')]);
    await waitFor(() => expect(mocks.listarNotificaciones).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.tocarTonoMencion).not.toHaveBeenCalled();
  });

  it('con «Sonido en la app» apagado no suena', async () => {
    localStorage.setItem('bds.sonidoApp', 'no');
    mocks.listarNotificaciones.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(mocks.listarNotificaciones).toHaveBeenCalled());
    await llegaMencion([mencion('silencio')]);
    await waitFor(() => expect(mocks.listarNotificaciones).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.tocarTonoMencion).not.toHaveBeenCalled();
  });

  it('mencionesNuevas ignora las leídas y las ya vistas', () => {
    expect(mencionesNuevas(new Set(['a']), [mencion('a'), mencion('b'), { ...mencion('c'), leida_at: 'x' }]).map((m) => m.mensaje_id)).toEqual(['b']);
  });
});

describe('abrir el canal desde la notificación push', () => {
  beforeEach(() => mocks.listarNotificaciones.mockResolvedValue([]));

  it('la app abierta en /?chat=…&mensaje=… abre ese canal, marca la mención y limpia la URL', async () => {
    renderPanel(`/?chat=${CANAL}&mensaje=${MENSAJE}`);
    expect(await screen.findByTestId('destino-chat')).toHaveTextContent(`canal:${CANAL}:mensaje:${MENSAJE}`);
    await waitFor(() => expect(mocks.marcarNotificacionLeida).toHaveBeenCalledWith(MENSAJE));
    expect(screen.getByTestId('ubicacion')).toHaveTextContent(/^\/$/);
  });

  it('ignora parámetros que no son identificadores', async () => {
    renderPanel('/?chat=javascript:alert(1)&otro=1');
    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveTextContent('/?otro=1'));
    expect(screen.queryByTestId('destino-chat')).not.toBeInTheDocument();
    expect(destinoDesdeNotificacion(CANAL, 'no-uuid')).toEqual({ canalId: CANAL, mensajeId: null });
  });

  it('con la app ya abierta, el mensaje del service worker abre el canal', async () => {
    const contenedor = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { value: contenedor, configurable: true });
    try {
      renderPanel();
      await waitFor(() => expect(mocks.listarNotificaciones).toHaveBeenCalled());
      act(() => {
        contenedor.dispatchEvent(new MessageEvent('message', { data: { tipo: 'abrir-chat', canalId: CANAL, mensajeId: MENSAJE } }));
      });
      expect(await screen.findByTestId('destino-chat')).toHaveTextContent(`canal:${CANAL}:mensaje:${MENSAJE}`);
    } finally {
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });

  it('al iniciar sesión vuelve a registrar la suscripción existente a nombre del usuario', async () => {
    renderPanel();
    await waitFor(() => expect(mocks.sincronizarSuscripcion).toHaveBeenCalledOnce());
  });
});
