import { describe, expect, it } from 'vitest';
import { sugerirSiguienteCodigo } from './codigoSistema';

describe('sugerirSiguienteCodigo (Bloque 3, Parte 3B)', () => {
  it('sugiere el siguiente correlativo con el mismo padding', () => {
    expect(sugerirSiguienteCodigo(['02-001', '02-002', '02-003'])).toBe('02-004');
  });

  it('respeta el ancho del padding también al pasar de 099 a 100', () => {
    expect(sugerirSiguienteCodigo(['02-097', '02-098', '02-099'])).toBe('02-100');
  });

  it('ignora especies distintas: usa el prefijo dominante entre los códigos dados', () => {
    // Simula que ya se filtró por especie antes de llamar: si igual llegara
    // basura de otro prefijo, el dominante (con más apariciones) gana.
    expect(sugerirSiguienteCodigo(['02-001', '02-002', '05-050'])).toBe('02-003');
  });

  it('sin códigos previos, no hay nada que sugerir', () => {
    expect(sugerirSiguienteCodigo([])).toBeNull();
  });

  it('ignora códigos sin un correlativo numérico al final', () => {
    expect(sugerirSiguienteCodigo(['sin-numero'])).toBeNull();
  });
});
