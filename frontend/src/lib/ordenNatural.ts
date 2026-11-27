/**
 * Orden natural de códigos de cruce e individuo (fase 5, decisión G16): la única función compartida para ordenar por código
 * en toda la app. Los números dentro del código se comparan como números, no como texto:
 *   02-001 < 02-002 < 02-080 < 02-1000      P2 < P10 < P100      02-001-P9 < 02-001-P10 < 02-002-P1
 * Con el mismo valor numérico y distinto relleno («P09» y «P9») el desempate es el texto, para que el orden sea estable.
 * Los vacíos van al final. Donde el orden es por otra cosa (puntaje, actividad), esta función es el desempate.
 */
const colador = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

export function compararCodigos(a: string | null | undefined, b: string | null | undefined): number {
  const va = a ?? '';
  const vb = b ?? '';
  if (va === '' || vb === '') return va === vb ? 0 : va === '' ? 1 : -1;
  return colador.compare(va, vb) || (va < vb ? -1 : va > vb ? 1 : 0);
}

/** Copia ordenada por código, en orden natural. */
export function ordenarPorCodigo<T>(items: readonly T[], codigo: (item: T) => string | null | undefined): T[] {
  return [...items].sort((x, y) => compararCodigos(codigo(x), codigo(y)));
}
