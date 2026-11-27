import { describe, expect, it } from 'vitest';
import { individuoDesdeBusqueda, rutaFichaIndividuo, UUID_COMPLETO_RE } from './rutasIndividuo';

const CRUCE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const INDIVIDUO = '11111111-2222-3333-4444-555555555555';

describe('rutaFichaIndividuo', () => {
  it('arma la ficha del cruce posicionada en el individuo', () => {
    expect(rutaFichaIndividuo(CRUCE, INDIVIDUO)).toBe(`/planta/${CRUCE}?individuo=${INDIVIDUO}`);
  });
});

describe('individuoDesdeBusqueda', () => {
  it('acepta un UUID y lo normaliza a minúsculas', () => {
    expect(individuoDesdeBusqueda(INDIVIDUO.toUpperCase())).toBe(INDIVIDUO);
  });
  it('devuelve null si falta, está vacío o no es un UUID completo', () => {
    expect(individuoDesdeBusqueda(null)).toBeNull();
    expect(individuoDesdeBusqueda('')).toBeNull();
    expect(individuoDesdeBusqueda('P7')).toBeNull();
    expect(individuoDesdeBusqueda(`${INDIVIDUO}x`)).toBeNull();
    expect(individuoDesdeBusqueda(`x${INDIVIDUO}`)).toBeNull();
    expect(individuoDesdeBusqueda(`${INDIVIDUO}&otro=1`)).toBeNull();
  });
});

describe('UUID_COMPLETO_RE', () => {
  it('exige el UUID completo (sin texto alrededor)', () => {
    expect(UUID_COMPLETO_RE.test(CRUCE)).toBe(true);
    expect(UUID_COMPLETO_RE.test(`/planta/${CRUCE}`)).toBe(false);
  });
});
