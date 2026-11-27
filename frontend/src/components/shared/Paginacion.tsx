/**
 * Pie de paginación numerada (fase 5, G18): «Mostrando 251–300 de 378», anterior y siguiente, números con puntos
 * suspensivos (1 2 3 … 8) y 50 o 100 filas por página. En el celular, una versión compacta: «‹ Página 2 de 8 ›».
 * Se usa con `usePaginacionUrl` (la página vive en la URL).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FILAS_POR_PAGINA, paginasVisibles, type FilasPorPagina } from '@/lib/paginacion';
import type { Paginacion as EstadoPaginacion } from '@/lib/usePaginacionUrl';

export function Paginacion({ estado, sufijo, className }: {
  estado: Pick<EstadoPaginacion<unknown>, 'actual' | 'total' | 'desde' | 'hasta' | 'cantidad' | 'porPagina' | 'irA' | 'cambiarPorPagina'>;
  /** Texto después del total, p. ej. « (de 379 vivos)». */
  sufijo?: string;
  className?: string;
}) {
  const { actual, total, desde, hasta, cantidad, porPagina, irA, cambiarPorPagina } = estado;
  const mostrando = `Mostrando ${desde}–${hasta} de ${cantidad}${sufijo ?? ''}`;
  const boton = 'inline-flex min-h-tap min-w-tap items-center justify-center rounded-md px-2 text-small tabular-nums disabled:pointer-events-none disabled:opacity-40';
  return (
    <nav aria-label="Paginación" className={cn('text-small text-ink-3', className)}>
      {/* Escritorio */}
      <div className="hidden flex-wrap items-center justify-between gap-3 md:flex">
        <span className="tabular-nums">{mostrando}</span>
        <div className="flex flex-wrap items-center gap-3">
          {total > 1 && (
            <ul className="flex items-center gap-1">
              <li>
                <button type="button" className={cn(boton, 'gap-1 border border-line bg-surface text-ink-2 hover:bg-surface-2')} disabled={actual <= 1} onClick={() => irA(actual - 1)}>
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
                </button>
              </li>
              {paginasVisibles(actual, total).map((p, i) => (
                <li key={p === 'hueco' ? `hueco-${i}` : p}>
                  {p === 'hueco' ? (
                    <span className="px-1 text-ink-3" aria-hidden="true">…</span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Página ${p}`}
                      aria-current={p === actual ? 'page' : undefined}
                      className={cn(boton, p === actual ? 'bg-brand-l font-semibold text-brand-ink' : 'text-ink-2 hover:bg-surface-2')}
                      onClick={() => irA(p)}
                    >
                      {p}
                    </button>
                  )}
                </li>
              ))}
              <li>
                <button type="button" className={cn(boton, 'gap-1 border border-line bg-surface text-ink-2 hover:bg-surface-2')} disabled={actual >= total} onClick={() => irA(actual + 1)}>
                  Siguiente <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            </ul>
          )}
          {cantidad > FILAS_POR_PAGINA[0] && (
            <label className="flex items-center gap-1.5">
              Filas por página
              <select
                className="min-h-tap rounded-md border border-line bg-surface px-2 text-small text-ink"
                value={porPagina}
                onChange={(e) => cambiarPorPagina(Number(e.target.value) as FilasPorPagina)}
              >
                {FILAS_POR_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
      {/* Celular */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        {total > 1 ? (
          <>
            <button type="button" aria-label="Página anterior" className={cn(boton, 'border border-line bg-surface text-ink-2')} disabled={actual <= 1} onClick={() => irA(actual - 1)}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="flex flex-col items-center tabular-nums">
              <span className="text-body text-ink">Página {actual} de {total}</span>
              <span className="text-micro">{desde}–{hasta} de {cantidad}</span>
            </span>
            <button type="button" aria-label="Página siguiente" className={cn(boton, 'border border-line bg-surface text-ink-2')} disabled={actual >= total} onClick={() => irA(actual + 1)}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        ) : (
          <span className="tabular-nums">{mostrando}</span>
        )}
      </div>
    </nav>
  );
}
