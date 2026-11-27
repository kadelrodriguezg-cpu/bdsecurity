/**
 * RPC de las notificaciones push (migración 20261030100000). Las suscripciones
 * solo se escriben por estas funciones; la tabla no acepta INSERT directo.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './client';

type FuncionesPush = {
  registrar_suscripcion_push: {
    Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string | null };
    Returns: undefined;
  };
  eliminar_suscripcion_push: { Args: { p_endpoint: string }; Returns: undefined };
};

type DatabasePush = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: FuncionesPush;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export function crearApiPush(cliente: SupabaseClient<DatabasePush>) {
  async function registrarSuscripcion(datos: { endpoint: string; p256dh: string; auth: string; userAgent?: string }) {
    const { error } = await cliente.rpc('registrar_suscripcion_push', {
      p_endpoint: datos.endpoint,
      p_p256dh: datos.p256dh,
      p_auth: datos.auth,
      p_user_agent: datos.userAgent?.slice(0, 200) ?? null,
    });
    if (error) {
      throw new Error(error.code === '22023'
        ? 'Este navegador entregó una suscripción no válida. Prueba con Chrome, Edge, Firefox o Safari.'
        : 'No se pudo activar las notificaciones. Intenta de nuevo.');
    }
  }

  async function eliminarSuscripcion(endpoint: string) {
    const { error } = await cliente.rpc('eliminar_suscripcion_push', { p_endpoint: endpoint });
    if (error) throw new Error('No se pudo desactivar las notificaciones en el servidor.');
  }

  return { registrarSuscripcion, eliminarSuscripcion };
}

export const push = crearApiPush(supabase as unknown as SupabaseClient<DatabasePush>);
