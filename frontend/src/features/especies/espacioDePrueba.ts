/**
 * Solo para pruebas: un espacio de especie fijo para montar pantallas sin el proveedor real. Uso:
 *   vi.mock('@/features/especies/EspacioEspecie', async () => (await import('@/features/especies/espacioDePrueba')).moduloEspacioDePrueba());
 * y, si hace falta, `fijarEspacioDePrueba({ activa: null })` dentro de la prueba (se restablece con `reiniciarEspacioDePrueba`).
 */
import type { EspacioEspecie } from './EspacioEspecie';
import type { PanoramaEspecie } from '@/api/especies';

export const ESPECIE_DE_PRUEBA = { id: 'esp-arandano', nombre: 'Arándano', nombre_cientifico: null };

export const panoramaDePrueba = (cambios: Partial<PanoramaEspecie> = {}): PanoramaEspecie => ({
  id: ESPECIE_DE_PRUEBA.id, nombre: ESPECIE_DE_PRUEBA.nombre, cruces: 6, cruces_activos: 5, individuos_vivos: 379,
  sin_evaluacion_cerrada: 230, evaluaciones_cerradas: 149, cruces_con_pendientes: 1,
  cruces_por_fase: { sin_empezar: 1, evaluacion_anual: 5 }, fases_con_pendientes: { evaluacion_anual: 1 },
  ultima_actividad: null, ultima_actividad_por: null, ...cambios,
});

const inicial = (): EspacioEspecie => ({
  especies: [ESPECIE_DE_PRUEBA],
  panorama: [panoramaDePrueba()],
  panoramaError: false,
  reintentarPanorama: () => {},
  activa: ESPECIE_DE_PRUEBA,
  listo: true,
  cambiar: () => {},
  parametro: 'arandano',
});

let actual = inicial();
export const fijarEspacioDePrueba = (cambios: Partial<EspacioEspecie>) => { actual = { ...actual, ...cambios }; };
export const reiniciarEspacioDePrueba = () => { actual = inicial(); };

export function moduloEspacioDePrueba() {
  return {
    useEspacioEspecie: () => actual,
    useEspacioEspecieOpcional: () => actual,
    useCambioAutomaticoEspecie: () => {},
    llevaEspecieEnUrl: () => false,
  };
}
