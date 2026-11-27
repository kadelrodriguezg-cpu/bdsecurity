/**
 * Registro de los usuarios de Auth que crean las pruebas en una corrida.
 *
 * Las pruebas corren en procesos hijos de Vitest y el borrado final lo hace el
 * proceso principal (`global-setup.ts`), así que los ids se pasan por un
 * archivo: una línea por id, en `.scratch/` (ignorado por git).
 *
 * El nombre del archivo viaja en la variable de entorno
 * `TALCA_REGISTRO_USUARIOS`, que fija el `setup` global antes de que arranquen
 * los procesos hijos. Si la variable no existe (por ejemplo, un archivo de
 * prueba ejecutado fuera de Vitest), anotar es un no-op: nunca se borra nada
 * que no esté anotado en el archivo de la corrida en curso.
 */
import { appendFileSync, readFileSync, existsSync } from 'node:fs';

export const VARIABLE_REGISTRO = 'TALCA_REGISTRO_USUARIOS';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Anota un id de usuario creado en esta corrida. Nunca lanza. */
export function anotarUsuarioCreado(id: string | null | undefined): void {
  const archivo = process.env[VARIABLE_REGISTRO];
  if (!archivo || !id || !UUID.test(id)) return;
  try {
    // appendFileSync con una línea corta es atómico en la práctica entre procesos.
    appendFileSync(archivo, `${id}\n`, 'utf8');
  } catch {
    // Si no se puede anotar, el usuario simplemente no se limpia al final.
  }
}

/** Ids anotados en el archivo de la corrida, sin repetidos. */
export function leerUsuariosAnotados(archivo: string): string[] {
  if (!existsSync(archivo)) return [];
  const ids = readFileSync(archivo, 'utf8')
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => UUID.test(linea));
  return [...new Set(ids)];
}
