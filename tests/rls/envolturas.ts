/**
 * Helpers del paso 39 (REVOKE de las firmas viejas de RPC).
 *
 * Con el REVOKE aplicado, `authenticated` ya no puede ejecutar:
 *   - individualizar_plantas(uuid, integer)
 *   - iniciar_ronda_evaluacion(uuid)
 *   - iniciar_ronda_multisitio(uuid, uuid)
 *   - evecl_guardar_ficha (14 argumentos)
 * Las pruebas llaman ahora a sus envolturas SECURITY DEFINER, que es lo que usa
 * la app:
 *   - individualizar_plantas_una_vez(planta, cantidad, clave)
 *   - iniciar_ronda_esperada(individuo, serie, número esperado)
 *   - evecl_guardar_ficha_con_bajas(entrada jsonb, descriptores a eliminar)
 *
 * Los helpers devuelven la misma forma `{ data, error }` que `client.rpc`, de
 * modo que las aserciones de cada prueba no cambian.
 *
 * Para comprobar las reglas internas que la envoltura no deja ver (tope de 3
 * rondas, predio de multisitio) `psqlInterno` ejecuta la firma vieja con el
 * permiso del dueño y el JWT del usuario (auth.uid() sigue funcionando), sin
 * pasar por el rol `authenticated`.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getLocalCreds } from './helpers';

export const CONTENEDOR_DB_ENVOLTURAS = 'supabase_db_dbsecurity-frutales';

let servicioCache: SupabaseClient | null = null;

/** Cliente service_role compartido, solo para leer la numeración de rondas. */
function servicio(): SupabaseClient {
  if (!servicioCache) {
    const creds = getLocalCreds();
    servicioCache = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicioCache;
}

/** Número de la siguiente ronda de la serie para ese individuo (1 si no hay ninguna). */
export async function siguienteNumeroRonda(individuoId: string, tipo: 'anual' | 'multisitio' = 'anual'): Promise<number> {
  const { data, error } = await servicio()
    .from('ronda_evaluacion_anual')
    .select('numero_ronda')
    .eq('individuo_id', individuoId)
    .eq('tipo_ronda', tipo)
    .order('numero_ronda', { ascending: false })
    .limit(1);
  if (error) throw new Error(`siguienteNumeroRonda: ${error.message}`);
  return (data?.[0]?.numero_ronda ?? 0) + 1;
}

/**
 * Equivale a la antigua `iniciar_ronda_evaluacion(p_individuo_id)`: inicia la
 * siguiente ronda ANUAL del individuo vía `iniciar_ronda_esperada`.
 * `numero` solo se pasa para forzar un número esperado distinto del siguiente.
 */
export async function iniciarRondaAnual(cliente: SupabaseClient, individuoId: string, numero?: number) {
  const esperado = numero ?? (await siguienteNumeroRonda(individuoId, 'anual'));
  return cliente.rpc('iniciar_ronda_esperada', { p_individuo_id: individuoId, p_tipo: 'anual', p_numero_esperado: esperado });
}

/** Equivale a la antigua `iniciar_ronda_multisitio(p_individuo_id)` (sin predio, como la app). */
export async function iniciarRondaMultisitio(cliente: SupabaseClient, individuoId: string, numero?: number) {
  const esperado = numero ?? (await siguienteNumeroRonda(individuoId, 'multisitio'));
  return cliente.rpc('iniciar_ronda_esperada', { p_individuo_id: individuoId, p_tipo: 'multisitio', p_numero_esperado: esperado });
}

/**
 * Equivale a la antigua `individualizar_plantas(p_planta_id, p_cantidad)` vía
 * `individualizar_plantas_una_vez`. Sin `clave` genera una nueva en cada llamada
 * (cada llamada es un intento distinto, como antes).
 */
export function individualizarPlantas(
  cliente: SupabaseClient,
  args: { p_planta_id: string; p_cantidad: number | null },
  clave: string = randomUUID(),
) {
  return cliente.rpc('individualizar_plantas_una_vez', { ...args, p_clave: clave });
}

/**
 * Equivale a la antigua `evecl_guardar_ficha(...)` vía
 * `evecl_guardar_ficha_con_bajas`: los argumentos viejos (`p_id`, `p_ensayo_id`,
 * `p_variedad`, ... `p_respuestas`, `p_idempotency_key`) viajan en `p_entrada`.
 */
export function guardarFichaEvecl(
  cliente: SupabaseClient,
  entrada: Record<string, unknown>,
  descriptoresEliminar: number[] = [],
) {
  return cliente.rpc('evecl_guardar_ficha_con_bajas', { p_entrada: entrada, p_descriptores_eliminar: descriptoresEliminar });
}

export interface ResultadoPsql {
  salida: string;
  codigo: number | null;
}

/**
 * Ejecuta SQL en el contenedor local con el JWT de un usuario, en UNA
 * transacción. Con `rol: 'authenticated'` (por defecto) cambia al rol
 * `authenticated`, como la API. Con `rol: 'dueno'` NO cambia de rol: la sesión
 * es la del dueño de las funciones, que conserva el EXECUTE sobre las firmas
 * viejas, y `auth.uid()` sigue siendo el usuario.
 */
export function psqlComoUsuario(
  userId: string,
  sql: string,
  opciones: { rol?: 'authenticated' | 'dueno'; verboso?: boolean } = {},
): Promise<ResultadoPsql> {
  const rol = opciones.rol ?? 'authenticated';
  const guion = [
    'begin;',
    `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);`,
    rol === 'authenticated' ? 'set local role authenticated;' : '',
    sql,
    'commit;',
  ].join('\n');
  const args = ['exec', '-i', CONTENEDOR_DB_ENVOLTURAS, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At'];
  if (opciones.verboso) args.push('-v', 'VERBOSITY=verbose');
  return new Promise((resolve) => {
    const proc = spawn('docker', args);
    let salida = '';
    proc.stdout.on('data', (d) => { salida += String(d); });
    proc.stderr.on('data', (d) => { salida += String(d); });
    proc.on('close', (codigo) => resolve({ salida, codigo }));
    proc.stdin.write(guion);
    proc.stdin.end();
  });
}

/**
 * Llama una firma vieja (la `expresion` SQL que devuelve jsonb o un escalar)
 * con el permiso del dueño y el JWT del usuario. Devuelve `{ data, error }`
 * con el `code` SQLSTATE y el mensaje del error de negocio, igual que `rpc`.
 * Solo para comprobar reglas internas que la envoltura no deja ver.
 */
export async function psqlInterno(
  userId: string,
  expresion: string,
): Promise<{ data: unknown; error: { code: string; message: string } | null }> {
  const r = await psqlComoUsuario(userId, `select (${expresion})::text;`, { rol: 'dueno', verboso: true });
  if (r.codigo !== 0) {
    const m = r.salida.match(/ERROR:\s+([0-9A-Z]{5}):\s*(.+)/);
    return { data: null, error: { code: m?.[1] ?? 'XX000', message: (m?.[2] ?? r.salida).trim() } };
  }
  // Con -q -At la salida son las filas: primero el set_config del JWT y al final el resultado.
  const lineas = r.salida.split('\n').map((l) => l.trim()).filter(Boolean);
  const ultima = lineas[lineas.length - 1] ?? '';
  try {
    return { data: JSON.parse(ultima), error: null };
  } catch {
    return { data: ultima, error: null };
  }
}
