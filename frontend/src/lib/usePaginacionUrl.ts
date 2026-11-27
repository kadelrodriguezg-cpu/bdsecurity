/**
 * Paginación numerada con la página y las filas por página en la URL (fase 5, G18). Los filtros, la búsqueda y los conteos
 * se calculan sobre todo `items`; aquí solo se corta la página que se dibuja. Cambiar el filtro o la búsqueda vuelve a la
 * página 1: lo hace quien cambia el filtro (borrando `param` en la misma actualización de la URL) o, si el filtro no vive
 * en la URL, el cambio de `reinicio` (no se reinicia al montar: así se respeta la página con la que se llegó).
 */
import { useEffect, useRef } from 'react';
import { useParametrosUrl } from './useParametrosUrl';
import { FILAS_POR_PAGINA, FILAS_POR_PAGINA_INICIAL, acotarPagina, paginaDeIndice, rangoPagina, totalPaginas, type FilasPorPagina } from './paginacion';

export interface OpcionesPaginacion {
  /** Nombre del parámetro de la página en la URL (por omisión `pag`). Dos tablas en la misma pantalla usan nombres distintos. */
  param?: string;
  /** Nombre del parámetro de filas por página (por omisión `filas`). */
  paramFilas?: string;
  /** Si cambia, se vuelve a la página 1 (no al montar). */
  reinicio?: readonly unknown[];
}

export interface Paginacion<T> {
  pagina: T[];
  actual: number;
  total: number;
  porPagina: FilasPorPagina;
  desde: number;
  hasta: number;
  cantidad: number;
  irA: (pagina: number) => void;
  cambiarPorPagina: (filas: FilasPorPagina) => void;
  /** Página en que queda la fila de índice `indice` de `items`. */
  paginaDe: (indice: number) => number;
}

export function usePaginacionUrl<T>(items: readonly T[], opciones: OpcionesPaginacion = {}): Paginacion<T> {
  const { param = 'pag', paramFilas = 'filas', reinicio = [] } = opciones;
  const [parametros, setParametros] = useParametrosUrl();
  const filasUrl = Number(parametros.get(paramFilas));
  const porPagina: FilasPorPagina = (FILAS_POR_PAGINA as readonly number[]).includes(filasUrl) ? (filasUrl as FilasPorPagina) : FILAS_POR_PAGINA_INICIAL;
  const total = totalPaginas(items.length, porPagina);
  const actual = acotarPagina(Number(parametros.get(param) ?? 1), total);
  const { desde, hasta } = rangoPagina(actual, porPagina, items.length);

  const irA = (pagina: number) => setParametros((p) => {
    const n = acotarPagina(pagina, total);
    if (n <= 1) p.delete(param); else p.set(param, String(n));
  });
  const cambiarPorPagina = (filas: FilasPorPagina) => setParametros((p) => {
    if (filas === FILAS_POR_PAGINA_INICIAL) p.delete(paramFilas); else p.set(paramFilas, String(filas));
    p.delete(param);
  });

  const clave = JSON.stringify(reinicio);
  const claveAnterior = useRef(clave);
  useEffect(() => {
    if (claveAnterior.current === clave) return;
    claveAnterior.current = clave;
    setParametros((p) => { p.delete(param); });
  }, [clave, param, setParametros]);

  return {
    pagina: items.slice(desde > 0 ? desde - 1 : 0, hasta),
    actual, total, porPagina, desde, hasta, cantidad: items.length,
    irA, cambiarPorPagina,
    paginaDe: (indice: number) => paginaDeIndice(indice, porPagina),
  };
}
