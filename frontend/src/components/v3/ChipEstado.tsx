/**
 * Contrato v3 (docs/rediseno_v3/contrato.md, §5): el chip de estado del individuo en la ronda, a partir del estado del contrato
 * (`lib/v3/estados.ts`) y no de cada pantalla. Usa el mismo chip visual que la planilla de ronda (`ChipEstadoPlanilla`), así que no
 * cambia ningún color ni palabra: solo decide cuál mostrar. No lo usa ninguna pantalla todavía.
 *
 * Vocabulario actual (decisión E18: «Cerrada» y «Completa» se conservan los dos; «Completa» es un subconjunto de las cerradas):
 *   cerrada con todo lo obligatorio .......... «Completa» (verde)
 *   cerrada con obligatorios sin medir ....... «Cerrada · falta 1» / «Cerrada · faltan N» (ámbar)
 *   cerrada con una métrica marcada .......... «Revisar» (rojo)
 *   borrador ................................ «Borrador» (índigo suave)
 *   sin evaluación ........................... «Pendiente» (gris; por E15 y E16 esta palabra será «Sin empezar» al migrar las pantallas)
 *   sin ronda ................................ «Sin ronda» (gris punteado)
 */
import { ChipEstadoPlanilla, type EstadoChip } from '@/features/evaluaciones/PlanillaPiezas';
import type { EstadoIndividuoRonda } from '@/lib/v3/estados';

export interface PropsChipEstado {
  estado: EstadoIndividuoRonda;
  /** Obligatorios del protocolo que faltan en la evaluación cerrada (solo aplica a `cerrada`). */
  faltan?: number;
  /** La evaluación cerrada tiene una métrica marcada para revisión (solo aplica a `cerrada`). */
  aRevisar?: boolean;
}

/** Qué chip y qué texto corresponden a un estado. Separado del componente para poder probarlo y reutilizarlo en listas. */
export function chipDeEstado({ estado, faltan = 0, aRevisar = false }: PropsChipEstado): { chip: EstadoChip; texto?: string } {
  switch (estado) {
    case 'cerrada':
      if (aRevisar) return { chip: 'revisar' };
      if (faltan > 0) return { chip: 'cerrada', texto: `Cerrada · ${faltan === 1 ? 'falta 1' : `faltan ${faltan}`}` };
      return { chip: 'completa' };
    case 'borrador': return { chip: 'borrador' };
    case 'sin_evaluacion': return { chip: 'pendiente' };
    case 'sin_ronda': return { chip: 'sin_ronda' };
  }
}

export function ChipEstado(props: PropsChipEstado) {
  const { chip, texto } = chipDeEstado(props);
  return <ChipEstadoPlanilla estado={chip} texto={texto} />;
}
