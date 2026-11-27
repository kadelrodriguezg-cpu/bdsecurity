/**
 * Une la comprobación de versión con el aviso. Se monta una sola vez, por
 * encima de todas las rutas (incluidas las de evaluación a pantalla completa,
 * que quedan fuera de AppShell y es donde más cambios sin guardar hay).
 */
import { useActualizacionApp, type OpcionesActualizacionApp } from '@/lib/actualizacionApp/useActualizacionApp';
import { AvisoVersionNueva } from './AvisoVersionNueva';

export function ActualizacionApp(opciones: OpcionesActualizacionApp = {}) {
  const { hayVersionNueva, actualizar } = useActualizacionApp(opciones);
  return hayVersionNueva ? <AvisoVersionNueva onActualizar={actualizar} /> : null;
}
