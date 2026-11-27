import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

/** Cuánto hay que bajar antes de ofrecer «Volver arriba» (U-10: las planillas largas pierden el contexto al bajar). */
export const UMBRAL_VOLVER_ARRIBA_PX = 600;

/** Botón flotante a la izquierda (el chat y la campana ocupan la derecha) que lleva al inicio de la página. */
export function VolverArriba() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const alDesplazar = () => setVisible(window.scrollY > UMBRAL_VOLVER_ARRIBA_PX);
    alDesplazar();
    window.addEventListener('scroll', alDesplazar, { passive: true });
    return () => window.removeEventListener('scroll', alDesplazar);
  }, []);
  if (!visible) return null;
  const sinMovimiento = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: sinMovimiento ? 'auto' : 'smooth' })}
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 z-30 inline-flex min-h-tap items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-small font-medium text-ink-2 hover:bg-surface-2 md:bottom-6 md:left-6"
    >
      <ArrowUp className="h-4 w-4" aria-hidden="true" /> Volver arriba
    </button>
  );
}
