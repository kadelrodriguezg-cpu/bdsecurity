/**
 * Auditoría integral, Corrida 1, grupo G4: ayudas para pruebas de carrera real.
 *
 * Dos llamadas HTTP seguidas a PostgREST casi nunca se solapan dentro de
 * Postgres (cada una dura milisegundos), así que «dos usuarios a la vez» por
 * la API no demuestra una carrera. Para forzarla se abren dos sesiones de
 * `psql` dentro del contenedor local: la primera ejecuta la RPC como un
 * usuario real (rol `authenticated` + claims JWT, igual que PostgREST) y
 * retiene la transacción unos segundos antes de confirmar; la segunda
 * arranca a mitad de ese tiempo y se bloquea en los mismos locks.
 *
 * Solo toca la base LOCAL (contenedor Docker del proyecto) y solo con datos
 * de prueba creados por la propia prueba.
 */
import { spawn } from 'node:child_process';

const CONTENEDOR = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_dbsecurity-frutales';

export interface ResultadoPsql {
  /** Código de salida de psql. */
  codigo: number | null;
  /** stdout + stderr juntos (los errores de SQL salen por stderr). */
  salida: string;
}

/** Ejecuta un script SQL en una sesión nueva de psql dentro del contenedor local. */
export function psql(sql: string): Promise<ResultadoPsql> {
  return new Promise((resolver, rechazar) => {
    const proceso = spawn('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let salida = '';
    proceso.stdout.on('data', (d) => (salida += d));
    proceso.stderr.on('data', (d) => (salida += d));
    proceso.on('error', rechazar);
    proceso.on('close', (codigo) => resolver({ codigo, salida }));
    proceso.stdin.end(sql);
  });
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Envuelve una sentencia SQL en una transacción que se ejecuta como el usuario
 * dado (rol `authenticated` + claims) y la retiene `retencionSegundos` antes
 * de confirmar.
 */
export function comoUsuario(usuarioId: string, sentencia: string, retencionSegundos = 0): string {
  return [
    'begin;',
    'set local role authenticated;',
    `select set_config('request.jwt.claims', '{"sub":"${usuarioId}","role":"authenticated"}', true);`,
    sentencia.trim().replace(/;?$/, ';'),
    retencionSegundos > 0 ? `select pg_sleep(${retencionSegundos});` : '',
    'commit;',
  ].join('\n');
}

/**
 * Lanza dos transacciones solapadas: la primera retiene sus locks
 * `retencionSegundos`; la segunda arranca `desfaseMs` después (menor que la
 * retención), de modo que choca de verdad con la primera.
 */
export async function solapar(
  primera: { usuarioId: string; sentencia: string },
  segunda: { usuarioId: string; sentencia: string },
  { retencionSegundos = 3, desfaseMs = 1200 }: { retencionSegundos?: number; desfaseMs?: number } = {},
): Promise<[ResultadoPsql, ResultadoPsql]> {
  const p1 = psql(comoUsuario(primera.usuarioId, primera.sentencia, retencionSegundos));
  await dormir(desfaseMs);
  const p2 = psql(comoUsuario(segunda.usuarioId, segunda.sentencia, 0));
  return Promise.all([p1, p2]);
}
