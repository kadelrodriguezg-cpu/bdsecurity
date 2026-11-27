import { describe, expect, it } from 'vitest';
import type { EstadoRanking } from '@/api/rankingGrupos';
import type { EstadoFilaPlanilla } from '@/api/protocolo';
import {
  contarEstados, esPendienteDeEvaluacion, esSinEmpezar, estadoDesdePlanilla, estadoDesdeRanking, ESTADOS_INDIVIDUO_RONDA,
  type EstadoIndividuoRonda,
} from './estados';
import {
  describirPuesto, formatearActividad, formatearCantidad, formatearCobertura, formatearFecha, formatearFechaHoraChile, formatearPuesto, formatearPuntaje, SIN_VALOR,
} from './formatos';
import { categoriasDeDatos, describirCategoria, etiquetaDeGrupo, nombreDesdeClave, ordenarCategorias } from './categorias';
import { sinEvaluacionCompleta } from '@/api/rankingGrupos';

describe('estado del individuo en la ronda y «pendiente» (contrato §2)', () => {
  it('traduce el vocabulario de la planilla', () => {
    const casos: Array<[EstadoFilaPlanilla, EstadoIndividuoRonda]> = [
      ['sin_ronda', 'sin_ronda'], ['sin_iniciar', 'sin_evaluacion'], ['borrador', 'borrador'], ['completa', 'cerrada'],
    ];
    for (const [entrada, salida] of casos) expect(estadoDesdePlanilla(entrada)).toBe(salida);
  });

  it('traduce el vocabulario del ranking: lo que tiene evaluación cerrada es «cerrada» y sin_version no dice nada', () => {
    expect(estadoDesdeRanking('sin_ronda')).toBe('sin_ronda');
    expect(estadoDesdeRanking('sin_evaluacion')).toBe('sin_evaluacion');
    for (const e of ['comparable', 'pocas_plantas', 'excluida_revision', 'no_comparable', 'sin_datos'] as EstadoRanking[]) {
      expect(estadoDesdeRanking(e)).toBe('cerrada');
    }
    expect(estadoDesdeRanking('sin_version')).toBeNull();
  });

  it('«pendiente de evaluación» = sin evaluación cerrada: incluye sin ronda, sin empezar y solo borrador', () => {
    expect(ESTADOS_INDIVIDUO_RONDA.filter(esPendienteDeEvaluacion)).toEqual(['sin_ronda', 'sin_evaluacion', 'borrador']);
    expect(esPendienteDeEvaluacion('cerrada')).toBe(false);
  });

  it('coincide con sinEvaluacionCompleta del ranking en todo estado del ranking que no sea un borrador (que el ranking no distingue)', () => {
    const todos: EstadoRanking[] = ['comparable', 'pocas_plantas', 'excluida_revision', 'no_comparable', 'sin_datos', 'sin_evaluacion', 'sin_ronda'];
    for (const e of todos) expect(esPendienteDeEvaluacion(estadoDesdeRanking(e)!)).toBe(sinEvaluacionCompleta({ estado_ranking: e }));
  });

  it('una evaluación fuera del ranking (excluida, sin datos, pocas plantas) NO es pendiente: existe y está cerrada', () => {
    for (const e of ['excluida_revision', 'sin_datos', 'pocas_plantas', 'no_comparable'] as EstadoRanking[]) {
      expect(esPendienteDeEvaluacion(estadoDesdeRanking(e)!)).toBe(false);
    }
  });

  it('«sin empezar» (lo que hoy cuenta la píldora «Pendientes» de la planilla; decisión E16) es más angosto que «pendiente»', () => {
    expect(ESTADOS_INDIVIDUO_RONDA.filter(esSinEmpezar)).toEqual(['sin_evaluacion']);
  });

  it('cuenta por estado y total de pendientes', () => {
    const cuenta = contarEstados(['cerrada', 'cerrada', 'borrador', 'sin_evaluacion', 'sin_evaluacion', 'sin_ronda']);
    expect(cuenta).toEqual({ sin_ronda: 1, sin_evaluacion: 2, borrador: 1, cerrada: 2, pendientes: 4, total: 6 });
    expect(contarEstados([])).toEqual({ sin_ronda: 0, sin_evaluacion: 0, borrador: 0, cerrada: 0, pendientes: 0, total: 0 });
  });
});

describe('formatos (contrato §3)', () => {
  it('puntaje (N34): 0–100 con un decimal y coma, recortado a 0–1 y «—» si no hay', () => {
    expect(formatearPuntaje(0.465)).toBe('46,5');
    expect(formatearPuntaje(0)).toBe('0,0');
    expect(formatearPuntaje(1.2)).toBe('100,0');
    expect(formatearPuntaje(-0.3)).toBe('0,0');
    expect(formatearPuntaje(null)).toBe(SIN_VALOR);
    expect(formatearPuntaje(undefined)).toBe('—');
  });

  it('puesto: número, «=» si empata y «Sin puesto» si no compite', () => {
    expect(formatearPuesto(3)).toBe('3');
    expect(formatearPuesto(3, true)).toBe('3=');
    expect(formatearPuesto(null)).toBe('Sin puesto');
    expect(formatearPuesto(undefined, true)).toBe('Sin puesto');
  });

  it('puesto en una frase', () => {
    expect(describirPuesto(50, 146)).toBe('puesto 50 de 146 en su grupo');
    expect(describirPuesto(2, 12, true)).toBe('puesto 2 de 12 en su grupo, empatado');
    expect(describirPuesto(2, null)).toBe('puesto 2 en su grupo');
    expect(describirPuesto(null, 12)).toBe('Sin puesto');
  });

  it('fecha civil sin correrse de día por la zona horaria, y mensaje si no hay', () => {
    expect(formatearFecha('2026-10-23')).toBe('23-10-2026');
    expect(formatearFecha('2026-01-01')).toBe('01-01-2026');
    expect(formatearFecha(null)).toBe('Sin fecha registrada');
  });

  it('fecha y hora de Chile: dd-mm-aaaa y hora de 24 h (no «4:39 p. m.»)', () => {
    expect(formatearFechaHoraChile('2026-10-23T19:39:00Z')).toBe('23-10-2026, 16:39');
    expect(formatearFechaHoraChile('2026-07-01T04:05:00Z')).toBe('01-07-2026, 00:05'); // invierno: UTC-4
    expect(formatearFechaHoraChile(undefined)).toBe('Sin fecha registrada');
  });

  it('lista de actividad (decisión N9): «hoy»/«ayer» más la hora, y de ahí hacia atrás la fecha absoluta con hora', () => {
    const ahora = new Date('2026-10-23T23:00:00Z'); // 20:00 en Chile (UTC-3 en octubre)
    expect(formatearActividad('2026-10-23T19:39:00Z', ahora)).toBe('hoy 16:39');
    expect(formatearActividad('2026-10-22T19:39:00Z', ahora)).toBe('ayer 16:39');
    expect(formatearActividad('2026-10-10T19:39:00Z', ahora)).toBe('10-10-2026, 16:39');
    expect(formatearActividad(null, ahora)).toBe('Sin fecha registrada');
    expect(formatearActividad('no es una fecha', ahora)).toBe('Sin fecha registrada');
  });

  it('lista de actividad: el día se decide en Chile, no en UTC (02:30 UTC del 24 sigue siendo el 23 en Chile)', () => {
    const ahora = new Date('2026-10-24T14:00:00Z');
    expect(formatearActividad('2026-10-24T02:30:00Z', ahora)).toBe('ayer 23:30');
    expect(formatearActividad('2026-10-24T12:00:00Z', ahora)).toBe('hoy 09:00');
  });

  it('nunca «hace X» (decisión de Kadel, 24-10-2026): la actividad de hace minutos se escribe «hoy HH:MM»', () => {
    const ahora = new Date('2026-10-24T14:00:00Z');
    expect(formatearActividad('2026-10-24T13:49:00Z', ahora)).toBe('hoy 10:49');
  });

  it('cobertura y cantidades', () => {
    expect(formatearCobertura(10, 15)).toBe('10/15');
    expect(formatearCantidad(1, 'borrador', 'borradores')).toBe('1 borrador');
    expect(formatearCantidad(0, 'borrador', 'borradores')).toBe('0 borradores');
    expect(formatearCantidad(2, 'borrador', 'borradores')).toBe('2 borradores');
  });
});

describe('categorías salidas de los datos (contrato §4)', () => {
  it('describe las conocidas con nombre completo, corto y abreviatura', () => {
    expect(describirCategoria('fruto_calidad')).toEqual({ clave: 'fruto_calidad', etiqueta: 'Fruto/Calidad', corta: 'Fruto', abreviatura: 'Fruto' });
    expect(describirCategoria('fenologia')).toMatchObject({ etiqueta: 'Fenología', abreviatura: 'Fen.' });
    expect(describirCategoria('produccion')).toMatchObject({ corta: 'Producción', abreviatura: 'Prod.' });
    expect(describirCategoria('estres')).toMatchObject({ etiqueta: 'Estrés' });
  });

  it('la quinta categoría tiene su nombre (decisión S10): clave brotes, «Brotes y varas», corto «Brotes», abreviatura «Brot.»', () => {
    expect(describirCategoria('brotes')).toEqual({ clave: 'brotes', etiqueta: 'Brotes y varas', corta: 'Brotes', abreviatura: 'Brot.' });
  });

  it('una categoría que el frontend no conoce no rompe nada: se muestra con un nombre derivado de su clave', () => {
    expect(describirCategoria('agua')).toEqual({ clave: 'agua', etiqueta: 'Agua', corta: 'Agua', abreviatura: 'Agua' });
    expect(describirCategoria('riego_goteo')).toEqual({ clave: 'riego_goteo', etiqueta: 'Riego goteo', corta: 'Riego goteo', abreviatura: 'Rieg.' });
    expect(nombreDesdeClave('brotes_varas_basales')).toBe('Brotes varas basales');
    expect(describirCategoria('x')).toEqual({ clave: 'x', etiqueta: 'X', corta: 'X', abreviatura: 'X' });
  });

  it('los datos pueden traer el nombre de una categoría nueva sin tocar el frontend', () => {
    expect(describirCategoria('agua', { etiqueta: 'Agua y riego', abreviatura: 'Agua' })).toEqual({
      clave: 'agua', etiqueta: 'Agua y riego', corta: 'Agua y riego', abreviatura: 'Agua',
    });
    // Si los datos traen etiqueta propia, mandan también sobre una conocida; el resto de los campos queda como estaba.
    expect(describirCategoria('brotes', { etiqueta: 'Brotes y varas basales' })).toEqual({
      clave: 'brotes', etiqueta: 'Brotes y varas basales', corta: 'Brotes', abreviatura: 'Brot.',
    });
  });

  it('ordena las conocidas por peso de la versión 2 (Fruto, Producción, Fenología, Brotes, Estrés; decisiones S10 y EF9) y las demás por nombre, sin repetidos', () => {
    expect(ordenarCategorias(['estres', 'brotes', 'fenologia', 'brotes', 'produccion', 'fruto_calidad', 'agua'])).toEqual([
      'fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres', 'agua',
    ]);
    expect(ordenarCategorias(['riego', 'agua', 'estres'])).toEqual(['estres', 'agua', 'riego']);
  });

  it('saca las categorías de los grupos de los datos (no hay un conjunto fijo)', () => {
    const grupos = [['fenologia', 'estres'], ['fenologia', 'fruto_calidad', 'brotes'], []];
    expect(categoriasDeDatos(grupos).map((c) => c.clave)).toEqual(['fruto_calidad', 'fenologia', 'brotes', 'estres']);
    expect(categoriasDeDatos([['estres', 'brotes', 'fenologia', 'produccion', 'fruto_calidad']]).map((c) => c.clave))
      .toEqual(['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres']);
    expect(categoriasDeDatos([])).toEqual([]);
  });

  it('el grupo se escribe en frase y en el orden de las categorías, aunque llegue desordenado', () => {
    expect(etiquetaDeGrupo(['estres', 'fenologia', 'produccion'])).toBe('Producción · Fenología · Estrés');
    expect(etiquetaDeGrupo(['fenologia', 'fruto_calidad'], 'etiqueta')).toBe('Fruto/Calidad · Fenología');
    expect(etiquetaDeGrupo(['produccion', 'fenologia'], 'abreviatura')).toBe('Prod. · Fen.');
    expect(etiquetaDeGrupo(['estres', 'brotes', 'fenologia'])).toBe('Fenología · Brotes · Estrés');
    expect(etiquetaDeGrupo(['estres', 'brotes'], 'etiqueta')).toBe('Brotes y varas · Estrés');
    expect(etiquetaDeGrupo(['produccion', 'brotes'], 'abreviatura')).toBe('Prod. · Brot.');
    expect(etiquetaDeGrupo([])).toBe('');
  });
});
