/**
 * Setup y teardown globales de Vitest (corren en el proceso principal).
 *
 * - `setup`: crea el archivo de registro de la corrida y fija su ruta en el
 *   entorno, que heredan los procesos hijos donde corren las pruebas.
 * - `teardown`: al terminar, borra de Auth los usuarios anotados en ESE archivo
 *   (el perfil cae en cascada). Nunca borra por patrón de correo: los usuarios
 *   de demostración (`demo-*`, `capturas-*`) no se tocan.
 *
 * El teardown jamás falla la suite: los usuarios que no se pueden borrar (por
 * ejemplo, porque crearon individuos y `individuos.created_by` es RESTRICT) se
 * cuentan y se informan en una línea.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { getLocalCreds } from './helpers';
import { VARIABLE_REGISTRO, leerUsuariosAnotados } from './registro-usuarios';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONCURRENCIA = 8;

function rutaDeLaCorrida(): string {
  const marca = `${Date.now()}-${process.pid}`;
  return join(RAIZ, '.scratch', `usuarios-de-prueba-${marca}.txt`);
}

export function setup(): void {
  const archivo = rutaDeLaCorrida();
  mkdirSync(dirname(archivo), { recursive: true });
  writeFileSync(archivo, '', 'utf8');
  process.env[VARIABLE_REGISTRO] = archivo;
}

/** Solo se borra contra el stack local: 127.0.0.1, localhost o [::1]. */
function esHostLocal(url: string): boolean {
  try {
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function teardown(): Promise<void> {
  const archivo = process.env[VARIABLE_REGISTRO];
  if (!archivo) return;

  try {
    const ids = leerUsuariosAnotados(archivo);
    if (ids.length === 0) {
      rmSync(archivo, { force: true });
      return;
    }

    const creds = getLocalCreds();
    if (!esHostLocal(creds.url)) {
      console.warn(`[limpieza de usuarios] Se omite: la URL ${creds.url} no es local. No se borró nada.`);
      return;
    }
    const service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    let borrados = 0;
    let yaNoExistian = 0;
    const fallos = new Map<string, number>();
    let siguiente = 0;
    const trabajador = async (): Promise<void> => {
      while (siguiente < ids.length) {
        const id = ids[siguiente++];
        const { error } = await service.auth.admin.deleteUser(id);
        if (!error) borrados += 1;
        // Lo borró la propia prueba (o nunca llegó a existir): no cuenta como fallo.
        else if (error.status === 404 || /not.?found/i.test(`${error.code ?? ''} ${error.message}`)) yaNoExistian += 1;
        else {
          // Auth responde 500 con cuerpo vacío cuando una FK RESTRICT lo impide.
          const motivo = error.status === 500 ? 'HTTP 500 (autor de filas con FK RESTRICT, p. ej. individuos)' : `HTTP ${error.status}: ${error.message}`;
          fallos.set(motivo, (fallos.get(motivo) ?? 0) + 1);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, ids.length) }, trabajador));

    const noBorrados = [...fallos.values()].reduce((a, b) => a + b, 0);
    const detalle = noBorrados ? ` Motivos: ${[...fallos].map(([m, n]) => `${m} (${n})`).join('; ')}.` : '';
    console.log(
      `[limpieza de usuarios] Anotados ${ids.length}: borrados ${borrados}, ya borrados por la prueba ${yaNoExistian}, no se pudieron borrar ${noBorrados}.${detalle}`,
    );
    rmSync(archivo, { force: true });
  } catch (e) {
    console.warn(`[limpieza de usuarios] Falló sin afectar la suite: ${e instanceof Error ? e.message : String(e)}. Registro: ${archivo}`);
  }
}
