import { describe, expect, it, vi } from 'vitest';
import { regionDesdeEstadoNominatim } from './regionesChile';

describe('regionDesdeEstadoNominatim', () => {
  it.each([
    ['Región del Maule', 'Maule'],
    ['REGION DE LOS RIOS', 'Los Ríos'],
    ['Región de Aysén del General Carlos Ibáñez del Campo', 'Aysén del General Carlos Ibáñez del Campo'],
  ] as const)('normaliza %s', (estado, region) => {
    expect(regionDesdeEstadoNominatim(estado)).toBe(region);
  });

  it('no fuerza una región ante un estado desconocido', () => {
    const advertencia = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(regionDesdeEstadoNominatim('Zona experimental')).toBeNull();
    expect(advertencia).toHaveBeenCalledOnce();
    advertencia.mockRestore();
  });
});
