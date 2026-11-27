import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import webpush from 'web-push';

/**
 * Envía las notificaciones push de una mención (docs/diseno_notificaciones_push.md).
 * La llama solo la base (trigger y cron vía pg_net) con el secreto compartido
 * en `x-push-secreto`. No recibe ninguna credencial de Supabase: solo las
 * suscripciones del destinatario y un título y cuerpo sin el texto del mensaje.
 * Responde el estado HTTP de cada suscripción para que la base lo recoja.
 */
type SolicitudVercel = IncomingMessage & { body?: unknown };

type RespuestaVercel = ServerResponse & {
  status: (codigo: number) => RespuestaVercel;
  json: (cuerpo: unknown) => RespuestaVercel;
};

export interface SuscripcionPush {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NotificacionPush {
  titulo: string;
  cuerpo: string;
  url: string;
  tag: string;
}

const MAXIMO_SUSCRIPCIONES = 10;
const MAXIMO_CUERPO_BYTES = 32_000;
/** El servicio push guarda el mensaje hasta 24 h si el dispositivo está apagado. */
const TTL_SEGUNDOS = 24 * 60 * 60;
/** pg_net espera 15 s: cada envío individual tiene que terminar antes. */
const TIEMPO_MAXIMO_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mismos servicios push que acepta la base (push_suscripcion_endpoint_valido). */
const HOSTS_PUSH = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const CLAVE_P256DH = /^[A-Za-z0-9_-]{80,100}={0,2}$/;
const CLAVE_AUTH = /^[A-Za-z0-9_-]{16,32}={0,2}$/;

export function endpointPermitido(valor: unknown): valor is string {
  if (typeof valor !== 'string' || valor.length > 1000 || /\s/.test(valor)) return false;
  let destino: URL;
  try {
    destino = new URL(valor);
  } catch {
    return false;
  }
  return destino.protocol === 'https:'
    && (destino.port === '' || destino.port === '443')
    && !destino.username && !destino.password
    && HOSTS_PUSH.test(destino.hostname);
}

const texto = (valor: unknown, maximo: number): valor is string =>
  typeof valor === 'string' && valor.trim().length > 0 && valor.length <= maximo;

function leerSuscripcion(fila: unknown): SuscripcionPush | null {
  if (!fila || typeof fila !== 'object') return null;
  const { id, endpoint, p256dh, auth } = fila as Record<string, unknown>;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (!endpointPermitido(endpoint)) return null;
  if (typeof p256dh !== 'string' || !CLAVE_P256DH.test(p256dh)) return null;
  if (typeof auth !== 'string' || !CLAVE_AUTH.test(auth)) return null;
  return { id, endpoint, p256dh, auth };
}

function leerNotificacion(valor: unknown): NotificacionPush | null {
  if (!valor || typeof valor !== 'object') return null;
  const { titulo, cuerpo, url, tag } = valor as Record<string, unknown>;
  if (!texto(titulo, 120) || !texto(cuerpo, 240) || !texto(tag, 100)) return null;
  // Solo rutas internas: la notificación nunca abre otro sitio.
  if (!texto(url, 300) || !url.startsWith('/') || url.startsWith('//')) return null;
  return { titulo, cuerpo, url, tag };
}

export function leerPedido(cuerpo: unknown): { suscripciones: SuscripcionPush[]; notificacion: NotificacionPush } | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const { suscripciones, notificacion } = cuerpo as Record<string, unknown>;
  if (!Array.isArray(suscripciones) || suscripciones.length === 0 || suscripciones.length > MAXIMO_SUSCRIPCIONES) return null;
  const leidas = suscripciones.map(leerSuscripcion);
  if (leidas.some((s) => s === null)) return null;
  const leida = leerNotificacion(notificacion);
  if (!leida) return null;
  return { suscripciones: leidas as SuscripcionPush[], notificacion: leida };
}

/** Compara en tiempo constante (los hash igualan el largo, así tampoco se filtra). */
function secretoCorrecto(recibido: unknown, esperado: string): boolean {
  if (typeof recibido !== 'string' || !recibido) return false;
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

async function leerCuerpo(request: SolicitudVercel): Promise<unknown> {
  // En Vercel el cuerpo JSON ya llega parseado; si no, se lee el stream con tope.
  if (request.body !== undefined) {
    if (typeof request.body === 'string') return JSON.parse(request.body);
    if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString('utf8'));
    return request.body;
  }
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of request) {
    const buffer = Buffer.isBuffer(parte) ? parte : Buffer.from(parte as string);
    total += buffer.length;
    if (total > MAXIMO_CUERPO_BYTES) throw new Error('cuerpo demasiado grande');
    partes.push(buffer);
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

function estadoDe(resultado: PromiseSettledResult<{ statusCode: number }>): number {
  if (resultado.status === 'fulfilled') return resultado.value.statusCode;
  const codigo = (resultado.reason as { statusCode?: unknown } | null)?.statusCode;
  // 0 = sin respuesta del servicio push (red, tiempo agotado): la base lo reintenta.
  return typeof codigo === 'number' ? codigo : 0;
}

export default async function pushEnviar(request: SolicitudVercel, response: RespuestaVercel): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const secreto = process.env.PUSH_SECRETO;
  const publica = process.env.VAPID_PUBLIC_KEY;
  const privada = process.env.VAPID_PRIVATE_KEY;
  const sujeto = process.env.VAPID_SUBJECT;
  if (!secreto || !publica || !privada || !sujeto) {
    console.error('push-enviar: falta configuración en el entorno.');
    response.status(503).json({ error: 'No disponible.' });
    return;
  }
  if (!secretoCorrecto(request.headers['x-push-secreto'], secreto)) {
    response.status(401).json({ error: 'No autorizado.' });
    return;
  }

  let pedido: ReturnType<typeof leerPedido>;
  try {
    pedido = leerPedido(await leerCuerpo(request));
  } catch {
    pedido = null;
  }
  if (!pedido) {
    response.status(400).json({ error: 'Pedido inválido.' });
    return;
  }

  const carga = JSON.stringify(pedido.notificacion);
  const resultados = await Promise.allSettled(pedido.suscripciones.map((s) => webpush.sendNotification(
    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
    carga,
    {
      TTL: TTL_SEGUNDOS,
      urgency: 'high',
      timeout: TIEMPO_MAXIMO_MS,
      vapidDetails: { subject: sujeto, publicKey: publica, privateKey: privada },
    },
  )));
  const estados = resultados.map((r, i) => ({ id: pedido.suscripciones[i].id, estado: estadoDe(r) }));

  // Solo conteos: ningún endpoint, clave ni texto llega a los logs.
  console.info('push-enviar', {
    total: estados.length,
    entregados: estados.filter((e) => e.estado >= 200 && e.estado < 300).length,
    vencidos: estados.filter((e) => e.estado === 404 || e.estado === 410).length,
    errores: estados.filter((e) => e.estado === 0 || e.estado >= 400 && e.estado !== 404 && e.estado !== 410).length,
  });
  response.status(200).json({ resultados: estados });
}
