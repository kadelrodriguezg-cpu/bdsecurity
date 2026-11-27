import { describe, expect, it } from 'vitest';
import { construirCsv, nombreArchivo, type ContextoExportacion } from './exportar';
import type { FilaResultado } from './modelo';

const fila: FilaResultado = {
  individuo_id: 'i1', codigo_display: '02-504-P34', planta_id: 'c', codigo_sistema: '02-504', evaluacion_id: 'e1',
  fecha_evaluacion: '2026-10-19', numero_ronda: 1, puntaje: 0.73264817, grupo: ['fenologia', 'fruto_calidad'], posicion: 1, tamano: 40,
  categorias: { fruto_calidad: 0.66, fenologia: 0.6125 }, cobertura: {}, estado: 'comparable',
};
const ctx: ContextoExportacion = { especie: 'Arándano', cruce: '02-504', version: 'Selección v1 (4-3-2-1)', ronda: 'Ronda 1', rondaCorta: 'ronda-1', grupo: 'las 4 categorías', ahora: new Date(2026, 9, 25, 10, 30) };

describe('Exportar (N36)', () => {
  it('nombre con especie, cruce, ronda y fecha; la versión de puntaje no va en el nombre', () => {
    expect(nombreArchivo(ctx)).toBe('resultados_arandano_02-504_ronda-1_2026-10-25.csv');
  });

  it('fila de encabezado con versión, ronda y fecha; puntaje 0–1 con precisión completa y el visible 0–100; sin linaje', () => {
    const csv = construirCsv([fila], ctx, { pesosGrupo: [{ categoria: 'fruto_calidad', peso: 0.6667 }, { categoria: 'fenologia', peso: 0.3333 }], columnas: [], valores: undefined, cambios: undefined });
    const [encabezado, columnas, datos] = csv.replace('﻿', '').split('\r\n');
    expect(encabezado).toContain('Versión de puntaje: Selección v1 (4-3-2-1)');
    expect(encabezado).toContain('Ronda 1');
    expect(encabezado).toMatch(/Exportado: 25-10-2026/);
    expect(columnas).toBe('Puesto;De;Individuo;Cruce;Ronda;Fecha de evaluación;Puntaje (0-1);Puntaje (0-100);Fruto/Calidad (0-1);Fenología (0-1)');
    expect(datos).toBe('1;40;02-504-P34;02-504;1;2026-10-19;0,73264817;73,3;0,66;0,6125');
    expect(csv.toLowerCase()).not.toMatch(/mam[aá]|pap[aá]|cruzamiento|linaje/);
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('con el cambio activado agrega el cambio exacto y su etiqueta', () => {
    const csv = construirCsv([fila], ctx, { pesosGrupo: [], columnas: [], valores: undefined, cambios: new Map([['i1', { delta: 0.0853, etiqueta: 'mejoro_leve', referencia: '1' }]]) });
    expect(csv).toContain(';Cambio (0-1);Cambio');
    expect(csv).toContain(';0,0853;mejoro_leve');
  });
});
