import { describe, expect, it } from 'vitest';
import { ESQUEMA_EVALUACION_ANUAL } from './evaluacionAnual';
import { camposLegibles, camposProtocolizables, contarObligatorios, contarObligatoriosDeEstados, estadoDescriptor, obligatoriosQueFaltan, resumenSecciones } from './protocolo';

const protocolo = {
  brotacion: 'obligatorio', floracion: 'obligatorio', precocidad: 'opcional',
  calibre_mm: 'opcional', cantidad_frutos: 'opcional', peso_total_g: 'opcional',
} as const;

describe('protocolo de ronda en el cliente', () => {
  it('resume cada sección según el protocolo', () => {
    const s = Object.fromEntries(resumenSecciones(ESQUEMA_EVALUACION_ANUAL, protocolo).map((r) => [r.id, r]));
    expect(s.fenologia.nivel).toBe('mixta');
    expect(s.fenologia.obligatorios).toEqual(['brotacion', 'floracion']);
    expect(s.fruto.nivel).toBe('opcional');
    expect(s.estres.nivel).toBe('fuera');
    expect(s.produccion.claves).toEqual([]); // los derivados nunca entran al protocolo
  });

  it('sin protocolo, todas las secciones quedan fuera', () => {
    expect(resumenSecciones(ESQUEMA_EVALUACION_ANUAL, null).every((s) => s.nivel === 'fuera')).toBe(true);
  });

  it('lista los obligatorios que faltan y cuenta los llenos', () => {
    expect(obligatoriosQueFaltan(ESQUEMA_EVALUACION_ANUAL, protocolo, { brotacion: 3, floracion: '' }))
      .toEqual([{ seccion: 'fenologia', etiqueta: 'Fenología', faltan: ['floracion'] }]);
    expect(contarObligatorios(protocolo, { brotacion: 3 })).toEqual({ llenos: 1, total: 2 });
    expect(contarObligatorios(null, {})).toEqual({ llenos: 0, total: 0 });
  });

  it('estado de un descriptor: medido, faltó, no evaluado y marcado', () => {
    expect(estadoDescriptor('brotacion', 0, protocolo)).toBe('medido');
    expect(estadoDescriptor('floracion', null, protocolo)).toBe('falto');
    expect(estadoDescriptor('dano_calor', undefined, protocolo)).toBe('no_evaluado');
    expect(estadoDescriptor('calibre_mm', 31, protocolo, ['calibre_mm'])).toBe('marcado');
    expect(estadoDescriptor('precocidad', null, protocolo)).toBe('no_evaluado'); // opcional sin valor
    expect(estadoDescriptor('floracion', null, null)).toBe('no_evaluado');
  });
});

describe('campos desactivados en el protocolo (EF11)', () => {
  it('los protocolos no ofrecen rend_t_ha, pero sí la distribución de flores y frutos', () => {
    const claves = camposProtocolizables(ESQUEMA_EVALUACION_ANUAL).map((c) => c.clave);
    expect(claves).not.toContain('rend_t_ha');
    expect(claves).toContain('distribucion_flores_frutos');
    expect(camposLegibles(ESQUEMA_EVALUACION_ANUAL).map((c) => c.clave)).toContain('rend_t_ha'); // para leer el dato histórico
    expect(camposLegibles(ESQUEMA_EVALUACION_ANUAL).map((c) => c.clave)).not.toContain('peso_promedio_g'); // derivado
  });

  it('un protocolo antiguo con rend_t_ha obligatorio no lo cuenta ni lo exige', () => {
    const antiguo = { brotacion: 'obligatorio', rend_t_ha: 'obligatorio' } as const;
    expect(contarObligatorios(antiguo, { brotacion: 3 }, ESQUEMA_EVALUACION_ANUAL)).toEqual({ llenos: 1, total: 1 });
    expect(contarObligatorios(antiguo, { brotacion: 3 })).toEqual({ llenos: 1, total: 2 }); // sin esquema, como antes
    expect(contarObligatoriosDeEstados(antiguo, { brotacion: 'medido' }, ESQUEMA_EVALUACION_ANUAL)).toEqual({ llenos: 1, total: 1 });
    expect(obligatoriosQueFaltan(ESQUEMA_EVALUACION_ANUAL, antiguo, { brotacion: 3 })).toEqual([]);
  });

  it('la distribución obligatoria falta hasta que se elige un nivel', () => {
    const p = { distribucion_flores_frutos: 'obligatorio' } as const;
    expect(obligatoriosQueFaltan(ESQUEMA_EVALUACION_ANUAL, p, {})).toEqual([{ seccion: 'brotes', etiqueta: 'Brotes y varas basales', faltan: ['distribucion_flores_frutos'] }]);
    expect(obligatoriosQueFaltan(ESQUEMA_EVALUACION_ANUAL, p, { distribucion_flores_frutos: 1 })).toEqual([]);
  });
});
