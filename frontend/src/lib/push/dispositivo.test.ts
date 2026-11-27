import { describe, expect, it, vi } from 'vitest';
import {
  activarPush,
  desactivarPush,
  leerEstadoPush,
  olvidarPushAlCerrarSesion,
  pushActivoEnEsteDispositivo,
  sincronizarSuscripcion,
  type EntornoPush,
} from './dispositivo';

const CLAVE = 'BPrueba_clave-publica-vapid-de-prueba-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP';
const CHROME_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function suscripcionFalsa(endpoint = 'https://fcm.googleapis.com/fcm/send/abc') {
  return {
    endpoint,
    options: { applicationServerKey: null },
    toJSON: () => ({ endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

function entorno(opciones: Partial<EntornoPush> & { suscripcion?: ReturnType<typeof suscripcionFalsa> | null; permisoInicial?: NotificationPermission } = {}) {
  let permiso: NotificationPermission = opciones.permisoInicial ?? 'default';
  let actual = opciones.suscripcion ?? null;
  const pushManager = {
    getSubscription: vi.fn(async () => actual),
    subscribe: vi.fn(async () => { actual = suscripcionFalsa(); return actual; }),
  };
  const pedirPermiso = vi.fn(async () => { permiso = 'granted'; return permiso; });
  const e: EntornoPush = {
    userAgent: CHROME_PC,
    plataforma: 'Win32',
    puntosTactiles: 0,
    standalone: false,
    soportado: true,
    permiso: () => permiso,
    pedirPermiso,
    registro: async () => ({ pushManager }) as unknown as ServiceWorkerRegistration,
    clavePublica: CLAVE,
    ...opciones,
  };
  return { e, pushManager, pedirPermiso, fijarPermiso: (p: NotificationPermission) => { permiso = p; } };
}

const api = () => ({ registrarSuscripcion: vi.fn().mockResolvedValue(undefined), eliminarSuscripcion: vi.fn().mockResolvedValue(undefined) });

describe('estado del botón en cada dispositivo', () => {
  it('no soportado: navegador sin Push API o sin clave VAPID', async () => {
    expect(await leerEstadoPush(entorno({ soportado: false }).e)).toEqual({ tipo: 'no_soportado' });
    expect(await leerEstadoPush(entorno({ clavePublica: undefined }).e)).toEqual({ tipo: 'no_soportado' });
  });

  it('con el worker aún sin activar no toca pushManager y deja el botón disponible', async () => {
    expect(await leerEstadoPush(entorno({ registro: async () => undefined }).e)).toEqual({ tipo: 'disponible' });
  });

  it('iPhone sin instalar: Safari en pestaña (aunque no tenga Push API) pide agregar a la pantalla de inicio', async () => {
    expect(await leerEstadoPush(entorno({ userAgent: IPHONE, plataforma: 'iPhone', soportado: false }).e)).toEqual({ tipo: 'iphone_sin_instalar' });
    // iPadOS se presenta como Mac con pantalla táctil.
    expect(await leerEstadoPush(entorno({ userAgent: IPHONE.replace('iPhone', 'Macintosh'), plataforma: 'MacIntel', puntosTactiles: 5 }).e))
      .toEqual({ tipo: 'iphone_sin_instalar' });
    // Instalada (standalone) ya puede activarse.
    expect(await leerEstadoPush(entorno({ userAgent: IPHONE, plataforma: 'iPhone', standalone: true }).e)).toEqual({ tipo: 'disponible' });
  });

  it('permiso no pedido → disponible; sin pedir permiso al leer el estado', async () => {
    const { e, pedirPermiso } = entorno();
    expect(await leerEstadoPush(e)).toEqual({ tipo: 'disponible' });
    expect(pedirPermiso).not.toHaveBeenCalled();
  });

  it('activado en este dispositivo', async () => {
    const { e } = entorno({ permisoInicial: 'granted', suscripcion: suscripcionFalsa() });
    expect(await leerEstadoPush(e)).toEqual({ tipo: 'activado' });
    expect(pushActivoEnEsteDispositivo()).toBe(true);
  });

  it('bloqueado: no vuelve a pedir el permiso ni al tocar Activar', async () => {
    const { e, pedirPermiso, pushManager } = entorno({ permisoInicial: 'denied' });
    expect(await leerEstadoPush(e)).toEqual({ tipo: 'bloqueado' });
    expect(await activarPush(api(), e)).toEqual({ tipo: 'bloqueado' });
    expect(pedirPermiso).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe('activar y desactivar', () => {
  it('activar pide el permiso, suscribe con la clave VAPID y registra en la base', async () => {
    const { e, pedirPermiso, pushManager } = entorno();
    const a = api();
    expect(await activarPush(a, e)).toEqual({ tipo: 'activado' });
    expect(pedirPermiso).toHaveBeenCalledOnce();
    const opciones = (pushManager.subscribe.mock.calls[0] as unknown as [PushSubscriptionOptionsInit])[0];
    expect(opciones.userVisibleOnly).toBe(true);
    expect(opciones.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(a.registrarSuscripcion).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'B'.repeat(87), auth: 'A'.repeat(22), userAgent: CHROME_PC,
    });
  });

  it('si el usuario rechaza el permiso queda bloqueado y no se suscribe', async () => {
    const { e, pushManager } = entorno();
    e.pedirPermiso = vi.fn().mockResolvedValue('denied');
    expect(await activarPush(api(), e)).toEqual({ tipo: 'bloqueado' });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('si la base rechaza el registro, deshace la suscripción del navegador y propaga el error', async () => {
    const { e, pushManager } = entorno();
    const a = api();
    a.registrarSuscripcion.mockRejectedValue(new Error('No se pudo activar'));
    await expect(activarPush(a, e)).rejects.toThrow('No se pudo activar');
    const creada = await pushManager.subscribe.mock.results[0].value;
    expect(creada.unsubscribe).toHaveBeenCalledOnce();
  });

  it('con el service worker aún instalándose no se suscribe: avisa que espere (antes quedaba «Activando…» para siempre)', async () => {
    const { e, pushManager } = entorno();
    e.registro = async () => undefined;
    await expect(activarPush(api(), e)).rejects.toThrow('todavía se está instalando');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('si el servicio push del navegador no responde, corta con un error en vez de quedar esperando', async () => {
    vi.useFakeTimers();
    try {
      const { e, pushManager } = entorno();
      pushManager.subscribe.mockImplementation(() => new Promise(() => undefined));
      const resultado = activarPush(api(), e);
      const comprobacion = expect(resultado).rejects.toThrow('no respondió');
      await vi.advanceTimersByTimeAsync(30_000);
      await comprobacion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('desactivar anula la suscripción y la borra en la base', async () => {
    const sub = suscripcionFalsa();
    const { e } = entorno({ permisoInicial: 'granted', suscripcion: sub });
    const a = api();
    await desactivarPush(a, e);
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    expect(a.eliminarSuscripcion).toHaveBeenCalledWith(sub.endpoint);
  });

  it('al iniciar sesión con push activo se vuelve a registrar a nombre del usuario actual', async () => {
    const { e } = entorno({ permisoInicial: 'granted', suscripcion: suscripcionFalsa() });
    const a = api();
    await sincronizarSuscripcion(a, e);
    expect(a.registrarSuscripcion).toHaveBeenCalledOnce();
    const sinSub = api();
    await sincronizarSuscripcion(sinSub, entorno().e);
    expect(sinSub.registrarSuscripcion).not.toHaveBeenCalled();
  });
});

describe('cierre de sesión', () => {
  it('borra la suscripción en la base (antes del signOut) y la anula en el navegador', async () => {
    const sub = suscripcionFalsa();
    const { e } = entorno({ permisoInicial: 'granted', suscripcion: sub });
    const a = api();
    await olvidarPushAlCerrarSesion(a, e);
    expect(a.eliminarSuscripcion).toHaveBeenCalledWith(sub.endpoint);
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    expect(pushActivoEnEsteDispositivo()).toBe(false);
  });

  it('sin red no bloquea el cierre: espera un tope y anula igual la suscripción local', async () => {
    const sub = suscripcionFalsa();
    const { e } = entorno({ permisoInicial: 'granted', suscripcion: sub });
    const a = api();
    a.eliminarSuscripcion.mockImplementation(() => new Promise(() => undefined));
    await olvidarPushAlCerrarSesion(a, e, 20);
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
  });

  it('sin suscripción ni soporte no hace nada', async () => {
    const a = api();
    await olvidarPushAlCerrarSesion(a, entorno().e);
    await olvidarPushAlCerrarSesion(a, entorno({ soportado: false }).e);
    expect(a.eliminarSuscripcion).not.toHaveBeenCalled();
  });
});
