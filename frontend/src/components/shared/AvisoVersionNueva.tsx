/**
 * Aviso discreto de «versión nueva». Aparece solo cuando la app encontró una
 * versión publicada más nueva pero NO recargó porque hay cambios sin guardar (o
 * se guardaron hace instantes). El usuario decide cuándo actualizar.
 */
import { RefreshCw } from 'lucide-react';

export function AvisoVersionNueva({ onActualizar }: { onActualizar: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-[calc(0.5rem+env(safe-area-inset-top))] z-[60] mx-auto flex max-w-sm items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-small text-ink shadow-lg"
    >
      <span>Hay una versión nueva</span>
      <button
        type="button"
        onClick={onActualizar}
        className="inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-md px-2 font-semibold text-brand hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <RefreshCw aria-hidden="true" className="h-4 w-4" />
        Actualizar
      </button>
    </div>
  );
}
