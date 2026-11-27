import { describe, expect, it } from 'vitest';
import { ACCION_INFO, infoDeAccion } from './bitacoraLabels';

describe('etiquetas de Bitácora', () => {
  it.each([
    'alta_cruce',
    'creacion_evento_germinacion',
    'escritura_fase',
    'reinicio_cruzamiento',
    'creacion_multisitio',
    'creacion_procedimiento_cultivo',
    'traslado_individuo',
    'reasignacion_procedimiento',
    'retroceso_fase',
    'ronda_no_evaluada',
    'ronda_no_evaluada_quitada',
    'reactivacion_individuo',
    'pedido_correccion',
    'pedido_correccion_resuelto',
  ])('traduce %s a lenguaje humano', (accion) => {
    expect(infoDeAccion(accion).label).not.toBe(accion);
    expect(ACCION_INFO[accion]).toBeDefined();
  });

  it('no muestra claves técnicas desconocidas al usuario', () => {
    expect(infoDeAccion('accion_nueva_del_backend').label).toBe('Actividad del sistema');
  });
});
