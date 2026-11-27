import { useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';

/** La petición ya iniciada puede terminar; sus efectos pertenecen a su sesión e instancia. */
export function useVigenciaFormulario() {
  const { capturarVigenciaSesion } = useAuth();
  const [sesionVigente] = useState(() => capturarVigenciaSesion());
  const montado = useRef(true);
  useLayoutEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);
  return { sesionVigente, uiVigente: () => montado.current && sesionVigente() };
}
