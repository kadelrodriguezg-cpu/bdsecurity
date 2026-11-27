/**
 * Búsqueda de plantas por número o código (fase 5, decisión G14), compartida por la planilla e Individuos.
 *
 * Coinciden las mismas plantas que antes: el código contiene el texto, o el número de planta es exactamente el buscado
 * («78» o «P78»). Solo cambia el orden, por cuán bien coinciden, sin perder el orden de recorrido dentro de cada nivel:
 *   0. el número exacto (P78 antes que P178);
 *   1. la parte de la planta del código («P12») contiene lo buscado (P12, P20… al buscar «2»);
 *   2. el resto: coincide solo por el código del cruce (al buscar «2» en el cruce 02-001 coinciden todas).
 */

/** «78», «P78» o «p78» → 78; cualquier otra cosa → null. */
export function numeroBuscado(texto: string): number | null {
  const m = /^p?(\d+)$/i.exec(texto.trim());
  return m ? Number(m[1]) : null;
}

/** El número de planta del código («02-001-P78» → 78), o null si no termina en «P<número>». */
export function numeroDeCodigo(codigo: string): number | null {
  const m = /p(\d+)$/i.exec(codigo.trim());
  return m ? Number(m[1]) : null;
}

export interface Codificable { codigo: string; numero: number | null }

export function nivelCoincidencia({ codigo, numero }: Codificable, texto: string): number | null {
  const t = texto.trim().toLowerCase();
  if (t === '') return 2;
  const buscado = numeroBuscado(t);
  const n = numero ?? numeroDeCodigo(codigo);
  if (buscado !== null && n === buscado) return 0;
  const c = codigo.toLowerCase();
  if (!c.includes(t)) return null;
  const parteDePlanta = c.slice(c.lastIndexOf('-') + 1);
  return parteDePlanta.includes(t) ? 1 : 2;
}

/** Filtra por el texto y ordena por nivel de coincidencia; dentro de cada nivel se conserva el orden de entrada. */
export function buscarPorCodigo<T>(items: readonly T[], texto: string, datos: (item: T) => Codificable): T[] {
  if (texto.trim() === '') return [...items];
  return items
    .map((item, i) => ({ item, i, nivel: nivelCoincidencia(datos(item), texto) }))
    .filter((x): x is { item: T; i: number; nivel: number } => x.nivel !== null)
    .sort((a, b) => a.nivel - b.nivel || a.i - b.i)
    .map((x) => x.item);
}
