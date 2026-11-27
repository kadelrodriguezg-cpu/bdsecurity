/**
 * Suscripción push de ESTE dispositivo (docs/diseno_notificaciones_push.md).
 * El permiso del navegador se pide solo desde activarPush(), es decir, cuando
 * la persona toca el botón; nunca al abrir la app.
 */
import { esIOS } from './reglaNotificacion';

export type EstadoPush =
  | { tipo: 'no_soportado' }
  | { tipo: 'iphone_sin_instalar' }
  | { tipo: 'disponible' }
  | { tipo: 'activado' }
  | { tipo: 'bloqueado' };

export interface ApiSuscripciones {
  registrarSuscripcion: (datos: { endpoint: string; p256dh: string; auth: string; userAgent?: string }) => Promise<void>;
  eliminarSuscripcion: (endpoint: string) => Promise<void>;
}

/** Lo que se usa del navegador; las pruebas lo reemplazan. */
export interface EntornoPush {
  userAgent: string;
  plataforma: string;
  puntosTactiles: number;
  standalone: boolean;
  soportado: boolean;
  permiso: () => NotificationPermission;
  pedirPermiso: () => Promise<NotificationPermission>;
  /**
   * El registro del service worker, solo cuando su worker ya está ACTIVO (o undefined tras esperar).
   * Nunca se usa pushManager sobre un worker que se está instalando: en Chromium esa llamada queda
   * pendiente y deja en cola todas las operaciones push siguientes, incluida la suscripción.
   */
  registro: () => Promise<Pick<ServiceWorkerRegistration, 'pushManager'> | undefined>;
  clavePublica: string | undefined;
}

/** En la primera visita el worker precarga la app (unos 3 MB) antes de activarse. */
const ESPERA_ACTIVO_MS = 30_000;
/** Tope para la respuesta del servicio push del navegador al suscribirse. */
const ESPERA_SUSCRIPCION_MS = 30_000;

function conTope<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promesa,
    new Promise<never>((_, rechazar) => { temporizador = setTimeout(() => rechazar(new Error(mensaje)), ms); }),
  ]).finally(() => clearTimeout(temporizador));
}

export function entornoDelNavegador(): EntornoPush {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const soportado = !!nav && 'serviceWorker' in nav && typeof window !== 'undefined'
    && 'PushManager' in window && 'Notification' in window;
  return {
    userAgent: nav?.userAgent ?? '',
    plataforma: nav?.platform ?? '',
    puntosTactiles: nav?.maxTouchPoints ?? 0,
    standalone: typeof window !== 'undefined' && (
      window.matchMedia?.('(display-mode: standalone)').matches
      || (nav as Navigator & { standalone?: boolean } | undefined)?.standalone === true
    ),
    soportado,
    permiso: () => Notification.permission,
    pedirPermiso: () => Notification.requestPermission(),
    registro: async () => {
      if (!soportado) return undefined;
      const actual = await navigator.serviceWorker.getRegistration();
      if (actual?.active) return actual;
      // En el primer arranque el worker puede estar instalándose todavía: se espera a que se active.
      return Promise.race([
        navigator.serviceWorker.ready,
        new Promise<undefined>((resolver) => setTimeout(() => resolver(undefined), ESPERA_ACTIVO_MS)),
      ]);
    },
    clavePublica: import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined,
  };
}

let activoLocal = false;
/** ¿Este navegador tiene una suscripción activa? Lo usa el sonido de la app. */
export function pushActivoEnEsteDispositivo(): boolean {
  return activoLocal;
}

function bytesDeClave(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const binario = atob((base64url + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function mismaClave(actual: ArrayBuffer | null | undefined, esperada: Uint8Array): boolean {
  if (!actual) return true; // el navegador no la expone: se asume la misma
  const a = new Uint8Array(actual);
  return a.length === esperada.length && a.every((byte, i) => byte === esperada[i]);
}

function datosDe(suscripcion: PushSubscription) {
  const json = suscripcion.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error('Este navegador entregó una suscripción incompleta.');
  return { endpoint: json.endpoint, p256dh, auth };
}

export async function leerEstadoPush(entorno: EntornoPush = entornoDelNavegador()): Promise<EstadoPush> {
  activoLocal = false;
  if (esIOS(entorno.userAgent, entorno.plataforma, entorno.puntosTactiles) && !entorno.standalone) {
    return { tipo: 'iphone_sin_instalar' };
  }
  if (!entorno.soportado || !entorno.clavePublica) return { tipo: 'no_soportado' };
  if (entorno.permiso() === 'denied') return { tipo: 'bloqueado' };
  const registro = await entorno.registro();
  // Worker aún sin activar: se puede intentar activar (activarPush vuelve a esperarlo).
  if (!registro) return { tipo: 'disponible' };
  const suscripcion = await registro.pushManager.getSubscription();
  activoLocal = !!suscripcion && entorno.permiso() === 'granted';
  return activoLocal ? { tipo: 'activado' } : { tipo: 'disponible' };
}

export async function activarPush(api: ApiSuscripciones, entorno: EntornoPush = entornoDelNavegador()): Promise<EstadoPush> {
  const previo = await leerEstadoPush(entorno);
  if (previo.tipo !== 'disponible' && previo.tipo !== 'activado') return previo;
  const permiso = entorno.permiso() === 'granted' ? 'granted' : await entorno.pedirPermiso();
  if (permiso === 'denied') return { tipo: 'bloqueado' };
  if (permiso !== 'granted') return { tipo: 'disponible' };

  if (!entorno.clavePublica) return { tipo: 'no_soportado' };
  const registro = await entorno.registro();
  if (!registro) {
    throw new Error('La app todavía se está instalando en este dispositivo. Espera unos segundos y vuelve a intentarlo.');
  }
  const clave = bytesDeClave(entorno.clavePublica);
  let suscripcion = await registro.pushManager.getSubscription();
  if (suscripcion && !mismaClave(suscripcion.options?.applicationServerKey, clave)) {
    // Las claves VAPID cambiaron: la suscripción vieja ya no sirve.
    await suscripcion.unsubscribe();
    suscripcion = null;
  }
  suscripcion ??= await conTope(
    registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave }),
    ESPERA_SUSCRIPCION_MS,
    'El servicio de notificaciones del navegador no respondió. Revisa tu conexión e intenta de nuevo.',
  );
  try {
    await api.registrarSuscripcion({ ...datosDe(suscripcion), userAgent: entorno.userAgent });
  } catch (error) {
    // Sin registro en la base, la suscripción local no sirve: se deshace.
    await suscripcion.unsubscribe().catch(() => undefined);
    throw error;
  }
  activoLocal = true;
  return { tipo: 'activado' };
}

export async function desactivarPush(api: ApiSuscripciones, entorno: EntornoPush = entornoDelNavegador()): Promise<EstadoPush> {
  const registro = await entorno.registro();
  const suscripcion = await registro?.pushManager.getSubscription();
  if (suscripcion) {
    const { endpoint } = suscripcion;
    await suscripcion.unsubscribe();
    activoLocal = false;
    await api.eliminarSuscripcion(endpoint);
  }
  return leerEstadoPush(entorno);
}

/**
 * Al iniciar sesión con una suscripción ya activa en este navegador, se vuelve
 * a registrar: así queda a nombre de quien usa el dispositivo ahora.
 */
export async function sincronizarSuscripcion(api: ApiSuscripciones, entorno: EntornoPush = entornoDelNavegador()): Promise<void> {
  const estado = await leerEstadoPush(entorno);
  if (estado.tipo !== 'activado') return;
  const registro = await entorno.registro();
  const suscripcion = await registro?.pushManager.getSubscription();
  if (suscripcion) await api.registrarSuscripcion({ ...datosDe(suscripcion), userAgent: entorno.userAgent });
}

/**
 * Cierre de sesión: en un PC compartido nadie debe seguir recibiendo las
 * menciones de otra persona. Se borra en el servidor (todavía con sesión) y se
 * anula la suscripción del navegador. Nunca bloquea el cierre de sesión.
 */
export async function olvidarPushAlCerrarSesion(
  api: ApiSuscripciones,
  entorno: EntornoPush = entornoDelNavegador(),
  topeMs = 3000,
): Promise<void> {
  try {
    if (!entorno.soportado) return;
    const registro = await Promise.race([
      entorno.registro(),
      new Promise<undefined>((resolver) => setTimeout(() => resolver(undefined), topeMs)),
    ]);
    const suscripcion = await registro?.pushManager.getSubscription();
    if (!suscripcion) return;
    const { endpoint } = suscripcion;
    await Promise.race([
      api.eliminarSuscripcion(endpoint).catch(() => undefined),
      new Promise((resolver) => setTimeout(resolver, topeMs)),
    ]);
    // Aunque el servidor no responda, anular la suscripción local la invalida:
    // el próximo envío recibe 410 y el cron borra la fila.
    await suscripcion.unsubscribe().catch(() => undefined);
  } catch {
    // El cierre de sesión sigue igual.
  } finally {
    activoLocal = false;
  }
}
