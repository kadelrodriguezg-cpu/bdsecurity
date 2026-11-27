/**
 * Utilidades compartidas de las pruebas del grupo G7 (territorio, clima,
 * geocodificación y mapas). No es una prueba: no termina en .test.ts.
 */
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';

export const CONTENEDOR_DB = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_dbsecurity-frutales';

/**
 * Ejecuta SQL como superusuario en la base LOCAL (docker exec). Se usa solo
 * para preparar o inspeccionar datos que la API no deja tocar (por ejemplo,
 * leer net._http_response o insertar con session_replication_role=replica para
 * evitar que un trigger dispare una llamada HTTP real). Nunca para "probar"
 * permisos.
 */
export function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8',
    input: sql,
  }).trim();
}

export interface EntornoG7 {
  creds: LocalCreds;
  service: SupabaseClient;
  anon: SupabaseClient;
  admin: SupabaseClient;
  adminId: string;
  operario: SupabaseClient;
  operarioId: string;
  especieId: string;
}

/** Crea usuarios propios aud-g7-<etiqueta>-<rol>-<ts>@test.local y devuelve los clientes. */
export async function prepararEntornoG7(etiqueta: string): Promise<EntornoG7> {
  const creds = getLocalCreds();
  const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(creds.url, creds.serviceKey, opciones);
  const anon = createClient(creds.url, creds.anonKey, opciones);
  const marca = Date.now();
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g7-${etiqueta}-admin-${marca}@test.local`, rol: 'admin' });
  const op = await crearUsuarioDePrueba(creds, service, { email: `aud-g7-${etiqueta}-operario-${marca}@test.local`, rol: 'operario' });
  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  return { creds, service, anon, admin: ad.client, adminId: ad.userId, operario: op.client, operarioId: op.userId, especieId: esp.id as string };
}

/**
 * pg_cron ejecuta recolectar_clima_pendiente() cada 5 minutos (minutos
 * múltiplos de 5, segundo 0). Las pruebas que cuentan filas pendientes
 * esperan a estar lejos del borde para que el cron no las altere a mitad.
 */
export async function esperarLejosDelCron(margenSegundos = 25): Promise<void> {
  for (;;) {
    const ahora = new Date();
    const segundosDentroDelCiclo = (ahora.getUTCMinutes() % 5) * 60 + ahora.getUTCSeconds() + ahora.getUTCMilliseconds() / 1000;
    const alBorde = Math.min(segundosDentroDelCiclo, 300 - segundosDentroDelCiclo);
    if (alBorde > margenSegundos) return;
    await new Promise((resolver) => setTimeout(resolver, 2000));
  }
}

/**
 * Borra (mejor esfuerzo) los usuarios aud-g7 de un entorno. Falla en silencio si
 * alguna fila los referencia con RESTRICT: el usuario queda y se anota en el informe.
 */
export async function borrarUsuariosG7(E: Pick<EntornoG7, 'service' | 'adminId' | 'operarioId'>): Promise<void> {
  for (const id of [E.adminId, E.operarioId]) {
    const { error } = await E.service.auth.admin.deleteUser(id);
    if (error) console.warn(`[G7] no se pudo borrar el usuario ${id}: ${error.message}`);
  }
}
