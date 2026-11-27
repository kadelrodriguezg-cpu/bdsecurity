/**
 * Registro global de «hay cambios sin guardar».
 *
 * Cada formulario que sepa si tiene algo sin guardar lo declara con
 * `useMarcarCambiosSinGuardar(hay)`; la actualización automática de la app
 * (lib/actualizacionApp) consulta `hayCambiosSinGuardar()` antes de recargar y
 * NUNCA recarga si hay al menos una marca activa. Cada componente registra su
 * propia marca con un id único, así que varios formularios abiertos a la vez
 * no se pisan; al desmontarse, la marca se borra sola.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react';

const marcas = new Set<string>();
const oyentes = new Set<() => void>();
/** Última vez que dejó de haber cambios (null: nunca los hubo o ahora los hay). */
let ultimoSinCambiosEn: number | null = null;

function avisar() {
  oyentes.forEach((oyente) => oyente());
}

/** Registra o borra la marca de un id. Idempotente. */
export function marcarCambiosSinGuardar(id: string, hay: boolean): void {
  const habiaCambios = marcas.size > 0;
  if (hay) marcas.add(id);
  else marcas.delete(id);
  const hayCambios = marcas.size > 0;
  if (habiaCambios && !hayCambios) ultimoSinCambiosEn = Date.now();
  if (habiaCambios !== hayCambios) avisar();
}

/** ¿Hay algún formulario con cambios sin guardar ahora mismo? */
export function hayCambiosSinGuardar(): boolean {
  return marcas.size > 0;
}

/**
 * Milisegundos desde que el último formulario con cambios dejó de tenerlos
 * (guardó, descartó o se cerró). `Infinity` si nunca hubo cambios en esta sesión
 * de la pestaña; `0` mientras todavía los hay.
 */
export function msDesdeUltimosCambios(): number {
  if (marcas.size > 0) return 0;
  if (ultimoSinCambiosEn === null) return Infinity;
  return Math.max(0, Date.now() - ultimoSinCambiosEn);
}

export function suscribirCambiosSinGuardar(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

/** Solo para pruebas: deja el registro como al cargar la página. */
export function reiniciarCambiosSinGuardar(): void {
  marcas.clear();
  oyentes.clear();
  ultimoSinCambiosEn = null;
}

/** Declara que este componente tiene (o ya no tiene) cambios sin guardar. */
export function useMarcarCambiosSinGuardar(hay: boolean): void {
  const id = useId();
  useLayoutEffect(() => {
    marcarCambiosSinGuardar(id, hay);
  }, [id, hay]);
  useLayoutEffect(() => () => marcarCambiosSinGuardar(id, false), [id]);
}

/**
 * Versión como callback estable, para pasarla directo a un `onTocadoChange` de
 * un formulario cuando el componente padre no guarda ese estado por su cuenta.
 */
export function useMarcadorCambiosSinGuardar(): (hay: boolean) => void {
  const id = useId();
  const idRef = useRef(id);
  useEffect(() => {
    const propio = idRef.current;
    return () => marcarCambiosSinGuardar(propio, false);
  }, []);
  return useCallback((hay: boolean) => marcarCambiosSinGuardar(idRef.current, hay), []);
}
