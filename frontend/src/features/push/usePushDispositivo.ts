import { useCallback, useEffect, useState } from 'react';
import { push } from '@/api/push';
import { activarPush, desactivarPush, leerEstadoPush, type EstadoPush } from '@/lib/push/dispositivo';

/** Estado del botón «Activar notificaciones» de este dispositivo. */
export function usePushDispositivo() {
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    void leerEstadoPush().then((leido) => { if (vigente) setEstado(leido); })
      .catch(() => { if (vigente) setEstado({ tipo: 'no_soportado' }); });
    return () => { vigente = false; };
  }, []);

  const ejecutar = useCallback(async (accion: () => Promise<EstadoPush>) => {
    setProcesando(true);
    setError(null);
    try {
      setEstado(await accion());
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo cambiar las notificaciones.');
      setEstado(await leerEstadoPush().catch(() => ({ tipo: 'no_soportado' as const })));
    } finally {
      setProcesando(false);
    }
  }, []);

  return {
    estado,
    procesando,
    error,
    activar: () => ejecutar(() => activarPush(push)),
    desactivar: () => ejecutar(() => desactivarPush(push)),
  };
}
