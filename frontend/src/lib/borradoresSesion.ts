/**
 * Borradores locales y fin de sesión (U-01, U-45 de docs/revision_ux/informe.md).
 *
 * Los borradores de `useBorradorLocal` viven bajo `borrador:usuario:<id>:…`, así
 * que nunca se cargan para otra persona. Por eso una sesión que caduca o se
 * revoca ya no los borra: solo el cierre manual borra los del usuario que cierra.
 * Las claves legadas sin propietario (`borrador:<algo>` sin `usuario:`) nunca se
 * adoptan y se retiran en cualquier cierre manual.
 *
 * El aviso de «sesión expirada» va en sessionStorage para sobrevivir a la
 * recarga de /login dentro de la misma pestaña, sin quedar entre pestañas.
 */

const PREFIJO_BORRADOR = 'borrador:';
const PREFIJO_CON_DUENO = 'borrador:usuario:';
const CLAVE_AVISO = 'aviso:sesion-expirada';

export function prefijoBorradoresDe(usuarioId: string): string {
  return PREFIJO_CON_DUENO + encodeURIComponent(usuarioId) + ':';
}

function clavesLocales(): string[] {
  const claves: string[] = [];
  for (let indice = 0; indice < localStorage.length; indice += 1) {
    const clave = localStorage.key(indice);
    if (clave) claves.push(clave);
  }
  return claves;
}

/** Borradores que este equipo guarda para el usuario (0 si Storage está bloqueado). */
export function contarBorradoresDe(usuarioId: string): number {
  try {
    const prefijo = prefijoBorradoresDe(usuarioId);
    return clavesLocales().filter((clave) => clave.startsWith(prefijo)).length;
  } catch {
    return 0;
  }
}

/** Cierre manual: borra los del usuario que cierra y los legados sin dueño; nunca los de otra persona. */
export function borrarBorradoresDe(usuarioId: string): void {
  try {
    const prefijo = prefijoBorradoresDe(usuarioId);
    for (const clave of clavesLocales()) {
      const legado = clave.startsWith(PREFIJO_BORRADOR) && !clave.startsWith(PREFIJO_CON_DUENO);
      if (clave.startsWith(prefijo) || legado) localStorage.removeItem(clave);
    }
  } catch {
    // Storage bloqueado: la sesión ya está cerrada y no hay nada más que hacer.
  }
}

export function marcarSesionExpirada(usuarioId: string): void {
  try { sessionStorage.setItem(CLAVE_AVISO, JSON.stringify({ usuarioId })); } catch { /* Sin aviso, pero el borrador sigue. */ }
}

export function leerSesionExpirada(): { usuarioId: string } | null {
  try {
    const raw = sessionStorage.getItem(CLAVE_AVISO);
    if (!raw) return null;
    const dato: unknown = JSON.parse(raw);
    if (dato && typeof dato === 'object' && typeof (dato as { usuarioId?: unknown }).usuarioId === 'string') {
      return { usuarioId: (dato as { usuarioId: string }).usuarioId };
    }
    return null;
  } catch {
    return null;
  }
}

export function olvidarSesionExpirada(): void {
  try { sessionStorage.removeItem(CLAVE_AVISO); } catch { /* Nada que limpiar. */ }
}
