/** Misma clave que public.clave_nombre_variedad (migración del importador).
 * No usar NFD: quitaría diacríticos que la función SQL no traduce.
 */
export function claveNombreVariedad(nombre: string): string {
  const origen = 'áéíóúüñàèìòùâêîôû';
  const destino = 'aeiouunaeiouaeiou';
  return nombre.toLowerCase().replace(/[áéíóúüñàèìòùâêîôû]/g,
    (letra) => destino[origen.indexOf(letra)]!).replace(/[^a-z0-9]/g, '');
}
