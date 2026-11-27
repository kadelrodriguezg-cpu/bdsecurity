/**
 * Qué codifica el QR de cada etiqueta. Es la ÚNICA definición: la etiqueta
 * individual, la descarga en tanda y el escáner (`interpretarQR`) se apoyan en
 * ella, y el test de este módulo comprueba que lo que se imprime es lo que el
 * escáner entiende.
 *
 *   - Etiqueta de un INDIVIDUO: `/individuo/<uuid del individuo>`. Las etiquetas
 *     grande y mediana llevan el origen delante (`https://app/individuo/<uuid>`,
 *     así la cámara nativa del teléfono abre la ficha); la pequeña (QR de ~11 mm)
 *     lleva solo la ruta, igual de corta que el UUID pelado que llevaba antes.
 *   - Etiqueta de un CRUCE (todavía sin individualizar): URL
 *     `https://app/planta/<uuid>`, o el UUID pelado en la pequeña.
 *
 * INVARIANTE: un UUID pelado significa «cruce» PARA SIEMPRE. Las etiquetas
 * pequeñas de cruce ya impresas lo codifican así y no se reimprimen en bloque,
 * de modo que el QR de un individuo NUNCA se emite como UUID pelado: llevaría
 * al escáner a buscar un cruce con el id de un individuo.
 */
import { UUID_COMPLETO_RE } from '@/lib/rutasIndividuo';

export type DestinoQr = { individuoId: string } | { plantaId: string };

/**
 * @param corto  true para la etiqueta pequeña (sin origen); false para grande y mediana (con origen).
 * @param origin `window.location.origin`.
 */
export function contenidoQr(destino: DestinoQr, corto: boolean, origin: string): string {
  if ('individuoId' in destino) {
    // Falla temprano: un id mal formado se imprimiría en la etiqueta física sin que nadie lo note.
    if (!UUID_COMPLETO_RE.test(destino.individuoId)) throw new Error('El individuo no tiene un id válido para el QR.');
    const ruta = `/individuo/${destino.individuoId}`;
    return corto ? ruta : `${origin}${ruta}`;
  }
  if (!UUID_COMPLETO_RE.test(destino.plantaId)) throw new Error('El cruce no tiene un id válido para el QR.');
  return corto ? destino.plantaId : `${origin}/planta/${destino.plantaId}`;
}
