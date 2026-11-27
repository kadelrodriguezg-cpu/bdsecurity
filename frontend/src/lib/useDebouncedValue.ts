import { useEffect, useState } from 'react';

/** Retrasa la propagación de un valor que cambia rápido (ej. cada tecla de un input). */
export function useDebouncedValue<T>(valor: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(valor);
  useEffect(() => {
    const temporizador = setTimeout(() => setDebounced(valor), delayMs);
    return () => clearTimeout(temporizador);
  }, [valor, delayMs]);
  return debounced;
}
