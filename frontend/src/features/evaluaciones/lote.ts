/**
 * Ejecuta una operación sobre muchos elementos con un tope de llamadas
 * simultáneas (Sprint 1.1: iniciar la ronda de cientos de individuos sin
 * saturar la API). Nunca corta por un error: cada elemento termina como
 * hecho o fallido, y el avance se informa a medida que terminan.
 */
export interface ResultadoLote<T> {
  hechos: T[];
  fallidos: { item: T; error: unknown }[];
}

export async function ejecutarEnLote<T>(
  items: readonly T[],
  operacion: (item: T) => Promise<unknown>,
  { concurrencia = 5, onAvance }: { concurrencia?: number; onAvance?: (terminados: number, total: number) => void } = {},
): Promise<ResultadoLote<T>> {
  const hechos: T[] = [];
  const fallidos: { item: T; error: unknown }[] = [];
  let siguiente = 0;
  let terminados = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const item = items[siguiente];
      siguiente += 1;
      try {
        await operacion(item);
        hechos.push(item);
      } catch (error) {
        fallidos.push({ item, error });
      }
      terminados += 1;
      onAvance?.(terminados, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrencia), items.length) }, trabajador));
  return { hechos, fallidos };
}
