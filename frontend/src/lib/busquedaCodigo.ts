/**
 * Búsqueda por código (decisión N13): UNA sola lógica para la búsqueda del encabezado y la página del escáner. Resuelve lo que se lee o se escribe (código de cruce, código de individuo o QR) a una ruta de la ficha.
 * El código impreso de un individuo termina en «-P» y su número (U-11).
 */
import { buscarIdPorCodigoSistema } from '@/api/plantas';
import { resolverIndividuo, resolverIndividuoPorCodigo, type IndividuoResuelto } from '@/api/individuos';
import { rutaFichaIndividuo } from '@/lib/rutasIndividuo';
import type { ResultadoQR } from '@/components/shared/QRScanner';

export type Lectura = ResultadoQR | { tipo: 'codigo_individuo'; valor: string };

const CODIGO_INDIVIDUO_RE = /-P\d+$/i;

/** Lo escrito a mano: «02-502-P1» es un individuo; cualquier otro código, un cruce. */
export function lecturaDeTexto(texto: string): Lectura {
  const valor = texto.trim();
  return { tipo: CODIGO_INDIVIDUO_RE.test(valor) ? 'codigo_individuo' : 'codigo_sistema', valor };
}

export type ResultadoBusqueda = { ruta: string } | { error: string };

export async function resolverLectura(lectura: Lectura): Promise<ResultadoBusqueda> {
  try {
    if (lectura.tipo === 'individuo' || lectura.tipo === 'codigo_individuo') {
      const individuo: IndividuoResuelto | null = lectura.tipo === 'individuo'
        ? await resolverIndividuo(lectura.valor)
        : await resolverIndividuoPorCodigo(lectura.valor);
      if (individuo) return { ruta: rutaFichaIndividuo(individuo.planta_id, individuo.id) };
      return { error: 'No se encontró ningún individuo con ese código. Revisa la etiqueta e intenta de nuevo.' };
    }
    const id = lectura.tipo === 'id' ? lectura.valor : await buscarIdPorCodigoSistema(lectura.valor);
    if (id) return { ruta: `/planta/${id}` };
    return { error: 'No se encontró ningún cruce con ese código. Revisa la etiqueta e intenta de nuevo.' };
  } catch {
    return { error: 'No se pudo buscar el cruce. Revisa tu conexión e intenta de nuevo.' };
  }
}
