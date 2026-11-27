/**
 * Piezas compartidas por las planillas de avance (Fase 2, referencias
 * docs/diseno/v2/01, 06 y 07): la anual, la de Crecimiento y la de Multisitio
 * usan los mismos filtros tipo píldora, la misma barra de avance y los mismos
 * chips de estado. La paginación es la compartida (components/shared/Paginacion, G18).
 */
import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, Flag, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatearActividad } from '@/lib/v3/formatos';

export const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «hoy 09:40», «ayer 18:05» o «22-10-2026, 11:42» (contrato N9): en terreno se lee la hora, nunca «hace 2 h». */
export function horaModificacion(iso: string) {
  return formatearActividad(iso);
}

// --- Chips de estado --------------------------------------------------------

export type EstadoChip = 'completa' | 'cerrada' | 'borrador' | 'pendiente' | 'sin_ronda' | 'revisar' | 'no_evaluada';
const CHIPS: Record<EstadoChip, [clase: string, texto: string, icono: typeof Flag]> = {
  completa: ['bg-ok-l text-ok', 'Completa', CircleCheck],
  // U-06: cerrada con obligatorios sin medir. El verde es solo para n/n; lo que falta va en ámbar.
  cerrada: ['bg-warn-l text-warn', 'Cerrada', CircleAlert],
  borrador: ['bg-brand-s text-brand-ink', 'Borrador', Pencil],
  pendiente: ['bg-neutral-l text-ink-2', 'Sin empezar', CircleDashed],
  sin_ronda: ['bg-neutral-l text-ink-3', 'Sin ronda', CircleDashed],
  revisar: ['bg-danger-l text-danger', 'Revisar', Flag],
  // Fase 5 (G3): sin evaluar en esta ronda, con motivo (cuenta como resuelta).
  no_evaluada: ['bg-neutral-l text-ink-2', 'No evaluada', CircleMinus],
};

export function ChipEstadoPlanilla({ estado, texto }: { estado: EstadoChip; texto?: string }) {
  const [clase, etiqueta, Icono] = CHIPS[estado];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-small', clase)}>
      <Icono className="h-3 w-3" aria-hidden="true" />{texto ?? etiqueta}
    </span>
  );
}

// --- Filtros tipo píldora con conteo ---------------------------------------

export interface OpcionPildora<K extends string> { clave: K; etiqueta: string; conteo: number }

export function PildorasFiltro<K extends string>({ etiqueta, opciones, activa, onElegir, enUnaLinea = false }: {
  /** Nombre del grupo para lectores de pantalla. */
  etiqueta: string;
  opciones: readonly OpcionPildora<K>[];
  activa: K;
  onElegir: (clave: K) => void;
  /** En celular, una sola línea desplazable (para un grupo pegajoso que no se coma la pantalla). */
  enUnaLinea?: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', enUnaLinea && 'max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-0.5')} role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={o.clave}
          type="button"
          aria-pressed={activa === o.clave}
          onClick={() => onElegir(o.clave)}
          className={cn(
            'min-h-tap shrink-0 whitespace-nowrap rounded-full border px-3 text-small',
            activa === o.clave ? 'border-brand bg-brand-l text-brand-ink' : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
          )}
        >
          {o.etiqueta} <span className="tabular-nums text-ink-3">{o.conteo}</span>
        </button>
      ))}
    </div>
  );
}

// --- Barra de avance --------------------------------------------------------

export interface AvanceBarra {
  vivos: number;
  completas: number;
  /** Completas con algo por revisar: se pintan aparte, ya están dentro de `completas`. */
  porRevisar?: number;
  /** Sin este dato (Crecimiento no tiene borradores) la barra y la leyenda no lo muestran. */
  borradores?: number;
  pendientes: number;
  sinRonda?: number;
  /** Fase 5 (G3): plantas marcadas «No evaluada» en la ronda. */
  noEvaluadas?: number;
}

/**
 * Barra segmentada (completas, por revisar, borradores) y su leyenda; el avance se mide por evaluación cerrada, nunca por puntaje.
 * La leyenda es una partición de los vivos: «N cerradas (de ellas, M por revisar) · B borradores · S sin empezar · R sin ronda»
 * (decisión D14; «sin empezar» es E16). «Por revisar» está DENTRO de «cerradas»: no se suma aparte.
 */
export function BarraAvance({ avance, etiqueta = 'Avance de la ronda' }: { avance: AvanceBarra; etiqueta?: string }) {
  const { vivos, completas, borradores, pendientes } = avance;
  const porRevisar = avance.porRevisar ?? 0;
  const sinRonda = avance.sinRonda ?? 0;
  const noEvaluadas = avance.noEvaluadas ?? 0;
  const pct = (n: number) => (vivos > 0 ? (n / vivos) * 100 : 0);
  return (
    <>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-track"
        role="progressbar"
        aria-label={etiqueta}
        aria-valuemin={0}
        aria-valuemax={vivos}
        aria-valuenow={completas}
      >
        <div className="h-full bg-brand" style={{ width: `${pct(completas - porRevisar)}%` }} />
        <div className="h-full bg-danger" style={{ width: `${pct(porRevisar)}%` }} />
        <div className="h-full bg-brand-c" style={{ width: `${pct(borradores ?? 0)}%` }} />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small tabular-nums text-ink-3" aria-label="Detalle del avance">
        <li className="flex flex-wrap items-center gap-x-1.5">
          <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />{pl(completas, 'cerrada', 'cerradas')}
          {porRevisar > 0 && (
            <span className="inline-flex items-center gap-1.5">(de ellas,<span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />{porRevisar} por revisar)</span>
          )}
        </li>
        {borradores !== undefined && <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-c" aria-hidden="true" />{pl(borradores, 'borrador', 'borradores')}</li>}
        <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-line bg-surface" aria-hidden="true" />{pendientes} sin empezar</li>
        {noEvaluadas > 0 && <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ink-3" aria-hidden="true" />{pl(noEvaluadas, 'no evaluada', 'no evaluadas')}</li>}
        {sinRonda > 0 && <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-dashed border-ink-3" aria-hidden="true" />{sinRonda} sin ronda</li>}
      </ul>
    </>
  );
}
