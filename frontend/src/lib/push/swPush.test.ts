// @vitest-environment node
/**
 * public/sw-push.js en un entorno de service worker simulado: cuándo muestra la
 * notificación del sistema y qué hace al tocarla.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const FUENTE = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/sw-push.js'), 'utf8');
const ORIGEN = 'https://bdsecurity.example.com';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CARGA = { titulo: 'Ana te mencionó', cuerpo: 'En General. Abre la app para ver el mensaje.', url: '/?chat=c1&mensaje=m1', tag: 'm1' };

type Ventana = { url: string; visibilityState: 'visible' | 'hidden'; focused: boolean; focus: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };

function montar(ventanas: Ventana[], userAgent = CHROME) {
  const oyentes: Record<string, (evento: unknown) => void> = {};
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => null);
  const self = {
    location: new URL(`${ORIGEN}/sw.js`),
    navigator: { userAgent },
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => ventanas), openWindow },
    addEventListener: (tipo: string, fn: (evento: unknown) => void) => { oyentes[tipo] = fn; },
  };
  vm.runInNewContext(FUENTE, { self, URL });
  async function despachar(tipo: string, evento: Record<string, unknown>) {
    let trabajo: Promise<unknown> = Promise.resolve();
    oyentes[tipo]({ ...evento, waitUntil: (p: Promise<unknown>) => { trabajo = p; } });
    await trabajo;
  }
  return { showNotification, openWindow, despachar };
}

const ventana = (visibilityState: Ventana['visibilityState'], url = `${ORIGEN}/dashboard`, focused = false): Ventana =>
  ({ url, visibilityState, focused, focus: vi.fn(async () => undefined), postMessage: vi.fn() });
const push = (carga: unknown = CARGA) => ({ data: { json: () => carga } });

describe('sw-push.js: evento push', () => {
  it('con la app cerrada muestra la notificación con ícono, badge, tag de la mención y sin silencio', async () => {
    const sw = montar([]);
    await sw.despachar('push', push());
    expect(sw.showNotification).toHaveBeenCalledWith('Ana te mencionó', {
      body: CARGA.cuerpo,
      icon: '/pwa-192x192.png',
      badge: '/badge-96x96.png',
      tag: 'm1',
      renotify: true,
      requireInteraction: true,
      silent: false,
      data: { url: '/?chat=c1&mensaje=m1' },
    });
  });

  it('con la app abierta pero oculta (pestaña en segundo plano) la muestra', async () => {
    const sw = montar([ventana('hidden')]);
    await sw.despachar('push', push());
    expect(sw.showNotification).toHaveBeenCalledOnce();
  });

  it('con una ventana de la app a la vista no la muestra en Chrome/Edge/Firefox (avisa el sonido de la app)', async () => {
    const sw = montar([ventana('hidden'), ventana('visible')]);
    await sw.despachar('push', push());
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it('una ventana visible de OTRO sitio no cuenta como app a la vista', async () => {
    const sw = montar([ventana('visible', 'https://otro.cl/')]);
    await sw.despachar('push', push());
    expect(sw.showNotification).toHaveBeenCalledOnce();
  });

  it('en Safari (iOS) la muestra siempre, aunque la app esté a la vista', async () => {
    const sw = montar([ventana('visible')], SAFARI_IOS);
    await sw.despachar('push', push());
    expect(sw.showNotification).toHaveBeenCalledOnce();
  });

  it('un payload ilegible o con url externa igual muestra un aviso genérico que abre la app', async () => {
    const sw = montar([]);
    await sw.despachar('push', { data: { json: () => { throw new Error('no json'); } } });
    await sw.despachar('push', push({ ...CARGA, url: 'https://atacante.cl' }));
    expect((sw.showNotification.mock.calls[0] as unknown[])[0]).toBe('BDSecurity');
    expect((sw.showNotification.mock.calls[1] as unknown[])[1]).toMatchObject({ data: { url: '/' } });
  });
});

describe('sw-push.js: al tocar la notificación', () => {
  const clic = (url: string) => {
    const notification = { close: vi.fn(), data: { url } };
    return { notification };
  };

  it('con la app abierta la enfoca y le pide abrir ese canal, sin abrir otra ventana', async () => {
    const abierta = ventana('hidden');
    const sw = montar([abierta]);
    const evento = clic('/?chat=c1&mensaje=m1');
    await sw.despachar('notificationclick', evento);
    expect(evento.notification.close).toHaveBeenCalledOnce();
    expect(abierta.focus).toHaveBeenCalledOnce();
    expect(abierta.postMessage).toHaveBeenCalledWith({ tipo: 'abrir-chat', canalId: 'c1', mensajeId: 'm1' });
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it('sin ventana abierta abre la url de la notificación en el mismo sitio', async () => {
    const sw = montar([]);
    await sw.despachar('notificationclick', clic('/?chat=c1&mensaje=m1'));
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGEN}/?chat=c1&mensaje=m1`);
  });

  it('nunca abre un sitio externo', async () => {
    const sw = montar([]);
    await sw.despachar('notificationclick', clic('//atacante.cl/x'));
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGEN}/`);
  });
});
