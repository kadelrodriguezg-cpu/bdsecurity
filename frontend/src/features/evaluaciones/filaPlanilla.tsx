/**
 * Piezas de una fila de la planilla de ronda que comparten la tabla de avance y
 * la matriz «Ver valores»: qué fila hay que revisar, su código corto y su chip.
 */
import type { DescriptoresProtocolo, FilaPlanilla } from '@/api/protocolo';
import { contarObligatoriosDeEstados } from '@/lib/esquemaFase/protocolo';
import type { EsquemaFase } from '@/lib/esquemaFase/tipos';
import { ChipEstadoPlanilla, type EstadoChip } from './PlanillaPiezas';
import { etiquetaMotivoNoEvaluada } from '@/lib/etiquetas';

export const aRevisar = (f: FilaPlanilla) => (f.conteo?.marcado ?? 0) > 0;
/**
 * U-09: una ronda puede tener varias evaluaciones cerradas y, encima, un borrador de una visita nueva. La fila sigue
 * siendo «completa» (el chip principal no cambia); esto es solo el marcador secundario.
 */
export const visitaNuevaEnBorrador = (f: FilaPlanilla) => f.estado === 'completa' && f.hay_borrador === true;

export const corto = (f: FilaPlanilla) => f.codigo_display.split('-').pop() ?? f.codigo_display;

const CHIP_DE_FILA: Record<FilaPlanilla['estado'], EstadoChip> = { completa: 'completa', borrador: 'borrador', sin_iniciar: 'pendiente', sin_ronda: 'sin_ronda', no_evaluada: 'no_evaluada' };

/**
 * U-06: cuántos obligatorios del protocolo faltan en una evaluación cerrada (0 si no es una fila cerrada, si no hay
 * protocolo o si se cerró con otro protocolo, cuyo conteo no sería comparable).
 */
export function faltanObligatorios(f: FilaPlanilla, descriptores: DescriptoresProtocolo | null, esquema?: EsquemaFase): number {
  if (f.estado !== 'completa' || f.protocolo_distinto || !f.estados) return 0;
  const { llenos, total } = contarObligatoriosDeEstados(descriptores, f.estados, esquema);
  return Math.max(0, total - llenos);
}

/** Marcador secundario «Visita nueva en borrador» (con «de otra persona» si el borrador no es de quien mira). */
export function MarcaVisitaNueva({ fila }: { fila: FilaPlanilla }) {
  if (!visitaNuevaEnBorrador(fila)) return null;
  return (
    <span className="inline-flex max-w-full items-center rounded-md border border-dashed border-brand px-2 py-0.5 text-small leading-tight text-brand-ink">
      Visita nueva en borrador{fila.borrador_mio ? '' : ' · de otra persona'}
    </span>
  );
}

/** «Completa» solo con todos los obligatorios; con faltantes, «Cerrada · faltan N» en ámbar; marcada, «Revisar». */
export function ChipEstado({ fila, descriptores = null }: { fila: FilaPlanilla; descriptores?: DescriptoresProtocolo | null }) {
  if (fila.estado === 'no_evaluada') {
    return <ChipEstadoPlanilla estado="no_evaluada" texto={fila.no_evaluada ? `No evaluada · ${etiquetaMotivoNoEvaluada(fila.no_evaluada.motivo, fila.no_evaluada.detalle)}` : undefined} />;
  }
  if (fila.estado === 'completa' && aRevisar(fila)) return <ChipEstadoPlanilla estado="revisar" />;
  const faltan = faltanObligatorios(fila, descriptores);
  if (faltan > 0) return <ChipEstadoPlanilla estado="cerrada" texto={`Cerrada · ${faltan === 1 ? 'falta 1' : `faltan ${faltan}`}`} />;
  return <ChipEstadoPlanilla estado={CHIP_DE_FILA[fila.estado]} />;
}
