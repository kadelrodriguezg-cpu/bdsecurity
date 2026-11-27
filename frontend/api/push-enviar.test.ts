// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enviar = vi.hoisted(() => vi.fn());
vi.mock('web-push', () => ({ default: { sendNotification: enviar } }));

import pushEnviar, { endpointPermitido, leerPedido } from './push-enviar';

const SECRETO = 'secreto-de-prueba-0123456789abcdef';
const SUB_A = { id: '11111111-1111-4111-8111-111111111111', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
const SUB_B = { id: '22222222-2222-4222-8222-222222222222', endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz', p256dh: 'C'.repeat(87), auth: 'D'.repeat(22) };
const NOTIFICACION = { titulo: 'Ana te mencionó', cuerpo: 'En General. Abre la app para ver el mensaje.', url: '/?chat=c&mensaje=m', tag: 'm' };

function respuesta() {
  const cuerpo: { status?: number; json?: unknown; headers: Record<string, string> } = { headers: {} };
  const mock = {
    setHeader: vi.fn((nombre: string, valor: string) => { cuerpo.headers[nombre] = valor; }),
    status: vi.fn((codigo: number) => { cuerpo.status = codigo; return mock; }),
    json: vi.fn((valor: unknown) => { cuerpo.json = valor; return mock; }),
  };
  return { cuerpo, mock };
}

const SIN_SECRETO = Symbol('sin secreto');
const pedido = (body: unknown, secreto: string | typeof SIN_SECRETO = SECRETO, method = 'POST') =>
  ({ method, headers: secreto === SIN_SECRETO ? {} : { 'x-push-secreto': secreto }, body }) as never;

beforeEach(() => {
  vi.stubEnv('PUSH_SECRETO', SECRETO);
  vi.stubEnv('VAPID_PUBLIC_KEY', 'clave-publica');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'clave-privada-que-no-debe-aparecer');
  vi.stubEnv('VAPID_SUBJECT', 'mailto:prueba@ejemplo.cl');
  enviar.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('push-enviar: autenticación', () => {
  it('solo acepta POST', async () => {
    const salida = respuesta();
    await pushEnviar(pedido({}, SECRETO, 'GET'), salida.mock as never);
    expect(salida.cuerpo.status).toBe(405);
    expect(salida.cuerpo.headers.Allow).toBe('POST');
  });

  it('responde 401 sin detalle si falta el secreto o no calza, sin llamar a web-push', async () => {
    for (const secreto of [SIN_SECRETO, '', 'otro', `${SECRETO}x`, SECRETO.slice(0, -1)] as const) {
      const salida = respuesta();
      await pushEnviar(pedido({ suscripciones: [SUB_A], notificacion: NOTIFICACION }, secreto), salida.mock as never);
      expect(salida.cuerpo.status, String(secreto)).toBe(401);
      expect(salida.cuerpo.json).toEqual({ error: 'No autorizado.' });
    }
    expect(enviar).not.toHaveBeenCalled();
  });

  it('sin configuración en el entorno responde 503 y no envía', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    const salida = respuesta();
    await pushEnviar(pedido({ suscripciones: [SUB_A], notificacion: NOTIFICACION }), salida.mock as never);
    expect(salida.cuerpo.status).toBe(503);
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('push-enviar: validación del pedido', () => {
  const invalidos: Array<[string, unknown]> = [
    ['sin cuerpo', undefined],
    ['texto no JSON', 'no es json'],
    ['sin suscripciones', { suscripciones: [], notificacion: NOTIFICACION }],
    ['11 suscripciones', { suscripciones: Array.from({ length: 11 }, () => SUB_A), notificacion: NOTIFICACION }],
    ['endpoint http', { suscripciones: [{ ...SUB_A, endpoint: 'http://fcm.googleapis.com/x' }], notificacion: NOTIFICACION }],
    ['endpoint IP privada', { suscripciones: [{ ...SUB_A, endpoint: 'https://10.0.0.1/x' }], notificacion: NOTIFICACION }],
    ['endpoint metadatos', { suscripciones: [{ ...SUB_A, endpoint: 'https://169.254.169.254/latest' }], notificacion: NOTIFICACION }],
    ['host que imita', { suscripciones: [{ ...SUB_A, endpoint: 'https://fcm.googleapis.com.atacante.cl/x' }], notificacion: NOTIFICACION }],
    ['endpoint con credenciales', { suscripciones: [{ ...SUB_A, endpoint: 'https://u:p@fcm.googleapis.com/x' }], notificacion: NOTIFICACION }],
    ['puerto raro', { suscripciones: [{ ...SUB_A, endpoint: 'https://fcm.googleapis.com:8443/x' }], notificacion: NOTIFICACION }],
    ['id no uuid', { suscripciones: [{ ...SUB_A, id: '1' }], notificacion: NOTIFICACION }],
    ['clave corta', { suscripciones: [{ ...SUB_A, p256dh: 'abc' }], notificacion: NOTIFICACION }],
    ['título largo', { suscripciones: [SUB_A], notificacion: { ...NOTIFICACION, titulo: 'x'.repeat(121) } }],
    ['cuerpo largo', { suscripciones: [SUB_A], notificacion: { ...NOTIFICACION, cuerpo: 'x'.repeat(241) } }],
    ['url externa', { suscripciones: [SUB_A], notificacion: { ...NOTIFICACION, url: 'https://atacante.cl' } }],
    ['url protocolo relativo', { suscripciones: [SUB_A], notificacion: { ...NOTIFICACION, url: '//atacante.cl' } }],
    ['sin tag', { suscripciones: [SUB_A], notificacion: { ...NOTIFICACION, tag: '' } }],
  ];
  for (const [caso, cuerpo] of invalidos) {
    it(`rechaza con 400: ${caso}`, async () => {
      const salida = respuesta();
      await pushEnviar(pedido(cuerpo), salida.mock as never);
      expect(salida.cuerpo.status).toBe(400);
      expect(enviar).not.toHaveBeenCalled();
    });
  }

  it('acepta los servicios push de Chrome, Firefox, Safari y Edge', () => {
    for (const ep of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGabc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) expect(endpointPermitido(ep), ep).toBe(true);
    expect(leerPedido({ suscripciones: [SUB_A, SUB_B], notificacion: NOTIFICACION })).not.toBeNull();
  });

  it('también lee un cuerpo que llega como texto', async () => {
    enviar.mockResolvedValue({ statusCode: 201 });
    const salida = respuesta();
    await pushEnviar(pedido(JSON.stringify({ suscripciones: [SUB_A], notificacion: NOTIFICACION })), salida.mock as never);
    expect(salida.cuerpo.status).toBe(200);
  });
});

describe('push-enviar: envío', () => {
  it('envía con TTL de 24 h y urgencia alta, y devuelve el estado de cada suscripción (201 y 410)', async () => {
    enviar.mockResolvedValueOnce({ statusCode: 201 });
    enviar.mockRejectedValueOnce(Object.assign(new Error('Received unexpected response code'), { statusCode: 410, endpoint: SUB_B.endpoint }));
    const salida = respuesta();
    await pushEnviar(pedido({ suscripciones: [SUB_A, SUB_B], notificacion: NOTIFICACION }), salida.mock as never);

    expect(salida.cuerpo.status).toBe(200);
    expect(salida.cuerpo.json).toEqual({ resultados: [{ id: SUB_A.id, estado: 201 }, { id: SUB_B.id, estado: 410 }] });
    expect(enviar).toHaveBeenCalledTimes(2);
    const [sub, carga, opciones] = enviar.mock.calls[0];
    expect(sub).toEqual({ endpoint: SUB_A.endpoint, keys: { p256dh: SUB_A.p256dh, auth: SUB_A.auth } });
    expect(JSON.parse(carga)).toEqual(NOTIFICACION);
    expect(opciones).toMatchObject({
      TTL: 86400,
      urgency: 'high',
      vapidDetails: { subject: 'mailto:prueba@ejemplo.cl', publicKey: 'clave-publica', privateKey: 'clave-privada-que-no-debe-aparecer' },
    });
  });

  it('un error sin estado HTTP (red) se informa como 0 para que la base reintente', async () => {
    enviar.mockRejectedValueOnce(new Error('socket hang up'));
    const salida = respuesta();
    await pushEnviar(pedido({ suscripciones: [SUB_A], notificacion: NOTIFICACION }), salida.mock as never);
    expect(salida.cuerpo.json).toEqual({ resultados: [{ id: SUB_A.id, estado: 0 }] });
  });

  it('los logs no muestran endpoints, claves ni el secreto', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    enviar.mockResolvedValueOnce({ statusCode: 201 });
    enviar.mockRejectedValueOnce(Object.assign(new Error(`fallo en ${SUB_B.endpoint}`), { statusCode: 500, endpoint: SUB_B.endpoint }));
    await pushEnviar(pedido({ suscripciones: [SUB_A, SUB_B], notificacion: NOTIFICACION }), respuesta().mock as never);
    await pushEnviar(pedido({ suscripciones: [SUB_A], notificacion: NOTIFICACION }, 'malo'), respuesta().mock as never);

    const escrito = JSON.stringify([info.mock.calls, error.mock.calls, log.mock.calls, warn.mock.calls]);
    for (const prohibido of [SUB_A.endpoint, SUB_B.endpoint, 'fcm.googleapis', 'mozilla', SUB_A.p256dh, SUB_A.auth, SECRETO, 'clave-privada']) {
      expect(escrito).not.toContain(prohibido);
    }
    expect(info).toHaveBeenCalledWith('push-enviar', { total: 2, entregados: 1, vencidos: 0, errores: 1 });
  });
});
