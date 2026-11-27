import { useCallback, useEffect, useRef, useState } from 'react';

/** Solo retrasa cierres originados por el overlay. El padre conserva el montaje. */
export function useSalidaAnimada(onCerrar: () => void) {
  const [cerrando, setCerrando] = useState(false);
  const iniciada = useRef(false);
  const terminada = useRef(false);
  const montado = useRef(true);
  const temporizador = useRef<ReturnType<typeof setTimeout>>();
  const callback = useRef(onCerrar);
  callback.current = onCerrar;

  const finalizar = useCallback(() => {
    if (!montado.current || !iniciada.current || terminada.current) return;
    terminada.current = true;
    clearTimeout(temporizador.current);
    callback.current();
  }, []);

  useEffect(() => {
    montado.current = true;
    const preferencia = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const actualizar = () => { if (preferencia?.matches) finalizar(); };
    preferencia?.addEventListener('change', actualizar);
    return () => {
      montado.current = false;
      clearTimeout(temporizador.current);
      preferencia?.removeEventListener('change', actualizar);
    };
  }, [finalizar]);

  const iniciar = () => {
    if (iniciada.current) return;
    iniciada.current = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finalizar();
      return;
    }
    setCerrando(true);
    // CSS es la fuente del tiempo; el fallback cubre CSS ausente (p. ej. jsdom).
    const token = getComputedStyle(document.documentElement).getPropertyValue('--dur-exit-safety').trim();
    const valor = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000);
    temporizador.current = setTimeout(finalizar, Number.isFinite(valor) && valor > 0 ? valor : 300);
  };

  return { cerrando, iniciada, iniciar, finalizar };
}
