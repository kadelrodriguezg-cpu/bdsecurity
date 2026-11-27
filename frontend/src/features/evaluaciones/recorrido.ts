/**
 * Recorrido de la planilla al evaluar a pantalla completa (fase 5, decisiones G11 a G13).
 *
 * - «Siguiente» sigue el filtro desde el que se llegó: desde «Borradores», el próximo borrador después de la planta actual
 *   (de cualquier autor si es admin; solo los propios si es operario); desde «Sin empezar», la próxima sin empezar. Si no
 *   queda ninguno después de la actual, se vuelve a la planilla con un aviso: nunca se salta al principio del cruce.
 * - Sin filtro, la regla de siempre (A1-144): la siguiente sin empezar por número y, pasado el último, desde la primera.
 * - La planilla viaja en la URL (`?planilla=`): al volver se abre igual (filtro, búsqueda, página) y con `desde=` la planta
 *   de la que se volvió.
 */
import type { FilaPlanilla } from '@/api/protocolo';
import { corto, visitaNuevaEnBorrador } from './filaPlanilla';

export type FiltroRecorrido = 'borradores' | 'pendientes';

export const leerFiltroRecorrido = (valor: string | null): FiltroRecorrido | null => (valor === 'borradores' || valor === 'pendientes' ? valor : null);

/** Lo que se puede evaluar desde la pantalla, según el filtro de origen. */
export function filaRecorrible(f: FilaPlanilla, filtro: FiltroRecorrido | null, esAdmin: boolean): boolean {
  const borradorPropioOAdmin = f.estado === 'borrador' && (f.es_mia || esAdmin);
  // El borrador de una visita nueva sobre una fila cerrada solo lo continúa su autor (U-09), también para el admin.
  const visitaPropia = visitaNuevaEnBorrador(f) && f.borrador_mio === true;
  if (filtro === 'borradores') return borradorPropioOAdmin || visitaPropia;
  if (filtro === 'pendientes') return f.estado === 'sin_iniciar';
  // U-09: sin filtro, pendientes y borradores propios.
  return f.estado === 'sin_iniciar' || (f.estado === 'borrador' && f.es_mia) || visitaPropia;
}

export interface Vecinos {
  anterior: FilaPlanilla | null;
  posterior: FilaPlanilla | null;
  /** A quién lleva «Finalizar y seguir»; null = no hay (con filtro: se vuelve a la planilla con un aviso). */
  siguiente: FilaPlanilla | null;
}

export function vecinosEnRecorrido(filas: readonly FilaPlanilla[], actualId: string, filtro: FiltroRecorrido | null, esAdmin: boolean): Vecinos {
  const indice = filas.findIndex((f) => f.individuo_id === actualId);
  const puede = (f: FilaPlanilla) => filaRecorrible(f, filtro, esAdmin);
  const anterior = indice > 0 ? [...filas.slice(0, indice)].reverse().find(puede) ?? null : null;
  const posterior = indice >= 0 ? filas.slice(indice + 1).find(puede) ?? null : null;
  if (filtro) return { anterior, posterior, siguiente: posterior };
  const actual = indice >= 0 ? filas[indice] : null;
  const pendientes = filas.filter((f) => f.estado === 'sin_iniciar' && f.individuo_id !== actualId);
  const siguiente = pendientes.find((f) => (f.numero ?? Infinity) > (actual?.numero ?? -Infinity)) ?? pendientes[0] ?? null;
  return { anterior, posterior, siguiente };
}

export function avisoSinSiguiente(filtro: FiltroRecorrido, actual: FilaPlanilla): string {
  return filtro === 'borradores'
    ? `No quedan borradores después de ${corto(actual)}`
    : `No quedan plantas sin empezar después de ${corto(actual)}`;
}

/** La URL de la planilla que viajó en `?planilla=`, solo si es de este cruce (nada de redirecciones a otro sitio). */
export function planillaSegura(valor: string | null, plantaId: string): string | null {
  if (!valor || valor.startsWith('//')) return null;
  return valor === `/planta/${plantaId}` || valor.startsWith(`/planta/${plantaId}?`) ? valor : null;
}

/** La planilla con `desde=` (la planta de la que se vuelve), reemplazando uno anterior. */
export function conDesde(url: string, individuoId: string): string {
  const [ruta, consulta = ''] = url.split('?');
  const p = new URLSearchParams(consulta);
  p.delete('desde');
  p.set('desde', individuoId);
  return `${ruta}?${p.toString()}`;
}

/** Parámetros que la planilla agrega a la ruta de evaluar: el filtro de origen y la planilla a la que volver (sin `desde`). */
export function parametrosRecorrido(filtro: string, urlPlanilla: string): string {
  const planilla = quitarDesde(urlPlanilla);
  const p = new URLSearchParams();
  const f = leerFiltroRecorrido(filtro);
  if (f) p.set('filtro', f);
  p.set('planilla', planilla);
  return p.toString();
}

/** La URL sin `desde=` (lo que la planilla pasa al evaluar: al volver se agrega el de la planta evaluada). */
export function quitarDesde(url: string): string {
  const [ruta, consulta = ''] = url.split('?');
  const p = new URLSearchParams(consulta);
  p.delete('desde');
  return p.toString() ? `${ruta}?${p.toString()}` : ruta;
}
