/** Mensaje de error de carga de un catálogo, en palabras del equipo (sin detalles técnicos). */
export function mensajeCarga(nombre: string, error: unknown): string {
  return error instanceof Error && error.message === 'Failed to fetch'
    ? `No se pudo conectar para cargar ${nombre}.`
    : `No se pudieron cargar ${nombre}. Revisa tus permisos e inténtalo nuevamente.`;
}
