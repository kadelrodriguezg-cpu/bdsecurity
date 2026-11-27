import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { combinarMensajesChat, crearApiChat, prepararMensajeChat } from './chat-core';
import type { DatabaseConChat, MensajeChat } from '@/types/chat';

function mensaje(id: string, posicion: number, contenido = id): MensajeChat {
  return {
    id,
    posicion,
    contenido,
    canal_id: 'canal',
    autor_id: 'autor',
    autor_nombre: 'Nombre',
    clave_envio: crypto.randomUUID(),
    creado_at: '2026-09-07T12:00:00.000Z',
  };
}

describe('chat-core', () => {
  it('crea una clave estable que puede reutilizarse al reintentar', () => {
    const envio = prepararMensajeChat('canal', '  Avance terminado  ');
    expect(envio).toMatchObject({ canalId: 'canal', contenido: 'Avance terminado' });
    expect(envio.claveEnvio).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.isFrozen(envio)).toBe(true);
  });

  it('rechaza mensajes vacíos o sobre el límite antes de usar la red', () => {
    expect(() => prepararMensajeChat('canal', ' \n ')).toThrow('1 y 4000');
    expect(() => prepararMensajeChat('canal', 'x'.repeat(4001))).toThrow('1 y 4000');
  });

  it('deduplica por id y conserva el orden asignado por el servidor', () => {
    expect(combinarMensajesChat(
      [mensaje('b', 2, 'viejo'), mensaje('a', 1)],
      [mensaje('b', 2, 'confirmado'), mensaje('c', 3)],
    ).map(({ id, contenido }) => ({ id, contenido }))).toEqual([
      { id: 'a', contenido: 'a' },
      { id: 'b', contenido: 'confirmado' },
      { id: 'c', contenido: 'c' },
    ]);
  });

  it('deduplica el mismo mensaje recibido por dos pestañas y por la confirmación HTTP', () => {
    const confirmado = mensaje('mensaje-compartido', 8, 'Confirmado una vez');
    const desdePestanaA = combinarMensajesChat([], [confirmado]);
    const desdePestanaB = combinarMensajesChat(desdePestanaA, [confirmado, confirmado]);
    const trasRespuestaHttp = combinarMensajesChat(desdePestanaB, [confirmado]);

    expect(trasRespuestaHttp).toEqual([confirmado]);
  });

  it('revalida el resumen al recuperar red y elimina socket y listeners al cerrar sesión', async () => {
    const callbacks: Record<string, (evento: { new: Record<string, unknown> }) => void> = {};
    let cambioAuth: ((_evento: string, sesion: { user: { id: string } } | null) => void) | undefined;
    const cancelarAuth = vi.fn();
    const quitarCanal = vi.fn();
    const canalRealtime = {
      on: vi.fn((_tipo: string, filtro: { table: string }, callback: (evento: { new: Record<string, unknown> }) => void) => {
        callbacks[filtro.table] = callback;
        return canalRealtime;
      }),
      subscribe: vi.fn((callback: (estado: string) => void) => {
        callback('SUBSCRIBED');
        return canalRealtime;
      }),
    };
    const cliente = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usuario-1' } }, error: null }),
        onAuthStateChange: vi.fn((callback) => {
          cambioAuth = callback;
          return { data: { subscription: { unsubscribe: cancelarAuth } } };
        }),
      },
      channel: vi.fn(() => canalRealtime),
      removeChannel: quitarCanal,
    } as unknown as SupabaseClient<DatabaseConChat>;
    const alCambiar = vi.fn();

    const control = await crearApiChat(cliente).observarResumen(alCambiar);
    expect(alCambiar).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('online'));
    callbacks.chat_mensajes({ new: {} });
    callbacks.chat_lecturas({ new: { usuario_id: 'usuario-1' } });
    expect(alCambiar).toHaveBeenCalledTimes(4);

    cambioAuth?.('SIGNED_OUT', null);
    expect(cancelarAuth).toHaveBeenCalledOnce();
    expect(quitarCanal).toHaveBeenCalledWith(canalRealtime);
    window.dispatchEvent(new Event('online'));
    expect(alCambiar).toHaveBeenCalledTimes(4);

    control.cerrar();
    expect(quitarCanal).toHaveBeenCalledOnce();
  });
});
