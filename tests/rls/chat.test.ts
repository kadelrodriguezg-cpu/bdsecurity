import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';
import { crearApiChat, prepararMensajeChat } from '../../frontend/src/api/chat-core';
import type { DatabaseConChat } from '../../frontend/src/types/chat';

// Destino fijo: esta suite nunca acepta una URL de producción por entorno.
const URL_LOCAL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54600';

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_LOCAL)) {
  throw new Error('Los tests de chat solo pueden ejecutarse contra Supabase local.');
}
let servicio: SupabaseClient;
let anonimo: SupabaseClient;
let primero: SupabaseClient;
let primeroOtroDispositivo: SupabaseClient;
let segundo: SupabaseClient;
let sinPerfil: SupabaseClient;
let api: ReturnType<typeof crearApiChat>;
let apiOtroDispositivo: ReturnType<typeof crearApiChat>;
let apiSegundo: ReturnType<typeof crearApiChat>;
let especieId: string;
let plantaId: string;
let otraPlantaId: string;
let predioId: string;
let canal: string;
let otroCanal: string;
let canalPredio: string;
let general: string;
let primeroId: string;
const usuarios: string[] = [];
const cierres: (() => void)[] = [];

beforeAll(async () => {
  const creds = { ...getLocalCreds(), url: URL_LOCAL };
  servicio = createClient(URL_LOCAL, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  anonimo = createClient(URL_LOCAL, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sufijo = randomUUID();
  const correoPrimero = `chat-a-${sufijo}@test.local`;
  const a = await crearUsuarioDePrueba(creds, servicio, { email: correoPrimero, rol: 'operario' });
  primero = a.client; primeroId = a.userId; usuarios.push(a.userId);
  primeroOtroDispositivo = createClient(URL_LOCAL, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  expect((await primeroOtroDispositivo.auth.signInWithPassword({ email: correoPrimero, password: 'test-password-123' })).error).toBeNull();
  const b = await crearUsuarioDePrueba(creds, servicio, { email: `chat-b-${sufijo}@test.local`, rol: 'admin' });
  segundo = b.client; usuarios.push(b.userId);
  const c = await crearUsuarioDePrueba(creds, servicio, { email: `chat-c-${sufijo}@test.local`, rol: 'operario' });
  sinPerfil = c.client; usuarios.push(c.userId);
  expect((await servicio.from('perfiles').delete().eq('id', c.userId)).error).toBeNull();
  expect((await servicio.from('perfiles').update({ nombre: 'Operario Chat' }).eq('id', primeroId)).error).toBeNull();
  api = crearApiChat(primero as unknown as SupabaseClient<DatabaseConChat>);
  apiOtroDispositivo = crearApiChat(primeroOtroDispositivo as unknown as SupabaseClient<DatabaseConChat>);
  apiSegundo = crearApiChat(segundo as unknown as SupabaseClient<DatabaseConChat>);
  const especie = await servicio.from('especies').insert({ nombre: `chat-test-${sufijo}` }).select('id').single();
  if (especie.error) throw especie.error;
  especieId = especie.data.id;
  const plantas = await servicio.from('plantas').insert([
    { especie_id: especieId, codigo_sistema: `CHAT-A-${sufijo}`, cruzamiento: 'LINAJE-SECRETO-CHAT' },
    { especie_id: especieId, codigo_sistema: `CHAT-B-${sufijo}` },
  ]).select('id');
  if (plantas.error) throw plantas.error;
  [plantaId, otraPlantaId] = plantas.data.map((p) => p.id);
  const predio = await servicio.from('predio').insert({ nombre: `Predio Chat ${sufijo}` }).select('id').single();
  if (predio.error) throw predio.error;
  predioId = predio.data.id;
  [canal, otroCanal, canalPredio, general] = await Promise.all([
    api.obtenerCanal({ tipo: 'cruce', entidadId: plantaId }),
    api.obtenerCanal({ tipo: 'cruce', entidadId: otraPlantaId }),
    api.obtenerCanal({ tipo: 'predio', entidadId: predioId }),
    api.obtenerCanal(),
  ]);
});

afterAll(async () => {
  cierres.forEach((cerrar) => cerrar());
  await Promise.all([primero, primeroOtroDispositivo, segundo, sinPerfil, anonimo].filter(Boolean).map((c) => c.removeAllChannels()));
  // Solo IDs generados por esta suite; no modifica el seed ni cruces reales.
  if (canal && otroCanal && canalPredio) {
    expect((await servicio.from('chat_mensajes').delete().in('canal_id', [canal, otroCanal, canalPredio])).error).toBeNull();
    expect((await servicio.from('chat_canales').delete().in('id', [canal, otroCanal, canalPredio])).error).toBeNull();
  }
  if (usuarios.length) {
    expect((await servicio.from('chat_mensajes').delete().eq('canal_id', general).in('autor_id', usuarios)).error).toBeNull();
  }
  if (especieId) {
    expect((await servicio.from('plantas').delete().eq('especie_id', especieId)).error).toBeNull();
    expect((await servicio.from('especies').delete().eq('id', especieId)).error).toBeNull();
  }
  if (predioId) {
    expect((await servicio.from('sector').delete().eq('predio_id', predioId)).error).toBeNull();
    expect((await servicio.from('predio').delete().eq('id', predioId)).error).toBeNull();
  }
  for (const id of usuarios) expect((await servicio.auth.admin.deleteUser(id)).error).toBeNull();
});

describe('Chat — contratos reales con RLS local', () => {
  it('crea un solo canal aunque dos usuarios lo abran simultáneamente', async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? api : apiSegundo).obtenerCanal({ tipo: 'cruce', entidadId: plantaId })));
    expect(new Set(ids)).toEqual(new Set([canal]));
    expect(await apiSegundo.obtenerCanal()).toBe(general);
    expect(await apiSegundo.obtenerCanal({ tipo: 'predio', entidadId: predioId })).toBe(canalPredio);
    await expect(api.obtenerCanal({ tipo: 'cruce', entidadId: randomUUID() })).rejects.toThrow();
    await expect(api.obtenerCanal({ tipo: 'predio', entidadId: randomUUID() })).rejects.toThrow();
  });

  it('rechaza anónimos y cuentas sin perfil', async () => {
    expect((await anonimo.rpc('obtener_canal_chat', {})).error).not.toBeNull();
    expect((await anonimo.from('chat_mensajes').select('*')).error).not.toBeNull();
    expect((await sinPerfil.rpc('obtener_canal_chat', {})).error).not.toBeNull();
    expect((await sinPerfil.rpc('obtener_canal_chat', {
      p_tipo: 'predio', p_entidad_id: predioId,
    })).error).not.toBeNull();
    const lectura = await sinPerfil.from('chat_canales').select('*');
    expect(lectura.error).toBeNull();
    expect(lectura.data).toEqual([]);
    expect((await sinPerfil.rpc('enviar_mensaje_chat', {
      p_canal_id: canalPredio, p_contenido: 'No permitido', p_clave_envio: randomUUID(),
    })).error).not.toBeNull();
    expect((await sinPerfil.from('chat_mensajes').select('*').eq('canal_id', canalPredio)).data).toEqual([]);
  });

  it('el servidor fija identidad y los reintentos concurrentes producen un solo mensaje', async () => {
    const envio = prepararMensajeChat(canal, '  Evaluación terminada  ');
    const mensajes = await Promise.all(Array.from({ length: 10 }, () => api.enviarMensaje(envio)));
    expect(new Set(mensajes.map((m) => m.id)).size).toBe(1);
    expect(mensajes[0]).toMatchObject({ autor_id: primeroId, autor_nombre: 'Operario Chat', contenido: 'Evaluación terminada' });
    expect(Number.isNaN(Date.parse(mensajes[0].creado_at))).toBe(false);
    await expect(api.enviarMensaje({ ...envio, contenido: 'Texto diferente' })).rejects.toThrow();
    const listado = await api.listarCanales();
    const sala = listado.find((c) => c.id === canal)!;
    expect(sala.archivado).toBe(false);
    expect(Object.keys(sala).sort()).toEqual([
      'id', 'tipo', 'entidad_id', 'entidad_nombre', 'ultima_posicion', 'ultima_lectura',
      'no_leidos', 'ultima_actividad_at', 'archivado', 'creado_por', 'oculto_desde',
      'puede_gestionar', 'creado_at',
    ].sort());
    expect(JSON.stringify(listado)).not.toContain('LINAJE-SECRETO-CHAT');
  });

  it('calcula no leídos en general, cruce y predio y ordena por actividad reciente', async () => {
    await apiSegundo.enviarMensaje(prepararMensajeChat(general, 'Actualización general pendiente'));
    await apiSegundo.enviarMensaje(prepararMensajeChat(canal, 'Actualización de cruce pendiente'));
    await apiSegundo.enviarMensaje(prepararMensajeChat(canalPredio, 'Actualización de predio pendiente'));

    const listado = await api.listarCanales();
    for (const canalId of [general, canal, canalPredio]) {
      const resumen = listado.find((item) => item.id === canalId)!;
      expect(resumen.no_leidos).toBe(resumen.ultima_posicion - resumen.ultima_lectura);
      expect(resumen.no_leidos).toBeGreaterThan(0);
    }
    expect(listado[0].id).toBe(canalPredio);

    const predio = listado.find((item) => item.id === canalPredio)!;
    await api.marcarLeido(canalPredio, predio.ultima_posicion);
    const sincronizado = (await apiOtroDispositivo.listarCanales()).find((item) => item.id === canalPredio)!;
    expect(sincronizado).toMatchObject({ ultima_lectura: predio.ultima_posicion, no_leidos: 0 });
  });

  it('prohíbe insert/update/delete directos incluso al admin', async () => {
    const mensaje = await api.enviarMensaje(prepararMensajeChat(canal, 'Registro inmutable'));
    for (const cliente of [primero, segundo]) {
      expect((await cliente.from('chat_mensajes').insert({ ...mensaje, id: randomUUID(), autor_id: usuarios[1] })).error).not.toBeNull();
      expect((await cliente.from('chat_mensajes').update({ contenido: 'Alterado' }).eq('id', mensaje.id)).error).not.toBeNull();
      expect((await cliente.from('chat_mensajes').delete().eq('id', mensaje.id)).error).not.toBeNull();
      expect((await cliente.from('chat_canales').insert({ tipo: 'general' })).error).not.toBeNull();
      expect((await cliente.from('chat_lecturas').insert({ canal_id: canal, usuario_id: usuarios[1], ultima_posicion: 1 })).error).not.toBeNull();
    }
  });

  it.each(['', '   ', '\n\t', 'x'.repeat(4001)])('valida texto en el servidor, independientemente del frontend (%#)', async (contenido) => {
    expect((await primero.rpc('enviar_mensaje_chat', { p_canal_id: canal, p_contenido: contenido, p_clave_envio: randomUUID() })).error?.code).toBe('22023');
  });

  it('pagina sin solapamientos y mantiene orden estable bajo envíos simultáneos', async () => {
    const enviados = await Promise.all(Array.from({ length: 65 }, (_, i) =>
      (i % 2 ? api : apiSegundo).enviarMensaje(prepararMensajeChat(otroCanal, `Mensaje ${i}`))));
    expect(new Set(enviados.map((m) => m.posicion)).size).toBe(65);
    const recientes = await api.listarMensajes(otroCanal);
    const anteriores = await api.listarMensajes(otroCanal, { antes: recientes[0].posicion });
    expect(recientes).toHaveLength(50);
    expect(anteriores).toHaveLength(15);
    expect([...anteriores, ...recientes].map((m) => m.posicion)).toEqual(Array.from({ length: 65 }, (_, i) => i + 1));
    expect((await api.listarMensajes(canal)).every((m) => m.canal_id === canal)).toBe(true);
  });

  it('mantiene lecturas propias y monotónicas frente a dos dispositivos', async () => {
    await Promise.all([api.marcarLeido(otroCanal, 60), api.marcarLeido(otroCanal, 4)]);
    const propio = await primero.from('chat_lecturas').select('*').eq('canal_id', otroCanal).single();
    expect(propio.error).toBeNull();
    expect(propio.data.ultima_posicion).toBe(60);
    expect((await segundo.from('chat_lecturas').select('*').eq('canal_id', otroCanal)).data).toEqual([]);
    const otroDispositivo = (await apiOtroDispositivo.listarCanales()).find((item) => item.id === otroCanal)!;
    expect(otroDispositivo).toMatchObject({ ultima_lectura: 60, no_leidos: 5 });
    await expect(api.marcarLeido(otroCanal, 9999)).rejects.toThrow();
    await expect(api.marcarLeido(otroCanal, -1)).rejects.toThrow();
  });

  it('sincroniza por Realtime el punto leído entre dos dispositivos del mismo usuario', async () => {
    const resumen = (await api.listarCanales()).find((item) => item.id === canal)!;
    const posiciones: number[] = [];
    const suscripcion = primeroOtroDispositivo.channel(`test-lectura-${randomUUID()}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'chat_lecturas',
    }, (evento) => {
      if (evento.new.canal_id === canal) posiciones.push(evento.new.ultima_posicion as number);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const limite = setTimeout(() => reject(new Error('Realtime de lecturas no se suscribió')), 8000);
        suscripcion.subscribe((estado) => {
          if (estado === 'SUBSCRIBED') { clearTimeout(limite); resolve(); }
        });
      });
      await api.marcarLeido(canal, resumen.ultima_posicion);
      await expect.poll(() => posiciones.includes(resumen.ultima_posicion), { timeout: 10_000, interval: 250 }).toBe(true);
      const segundoResumen = (await apiOtroDispositivo.listarCanales()).find((item) => item.id === canal)!;
      expect(segundoResumen).toMatchObject({ ultima_lectura: resumen.ultima_posicion, no_leidos: 0 });
    } finally { await primeroOtroDispositivo.removeChannel(suscripcion); }
  }, 12_000);

  it('entrega mensajes por WebSocket entre dos usuarios con RLS', async () => {
    const recibidos = new Set<string>();
    const enviados = new Set<string>();
    const suscripcion = segundo.channel(`test-chat-${randomUUID()}`).on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'chat_mensajes',
    }, (evento) => {
      if (evento.new.canal_id === canal) recibidos.add(evento.new.id as string);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const limite = setTimeout(() => reject(new Error('Realtime no se suscribió')), 8000);
        suscripcion.subscribe((estado) => {
          if (estado === 'SUBSCRIBED') { clearTimeout(limite); resolve(); }
        });
      });
      // Una instancia Realtime recién creada puede informar SUBSCRIBED mientras
      // termina de iniciar la replicación. Reintentar escrituras nuevas evita
      // confundir ese arranque local con una falla del canal WebSocket.
      await expect.poll(async () => {
        const enviado = await api.enviarMensaje(prepararMensajeChat(canal, 'En vivo'));
        enviados.add(enviado.id);
        return [...recibidos].some((id) => enviados.has(id));
      }, { timeout: 10_000, interval: 500 }).toBe(true);
    } finally { await segundo.removeChannel(suscripcion); }
  }, 12_000);

  it('recupera más de una página perdida al reconectar usando el mismo controlador de la app', async () => {
    const ids = new Set<string>();
    const estados: string[] = [];
    const control = await apiSegundo.observarCanal(otroCanal, {
      desde: 0,
      onMensajes: (mensajes) => mensajes.forEach((m) => ids.add(m.id)),
      onEstado: (estado) => estados.push(estado),
      onError: (error) => { throw error; },
    });
    cierres.push(control.cerrar);
    await expect.poll(() => ids.size).toBe(65);
    const mensaje = await api.enviarMensaje(prepararMensajeChat(otroCanal, 'Recuperado'));
    await control.resincronizar();
    await expect.poll(() => ids.has(mensaje.id)).toBe(true);
    control.cerrar();
    expect(estados.at(-1)).toBe('cerrado');
  });

  it('conserva nombre histórico y archiva ante soft y hard delete del cruce', async () => {
    expect((await servicio.from('perfiles').update({ nombre: 'Nombre Actualizado' }).eq('id', primeroId)).error).toBeNull();
    expect((await api.listarMensajes(canal)).some((m) => m.autor_nombre === 'Operario Chat')).toBe(true);
    expect((await api.enviarMensaje(prepararMensajeChat(canal, 'Nombre nuevo'))).autor_nombre).toBe('Nombre Actualizado');
    expect((await servicio.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', plantaId)).error).toBeNull();
    expect(await api.obtenerCanal({ tipo: 'cruce', entidadId: plantaId })).toBe(canal);
    await expect(api.enviarMensaje(prepararMensajeChat(canal, 'No permitido'))).rejects.toThrow('archivada');
    expect((await api.listarCanales()).find((c) => c.id === canal)?.archivado).toBe(true);
    const antes = await api.listarMensajes(canal);
    expect((await servicio.from('plantas').delete().eq('id', plantaId)).error).toBeNull();
    expect(await api.listarMensajes(canal)).toEqual(antes);
    expect((await api.listarCanales()).find((c) => c.id === canal)).toMatchObject({ archivado: true, entidad_id: plantaId });
    await expect(api.enviarMensaje(prepararMensajeChat(canal, 'Tampoco'))).rejects.toThrow('archivada');
  });

  it('mantiene el canal de un predio inactivo como histórico de solo lectura', async () => {
    const mensaje = await api.enviarMensaje(prepararMensajeChat(canalPredio, 'Actividad del predio'));
    expect(mensaje.canal_id).toBe(canalPredio);
    expect((await servicio.from('predio').update({ activo: false }).eq('id', predioId)).error).toBeNull();
    expect(await api.obtenerCanal({ tipo: 'predio', entidadId: predioId })).toBe(canalPredio);
    expect((await api.listarCanales()).find((c) => c.id === canalPredio)).toMatchObject({
      tipo: 'predio', entidad_id: predioId, archivado: true,
    });
    expect((await api.listarMensajes(canalPredio)).some((item) => item.id === mensaje.id)).toBe(true);
    await expect(api.enviarMensaje(prepararMensajeChat(canalPredio, 'No permitido'))).rejects.toThrow('archivada');
  });
});
