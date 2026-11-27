/**
 * Notificaciones push de menciones (migración 20261030100000; ver el Maestro, «Notificaciones push del chat»).
 *
 * Cubre: RLS y grants de push_suscripcion / push_envio y de sus RPC; que una
 * mención encole el pedido en pg_net con un payload sin el texto del mensaje;
 * que un rollback no deje nada encolado; que una falla de pg_net, de Vault o de
 * la propia bandeja no impida guardar el mensaje; y la recolección
 * (201, 410, 500, sin respuesta, reintentos con tope y retención).
 *
 * Las pruebas de falla y de payload corren como SQL dentro de una transacción
 * que se revierte (docker exec psql), con `set local role authenticated` y los
 * claims del usuario: así pasan por enviar_mensaje_chat igual que la app.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';

const URL_LOCAL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54600';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_LOCAL)) {
  throw new Error('Las pruebas de push solo pueden ejecutarse contra Supabase local.');
}
const DB = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_dbsecurity-frutales';

function psql(sql: string, usuario: 'postgres' | 'supabase_admin' = 'postgres'): string {
  return execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', usuario, '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8',
    input: sql,
  }).trim();
}

/** Prefijo SQL para actuar como un usuario autenticado dentro de la transacción. */
const como = (uid: string) => `set local role authenticated;
set local request.jwt.claims to '{"sub":"${uid}","role":"authenticated"}';`;

const endpoint = (marca: string) => `https://fcm.googleapis.com/fcm/send/prueba-${marca}-${randomUUID()}`;
const P256DH = 'B'.repeat(87);
const AUTH = 'A'.repeat(22);

/** pg_cron corre recoger_respuestas_push() al segundo 0 de cada minuto. */
async function lejosDelCron(): Promise<void> {
  for (;;) {
    const s = new Date().getUTCSeconds();
    if (s >= 5 && s <= 45) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let servicio: SupabaseClient;
let anon: SupabaseClient;
let autor: SupabaseClient;
let destino: SupabaseClient;
let tercero: SupabaseClient;
let autorId: string;
let destinoId: string;
let terceroId: string;
let canal: string;
const usuarios: string[] = [];
const mensajes: string[] = [];
const respuestasFalsas: number[] = [];
let secretosCreados: string[] = [];

async function enviar(cliente: SupabaseClient, contenido: string, mencionados: string[] = [], todos = false): Promise<string> {
  const { data, error } = await cliente.rpc('enviar_mensaje_chat', {
    p_canal_id: canal, p_contenido: contenido, p_clave_envio: randomUUID(), p_mencionados: mencionados, p_mencionar_todos: todos,
  });
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  mensajes.push(id);
  return id;
}

function envio(mensajeId: string, usuarioId: string): { id: number; estado: string; intentos: number; request_id: number | null; ultimo_error: string | null; proximo: number | null; pendientes: string | null } | null {
  const fila = psql(`select json_build_object('id', id, 'estado', estado, 'intentos', intentos, 'request_id', request_id,
      'ultimo_error', ultimo_error, 'proximo', extract(epoch from proximo_intento_at - now()), 'pendientes', suscripciones_pendientes::text)
    from push_envio where mensaje_id = '${mensajeId}' and usuario_id = '${usuarioId}'`);
  return fila ? JSON.parse(fila) : null;
}

async function registrar(cliente: SupabaseClient, ep: string) {
  return cliente.rpc('registrar_suscripcion_push', { p_endpoint: ep, p_p256dh: P256DH, p_auth: AUTH, p_user_agent: 'vitest' });
}

beforeAll(async () => {
  const creds = { ...getLocalCreds(), url: URL_LOCAL };
  const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
  servicio = createClient(URL_LOCAL, creds.serviceKey, opciones);
  anon = createClient(URL_LOCAL, creds.anonKey, opciones);
  const sufijo = randomUUID();
  const a = await crearUsuarioDePrueba(creds, servicio, { email: `push-autor-${sufijo}@test.local`, rol: 'admin' });
  const d = await crearUsuarioDePrueba(creds, servicio, { email: `push-destino-${sufijo}@test.local`, rol: 'operario' });
  const t = await crearUsuarioDePrueba(creds, servicio, { email: `push-tercero-${sufijo}@test.local`, rol: 'operario' });
  autor = a.client; autorId = a.userId;
  destino = d.client; destinoId = d.userId;
  tercero = t.client; terceroId = t.userId;
  usuarios.push(autorId, destinoId, terceroId);
  expect((await servicio.from('perfiles').upsert([
    { id: autorId, nombre: 'Ana Autora', rol: 'admin' },
    { id: destinoId, nombre: 'Bruno Destino', rol: 'operario' },
    { id: terceroId, nombre: 'Carla Tercera', rol: 'operario' },
  ])).error).toBeNull();
  const { data, error } = await autor.rpc('crear_canal_libre', { p_nombre: 'Push prueba', p_participantes: [destinoId, terceroId] });
  if (error) throw new Error(error.message);
  canal = data as string;

  // Secretos de prueba en Vault local: un puerto cerrado, para que ningún pedido salga a ninguna parte.
  secretosCreados = psql(`
    select vault.create_secret('http://127.0.0.1:9/api/push-enviar', 'push_funcion_url') from (select 1) x
      where not exists (select 1 from vault.secrets where name = 'push_funcion_url');
    select vault.create_secret('secreto-de-prueba-local', 'push_secreto') from (select 1) x
      where not exists (select 1 from vault.secrets where name = 'push_secreto');
    select string_agg(name, ',') from vault.secrets where name in ('push_funcion_url', 'push_secreto')
      and created_at > now() - interval '5 seconds';`).split('\n').pop()!.split(',').filter(Boolean);
});

afterAll(async () => {
  if (mensajes.length) {
    psql(`delete from push_envio where mensaje_id in (${mensajes.map((m) => `'${m}'`).join(',')});`);
    expect((await servicio.from('chat_menciones').delete().in('mensaje_id', mensajes)).error).toBeNull();
    expect((await servicio.from('chat_mensajes').delete().in('id', mensajes)).error).toBeNull();
  }
  if (canal) expect((await servicio.from('chat_canales').delete().eq('id', canal)).error).toBeNull();
  if (respuestasFalsas.length) psql(`delete from net._http_response where id in (${respuestasFalsas.join(',')});`);
  if (secretosCreados.length) psql(`delete from vault.secrets where name in (${secretosCreados.map((s) => `'${s}'`).join(',')});`);
  for (const id of usuarios) expect((await servicio.auth.admin.deleteUser(id)).error).toBeNull();
});

describe('push_suscripcion: RLS, grants y validación del endpoint', () => {
  it('cada usuario registra, ve y borra solo sus suscripciones', async () => {
    const ep = endpoint('propia');
    expect((await registrar(destino, ep)).error).toBeNull();
    expect((await destino.from('push_suscripcion').select('endpoint').eq('endpoint', ep)).data).toHaveLength(1);
    expect((await tercero.from('push_suscripcion').select('endpoint').eq('endpoint', ep)).data).toEqual([]);

    // Borrado ajeno: ni por tabla ni por RPC.
    const ajeno = await tercero.from('push_suscripcion').delete().eq('endpoint', ep).select('id');
    expect(ajeno.error).toBeNull();
    expect(ajeno.data).toEqual([]);
    expect((await tercero.rpc('eliminar_suscripcion_push', { p_endpoint: ep })).error).toBeNull();
    expect(psql(`select count(*) from push_suscripcion where endpoint = '${ep}'`)).toBe('1');

    expect((await destino.rpc('eliminar_suscripcion_push', { p_endpoint: ep })).error).toBeNull();
    expect(psql(`select count(*) from push_suscripcion where endpoint = '${ep}'`)).toBe('0');
  });

  it('nadie inserta ni actualiza directo; anon no ejecuta las RPC', async () => {
    const directo = await destino.from('push_suscripcion').insert({ usuario_id: destinoId, endpoint: endpoint('directo'), p256dh: P256DH, auth: AUTH });
    expect(directo.error?.code).toBe('42501');
    const ep = endpoint('upd');
    expect((await registrar(destino, ep)).error).toBeNull();
    const upd = await destino.from('push_suscripcion').update({ usuario_id: terceroId }).eq('endpoint', ep);
    expect(upd.error?.code).toBe('42501');
    expect((await anon.rpc('registrar_suscripcion_push', { p_endpoint: endpoint('anon'), p_p256dh: P256DH, p_auth: AUTH })).error?.code).toBe('42501');
    expect((await anon.rpc('eliminar_suscripcion_push', { p_endpoint: ep })).error?.code).toBe('42501');
    expect((await anon.from('push_suscripcion').select('id')).error?.code).toBe('42501');
    await destino.rpc('eliminar_suscripcion_push', { p_endpoint: ep });
  });

  it('rechaza endpoints http, IP privadas, hosts que no son servicios push y claves mal formadas', async () => {
    for (const malo of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://10.0.0.5/push',
      'https://192.168.1.10/push',
      'https://127.0.0.1:54600/rest/v1/',
      'https://169.254.169.254/latest/meta-data',
      'https://fcm.googleapis.com.atacante.cl/x',
      'https://atacante.cl/fcm.googleapis.com/x',
      'https://fcm.googleapis.com/fcm/send/con espacio',
    ]) {
      const r = await registrar(destino, malo);
      expect(r.error?.code, malo).toBe('22023');
    }
    const clave = await destino.rpc('registrar_suscripcion_push', { p_endpoint: endpoint('clave'), p_p256dh: 'corta', p_auth: AUTH });
    expect(clave.error?.code).toBe('22023');
    for (const bueno of [
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGxyz',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect((await registrar(destino, bueno)).error, bueno).toBeNull();
      await destino.rpc('eliminar_suscripcion_push', { p_endpoint: bueno });
    }
  });

  it('un endpoint ya registrado por otra persona (PC compartido) pasa al usuario actual', async () => {
    const ep = endpoint('compartido');
    expect((await registrar(destino, ep)).error).toBeNull();
    expect((await registrar(tercero, ep)).error).toBeNull();
    expect(psql(`select usuario_id from push_suscripcion where endpoint = '${ep}'`)).toBe(terceroId);
    expect((await destino.from('push_suscripcion').select('id').eq('endpoint', ep)).data).toEqual([]);
    await tercero.rpc('eliminar_suscripcion_push', { p_endpoint: ep });
  });

  it('conserva como máximo 10 suscripciones por usuario (las más recientes)', async () => {
    const eps = Array.from({ length: 11 }, (_, i) => endpoint(`tope${i}`));
    for (const ep of eps) expect((await registrar(tercero, ep)).error).toBeNull();
    expect(psql(`select count(*) from push_suscripcion where usuario_id = '${terceroId}'`)).toBe('10');
    expect(psql(`select count(*) from push_suscripcion where endpoint = '${eps[0]}'`)).toBe('0');
    psql(`delete from push_suscripcion where usuario_id = '${terceroId}'`);
  });
});

describe('push_envio y funciones internas: nadie escribe desde el cliente', () => {
  it('authenticated y anon no escriben en push_envio ni ejecutan recoger, despachar ni limpiar', async () => {
    for (const cliente of [destino, autor]) {
      expect((await cliente.from('push_envio').insert({ mensaje_id: randomUUID(), usuario_id: destinoId })).error?.code).toBe('42501');
      expect((await cliente.from('push_envio').update({ estado: 'enviado' }).eq('usuario_id', destinoId)).error?.code).toBe('42501');
      expect((await cliente.from('push_envio').delete().eq('usuario_id', destinoId)).error?.code).toBe('42501');
      expect((await cliente.rpc('recoger_respuestas_push', {})).error?.code).toBe('42501');
      expect((await cliente.rpc('despachar_push_envio', { p_envio_id: 1 })).error?.code).toBe('42501');
      expect((await cliente.rpc('limpiar_push_envio', {})).error?.code).toBe('42501');
      expect((await cliente.rpc('programar_reintento_push', { p_envio_id: 1, p_error: 'x' })).error?.code).toBe('42501');
    }
    expect((await anon.from('push_envio').select('id')).error?.code).toBe('42501');
    expect((await anon.rpc('recoger_respuestas_push', {})).error?.code).toBe('42501');
  });
});

describe('Despacho desde el trigger de chat_menciones', () => {
  it('una mención a quien tiene suscripción crea su push_envio y encola el pedido en pg_net', async () => {
    const ep = endpoint('despacho');
    expect((await registrar(destino, ep)).error).toBeNull();
    const id = await enviar(autor, '@Bruno Destino revisa', [destinoId]);
    const fila = envio(id, destinoId);
    expect(fila).toMatchObject({ estado: 'pendiente', intentos: 1 });
    expect(fila!.request_id).not.toBeNull();
    expect(psql(`select (select count(*) from net.http_request_queue where id = ${fila!.request_id})
      + (select count(*) from net._http_response where id = ${fila!.request_id})`)).toBe('1');
    // El destinatario lee su envío; los demás no.
    expect((await destino.from('push_envio').select('estado').eq('mensaje_id', id)).data).toHaveLength(1);
    expect((await tercero.from('push_envio').select('estado').eq('mensaje_id', id)).data).toEqual([]);
    await destino.rpc('eliminar_suscripcion_push', { p_endpoint: ep });
  });

  it('una mención sin suscripciones queda en sin_suscripcion y no encola nada', async () => {
    const id = await enviar(autor, '@Carla Tercera sin dispositivo', [terceroId]);
    expect(envio(id, terceroId)).toMatchObject({ estado: 'sin_suscripcion', intentos: 0, request_id: null });
  });

  it('nunca notifica al autor: ni en @all ni si se menciona a sí mismo', async () => {
    const todos = await enviar(destino, '@all aviso', [], true);
    expect(envio(todos, destinoId)).toBeNull();
    expect(envio(todos, autorId)).not.toBeNull();
    expect(envio(todos, terceroId)).not.toBeNull();
    const propio = await enviar(autor, '@Ana Autora nota personal', [autorId]);
    expect(envio(propio, autorId)).toBeNull();
  });

  it('el payload lleva solo título, cuerpo, url y tag (nunca el texto) y un rollback no deja nada encolado', async () => {
    const ep = endpoint('payload');
    expect((await registrar(destino, ep)).error).toBeNull();
    const salida = psql(`begin;
${como(autorId)}
create temp table _r on commit drop as
  select (public.enviar_mensaje_chat('${canal}', 'SECRETO-INDUSTRIAL cruce 02-777 mama x papa', gen_random_uuid(), array['${destinoId}']::uuid[], false)).id as mensaje_id;
reset role;
select json_build_object(
  'request', e.request_id,
  'cuerpo', convert_from(q.body, 'UTF8')::jsonb,
  'headers', q.headers)
from _r join push_envio e on e.mensaje_id = _r.mensaje_id and e.usuario_id = '${destinoId}'
join net.http_request_queue q on q.id = e.request_id;
rollback;`);
    const { request, cuerpo, headers } = JSON.parse(salida.split('\n').filter((l) => l.startsWith('{')).pop()!);
    expect(cuerpo.notificacion.titulo).toBe('Ana Autora te mencionó');
    expect(cuerpo.notificacion.cuerpo).toBe('En Push prueba. Abre la app para ver el mensaje.');
    expect(cuerpo.notificacion.url).toMatch(new RegExp(`^/\\?chat=${canal}&mensaje=[0-9a-f-]{36}$`));
    expect(Object.keys(cuerpo).sort()).toEqual(['notificacion', 'suscripciones']);
    expect(Object.keys(cuerpo.notificacion).sort()).toEqual(['cuerpo', 'tag', 'titulo', 'url']);
    expect(cuerpo.suscripciones).toEqual([expect.objectContaining({ endpoint: ep, p256dh: P256DH, auth: AUTH })]);
    expect(JSON.stringify(cuerpo)).not.toMatch(/SECRETO|02-777|mama|papa/);
    expect(headers['x-push-secreto']).toBeTruthy();

    // Tras el rollback el pedido no existe ni llega a procesarse.
    await new Promise((r) => setTimeout(r, 3000));
    expect(psql(`select (select count(*) from net.http_request_queue where id = ${request})
      + (select count(*) from net._http_response where id = ${request})`)).toBe('0');
    await destino.rpc('eliminar_suscripcion_push', { p_endpoint: ep });
  });

  const mensajeGuardadoPese = (preparacion: string, usuario: 'postgres' | 'supabase_admin' = 'postgres') => {
    const salida = psql(`begin;
${preparacion}
${como(autorId)}
create temp table _r on commit drop as
  select (public.enviar_mensaje_chat('${canal}', 'mensaje que debe guardarse', gen_random_uuid(), array['${destinoId}']::uuid[], false)).id as mensaje_id;
reset role;
select json_build_object(
  'mensaje', (select count(*) from chat_mensajes m join _r on m.id = _r.mensaje_id),
  'mencion', (select count(*) from chat_menciones mn join _r on mn.mensaje_id = _r.mensaje_id),
  'envio', (select row_to_json(e) from push_envio e join _r on e.mensaje_id = _r.mensaje_id));
rollback;`, usuario);
    return JSON.parse(salida.split('\n').filter((l) => l.startsWith('{')).pop()!);
  };

  it('una falla de pg_net no impide guardar el mensaje ni la mención; el envío queda para reintento', async () => {
    const ep = endpoint('falla-net');
    expect((await registrar(destino, ep)).error).toBeNull();
    const r = mensajeGuardadoPese(`alter table net.http_request_queue add constraint push_prueba_falla check (false) not valid;`, 'supabase_admin');
    expect(r.mensaje).toBe(1);
    expect(r.mencion).toBe(1);
    expect(r.envio).toMatchObject({ estado: 'pendiente', intentos: 1, request_id: null });
    expect(r.envio.ultimo_error).toContain('push_prueba_falla');
    expect(r.envio.proximo_intento_at).not.toBeNull();
    await destino.rpc('eliminar_suscripcion_push', { p_endpoint: ep });
  });

  it('una falla de Vault (secreto ausente) tampoco impide guardar el mensaje', async () => {
    const ep = endpoint('falla-vault');
    expect((await registrar(destino, ep)).error).toBeNull();
    const r = mensajeGuardadoPese(`delete from vault.secrets where name = 'push_secreto';`);
    expect(r.mensaje).toBe(1);
    expect(r.mencion).toBe(1);
    expect(r.envio).toMatchObject({ estado: 'pendiente', intentos: 1, request_id: null });
    expect(r.envio.ultimo_error).toContain('Vault');
    // El rollback devolvió el secreto.
    expect(psql(`select count(*) from vault.secrets where name = 'push_secreto'`)).toBe('1');
    await destino.rpc('eliminar_suscripcion_push', { p_endpoint: ep });
  });

  it('si falla la propia bandeja, el mensaje y la mención igual se guardan (sin envío)', async () => {
    const ep = endpoint('falla-bandeja');
    expect((await registrar(destino, ep)).error).toBeNull();
    const r = mensajeGuardadoPese(`alter table push_envio add constraint push_prueba_falla check (false) not valid;`);
    expect(r.mensaje).toBe(1);
    expect(r.mencion).toBe(1);
    expect(r.envio).toBeNull();
    await destino.rpc('eliminar_suscripcion_push', { p_endpoint: ep });
  });
});

describe('recoger_respuestas_push: 201, 410, 500, sin respuesta, reintentos con tope', () => {
  let base = 970_000_000 + Math.floor(Math.random() * 1_000_000);
  const falsa = () => { base += 1; respuestasFalsas.push(base); return base; };

  /** Prepara un envío pendiente en vuelo con un request_id falso. */
  async function enVuelo(etiqueta: string, intentos = 1): Promise<{ mensaje: string; request: number; sub: string }> {
    const ep = endpoint(etiqueta);
    expect((await registrar(destino, ep)).error).toBeNull();
    const sub = psql(`select id from push_suscripcion where endpoint = '${ep}'`);
    // La mención se crea con el destinatario sin suscripción para que el trigger no despache de verdad.
    psql(`update push_suscripcion set usuario_id = '${terceroId}' where id = '${sub}'`);
    const mensaje = await enviar(autor, `@Bruno Destino ${etiqueta}`, [destinoId]);
    psql(`update push_suscripcion set usuario_id = '${destinoId}' where id = '${sub}'`);
    const request = falsa();
    psql(`update push_envio set estado = 'pendiente', request_id = ${request}, intentos = ${intentos}, actualizado_at = now()
      where mensaje_id = '${mensaje}' and usuario_id = '${destinoId}'`);
    return { mensaje, request, sub };
  }
  const responder = (request: number, status: number | null, contenido: unknown, timedOut = false) =>
    psql(`insert into net._http_response (id, status_code, content, timed_out, error_msg)
      values (${request}, ${status ?? 'null'}, '${JSON.stringify(contenido)}', ${timedOut}, ${status === null ? `'Couldn''t connect to server'` : 'null'})`);
  const limpiarSubs = () => psql(`delete from push_suscripcion where usuario_id = '${destinoId}'`);

  it('201: queda enviado y actualiza el último uso de la suscripción', async () => {
    await lejosDelCron();
    const { mensaje, request, sub } = await enVuelo('r201');
    psql(`update push_suscripcion set ultimo_uso_at = now() - interval '3 days' where id = '${sub}'`);
    responder(request, 200, { resultados: [{ id: sub, estado: 201 }] });
    psql('select recoger_respuestas_push()');
    expect(envio(mensaje, destinoId)).toMatchObject({ estado: 'enviado', request_id: null, ultimo_error: null });
    expect(psql(`select ultimo_uso_at > now() - interval '1 minute' from push_suscripcion where id = '${sub}'`)).toBe('t');
    limpiarSubs();
  });

  it('410: borra la suscripción vencida y, sin otras, el envío queda en sin_suscripcion', async () => {
    await lejosDelCron();
    const { mensaje, request, sub } = await enVuelo('r410');
    responder(request, 200, { resultados: [{ id: sub, estado: 410 }] });
    psql('select recoger_respuestas_push()');
    expect(psql(`select count(*) from push_suscripcion where id = '${sub}'`)).toBe('0');
    expect(envio(mensaje, destinoId)).toMatchObject({ estado: 'sin_suscripcion', request_id: null });
    limpiarSubs();
  });

  it('500 de la función: reintento con espera creciente; un 500 de una suscripción reintenta solo esa', async () => {
    await lejosDelCron();
    const a = await enVuelo('r500', 1);
    responder(a.request, 500, { error: 'x' });
    const b = await enVuelo('r500-sub', 3);
    responder(b.request, 200, { resultados: [{ id: b.sub, estado: 503 }] });
    psql('select recoger_respuestas_push()');
    const fa = envio(a.mensaje, destinoId)!;
    expect(fa).toMatchObject({ estado: 'pendiente', request_id: null, intentos: 1 });
    expect(fa.ultimo_error).toContain('500');
    expect(fa.proximo).toBeGreaterThan(50); // 1 minuto tras el primer intento
    expect(fa.proximo).toBeLessThan(65);
    const fb = envio(b.mensaje, destinoId)!;
    expect(fb).toMatchObject({ estado: 'pendiente', request_id: null, intentos: 3, pendientes: `{${b.sub}}` });
    expect(fb.proximo).toBeGreaterThan(230); // 4 minutos tras el tercero
    expect(fb.proximo).toBeLessThan(245);
    limpiarSubs();
  });

  it('sin respuesta: espera 2 minutos antes de reintentar; sin conexión cuenta como error', async () => {
    await lejosDelCron();
    const reciente = await enVuelo('sin-resp-reciente');
    const viejo = await enVuelo('sin-resp-viejo');
    psql(`update push_envio set actualizado_at = now() - interval '3 minutes' where mensaje_id = '${viejo.mensaje}'`);
    const caido = await enVuelo('sin-conexion');
    responder(caido.request, null, '');
    psql('select recoger_respuestas_push()');
    expect(envio(reciente.mensaje, destinoId)).toMatchObject({ estado: 'pendiente', request_id: reciente.request });
    expect(envio(viejo.mensaje, destinoId)).toMatchObject({ estado: 'pendiente', request_id: null, ultimo_error: 'sin respuesta de la función' });
    expect(envio(caido.mensaje, destinoId)).toMatchObject({ estado: 'pendiente', request_id: null });
    psql(`update push_envio set request_id = null, proximo_intento_at = now() + interval '1 hour' where mensaje_id = '${reciente.mensaje}'`);
    limpiarSubs();
  });

  it('al quinto intento fallido queda en fallido y no se vuelve a intentar', async () => {
    await lejosDelCron();
    const { mensaje, request } = await enVuelo('tope', 5);
    responder(request, 502, {});
    psql('select recoger_respuestas_push()');
    expect(envio(mensaje, destinoId)).toMatchObject({ estado: 'fallido', request_id: null, proximo: null, intentos: 5 });
    psql('select recoger_respuestas_push()');
    expect(envio(mensaje, destinoId)).toMatchObject({ estado: 'fallido', intentos: 5 });
    limpiarSubs();
  });

  it('un reintento vencido se vuelve a despachar y suma un intento', async () => {
    await lejosDelCron();
    const { mensaje } = await enVuelo('redespacho', 2);
    psql(`update push_envio set request_id = null, proximo_intento_at = now() - interval '1 second' where mensaje_id = '${mensaje}' and usuario_id = '${destinoId}'`);
    psql('select recoger_respuestas_push()');
    const fila = envio(mensaje, destinoId)!;
    expect(fila).toMatchObject({ estado: 'pendiente', intentos: 3 });
    expect(fila.request_id).not.toBeNull();
    limpiarSubs();
  });

  it('la retención borra lo enviado con más de 30 días y conserva los fallidos', async () => {
    const enviado = await enviar(autor, '@Carla Tercera viejo enviado', [terceroId]);
    const fallido = await enviar(autor, '@Carla Tercera viejo fallido', [terceroId]);
    psql(`update push_envio set estado = 'enviado', actualizado_at = now() - interval '31 days' where mensaje_id = '${enviado}';
      update push_envio set estado = 'fallido', actualizado_at = now() - interval '31 days' where mensaje_id = '${fallido}';
      select limpiar_push_envio();`);
    expect(envio(enviado, terceroId)).toBeNull();
    expect(envio(fallido, terceroId)).toMatchObject({ estado: 'fallido' });
  });

  it('los jobs de cron existen con su horario', () => {
    expect(psql(`select string_agg(jobname || ' ' || schedule, ';' order by jobname) from cron.job where jobname like 'push-%'`))
      .toBe('push-recoger * * * * *;push-retencion 20 4 * * *');
  });
});
