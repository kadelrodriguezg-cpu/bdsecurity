import { describe, expect, it } from 'vitest';
import { interpretarQR } from '@/components/shared/QRScanner';
import { contenidoQr } from './qrContenido';

const ORIGIN = 'https://bdsecurity.example.com';
const INDIVIDUO = '11111111-2222-3333-4444-555555555555';
const CRUCE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('contenidoQr — individuo', () => {
  it('grande y mediana: URL con origen', () => {
    expect(contenidoQr({ individuoId: INDIVIDUO }, false, ORIGIN)).toBe(`${ORIGIN}/individuo/${INDIVIDUO}`);
  });

  it('pequeña: solo la ruta, sin origen', () => {
    expect(contenidoQr({ individuoId: INDIVIDUO }, true, ORIGIN)).toBe(`/individuo/${INDIVIDUO}`);
  });

  it('INVARIANTE: nunca emite el UUID del individuo pelado', () => {
    for (const corto of [true, false]) {
      expect(contenidoQr({ individuoId: INDIVIDUO }, corto, ORIGIN)).not.toBe(INDIVIDUO);
    }
  });

  it('el tamaño de lo que se imprime no crece respecto de lo que ya se imprimía (misma versión de QR)', () => {
    // Las capacidades por versión (nivel de corrección L, modo bytes) vienen del estándar y no se
    // verifican acá; esto fija que el contenido de la etiqueta pequeña sea corto (<= 53 bytes).
    expect(contenidoQr({ individuoId: INDIVIDUO }, true, ORIGIN).length).toBeLessThanOrEqual(53);
    expect(contenidoQr({ individuoId: INDIVIDUO }, false, ORIGIN).length).toBeLessThanOrEqual(106);
  });

  it('rechaza un id mal formado antes de imprimirlo', () => {
    expect(() => contenidoQr({ individuoId: 'P7' }, false, ORIGIN)).toThrow(/id válido/);
    expect(() => contenidoQr({ individuoId: '' }, true, ORIGIN)).toThrow(/id válido/);
    expect(() => contenidoQr({ individuoId: `${INDIVIDUO}/x` }, true, ORIGIN)).toThrow(/id válido/);
  });
});

describe('contenidoQr — cruce (sin cambios respecto de lo que ya estaba impreso)', () => {
  it('grande y mediana: URL /planta/<uuid> con origen', () => {
    expect(contenidoQr({ plantaId: CRUCE }, false, ORIGIN)).toBe(`${ORIGIN}/planta/${CRUCE}`);
  });

  it('pequeña: UUID pelado', () => {
    expect(contenidoQr({ plantaId: CRUCE }, true, ORIGIN)).toBe(CRUCE);
  });

  it('rechaza un id mal formado', () => {
    expect(() => contenidoQr({ plantaId: 'no-es-uuid' }, true, ORIGIN)).toThrow(/id válido/);
  });
});

describe('ida y vuelta: lo que se imprime es lo que el escáner entiende', () => {
  it.each([
    ['individuo, grande/mediana', { individuoId: INDIVIDUO }, false, { tipo: 'individuo', valor: INDIVIDUO }],
    ['individuo, pequeña', { individuoId: INDIVIDUO }, true, { tipo: 'individuo', valor: INDIVIDUO }],
    ['cruce, grande/mediana', { plantaId: CRUCE }, false, { tipo: 'id', valor: CRUCE }],
    ['cruce, pequeña (UUID pelado)', { plantaId: CRUCE }, true, { tipo: 'id', valor: CRUCE }],
  ] as const)('%s', (_nombre, destino, corto, esperado) => {
    expect(interpretarQR(contenidoQr(destino, corto, ORIGIN))).toEqual(esperado);
  });

  it('un cambio de dominio no rompe las etiquetas ya impresas: el escáner no depende del origen', () => {
    const impreso = contenidoQr({ individuoId: INDIVIDUO }, false, 'https://dominio-viejo.example');
    expect(interpretarQR(impreso)).toEqual({ tipo: 'individuo', valor: INDIVIDUO });
  });
});
