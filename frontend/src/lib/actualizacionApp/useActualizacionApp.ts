/**
 * Actualización automática de la app.
 *
 * Comprueba si hay una versión publicada distinta de la cargada: al abrir, al
 * volver a primer plano (`visibilitychange`), al recuperar la conexión (`online`)
 * y cada 5 minutos mientras la pestaña está visible. Si la hay:
 *  - sin cambios sin guardar (y no recién guardados): recarga sola;
 *  - con cambios sin guardar: NO recarga; deja `hayVersionNueva` en true para que
 *    se muestre el aviso «Hay una versión nueva · Actualizar» y espera.
 * Una comprobación fallida (sin red, 404, respuesta rara) no hace nada ni avisa.
 * En desarrollo no hace nada.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { hayCambiosSinGuardar, msDesdeUltimosCambios } from '@/lib/cambiosSinGuardar';
import { ID_VERSION_CARGADA, obtenerIdVersionPublicada } from './versionApp';
import { actualizarServiceWorker } from './serviceWorker';

export const INTERVALO_COMPROBACION_MS = 5 * 60_000;
/** Tras guardar, no se recarga sola hasta que pase este tiempo sin cambios pendientes. */
export const GRACIA_TRAS_GUARDAR_MS = 60_000;
/** No se vuelve a recargar sola hacia la misma versión antes de este tiempo (evita bucles). */
export const ANTI_BUCLE_MS = 10 * 60_000;
export const CLAVE_INTENTO = 'bds:actualizacion:ultimo-intento';

type Almacenamiento = Pick<Storage, 'getItem' | 'setItem'>;

export interface OpcionesActualizacionApp {
  /** Por omisión, desactivado en desarrollo. */
  habilitado?: boolean;
  idCargado?: string;
  intervaloMs?: number;
  graciaTrasGuardarMs?: number;
  antiBucleMs?: number;
  obtenerIdPublicado?: () => Promise<string | null>;
  prepararRecarga?: () => Promise<void>;
  recargar?: () => void;
  almacenamiento?: Almacenamiento | null;
}

function almacenamientoDeSesion(): Almacenamiento | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** ¿Ya se intentó recargar hacia esta versión hace poco? Si no se puede saber, se asume que sí. */
function intentoReciente(almacen: Almacenamiento | null, destino: string, ahora: number, ventanaMs: number): boolean {
  if (!almacen) return true;
  try {
    const crudo = almacen.getItem(CLAVE_INTENTO);
    if (!crudo) return false;
    const dato: unknown = JSON.parse(crudo);
    if (dato === null || typeof dato !== 'object') return false;
    const { destino: previo, en } = dato as { destino?: unknown; en?: unknown };
    return previo === destino && typeof en === 'number' && ahora - en < ventanaMs;
  } catch {
    return true;
  }
}

/** Devuelve false si no pudo dejar constancia: sin ella no se recarga sola (no habría freno contra bucles). */
function guardarIntento(almacen: Almacenamiento | null, destino: string, ahora: number): boolean {
  if (!almacen) return false;
  try {
    almacen.setItem(CLAVE_INTENTO, JSON.stringify({ destino, en: ahora }));
    return true;
  } catch {
    return false;
  }
}

export function useActualizacionApp(opciones: OpcionesActualizacionApp = {}) {
  const [hayVersionNueva, setHayVersionNueva] = useState(false);
  // Las opciones se leen vía ref: cambiarlas no reinicia temporizadores ni oyentes.
  const ref = useRef(opciones);
  ref.current = opciones;
  const publicadaRef = useRef<string | null>(null);
  const habilitado = opciones.habilitado ?? !import.meta.env.DEV;

  const configuracion = () => {
    const o = ref.current;
    return {
      idCargado: o.idCargado ?? ID_VERSION_CARGADA,
      graciaMs: o.graciaTrasGuardarMs ?? GRACIA_TRAS_GUARDAR_MS,
      antiBucleMs: o.antiBucleMs ?? ANTI_BUCLE_MS,
      obtener: o.obtenerIdPublicado ?? (() => obtenerIdVersionPublicada()),
      preparar: o.prepararRecarga ?? (() => actualizarServiceWorker()),
      recargar: o.recargar ?? (() => window.location.reload()),
      almacen: o.almacenamiento === undefined ? almacenamientoDeSesion() : o.almacenamiento,
    };
  };

  const actualizar = useCallback(() => {
    const c = configuracion();
    // Clic explícito del usuario: se deja constancia (si se puede) y se recarga siempre.
    guardarIntento(c.almacen, publicadaRef.current ?? c.idCargado, Date.now());
    void c.preparar().catch(() => undefined).then(() => c.recargar());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!habilitado) return undefined;
    let activo = true;
    let enCurso = false;
    let temporizador: ReturnType<typeof setInterval> | undefined;

    const puedeRecargarSola = (graciaMs: number) => !hayCambiosSinGuardar() && msDesdeUltimosCambios() >= graciaMs;

    const comprobar = async () => {
      if (enCurso || !activo) return;
      enCurso = true;
      try {
        const c = configuracion();
        const publicado = await c.obtener().catch(() => null);
        if (!activo || publicado === null) return;
        if (publicado === c.idCargado) {
          // La versión publicada volvió a ser la cargada (p. ej. una reversión): el aviso ya no aplica.
          setHayVersionNueva(false);
          return;
        }
        publicadaRef.current = publicado;

        if (!puedeRecargarSola(c.graciaMs) || intentoReciente(c.almacen, publicado, Date.now(), c.antiBucleMs)) {
          setHayVersionNueva(true);
          return;
        }
        await c.preparar().catch(() => undefined);
        if (!activo) return;
        // Mientras se preparaba la recarga el usuario pudo empezar a escribir: se vuelve a mirar.
        if (!puedeRecargarSola(c.graciaMs) || !guardarIntento(c.almacen, publicado, Date.now())) {
          setHayVersionNueva(true);
          return;
        }
        c.recargar();
      } catch {
        // Cualquier fallo inesperado: se ignora; la siguiente comprobación lo reintenta.
      } finally {
        enCurso = false;
      }
    };

    const iniciarSondeo = () => {
      if (temporizador !== undefined) return;
      temporizador = setInterval(() => { void comprobar(); }, ref.current.intervaloMs ?? INTERVALO_COMPROBACION_MS);
    };
    const detenerSondeo = () => {
      if (temporizador === undefined) return;
      clearInterval(temporizador);
      temporizador = undefined;
    };
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') {
        detenerSondeo();
      } else {
        void comprobar();
        iniciarSondeo();
      }
    };
    const alVolverLaRed = () => { void comprobar(); };

    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    window.addEventListener('online', alVolverLaRed);
    if (document.visibilityState !== 'hidden') {
      void comprobar();
      iniciarSondeo();
    }
    return () => {
      activo = false;
      detenerSondeo();
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      window.removeEventListener('online', alVolverLaRed);
    };
  }, [habilitado]);

  return { hayVersionNueva, actualizar };
}
