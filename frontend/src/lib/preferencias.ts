/**
 * Opción global de admin «Incluir cruces de prueba» (N4; docs/rediseno_v3/inicio_cruces.md). Se guarda en este equipo
 * (localStorage, con try/catch: en una ventana privada puede no estar) y avisa a todas las pantallas abiertas. Para un
 * operario siempre vale false: la base tampoco le entrega cruces de prueba aunque los pida (migración 20261024090000).
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';

const CLAVE = 'bds:incluir-cruces-prueba';
const EVENTO = 'bds:preferencias';

function leer(): boolean {
  try { return window.localStorage.getItem(CLAVE) === '1'; } catch { return false; }
}

export function guardarIncluirPruebas(valor: boolean): void {
  try {
    if (valor) window.localStorage.setItem(CLAVE, '1');
    else window.localStorage.removeItem(CLAVE);
  } catch {
    // Sin almacenamiento (ventana privada): la opción vale solo mientras dure esta pantalla.
  }
  window.dispatchEvent(new Event(EVENTO));
}

/** [valor efectivo, cambiar]. El valor efectivo es false para quien no es admin. */
export function useIncluirPruebas(): [boolean, (valor: boolean) => void] {
  const { esAdmin } = useAuth();
  const [guardado, setGuardado] = useState(leer);
  useEffect(() => {
    const alCambiar = () => setGuardado(leer());
    window.addEventListener(EVENTO, alCambiar);
    window.addEventListener('storage', alCambiar);
    return () => {
      window.removeEventListener(EVENTO, alCambiar);
      window.removeEventListener('storage', alCambiar);
    };
  }, []);
  const cambiar = useCallback((valor: boolean) => { setGuardado(valor); guardarIncluirPruebas(valor); }, []);
  return [esAdmin && guardado, cambiar];
}
