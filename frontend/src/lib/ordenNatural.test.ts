import { describe, expect, it } from 'vitest';
import { compararCodigos, ordenarPorCodigo } from './ordenNatural';

const ordenar = (codigos: string[]) => [...codigos].sort(compararCodigos);

describe('orden natural de códigos (G16)', () => {
  it('cruces: 02-001 antes que 02-002 y 02-080; 02-1000 al final', () => {
    expect(ordenar(['02-080', '02-1000', '02-002', '02-001', '07-001'])).toEqual(['02-001', '02-002', '02-080', '02-1000', '07-001']);
  });

  it('individuos: P2 antes que P10 y P100, también con el código completo y entre cruces', () => {
    expect(ordenar(['P100', 'P10', 'P2'])).toEqual(['P2', 'P10', 'P100']);
    expect(ordenar(['02-001-P10', '02-002-P1', '02-001-P9', '02-001-P100'])).toEqual(['02-001-P9', '02-001-P10', '02-001-P100', '02-002-P1']);
  });

  it('mismo número con distinto relleno: orden estable por el texto; los vacíos al final', () => {
    expect(ordenar(['P9', 'P09'])).toEqual(['P09', 'P9']);
    expect([...['', '02-001', null as unknown as string]].sort(compararCodigos)).toEqual(['02-001', '', null]);
  });

  it('mayúsculas y minúsculas no cambian el orden', () => {
    expect(ordenar(['p10', 'P2'])).toEqual(['P2', 'p10']);
  });

  it('ordenarPorCodigo no muta y usa el campo indicado', () => {
    const cruces = [{ c: '02-080' }, { c: '02-001' }];
    const ordenados = ordenarPorCodigo(cruces, (x) => x.c);
    expect(ordenados.map((x) => x.c)).toEqual(['02-001', '02-080']);
    expect(cruces[0].c).toBe('02-080');
  });
});
