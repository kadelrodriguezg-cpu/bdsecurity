/**
 * Verificación independiente (Fase 2) de la Corrida 1: utilidades propias del
 * agente verificador. No reutiliza los setup de los grupos G5-G9.
 *
 * Reglas: usuarios `aud-v2-<tema>-<rol>-<ts>@test.local`, cruces con
 * `es_prueba = true` y código `AUD-V2-...`. `service` (service_role) se usa
 * solo para preparar y limpiar; los permisos se prueban con clientes logueados
 * con la clave anon (sujetos a RLS).
 */
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../../helpers';

export const CONTENEDOR_DB = 'supabase_db_dbsecurity-frutales';

/** SQL como superusuario en la base local (consultas de catálogo y limpieza de lo propio). */
export function psql(sql: string): string {
  const r = spawnSync(
    'docker',
    ['exec', '-i', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: sql, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`psql falló: ${r.stderr || r.stdout}\n${sql}`);
  return r.stdout.trim();
}

export interface UsuarioV2 {
  client: SupabaseClient;
  userId: string;
  email: string;
}

export class ContextoV2 {
  readonly creds: LocalCreds = getLocalCreds();
  readonly sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  readonly service: SupabaseClient = createClient(this.creds.url, this.creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  readonly anon: SupabaseClient = createClient(this.creds.url, this.creds.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  readonly usuarios: string[] = [];

  constructor(readonly tema: string) {}

  async usuario(rol: 'admin' | 'operario', etiqueta = rol, puedeVerLinaje = false): Promise<UsuarioV2> {
    const email = `aud-v2-${this.tema}-${etiqueta}-${this.sufijo}@test.local`;
    const { client, userId } = await crearUsuarioDePrueba(this.creds, this.service, { email, rol, puedeVerLinaje });
    this.usuarios.push(userId);
    return { client, userId, email };
  }

  /** Borra los usuarios propios (después de haber borrado lo que los referencia con RESTRICT). */
  async borrarUsuarios(): Promise<string[]> {
    const fallos: string[] = [];
    for (const id of this.usuarios) {
      const { error } = await this.service.auth.admin.deleteUser(id);
      if (error) fallos.push(`${id}: ${error.message}`);
    }
    return fallos;
  }
}
