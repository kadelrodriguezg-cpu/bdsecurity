/**
 * Nombre corto de una persona para las pantallas de terreno (U-20): inicial del primer nombre y último apellido,
 * «María Soto» → «M. Soto». Con una sola palabra, esa palabra. Vacío si no hay nombre.
 */
export function nombreCorto(nombre: string | null | undefined): string {
  const palabras = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '';
  if (palabras.length === 1) return palabras[0];
  return `${palabras[0][0].toUpperCase()}. ${palabras[palabras.length - 1]}`;
}
