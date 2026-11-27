import { describe, expect, it } from 'vitest';
import { filtrarPrediosPorRegion } from './PrediosCatalogo';
import type { Predio } from '@/api/catalogos';

const predios: Predio[] = [
  { id: 'maule', nombre: 'Predio Maule', activo: true, latitud: null, longitud: null, region: 'Maule' },
  { id: 'nuble', nombre: 'Predio Ñuble', activo: true, latitud: null, longitud: null, region: 'Ñuble' },
  { id: 'sin-region', nombre: 'Predio sin región', activo: true, latitud: null, longitud: null, region: null },
];

describe('filtrarPrediosPorRegion', () => {
  it('devuelve sólo los predios de la región seleccionada y todos al limpiar el filtro', () => {
    expect(filtrarPrediosPorRegion(predios, 'Maule').map((predio) => predio.id)).toEqual(['maule']);
    expect(filtrarPrediosPorRegion(predios, '')).toEqual(predios);
  });
});
