/**
 * Ordenamiento por columna para las tablas de ranking (Sprint 6, 3.a).
 *
 * Ciclo por clic en el encabezado: asc → desc → sin orden. Una sola columna
 * activa a la vez (cambiar de columna reinicia en asc).
 *
 * DECISIÓN — valores NULL (categoría sin métricas evaluadas, métrica sin
 * valor): van SIEMPRE al final, sin importar asc/desc. Un NULL no es "el
 * valor más bajo": es ausencia de dato (la categoría no tiene ninguna
 * métrica configurada/evaluada — hoy Fenología, Producción y Estrés están
 * así para todos los individuos). Si NULL ordenara como 0, en orden asc
 * los individuos sin dato aparecerían "peores que" los medidos, que es
 * exactamente la penalización por dato faltante que el documento maestro
 * prohíbe (2.1/1.a). Al final y estables entre sí (desempate por código),
 * quedan visibles pero nunca compiten con los valores reales.
 */

export type DireccionOrden = 'asc' | 'desc';

export interface OrdenColumna<C extends string> {
  columna: C;
  direccion: DireccionOrden;
}

/** asc → desc → sin orden; una columna nueva arranca en asc. */
export function cicloOrden<C extends string>(
  actual: OrdenColumna<C> | null,
  columna: C,
): OrdenColumna<C> | null {
  if (actual === null || actual.columna !== columna) return { columna, direccion: 'asc' };
  if (actual.direccion === 'asc') return { columna, direccion: 'desc' };
  return null;
}

/**
 * Comparador numérico con NULL siempre al final. El desempate (y el orden
 * relativo entre NULLs) lo decide `desempate` — típicamente el código del
 * individuo — para que el resultado sea determinista.
 */
export function compararConNulosAlFinal(
  a: number | null | undefined,
  b: number | null | undefined,
  direccion: DireccionOrden,
  desempate: number,
): number {
  const aNulo = a === null || a === undefined;
  const bNulo = b === null || b === undefined;
  if (aNulo && bNulo) return desempate;
  if (aNulo) return 1;
  if (bNulo) return -1;
  if (a !== b) return direccion === 'asc' ? a - b : b - a;
  return desempate;
}

// El orden por código (antes `compararCodigoDisplay`) vive en lib/ordenNatural.ts: una sola función para toda la app (G16).
