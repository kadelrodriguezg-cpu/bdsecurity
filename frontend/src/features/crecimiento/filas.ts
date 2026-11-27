/**
 * Filas de la planilla de avance de Crecimiento (S2-6): un individuo vivo del
 * cruce y el estado de su evaluación reducida de la fase. No hay rondas ni
 * borradores: está «hecha» si tiene al menos una evaluación, «pendiente» si no.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listarIndividuosDePlanta, type Individuo } from '@/api/individuos';
import { listarEvaluacionesReducidasDeCruce, type EvaluacionReducidaDeCruce } from '@/api/evaluacionReducida';
import { qk } from '@/lib/queryKeys';
import { compararCodigos } from '@/lib/ordenNatural';

export const FASE_CRECIMIENTO = 'crecimiento' as const;

export interface FilaCrecimiento {
  individuo: Individuo;
  /** Número de planta (A1-144): el recorrido va por número. */
  numero: number | null;
  estado: 'pendiente' | 'hecha';
  /** La más reciente. */
  ultima: EvaluacionReducidaDeCruce | null;
  /** Cuántas evaluaciones reducidas de Crecimiento tiene. */
  cantidad: number;
}

export const numeroDeCodigo = (codigo: string): number | null => {
  const m = /-P(\d+)$/i.exec(codigo);
  return m ? Number(m[1]) : null;
};

/** «P12»: lo que se lee en terreno. */
export const codigoCorto = (codigo: string) => codigo.split('-').pop() ?? codigo;

export function armarFilasCrecimiento(individuos: readonly Individuo[], evaluaciones: readonly EvaluacionReducidaDeCruce[]): FilaCrecimiento[] {
  const porIndividuo = new Map<string, EvaluacionReducidaDeCruce[]>();
  for (const e of evaluaciones) porIndividuo.set(e.individuo_id, [...(porIndividuo.get(e.individuo_id) ?? []), e]);
  return individuos
    .filter((i) => i.estado_vital === 'vivo')
    .map((individuo): FilaCrecimiento => {
      const propias = porIndividuo.get(individuo.id) ?? [];
      const ultima = propias.reduce<EvaluacionReducidaDeCruce | null>((a, e) => (!a || e.created_at > a.created_at ? e : a), null);
      return { individuo, numero: numeroDeCodigo(individuo.codigo_display), estado: ultima ? 'hecha' : 'pendiente', ultima, cantidad: propias.length };
    })
    .sort((a, b) => (a.numero ?? Infinity) - (b.numero ?? Infinity) || compararCodigos(a.individuo.codigo_display, b.individuo.codigo_display));
}

/** «Talla 34 · Vigor 4»: lo medido, en una línea. */
export function resumenMedicion(e: EvaluacionReducidaDeCruce): string {
  return [
    e.talla != null && `Talla ${e.talla}`,
    e.numero_entrenudos != null && `Entrenudos ${e.numero_entrenudos}`,
    e.vigor != null && `Vigor ${e.vigor}`,
    e.multibrotes != null && `Multibrotes ${e.multibrotes}`,
    e.presencia_raices != null && `Raíces ${e.presencia_raices}`,
  ].filter(Boolean).join(' · ');
}

/** Los vivos del cruce con el estado de su evaluación reducida de Crecimiento (la misma consulta y caché para la planilla, la pantalla y el resumen de la ficha). */
export function useFilasCrecimiento(plantaId: string, habilitado = true) {
  const individuos = useQuery({ queryKey: qk.individuos.lista(plantaId), queryFn: () => listarIndividuosDePlanta(plantaId), enabled: habilitado });
  const evaluaciones = useQuery({
    queryKey: qk.evaluacionReducida.cruce(plantaId, FASE_CRECIMIENTO),
    queryFn: () => listarEvaluacionesReducidasDeCruce(plantaId, FASE_CRECIMIENTO),
    enabled: habilitado,
  });
  const filas = useMemo(
    () => (individuos.data && evaluaciones.data ? armarFilasCrecimiento(individuos.data, evaluaciones.data) : undefined),
    [individuos.data, evaluaciones.data],
  );
  return {
    filas,
    isPending: individuos.isPending || evaluaciones.isPending,
    isError: individuos.isError || evaluaciones.isError,
    isFetching: individuos.isFetching || evaluaciones.isFetching,
    refetch: () => Promise.all([individuos.refetch(), evaluaciones.refetch()]),
  };
}
