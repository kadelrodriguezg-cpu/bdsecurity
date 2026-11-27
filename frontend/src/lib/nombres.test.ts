import { describe, expect, it } from 'vitest';
import { nombreCorto } from './nombres';

describe('nombreCorto (U-20)', () => {
  it('toma la inicial del primer nombre y el último apellido', () => {
    expect(nombreCorto('María Soto')).toBe('M. Soto');
    expect(nombreCorto('  juan carlos Pérez Soto ')).toBe('J. Soto');
  });
  it('con una palabra la deja tal cual y sin nombre devuelve vacío', () => {
    expect(nombreCorto('Carla')).toBe('Carla');
    expect(nombreCorto('   ')).toBe('');
    expect(nombreCorto(null)).toBe('');
    expect(nombreCorto(undefined)).toBe('');
  });
});
