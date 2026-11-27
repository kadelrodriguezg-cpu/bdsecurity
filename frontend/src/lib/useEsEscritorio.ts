import { useEffect, useState } from 'react';

/** Corte entre escritorio y celular (decisión N12). */
export const CONSULTA_ESCRITORIO = '(min-width: 768px)';

/**
 * ¿La ventana mide al menos 768 px? Escucha los cambios (girar el teléfono, redimensionar). Sin `matchMedia`
 * (pruebas, entornos sin ventana) se asume escritorio, que es el diseño que ya conocían las pruebas.
 */
export function useEsEscritorio(): boolean {
  const consulta = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(CONSULTA_ESCRITORIO) : null);
  const [esEscritorio, setEsEscritorio] = useState(() => consulta()?.matches ?? true);
  useEffect(() => {
    const mq = consulta();
    if (!mq) return;
    const alCambiar = () => setEsEscritorio(mq.matches);
    alCambiar();
    mq.addEventListener?.('change', alCambiar);
    return () => mq.removeEventListener?.('change', alCambiar);
  }, []);
  return esEscritorio;
}
