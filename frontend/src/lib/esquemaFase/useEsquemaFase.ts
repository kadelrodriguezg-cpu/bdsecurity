import { useQuery } from '@tanstack/react-query';
import { obtenerEsquemaFase } from '@/api/esquemaFase';
import { especieDeCruce, listarConfigDescriptores } from '@/api/descriptoresEspecie';
import { aplicarEspecie } from './especie';
import { qk } from '@/lib/queryKeys';
import { ESQUEMA_EVALUACION_ANUAL, type ClaveEvaluacionAnual } from './evaluacionAnual';
import type { EsquemaFase } from './tipos';

/**
 * Esquema de Evaluación anual desde la base. Mientras carga, o sin conexión,
 * usa la copia TS (idéntica por prueba), así que nunca devuelve vacío.
 */
export function useEsquemaEvaluacionAnual(): EsquemaFase<ClaveEvaluacionAnual> {
  const { data } = useQuery({
    queryKey: qk.esquemaFase('evaluacion_anual'),
    queryFn: () => obtenerEsquemaFase('evaluacion_anual'),
    staleTime: Infinity,
    retry: false,
  });
  return (data as EsquemaFase<ClaveEvaluacionAnual> | undefined) ?? ESQUEMA_EVALUACION_ANUAL;
}

/** Especie de un cruce (fase 4), para usar el esquema de esa especie en formularios y lecturas. */
export function useEspecieDeCruce(plantaId: string | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: qk.especieDeCruce(plantaId ?? ''),
    queryFn: () => especieDeCruce(plantaId as string),
    enabled: !!plantaId,
    staleTime: Infinity,
  });
  return data ?? null;
}

/**
 * Esquema de Evaluación anual tal como lo usa una especie (fase 4): sin los descriptores que la especie no usa (quedan como
 * desactivados) y con sus etiquetas por nivel propias. Sin especie, o mientras carga, es el esquema de siempre.
 */
export function useEsquemaEvaluacionAnualDeEspecie(especieId: string | null | undefined): EsquemaFase<ClaveEvaluacionAnual> {
  const esquema = useEsquemaEvaluacionAnual();
  const { data } = useQuery({
    queryKey: qk.descriptoresEspecie(especieId ?? ''),
    queryFn: () => listarConfigDescriptores(especieId as string),
    enabled: !!especieId,
    staleTime: 60_000,
  });
  return data ? aplicarEspecie(esquema, data) : esquema;
}
