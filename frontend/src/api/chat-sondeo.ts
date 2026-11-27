/**
 * Sondeo de respaldo del chat (S2-8). Realtime es el camino principal; estos
 * temporizadores solo cubren sockets que fallan en silencio. Reglas:
 *  - Con la pestaña oculta no se hacen peticiones periódicas; al volver a
 *    estar visible hay una inmediata y el temporizador se reanuda.
 *  - Tras un 401 / JWT inválido el sondeo se detiene (no reintenta en bucle)
 *    hasta que vuelva la sesión. El cierre de sesión y la redirección los
 *    resuelve el flujo de auth; aquí solo se deja de golpear la API.
 */

const CODIGOS_SIN_SESION = ['28000', '28P01', 'PGRST301', 'PGRST302', 'PGRST303'];

/** Mismo criterio que `traducirError` en `client.ts`, más el status HTTP 401. */
export function esErrorSesionChat(
  error: { code?: string; message?: string } | null | undefined,
  status?: number,
): boolean {
  if (status === 401) return true;
  if (!error) return false;
  return CODIGOS_SIN_SESION.includes(error.code ?? '') || /\bjwt\b/i.test(error.message ?? '');
}

export class ErrorSesionChat extends Error {
  constructor() {
    super('Tu sesión expiró. El chat se reanudará al volver a iniciar sesión.');
    this.name = 'ErrorSesionChat';
  }
}

/** Estado compartido por todos los sondeos de una instancia de la API del chat. */
export function crearEstadoSesionChat() {
  let caida = false;
  const alRestaurar = new Set<() => void>();
  return {
    get caida() { return caida; },
    marcarCaida() { caida = true; },
    /** Idempotente: solo avisa a los sondeos si estaba caída. */
    restaurar() {
      if (!caida) return;
      caida = false;
      alRestaurar.forEach((reanudar) => reanudar());
    },
    suscribirRestauracion(reanudar: () => void) {
      alRestaurar.add(reanudar);
      return () => { alRestaurar.delete(reanudar); };
    },
  };
}
export type EstadoSesionChat = ReturnType<typeof crearEstadoSesionChat>;

const oculta = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function crearSondeoChat(opciones: {
  intervaloMs: number;
  ejecutar: () => void;
  sesion: EstadoSesionChat;
}) {
  const { intervaloMs, ejecutar, sesion } = opciones;
  let temporizador: ReturnType<typeof setInterval> | undefined;
  let activo = false;

  const detenerTemporizador = () => {
    if (temporizador !== undefined) clearInterval(temporizador);
    temporizador = undefined;
  };
  const iniciarTemporizador = () => {
    detenerTemporizador();
    temporizador = setInterval(() => {
      if (oculta() || sesion.caida) return;
      ejecutar();
    }, intervaloMs);
  };
  /** Disparos puntuales (online, foco): igual de prudentes que el sondeo. */
  const sondear = () => {
    if (!activo || oculta() || sesion.caida) return;
    ejecutar();
  };
  const alCambiarVisibilidad = () => {
    if (!activo) return;
    if (oculta()) { detenerTemporizador(); return; }
    iniciarTemporizador();
    if (!sesion.caida) ejecutar();
  };
  const reanudarPorSesion = () => {
    if (activo && !oculta()) ejecutar();
  };
  let desuscribir: (() => void) | undefined;

  return {
    iniciar() {
      if (activo) return;
      activo = true;
      if (!oculta()) iniciarTemporizador();
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', alCambiarVisibilidad);
      if (typeof window !== 'undefined') {
        window.addEventListener('online', sondear);
        window.addEventListener('focus', sondear);
      }
      desuscribir = sesion.suscribirRestauracion(reanudarPorSesion);
    },
    detener() {
      if (!activo) return;
      activo = false;
      detenerTemporizador();
      desuscribir?.();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', sondear);
        window.removeEventListener('focus', sondear);
      }
    },
  };
}
