import { supabase } from './client';
import { crearApiChat } from './chat-core';

export { prepararMensajeChat, combinarMensajesChat } from './chat-core';
export type { BorradorEnvioChat, ControlObservadorChat, EstadoChat } from './chat-core';
export const chat = crearApiChat(supabase);
