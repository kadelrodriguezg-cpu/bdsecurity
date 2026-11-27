import { describe, expect, it } from 'vitest';
import { avisoFueraDeRango, CLAVES_NUMERICAS, REGLAS_TECNICAS, validarValorNumerico } from './limites';
import { ESQUEMA_EVALUACION_ANUAL } from './evaluacionAnual';

describe('validación técnica de los descriptores numéricos (U-07)', () => {
  it('cada descriptor numérico libre y ACTIVO del formulario tiene validación técnica (los desactivados no se piden)', () => {
    const numericos = ESQUEMA_EVALUACION_ANUAL.campos
      .filter((c) => (c.tipo === 'numero' || c.tipo === 'entero') && c.rol !== 'derivado' && c.activo !== false)
      .map((c) => c.clave);
    expect([...CLAVES_NUMERICAS].sort()).toEqual([...numericos].sort());
  });

  it('no hay máximos duros: un valor enorme es válido, salvo los porcentajes de poscosecha (CHECK 0–100 de la base)', () => {
    const porcentajes = ['pct_buen_estado_15d', 'pct_buen_estado_30d', 'pct_buen_estado_45d'];
    for (const clave of CLAVES_NUMERICAS) {
      if (porcentajes.includes(clave)) continue;
      expect(validarValorNumerico(clave, '99999')).toBeNull();
    }
    expect(Object.entries(REGLAS_TECNICAS).filter(([, regla]) => regla?.maximo !== undefined).map(([clave]) => clave)).toEqual(porcentajes);
    expect(validarValorNumerico('pct_buen_estado_45d', '100')).toBeNull();
    expect(validarValorNumerico('pct_buen_estado_45d', '100.5')).toBe('Buen estado a los 45 días no puede superar 100 %.');
  });

  describe.each(CLAVES_NUMERICAS.map((clave) => [clave] as const))('%s', (clave) => {
    it('acepta el vacío y el cero', () => {
      expect(validarValorNumerico(clave, '')).toBeNull();
      expect(validarValorNumerico(clave, '   ')).toBeNull();
      expect(validarValorNumerico(clave, '0')).toBeNull();
    });
    it('rechaza un valor negativo', () => {
      expect(validarValorNumerico(clave, '-1')).toMatch(/no puede ser negativo\.$/);
    });
    it('rechaza lo que no es un número finito', () => {
      for (const texto of ['abc', 'NaN', 'Infinity', '-Infinity']) {
        expect(validarValorNumerico(clave, texto)).toMatch(/debe ser un número válido\.$/);
      }
    });
  });

  describe.each(CLAVES_NUMERICAS.filter((clave) => REGLAS_TECNICAS[clave]?.entero).map((clave) => [clave] as const))('%s (entero)', (clave) => {
    it('rechaza los decimales y acepta los enteros', () => {
      expect(validarValorNumerico(clave, '2.5')).toMatch(/debe ser un entero\.$/);
      expect(validarValorNumerico(clave, '12')).toBeNull();
    });
  });

  it('los descriptores que no cuentan cosas aceptan decimales', () => {
    expect(validarValorNumerico('brix', '12.5')).toBeNull();
    expect(validarValorNumerico('calibre_mm', '17.25')).toBeNull();
  });

  it('el mensaje nombra el descriptor', () => {
    expect(validarValorNumerico('n_varas_basales', '-3')).toBe('Varas basales no puede ser negativo.');
    expect(validarValorNumerico('n_varas_basales', '3.5')).toBe('Varas basales debe ser un entero.');
    expect(validarValorNumerico('cantidad_frutos', '2.5')).toBe('Cantidad de frutos debe ser un entero.');
  });
});

describe('aviso de rango esperado (U-07): avisa, nunca bloquea', () => {
  const brix = { minimo_esperado: 10, maximo_esperado: 18 };

  it('Brix 999 avisa «fuera del rango esperado: revisa» con el rango, y sigue siendo un valor válido', () => {
    expect(avisoFueraDeRango('Brix', 999, '°Bx', brix)).toBe('Brix 999 °Bx: fuera del rango esperado: revisa (10–18 °Bx). Se puede guardar.');
    expect(validarValorNumerico('brix', '999')).toBeNull();
  });

  it('avisa también por debajo del mínimo esperado', () => {
    expect(avisoFueraDeRango('Brix', 4, '°Bx', brix)).toMatch(/fuera del rango esperado: revisa/);
  });

  it('dentro del rango, vacío o sin rango_referencia no hay aviso (no se inventan rangos)', () => {
    expect(avisoFueraDeRango('Brix', 12, '°Bx', brix)).toBeNull();
    expect(avisoFueraDeRango('Brix', null, '°Bx', brix)).toBeNull();
    expect(avisoFueraDeRango('Brix', Number.NaN, '°Bx', brix)).toBeNull();
    expect(avisoFueraDeRango('Rendimiento', 999, 'kg/planta', null)).toBeNull();
    expect(avisoFueraDeRango('Rendimiento', 999, 'kg/planta', {})).toBeNull();
  });

  it('con solo un lado configurado avisa solo de ese lado', () => {
    expect(avisoFueraDeRango('Calibre', 30, 'mm', { maximo_esperado: 24 })).toMatch(/\(hasta 24 mm\)/);
    expect(avisoFueraDeRango('Calibre', 3, 'mm', { maximo_esperado: 24 })).toBeNull();
  });

  it('en el límite de revisión el único texto explica que queda marcado y no entra al ranking', () => {
    const calibre = { minimo_esperado: 14, maximo_esperado: 24, limite_revision_superior: 40 };
    expect(avisoFueraDeRango('Calibre', 40, 'mm', calibre)).toBe('Calibre 40 mm está en el límite de revisión: quedará marcado y no entrará al ranking hasta revisarse.');
  });
});
