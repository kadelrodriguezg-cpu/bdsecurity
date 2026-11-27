/**
 * Rutas que llevan a un individuo concreto. Una sola definición para el escáner
 * y para la página `/individuo/:id`, para que no se desincronicen.
 */

/** UUID con forma válida (cualquier versión), de cuerpo completo. */
export const UUID_COMPLETO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ficha del cruce posicionada en la fila de un individuo. Solo lectura: no abre ninguna acción de escritura. */
export function rutaFichaIndividuo(plantaId: string, individuoId: string): string {
  return `/planta/${plantaId}?individuo=${individuoId}`;
}

/**
 * Destino de «volver» pedido por la URL (`?volver=`) de una pantalla completa: solo rutas internas de ESTE cruce
 * (nada de redirecciones a otro sitio ni a otro cruce). Devuelve null si falta o no es válido.
 */
export function volverDeCruce(plantaId: string, pedido: string | null): string | null {
  const raiz = `/planta/${plantaId}`;
  if (!pedido || pedido.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(pedido)) return null;
  if (pedido.split(/[?#]/)[0].split('/').includes('..')) return null;
  const resto = pedido.slice(raiz.length);
  return pedido.startsWith(raiz) && (resto === '' || /^[/?#]/.test(resto)) ? pedido : null;
}

/** Evaluación reducida de Crecimiento a pantalla completa; `volver` es la ficha a la que se regresa al cerrar. */
export function rutaEvaluarCrecimiento(plantaId: string, individuoId: string, volver?: string): string {
  const ruta = `/planta/${plantaId}/crecimiento/${individuoId}`;
  return volver ? `${ruta}?volver=${encodeURIComponent(volver)}` : ruta;
}

/** Evaluación de una ronda multisitio a pantalla completa (`ronda` = número de la ronda del individuo). */
export function rutaEvaluarMultisitio(plantaId: string, individuoId: string, opciones: { ronda?: number; volver?: string } = {}): string {
  const consulta = new URLSearchParams();
  if (opciones.ronda !== undefined) consulta.set('ronda', String(opciones.ronda));
  if (opciones.volver) consulta.set('volver', opciones.volver);
  const texto = consulta.toString();
  return `/planta/${plantaId}/multisitio/${individuoId}${texto ? `?${texto}` : ''}`;
}

/** Individuo que pide la URL de la ficha (`?individuo=`), o null si falta o no es un UUID válido. */
export function individuoDesdeBusqueda(valor: string | null): string | null {
  return valor !== null && UUID_COMPLETO_RE.test(valor) ? valor.toLowerCase() : null;
}
