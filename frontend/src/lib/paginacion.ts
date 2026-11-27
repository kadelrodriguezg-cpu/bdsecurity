/**
 * Paginación numerada (fase 5, decisión G18): reemplaza a «Mostrar más» en las tablas largas. Lógica pura: qué números de
 * página se dibujan y qué rango de filas muestra cada página. El componente es `components/shared/Paginacion.tsx` y el estado
 * vive en la URL (`lib/usePaginacionUrl.ts`).
 */

/** Filas por página que se pueden elegir. */
export const FILAS_POR_PAGINA = [50, 100] as const;
export type FilasPorPagina = (typeof FILAS_POR_PAGINA)[number];
export const FILAS_POR_PAGINA_INICIAL: FilasPorPagina = 50;

export type ElementoPagina = number | 'hueco';

export const totalPaginas = (cantidad: number, porPagina: number) => Math.max(1, Math.ceil(cantidad / porPagina));

/** Lleva un número de página cualquiera (de la URL, por ejemplo) al rango 1..total. */
export function acotarPagina(pagina: number, total: number): number {
  if (!Number.isFinite(pagina)) return 1;
  return Math.min(Math.max(1, Math.trunc(pagina)), Math.max(1, total));
}

/**
 * Los números que se dibujan, con «…» donde se saltan páginas: siempre la primera y la última, la actual y sus vecinas;
 * cerca de un extremo se muestran tres seguidas (1 2 3 … 8). Un salto de una sola página se dibuja como número, no como «…».
 */
export function paginasVisibles(actual: number, total: number): ElementoPagina[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  let desde = Math.max(2, actual - 1);
  let hasta = Math.min(total - 1, actual + 1);
  if (actual <= 3) { desde = 2; hasta = Math.max(hasta, 3); }
  if (actual >= total - 2) { hasta = total - 1; desde = Math.min(desde, total - 2); }
  const salida: ElementoPagina[] = [1];
  if (desde === 3) salida.push(2);
  else if (desde > 3) salida.push('hueco');
  for (let n = desde; n <= hasta; n += 1) salida.push(n);
  if (hasta === total - 2) salida.push(total - 1);
  else if (hasta < total - 2) salida.push('hueco');
  salida.push(total);
  return salida;
}

/** Filas que muestra la página (1-based, inclusivas): «Mostrando 251–300 de 378». Con 0 filas, 0–0. */
export function rangoPagina(pagina: number, porPagina: number, cantidad: number): { desde: number; hasta: number } {
  if (cantidad === 0) return { desde: 0, hasta: 0 };
  const desde = (pagina - 1) * porPagina + 1;
  return { desde, hasta: Math.min(cantidad, pagina * porPagina) };
}

/** En qué página queda la fila de índice `indice` (0-based). */
export const paginaDeIndice = (indice: number, porPagina: number) => Math.floor(Math.max(0, indice) / porPagina) + 1;
