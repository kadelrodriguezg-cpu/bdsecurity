/** Piezas visuales compartidas de Resultados (escritorio, celular y panel del individuo). */
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { ETIQUETA_DELTA_LABEL } from '@/api/comparacion';
import { formatearCambio } from '@/lib/v3/puntaje';
import { cn } from '@/lib/utils';
import type { Cambio } from './modelo';

/** Ancho de una barra en % (independiente de la escala visible del número). */
const pct = (valor01: number) => Math.min(1, Math.max(0, valor01)) * 100;

const formatoDescriptor = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2, useGrouping: false });
/** Valor crudo de un descriptor en una columna agregada: hasta 2 decimales con coma («15,1»). */
export const formatearDescriptor = (valor: number | null | undefined) => (valor === null || valor === undefined ? '—' : formatoDescriptor.format(Number(valor)));

/** Barra del puntaje con la raya de la mediana del grupo. Valores en 0–1. */
export function BarraPuntaje({ valor, mediana, className }: { valor: number | null; mediana: number | null; className?: string }) {
  const ancho = valor === null ? 0 : pct(valor);
  return (
    <span aria-hidden="true" className={cn('relative block h-1.5 w-full rounded-full bg-track', className)}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${ancho}%` }} />
      {mediana !== null && <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-ink" style={{ left: `calc(${pct(mediana)}% - 1px)` }} />}
    </span>
  );
}

/** Barra fina de una categoría (0–1). */
export function BarraCategoria({ valor }: { valor: number | null }) {
  return (
    <span aria-hidden="true" className="mt-1 block h-1 w-full rounded-full bg-track">
      <span className="block h-1 rounded-full bg-primary opacity-60" style={{ width: `${valor === null ? 0 : pct(valor)}%` }} />
    </span>
  );
}

/**
 * Cambio con flecha, número con signo y texto: nunca solo color («↑ +8,1 · Mejoró marcado»). Sin cambio calculable se
 * muestra el motivo (`sinCambio`, p. ej. «Sin ronda anterior»), nunca «0,0 · Estable».
 */
export function ChipCambio({ cambio, sinCambio, className }: { cambio: Cambio | undefined; sinCambio?: string; className?: string }) {
  if (!cambio) return sinCambio ? <span className={cn('inline-flex whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-small text-ink-3', className)}>{sinCambio}</span> : <span className="text-small text-ink-3">—</span>;
  const sube = cambio.etiqueta.startsWith('mejoro');
  const baja = cambio.etiqueta.startsWith('empeoro');
  const Icono = sube ? ArrowUp : baja ? ArrowDown : Minus;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-small font-medium',
      sube ? 'bg-ok-l text-ok' : baja ? 'bg-danger-l text-danger' : 'bg-neutral-l text-ink-2',
      className,
    )}
    >
      <Icono className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="tabular-nums">{formatearCambio(cambio.delta)}</span>
      <span aria-hidden="true">·</span>
      <span>{ETIQUETA_DELTA_LABEL[cambio.etiqueta]}</span>
    </span>
  );
}

/** Punto ámbar de cobertura baja (N8: ámbar = dato faltante o dudoso). La explicación está una sola vez, al pie. */
export function PuntoCobertura() {
  return <span role="img" aria-label="cobertura baja" className="ml-1 inline-block h-2 w-2 rounded-full bg-warn align-middle" />;
}
