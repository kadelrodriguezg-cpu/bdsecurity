import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApiChat } from './chat-core';
import { crearEstadoSesionChat, crearSondeoChat, esErrorSesionChat } from './chat-sondeo';
import type { DatabaseConChat } from '@/types/chat';

function fijarVisibilidad(estado: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  fijarVisibilidad('visible');
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('esErrorSesionChat', () => {
  it('reconoce 401, JWT inválido/expirado y los códigos de sesión de PostgREST', () => {
    expect(esErrorSesionChat({ message: 'x' }, 401)).toBe(true);
    expect(esErrorSesionChat({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(esErrorSesionChat({ message: 'invalid JWT: unable to parse' })).toBe(true);
    expect(esErrorSesionChat({ code: '42501', message: 'permiso' }, 403)).toBe(false);
    expect(esErrorSesionChat(null)).toBe(false);
  });
});

describe('crearSondeoChat', () => {
  it('sondea cada intervalo y no hace nada con la pestaña oculta', () => {
    const ejecutar = vi.fn();
    const sondeo = crearSondeoChat({ intervaloMs: 15_000, ejecutar, sesion: crearEstadoSesionChat() });
    sondeo.iniciar();
    vi.advanceTimersByTime(15_000);
    expect(ejecutar).toHaveBeenCalledTimes(1);

    fijarVisibilidad('hidden');
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event('online'));
    expect(ejecutar).toHaveBeenCalledTimes(1);
    sondeo.detener();
  });

  it('al volver a visible hace una petición inmediata y reanuda el intervalo', () => {
    const ejecutar = vi.fn();
    const sondeo = crearSondeoChat({ intervaloMs: 15_000, ejecutar, sesion: crearEstadoSesionChat() });
    fijarVisibilidad('hidden');
    sondeo.iniciar();
    vi.advanceTimersByTime(60_000);
    expect(ejecutar).not.toHaveBeenCalled();

    fijarVisibilidad('visible');
    expect(ejecutar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });

  it('tras un 401 no hay más peticiones aunque pase el tiempo; al volver la sesión se reanuda', () => {
    const ejecutar = vi.fn();
    const sesion = crearEstadoSesionChat();
    const sondeo = crearSondeoChat({ intervaloMs: 15_000, ejecutar, sesion });
    sondeo.iniciar();
    sesion.marcarCaida();

    vi.advanceTimersByTime(300_000);
    window.dispatchEvent(new Event('focus'));
    fijarVisibilidad('hidden');
    fijarVisibilidad('visible');
    expect(ejecutar).not.toHaveBeenCalled();

    sesion.restaurar();
    expect(ejecutar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });

  it('detener elimina temporizador y listeners', () => {
    const ejecutar = vi.fn();
    const sondeo = crearSondeoChat({ intervaloMs: 15_000, ejecutar, sesion: crearEstadoSesionChat() });
    sondeo.iniciar();
    sondeo.detener();
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event('online'));
    fijarVisibilidad('hidden');
    fijarVisibilidad('visible');
    expect(ejecutar).not.toHaveBeenCalled();
  });
});

describe('observarCanal / observarResumen con sesión caída', () => {
  function montar() {
    let cambioAuth: ((evento: string, sesion: { user: { id: string } } | null) => void) | undefined;
    const respuestas: Array<{ data: unknown; error: unknown; status: number }> = [];
    const consulta = {
      select: vi.fn(() => consulta), eq: vi.fn(() => consulta), gt: vi.fn(() => consulta), lt: vi.fn(() => consulta),
      order: vi.fn(() => consulta),
      limit: vi.fn(() => Promise.resolve(respuestas.shift() ?? { data: [], error: null, status: 200 })),
    };
    const canalRealtime = {
      on: vi.fn(() => canalRealtime),
      subscribe: vi.fn(() => canalRealtime),
    };
    const rpc = vi.fn(() => Promise.resolve(respuestas.shift() ?? { data: [], error: null, status: 200 }));
    const cliente = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usuario-1' } }, error: null }),
        onAuthStateChange: vi.fn((callback) => {
          cambioAuth = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
      },
      from: vi.fn(() => consulta),
      rpc,
      channel: vi.fn(() => canalRealtime),
      removeChannel: vi.fn(),
    } as unknown as SupabaseClient<DatabaseConChat>;
    return { cliente, consulta, rpc, respuestas, emitir: (e: string) => cambioAuth?.(e, { user: { id: 'usuario-1' } }) };
  }

  it('el sondeo del canal se detiene tras un 401 y se reanuda con TOKEN_REFRESHED', async () => {
    const { cliente, consulta, respuestas, emitir } = montar();
    const alError = vi.fn();
    // Sincronización inicial correcta.
    respuestas.push({ data: [], error: null, status: 200 });
    const control = await crearApiChat(cliente).observarCanal('canal-1', {
      desde: 0, onMensajes: vi.fn(), onEstado: vi.fn(), onError: alError,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(consulta.limit).toHaveBeenCalledTimes(1);

    // El siguiente tick recibe un 401.
    respuestas.push({ data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(consulta.limit).toHaveBeenCalledTimes(2);
    expect(alError).toHaveBeenCalledWith(expect.objectContaining({ name: 'ErrorSesionChat' }));

    await vi.advanceTimersByTimeAsync(600_000);
    expect(consulta.limit).toHaveBeenCalledTimes(2);

    emitir('TOKEN_REFRESHED');
    await vi.advanceTimersByTimeAsync(0);
    expect(consulta.limit).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(consulta.limit).toHaveBeenCalledTimes(4);
    control.cerrar();
  });

  it('el sondeo del resumen no avisa con la pestaña oculta y calla tras un 401 de las consultas', async () => {
    const { cliente, rpc } = montar();
    const api = crearApiChat(cliente);
    const alCambiar = vi.fn(() => { void api.listarCanales().catch(() => undefined); });
    const control = await api.observarResumen(alCambiar);
    expect(alCambiar).not.toHaveBeenCalled();

    fijarVisibilidad('hidden');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(alCambiar).not.toHaveBeenCalled();

    fijarVisibilidad('visible');
    expect(alCambiar).toHaveBeenCalledTimes(1);

    // Esta consulta ya estaba en vuelo cuando llegó el 401.
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 } as never);
    await api.listarCanales().catch(() => undefined);
    const antes = alCambiar.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(alCambiar.mock.calls.length).toBe(antes);
    control.cerrar();
  });
});
