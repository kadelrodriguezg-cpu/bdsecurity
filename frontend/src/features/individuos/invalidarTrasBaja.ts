/**
 * Consultas que quedan viejas cuando uno o varios individuos se dan de baja.
 * Una sola lista para la baja individual (BajaForm) y la baja en lote: la
 * invalidación ya falló varias veces en este repo por listas copiadas que se
 * desalinearon.
 *
 * estado_vital decide la elegibilidad del ranking (individuo_descartado/
 * muerto), los conteos de vivos de los listados de cruces, la comparación de
 * rondas (solo vivos), ResumenFinal y la ficha del cruce.
 */
import type { QueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';

export function invalidarTrasBaja(
  queryClient: QueryClient,
  { plantaIds, individuoIds }: { plantaIds: string[]; individuoIds: string[] },
) {
  const claves: ReadonlyArray<readonly unknown[]> = [
    qk.individuos.all,
    qk.plantas.all,
    qk.ranking.all,
    qk.dashboard.all,
    qk.resumenFinal.all,
    qk.comparacion.all,
    qk.territorio.mapaCruceAll,
    qk.territorio.mapaAgregadoAll,
    ...individuoIds.map((id) => qk.baja.motivos(id)),
    ...plantaIds.flatMap((id) => [
      qk.planta.detalle(id),
      qk.scoring.planta(id),
      qk.auditoria.planta(id),
      qk.actividad.planta(id),
    ]),
  ];
  for (const queryKey of claves) void queryClient.invalidateQueries({ queryKey });
}
