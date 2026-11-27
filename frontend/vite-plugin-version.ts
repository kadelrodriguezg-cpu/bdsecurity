import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';

/**
 * Identificador de versión del build. Se usa para dos cosas que deben coincidir:
 *  - la constante `__BUILD_ID__` compilada dentro del código de la app, y
 *  - el archivo `dist/version.json`, que la app consulta para saber si hay una
 *    versión publicada más nueva que la que tiene cargada.
 *
 * Prioridad: SHA corto del commit (el de Vercel si existe, si no el de git local);
 * sin git, la marca de tiempo del build.
 */
export interface EntornoVersion {
  env?: Record<string, string | undefined>;
  /** Devuelve el SHA de HEAD o lanza si no hay git. */
  leerGit?: () => string;
  ahora?: () => Date;
}

const LARGO_SHA = 8;

function shaLocal(): string {
  return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

export function calcularIdVersion({ env = process.env, leerGit = shaLocal, ahora = () => new Date() }: EntornoVersion = {}): string {
  const deVercel = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (deVercel && /^[0-9a-f]{7,}$/i.test(deVercel)) return deVercel.slice(0, LARGO_SHA);
  try {
    const sha = leerGit().trim();
    if (/^[0-9a-f]{7,}$/i.test(sha)) return sha.slice(0, LARGO_SHA);
  } catch {
    // Sin git (por ejemplo, build desde un zip): se usa la marca de tiempo.
  }
  return 't' + ahora().getTime().toString(36);
}

/** Contenido de `version.json`: solo lo que la app necesita leer. */
export function contenidoVersionJson(id: string, ahora: Date = new Date()): string {
  return JSON.stringify({ id, construidoEn: ahora.toISOString() }) + '\n';
}

export function pluginVersion(entorno: EntornoVersion = {}): Plugin {
  const ahora = entorno.ahora ?? (() => new Date());
  // Una sola vez por ejecución de Vite: el define y el archivo comparten el mismo id.
  const id = calcularIdVersion(entorno);
  const construidoEn = ahora();
  return {
    name: 'bds-version',
    config: () => ({ define: { __BUILD_ID__: JSON.stringify(id) } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: contenidoVersionJson(id, construidoEn) });
    },
  };
}
