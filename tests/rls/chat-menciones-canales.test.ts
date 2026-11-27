import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';
import { crearApiChat, prepararMensajeChat } from '../../frontend/src/api/chat-core';
import type { DatabaseConChat } from '../../frontend/src/types/chat';

const URL_LOCAL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54600';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_LOCAL)) {
  throw new Error('Los tests de chat solo pueden ejecutarse contra Supabase local.');
}

let servicio: SupabaseClient;
let creador: SupabaseClient;
let invitado: SupabaseClient;
let externo: SupabaseClient;
let otroAdmin: SupabaseClient;
let apiCreador: ReturnType<typeof crearApiChat>;
let apiInvitado: ReturnType<typeof crearApiChat>;
let apiExterno: ReturnType<typeof crearApiChat>;
let apiOtroAdmin: ReturnType<typeof crearApiChat>;
let creadorId: string;
let invitadoId: string;
let externoId: string;
let otroAdminId: string;
let general: string;
let libre: string;
const usuarios: string[] = [];
const canales: string[] = [];
const mensajes: string[] = [];

beforeAll(async () => {
  const creds = { ...getLocalCreds(), url: URL_LOCAL };
  servicio = createClient(URL_LOCAL, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sufijo = randomUUID();
  const creadorCreado = await crearUsuarioDePrueba(creds, servicio, { email: `chat-owner-${sufijo}@test.local`, rol: 'admin' });
  const invitadoCreado = await crearUsuarioDePrueba(creds, servicio, { email: `chat-member-${sufijo}@test.local`, rol: 'operario' });
  const externoCreado = await crearUsuarioDePrueba(creds, servicio, { email: `chat-outsider-${sufijo}@test.local`, rol: 'operario' });
  const otroAdminCreado = await crearUsuarioDePrueba(creds, servicio, { email: `chat-admin-${sufijo}@test.local`, rol: 'admin' });
  creador = creadorCreado.client; creadorId = creadorCreado.userId;
  invitado = invitadoCreado.client; invitadoId = invitadoCreado.userId;
  externo = externoCreado.client; externoId = externoCreado.userId;
  otroAdmin = otroAdminCreado.client; otroAdminId = otroAdminCreado.userId;
  usuarios.push(creadorId, invitadoId, externoId, otroAdminId);
  expect((await servicio.from('perfiles').upsert([
    { id: creadorId, nombre: 'Ana Creadora', rol: 'admin' },
    { id: invitadoId, nombre: 'Bruno Invitado', rol: 'operario' },
    { id: externoId, nombre: 'Carla Externa', rol: 'operario' },
    { id: otroAdminId, nombre: 'Diego Administrador', rol: 'admin' },
  ])).error).toBeNull();

  apiCreador = crearApiChat(creador as unknown as SupabaseClient<DatabaseConChat>);
  apiInvitado = crearApiChat(invitado as unknown as SupabaseClient<DatabaseConChat>);
  apiExterno = crearApiChat(externo as unknown as SupabaseClient<DatabaseConChat>);
  apiOtroAdmin = crearApiChat(otroAdmin as unknown as SupabaseClient<DatabaseConChat>);
  general = await apiCreador.obtenerCanal();
  libre = await apiCreador.crearCanalLibre('Equipo Norte', [invitadoId]);
  canales.push(libre);
});

afterAll(async () => {
  await Promise.all([creador, invitado, externo, otroAdmin].filter(Boolean).map((cliente) => cliente.removeAllChannels()));
  if (mensajes.length) {
    expect((await servicio.from('chat_menciones').delete().in('mensaje_id', mensajes)).error).toBeNull();
    expect((await servicio.from('chat_mensajes').delete().in('id', mensajes)).error).toBeNull();
  }
  if (canales.length) {
    expect((await servicio.from('audit_log').delete().eq('accion', 'chat_clear').in('detalle->>canal_id', canales)).error).toBeNull();
    expect((await servicio.from('chat_canales').delete().in('id', canales)).error).toBeNull();
  }
  for (const id of usuarios) expect((await servicio.auth.admin.deleteUser(id)).error).toBeNull();
});

describe('Chat — menciones, comandos y canales libres con RLS local', () => {
  it('aísla el canal libre de cualquier usuario no incluido', async () => {
    expect((await apiCreador.listarCanales()).find((canal) => canal.id === libre)).toMatchObject({
      tipo: 'libre', entidad_nombre: 'Equipo Norte', creado_por: creadorId, puede_gestionar: true,
    });
    expect((await apiInvitado.listarCanales()).some((canal) => canal.id === libre)).toBe(true);
    expect((await apiExterno.listarCanales()).some((canal) => canal.id === libre)).toBe(false);
    expect((await externo.from('chat_canales').select('id').eq('id', libre)).data).toEqual([]);
    expect(await apiExterno.listarMensajes(libre)).toEqual([]);
    await expect(apiExterno.enviarMensaje(prepararMensajeChat(libre, 'Intrusión'))).rejects.toThrow('No tienes acceso');
  });

  it('reserva la gestión al admin creador y conserva siempre su membresía', async () => {
    await expect(apiOtroAdmin.actualizarParticipantes(libre, [otroAdminId])).rejects.toThrow('No tienes acceso');
    await apiCreador.actualizarParticipantes(libre, [invitadoId, externoId]);
    expect((await apiExterno.listarCanales()).some((canal) => canal.id === libre)).toBe(true);
    await apiCreador.actualizarParticipantes(libre, [invitadoId]);
    expect((await apiExterno.listarCanales()).some((canal) => canal.id === libre)).toBe(false);
    const participantes = await apiCreador.listarParticipantes(libre);
    expect(participantes.map((perfil) => perfil.id).sort()).toEqual([creadorId, invitadoId].sort());
  });

  it('persiste una mención directa estructurada solo para su destinatario', async () => {
    const mensaje = await apiCreador.enviarMensaje(prepararMensajeChat(
      general,
      '@Bruno Invitado revisa el bloque norte',
      { mencionados: [invitadoId] },
    ));
    mensajes.push(mensaje.id);
    expect(await apiInvitado.listarNotificaciones()).toContainEqual(expect.objectContaining({
      mensaje_id: mensaje.id, canal_id: general, tipo: 'directa', autor_nombre: 'Ana Creadora',
    }));
    expect((await apiExterno.listarNotificaciones()).some((item) => item.mensaje_id === mensaje.id)).toBe(false);
  });

  it('permite @all al admin en General y lo rechaza al operario sin crear mensaje', async () => {
    const permitido = await apiCreador.enviarMensaje(prepararMensajeChat(general, '@all reunión breve', { mencionarTodos: true }));
    mensajes.push(permitido.id);
    for (const apiDestino of [apiInvitado, apiExterno, apiOtroAdmin]) {
      expect((await apiDestino.listarNotificaciones()).some((item) => item.mensaje_id === permitido.id && item.tipo === 'todos')).toBe(true);
    }

    const antes = (await apiInvitado.listarMensajes(general)).length;
    await expect(apiInvitado.enviarMensaje(prepararMensajeChat(general, '@all intento', { mencionarTodos: true })))
      .rejects.toThrow('Solo un administrador');
    expect((await apiInvitado.listarMensajes(general)).length).toBe(antes);
  });

  it('permite @all a un participante en un canal libre y limita sus destinatarios', async () => {
    const mensaje = await apiInvitado.enviarMensaje(prepararMensajeChat(libre, '@all actualización del equipo', { mencionarTodos: true }));
    mensajes.push(mensaje.id);
    expect((await apiCreador.listarNotificaciones()).some((item) => item.mensaje_id === mensaje.id)).toBe(true);
    expect((await apiExterno.listarNotificaciones()).some((item) => item.mensaje_id === mensaje.id)).toBe(false);
  });

  it('marca una notificación o todas sin modificar mensajes', async () => {
    const pendientes = (await apiInvitado.listarNotificaciones()).filter((item) => !item.leida_at);
    expect(pendientes.length).toBeGreaterThanOrEqual(2);
    await apiInvitado.marcarNotificacionLeida(pendientes[0].mensaje_id);
    expect((await apiInvitado.listarNotificaciones()).find((item) => item.mensaje_id === pendientes[0].mensaje_id)?.leida_at).not.toBeNull();
    await apiInvitado.marcarTodasNotificacionesLeidas();
    expect((await apiInvitado.listarNotificaciones()).every((item) => item.leida_at !== null)).toBe(true);
  });

  it('/clear exige admin, oculta sin borrar y deja auditoría', async () => {
    const canalClear = await apiCreador.crearCanalLibre('Canal para limpiar', [invitadoId]);
    canales.push(canalClear);
    const uno = await apiCreador.enviarMensaje(prepararMensajeChat(canalClear, 'Mensaje conservado uno'));
    const dos = await apiCreador.enviarMensaje(prepararMensajeChat(canalClear, 'Mensaje conservado dos'));
    mensajes.push(uno.id, dos.id);
    await expect(apiInvitado.limpiarCanal(canalClear)).rejects.toThrow('No tienes acceso');
    const corte = await apiCreador.limpiarCanal(canalClear);
    expect(corte).toBe(2);
    expect(await apiCreador.listarMensajes(canalClear)).toEqual([]);
    const fisicos = await servicio.from('chat_mensajes').select('id').eq('canal_id', canalClear);
    expect(fisicos.error).toBeNull();
    expect(fisicos.data).toHaveLength(2);
    const auditoria = await servicio.from('audit_log').select('usuario_id,detalle').eq('accion', 'chat_clear').eq('detalle->>canal_id', canalClear).single();
    expect(auditoria.error).toBeNull();
    expect(auditoria.data).toMatchObject({ usuario_id: creadorId, detalle: { canal_id: canalClear, oculto_hasta_posicion: 2 } });
  });

  it('archiva el canal libre como historial y bloquea nuevos mensajes', async () => {
    const mensaje = await apiCreador.enviarMensaje(prepararMensajeChat(libre, 'Cierre de temporada'));
    mensajes.push(mensaje.id);
    await expect(apiOtroAdmin.archivarCanalLibre(libre)).rejects.toThrow('No tienes acceso');
    await apiCreador.archivarCanalLibre(libre);
    expect((await apiInvitado.listarCanales()).find((canal) => canal.id === libre)?.archivado).toBe(true);
    expect((await apiInvitado.listarMensajes(libre)).some((item) => item.id === mensaje.id)).toBe(true);
    await expect(apiInvitado.enviarMensaje(prepararMensajeChat(libre, 'No permitido'))).rejects.toThrow('archivada');
  });
});
