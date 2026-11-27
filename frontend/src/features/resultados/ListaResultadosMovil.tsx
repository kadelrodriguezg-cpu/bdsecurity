/** Resultados en el celular: lista simple (puesto, código, «Año N» y puntaje con barra y mediana, chip de cambio). Sin categorías en la fila. */
import { ChevronRight } from 'lucide-react';
import { formatearPuntos } from '@/lib/v3/puntaje';
import { etiquetaAnio, textoEmpate } from '@/lib/etiquetas';
import { BarraPuntaje, ChipCambio } from './piezas';
import type { Cambio, FilaResultado } from './modelo';

export function ListaResultadosMovil({ filas, mediana, cambios, sinCambio, onSeleccion, empates }: {
  filas: readonly FilaResultado[];
  mediana: number | null;
  cambios: Map<string, Cambio> | undefined;
  sinCambio?: (individuoId: string) => string;
  onSeleccion: (individuoId: string) => void;
  /** G19: con cuántos otros comparte el puesto cada individuo. */
  empates?: Map<string, number>;
}) {
  return (
    <ul className="divide-y divide-line-soft rounded-lg border border-line bg-surface">
      {filas.map((f) => (
        <li key={f.individuo_id}>
          <button
            type="button"
            onClick={() => onSeleccion(f.individuo_id)}
            className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <span className="w-8 shrink-0 text-center text-body-l font-semibold tabular-nums text-ink">{f.posicion ?? '—'}</span>
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono font-semibold text-ink">{f.codigo_display}</span>
                <span className="shrink-0 text-body-l font-semibold tabular-nums text-ink">
                  {etiquetaAnio(f.numero_ronda) && <span className="mr-2 text-small font-normal text-ink-3">{etiquetaAnio(f.numero_ronda)}</span>}
                  {formatearPuntos(f.puntaje)}
                </span>
              </span>
              <BarraPuntaje valor={f.puntaje} mediana={mediana} />
              {textoEmpate(empates?.get(f.individuo_id)) && <span className="block text-micro text-ink-3">Puesto {f.posicion} · {textoEmpate(empates?.get(f.individuo_id))}</span>}
              {cambios && <ChipCambio cambio={cambios.get(f.individuo_id)} sinCambio={sinCambio?.(f.individuo_id)} />}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
