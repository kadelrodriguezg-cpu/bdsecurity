import type { Database } from './database.types';

export type MensajeChat = {
  id: string;
  canal_id: string;
  posicion: number;
  autor_id: string | null;
  autor_nombre: string;
  contenido: string;
  clave_envio: string;
  creado_at: string;
};

export type CanalChat = {
  id: string;
  tipo: 'general' | 'cruce' | 'predio' | 'libre';
  entidad_id: string | null;
  entidad_nombre: string | null;
  ultima_posicion: number;
  ultima_lectura: number;
  no_leidos: number;
  ultima_actividad_at: string;
  archivado: boolean;
  creado_por: string | null;
  oculto_desde: number;
  puede_gestionar: boolean;
  creado_at: string;
};

export type ParticipanteChat = { id: string; nombre: string };

export type NotificacionChat = {
  mensaje_id: string;
  canal_id: string;
  canal_tipo: CanalChat['tipo'];
  canal_nombre: string;
  autor_nombre: string;
  contenido: string;
  tipo: 'directa' | 'todos';
  creado_at: string;
  leida_at: string | null;
};

export type DestinoChat =
  | { tipo: 'general' }
  | { tipo: 'cruce' | 'predio'; entidadId: string };

type TablaLectura<T> = { Row: T; Insert: never; Update: never; Relationships: [] };

/** Tablas y RPC del chat tal como las dejan las 4 migraciones `2026090719…_chat_*`. */
type TablasChat = {
  chat_canales: TablaLectura<
    Omit<CanalChat, 'archivado' | 'ultima_lectura' | 'no_leidos' | 'puede_gestionar'>
    & { archivado_at: string | null }
  >;
  chat_mensajes: TablaLectura<MensajeChat>;
  chat_lecturas: TablaLectura<{
    canal_id: string; usuario_id: string; ultima_posicion: number; actualizado_at: string;
  }>;
  chat_canal_participantes: TablaLectura<{
    canal_id: string; usuario_id: string; agregado_por: string | null; agregado_at: string;
  }>;
  chat_menciones: TablaLectura<{
    mensaje_id: string; usuario_id: string; tipo: 'directa' | 'todos'; leida_at: string | null; creado_at: string;
  }>;
};

type FuncionesChat = {
  obtener_canal_chat: { Args: { p_tipo?: string; p_entidad_id?: string }; Returns: string };
  listar_canales_chat: { Args: Record<string, never>; Returns: CanalChat[] };
  enviar_mensaje_chat: {
    Args: {
      p_canal_id: string; p_contenido: string; p_clave_envio: string;
      p_mencionados?: string[]; p_mencionar_todos?: boolean;
    };
    Returns: MensajeChat;
  };
  marcar_chat_leido: { Args: { p_canal_id: string; p_posicion: number }; Returns: undefined };
  listar_participantes_chat: { Args: { p_canal_id: string }; Returns: ParticipanteChat[] };
  crear_canal_libre: { Args: { p_nombre: string; p_participantes?: string[] }; Returns: string };
  actualizar_participantes_canal_libre: {
    Args: { p_canal_id: string; p_participantes: string[] }; Returns: undefined;
  };
  archivar_canal_libre: { Args: { p_canal_id: string }; Returns: undefined };
  listar_notificaciones_chat: { Args: Record<string, never>; Returns: NotificacionChat[] };
  marcar_notificacion_chat_leida: { Args: { p_mensaje_id: string }; Returns: undefined };
  marcar_todas_notificaciones_chat_leidas: { Args: Record<string, never>; Returns: undefined };
  limpiar_canal_chat: { Args: { p_canal_id: string }; Returns: number };
};

/**
 * Extensión acotada del esquema generado; no reescribe tipos de otros módulos.
 * Las entradas de chat se reemplazan (Omit) en vez de intersectarse: si
 * database.types.ts trae una versión anterior del chat (como la sincronizada
 * el 2026-09-17), la intersección produciría tipos imposibles.
 */
export type DatabaseConChat = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables' | 'Functions'> & {
    Tables: Omit<Database['public']['Tables'], keyof TablasChat> & TablasChat;
    Functions: Omit<Database['public']['Functions'], keyof FuncionesChat> & FuncionesChat;
  };
};
