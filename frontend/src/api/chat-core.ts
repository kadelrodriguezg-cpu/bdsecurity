import type { SupabaseClient } from '@supabase/supabase-js';
import type { DatabaseConChat, DestinoChat, MensajeChat } from '../types/chat';
import { crearEstadoSesionChat, crearSondeoChat, ErrorSesionChat, esErrorSesionChat } from './chat-sondeo';

export type EstadoChat = 'conectando' | 'sincronizando' | 'conectado' | 'reconectando' | 'cerrado';
export type BorradorEnvioChat = Readonly<{
  canalId: string;
  contenido: string;
  claveEnvio: string;
  mencionados: string[];
  mencionarTodos: boolean;
}>;
export type ControlObservadorChat = { cerrar: () => void; resincronizar: () => Promise<void> };

/** Conservar este objeto para reintentar. Cambiar el texto implica otro envío. */
export function prepararMensajeChat(
  canalId: string,
  contenido: string,
  menciones: { mencionados?: string[]; mencionarTodos?: boolean } = {},
): BorradorEnvioChat {
  const texto = contenido.trim();
  if (!texto || Array.from(texto).length > 4000) throw new Error('Escribe un mensaje de entre 1 y 4000 caracteres.');
  return Object.freeze({
    canalId,
    contenido: texto,
    claveEnvio: crypto.randomUUID(),
    mencionados: [...new Set(menciones.mencionados ?? [])],
    mencionarTodos: menciones.mencionarTodos ?? false,
  });
}

export function combinarMensajesChat(actuales: MensajeChat[], nuevos: MensajeChat[]): MensajeChat[] {
  const porId = new Map(actuales.map((mensaje) => [mensaje.id, mensaje]));
  nuevos.forEach((mensaje) => porId.set(mensaje.id, mensaje));
  return [...porId.values()].sort((a, b) => a.posicion - b.posicion);
}

function lanzarErrorChat(error: { code?: string; message?: string }): void {
  const mensajes: Record<string, string> = {
    '42501': 'No tienes acceso a esta conversación.',
    'P0002': 'La entidad no está disponible.',
    '55000': 'Esta conversación está archivada.',
    '22023': 'Revisa el mensaje o inicia un nuevo envío.',
  };
  if (error.message?.includes('@all')) throw new Error('Solo un administrador puede usar @all en General.');
  // Nunca registrar contenido ni errores crudos en telemetría.
  throw new Error(mensajes[error.code ?? ''] ?? 'No se pudo conectar con el chat. Intenta de nuevo.');
}

export function crearApiChat(cliente: SupabaseClient<DatabaseConChat>) {
  // Compartido por los dos sondeos y por las consultas: un 401 detiene el
  // sondeo y cualquier respuesta correcta (o un evento de sesión) lo reanuda.
  const sesion = crearEstadoSesionChat();

  function errorChat(error: { code?: string; message?: string } | null, status?: number): void {
    if (!error) { sesion.restaurar(); return; }
    if (esErrorSesionChat(error, status)) {
      sesion.marcarCaida();
      throw new ErrorSesionChat();
    }
    lanzarErrorChat(error);
  }

  async function obtenerCanal(destino: DestinoChat = { tipo: 'general' }) {
    const parametros = destino.tipo === 'general'
      ? { p_tipo: 'general' }
      : { p_tipo: destino.tipo, p_entidad_id: destino.entidadId };
    const { data, error } = await cliente.rpc('obtener_canal_chat', parametros);
    errorChat(error);
    if (!data) throw new Error('La conversación no está disponible.');
    return data;
  }

  async function listarCanales() {
    const { data, error, status } = await cliente.rpc('listar_canales_chat', {});
    errorChat(error, status);
    return data ?? [];
  }

  async function enviarMensaje(envio: BorradorEnvioChat) {
    const { data, error } = await cliente.rpc('enviar_mensaje_chat', {
      p_canal_id: envio.canalId, p_contenido: envio.contenido, p_clave_envio: envio.claveEnvio,
      p_mencionados: envio.mencionados, p_mencionar_todos: envio.mencionarTodos,
    });
    errorChat(error);
    if (!data) throw new Error('No se confirmó el envío. Puedes reintentarlo.');
    return data;
  }

  async function listarMensajes(canalId: string, cursor: { antes?: number; despues?: number } = {}) {
    if (cursor.antes !== undefined && cursor.despues !== undefined) throw new Error('Usa un solo cursor.');
    let consulta = cliente.from('chat_mensajes').select('*').eq('canal_id', canalId);
    if (cursor.antes !== undefined) consulta = consulta.lt('posicion', cursor.antes);
    if (cursor.despues !== undefined) consulta = consulta.gt('posicion', cursor.despues);
    const { data, error, status } = await consulta.order('posicion', { ascending: cursor.despues !== undefined }).limit(50);
    errorChat(error, status);
    const mensajes = data ?? [];
    return cursor.despues === undefined ? mensajes.reverse() : mensajes;
  }

  async function listarContextoMensaje(canalId: string, mensajeId: string) {
    const objetivo = await cliente.from('chat_mensajes').select('*')
      .eq('canal_id', canalId).eq('id', mensajeId).maybeSingle();
    errorChat(objetivo.error);
    if (!objetivo.data) throw new Error('El mensaje ya no está disponible en el historial visible.');
    const [anteriores, posteriores] = await Promise.all([
      cliente.from('chat_mensajes').select('*').eq('canal_id', canalId)
        .lt('posicion', objetivo.data.posicion).order('posicion', { ascending: false }).limit(24),
      cliente.from('chat_mensajes').select('*').eq('canal_id', canalId)
        .gte('posicion', objetivo.data.posicion).order('posicion', { ascending: true }).limit(26),
    ]);
    errorChat(anteriores.error);
    errorChat(posteriores.error);
    return combinarMensajesChat((anteriores.data ?? []).reverse(), posteriores.data ?? []);
  }

  async function marcarLeido(canalId: string, posicion: number) {
    const { error } = await cliente.rpc('marcar_chat_leido', { p_canal_id: canalId, p_posicion: posicion });
    errorChat(error);
  }

  async function listarParticipantes(canalId: string) {
    const { data, error } = await cliente.rpc('listar_participantes_chat', { p_canal_id: canalId });
    errorChat(error);
    return data ?? [];
  }

  async function crearCanalLibre(nombre: string, participantes: string[]) {
    const { data, error } = await cliente.rpc('crear_canal_libre', {
      p_nombre: nombre, p_participantes: participantes,
    });
    errorChat(error);
    if (!data) throw new Error('No se pudo crear el canal.');
    return data;
  }

  async function actualizarParticipantes(canalId: string, participantes: string[]) {
    const { error } = await cliente.rpc('actualizar_participantes_canal_libre', {
      p_canal_id: canalId, p_participantes: participantes,
    });
    errorChat(error);
  }

  async function archivarCanalLibre(canalId: string) {
    const { error } = await cliente.rpc('archivar_canal_libre', { p_canal_id: canalId });
    errorChat(error);
  }

  async function listarNotificaciones() {
    const { data, error, status } = await cliente.rpc('listar_notificaciones_chat', {});
    errorChat(error, status);
    return data ?? [];
  }

  async function marcarNotificacionLeida(mensajeId: string) {
    const { error } = await cliente.rpc('marcar_notificacion_chat_leida', { p_mensaje_id: mensajeId });
    errorChat(error);
  }

  async function marcarTodasNotificacionesLeidas() {
    const { error } = await cliente.rpc('marcar_todas_notificaciones_chat_leidas', {});
    errorChat(error);
  }

  async function limpiarCanal(canalId: string) {
    const { data, error } = await cliente.rpc('limpiar_canal_chat', { p_canal_id: canalId });
    errorChat(error);
    return data ?? 0;
  }

  /** Mantiene actualizado el resumen aun con el panel cerrado. Los eventos
   * solo despiertan una consulta con RLS; no se usan como estado definitivo. */
  async function observarResumen(onCambio: () => void): Promise<ControlObservadorChat> {
    const { data, error } = await cliente.auth.getUser();
    if (error || !data.user) throw new Error('Inicia sesión para abrir el chat.');
    const usuarioId = data.user.id;
    let cerrado = false;

    const resincronizar = async () => {
      if (!cerrado) onCambio();
    };
    // Los eventos de Realtime también callan mientras no haya sesión válida.
    const despertar = () => { if (!sesion.caida) void resincronizar(); };
    const canal = cliente.channel(`chat-resumen:${usuarioId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensajes' }, despertar)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chat_lecturas',
      }, (evento) => {
        // RLS ya limita la fila al usuario actual; la comprobación evita un
        // refresco accidental si Realtime amplía el payload en el futuro.
        if ('usuario_id' in evento.new && evento.new.usuario_id === usuarioId) despertar();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_canales' }, despertar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_menciones' }, (evento) => {
        if ('usuario_id' in evento.new && evento.new.usuario_id === usuarioId) despertar();
      })
      .subscribe((estado) => {
        if (!cerrado && estado === 'SUBSCRIBED') despertar();
      });

    // Respaldo cada 30 s: pausado con la pestaña oculta y tras un 401.
    const sondeo = crearSondeoChat({ intervaloMs: 30_000, ejecutar: () => { void resincronizar(); }, sesion });
    sondeo.iniciar();
    const { data: auth } = cliente.auth.onAuthStateChange((evento, sesionAuth) => {
      if (sesionAuth?.user.id !== usuarioId) { cerrar(); return; }
      if (evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED') sesion.restaurar();
    });

    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      sondeo.detener();
      auth.subscription.unsubscribe();
      void cliente.removeChannel(canal);
    }

    return { cerrar, resincronizar };
  }

  /** Las notificaciones disparan una lectura autorizada; nunca adelantan el
   * cursor directamente. Así se recuperan también huecos de red o eventos fuera
   * de orden. Sin cursor inicial carga solo los últimos 50 mensajes. */
  async function observarCanal(canalId: string, opciones: {
    desde?: number;
    onMensajes: (mensajes: MensajeChat[]) => void;
    onEstado: (estado: EstadoChat) => void;
    onError: (error: Error) => void;
  }) {
    const { data, error } = await cliente.auth.getUser();
    if (error || !data.user) throw new Error('Inicia sesión para abrir el chat.');
    const usuarioId = data.user.id;
    let cerrado = false;
    let conectado = false;
    let ejecutando = false;
    let pendiente = false;
    let cursor = opciones.desde;

    async function sincronizar() {
      if (cerrado) return;
      if (ejecutando) { pendiente = true; return; }
      ejecutando = true;
      try {
        do {
          pendiente = false;
          if (cerrado) return;
          opciones.onEstado('sincronizando');
          const inicial = cursor === undefined;
          const mensajes = await listarMensajes(canalId, inicial ? {} : { despues: cursor });
          if (cerrado) return;
          if (mensajes.length) opciones.onMensajes(mensajes);
          cursor = mensajes.at(-1)?.posicion ?? cursor ?? 0;
          // El cursor por canal se asigna bajo bloqueo, en orden de commit.
          if (!inicial && mensajes.length === 50) pendiente = true;
        } while (pendiente);
        opciones.onEstado(conectado ? 'conectado' : 'reconectando');
      } catch (fallo) {
        if (!cerrado) {
          opciones.onEstado('reconectando');
          opciones.onError(fallo instanceof ErrorSesionChat
            ? fallo
            : new Error('No se pudo actualizar la conversación. Se reintentará al recuperar conexión.'));
        }
      } finally { ejecutando = false; }
    }

    opciones.onEstado('conectando');
    const canal = cliente.channel(`chat:${canalId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensajes' },
        (evento) => {
          // Realtime solo despierta la sincronización. La consulta HTTP con
          // RLS es la fuente de verdad y recupera eventos perdidos.
          if (evento.new.canal_id === canalId && !sesion.caida) void sincronizar();
        })
      .subscribe((estado) => {
        if (cerrado) return;
        conectado = estado === 'SUBSCRIBED';
        opciones.onEstado(conectado ? 'conectado' : 'reconectando');
        if (conectado && !sesion.caida) void sincronizar();
      });

    // Respaldo cada 15 s cuando el socket falla en silencio: pausado con la
    // pestaña oculta y tras un 401; se elimina al cerrar.
    const sondeo = crearSondeoChat({ intervaloMs: 15_000, ejecutar: () => { void sincronizar(); }, sesion });
    sondeo.iniciar();
    const { data: auth } = cliente.auth.onAuthStateChange((evento, sesionAuth) => {
      if (sesionAuth?.user.id !== usuarioId) { cerrar(); return; }
      if (evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED') sesion.restaurar();
    });

    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      sondeo.detener();
      auth.subscription.unsubscribe();
      void cliente.removeChannel(canal);
      opciones.onEstado('cerrado');
    }

    void sincronizar();
    return { cerrar, resincronizar: sincronizar };
  }

  return {
    obtenerCanal,
    listarCanales,
    enviarMensaje,
    listarMensajes,
    listarContextoMensaje,
    marcarLeido,
    listarParticipantes,
    crearCanalLibre,
    actualizarParticipantes,
    archivarCanalLibre,
    listarNotificaciones,
    marcarNotificacionLeida,
    marcarTodasNotificacionesLeidas,
    limpiarCanal,
    observarCanal,
    observarResumen,
  };
}
