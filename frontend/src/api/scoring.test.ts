import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIA_ABREV, CATEGORIA_CORTA, categoriasConColumna } from '@/features/ranking/formato';
import { describirCategoria } from '@/lib/v3/categorias';
import { CATEGORIA_LABEL, CATEGORIAS_BASE, CATEGORIAS_SCORING, ordenarGrupo } from './scoring';

/** Valores del enum categoria_scoring según las migraciones (create type + alter type … add value). */
function enumDeLaBase(): string[] {
  const dir = path.resolve(process.cwd(), '..', 'supabase', 'migrations');
  const sqls = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort().map((n) => readFileSync(path.join(dir, n), 'utf8'));
  let valores: string[] = [];
  for (const sql of sqls) {
    const crea = sql.match(/create\s+type\s+(public\.)?categoria_scoring\s+as\s+enum\s*\(([^)]*)\)/i);
    if (crea && valores.length === 0) valores = [...crea[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }
  for (const sql of sqls) for (const m of sql.matchAll(/alter\s+type\s+(public\.)?categoria_scoring\s+add\s+value\s+(if\s+not\s+exists\s+)?'([^']+)'/gi)) valores.push(m[3]);
  return valores;
}

describe('categorías del puntaje (5 con la versión 2)', () => {
  it('el frontend conoce exactamente las categorías del enum de la base', () => {
    expect([...CATEGORIAS_SCORING].sort()).toEqual([...enumDeLaBase()].sort());
    expect(CATEGORIAS_SCORING).toHaveLength(5);
  });

  it('se presentan por peso de la versión 2: Fruto/Calidad, Producción, Fenología, Brotes y varas, Estrés (40·30·15·10·5)', () => {
    expect(CATEGORIAS_SCORING).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres']);
    expect(CATEGORIAS_SCORING.map((c) => CATEGORIA_LABEL[c])).toEqual(['Fruto/Calidad', 'Producción', 'Fenología', 'Brotes y varas', 'Estrés']);
  });

  it('cada categoría tiene nombre completo, corto y abreviado, y coincide con el contrato v3', () => {
    for (const c of CATEGORIAS_SCORING) {
      expect(CATEGORIA_LABEL[c]).toBeTruthy();
      expect(CATEGORIA_CORTA[c]).toBeTruthy();
      expect(CATEGORIA_ABREV[c]).toBeTruthy();
      const v3 = describirCategoria(c);
      expect([v3.etiqueta, v3.corta, v3.abreviatura]).toEqual([CATEGORIA_LABEL[c], CATEGORIA_CORTA[c], CATEGORIA_ABREV[c]]);
    }
    expect(CATEGORIA_LABEL.brotes).toBe('Brotes y varas');
    expect(CATEGORIA_CORTA.brotes).toBe('Brotes');
    expect(CATEGORIA_ABREV.brotes).toBe('Brot.');
  });

  it('un grupo se ordena por peso sin importar cómo llegue (la base lo entrega en orden del enum)', () => {
    expect(ordenarGrupo(['fenologia', 'fruto_calidad', 'produccion', 'brotes', 'estres'])).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres']);
    expect(ordenarGrupo(['estres', 'fenologia'])).toEqual(['fenologia', 'estres']);
    const original = ['estres', 'fruto_calidad'] as const;
    ordenarGrupo(original);
    expect(original).toEqual(['estres', 'fruto_calidad']); // no muta
  });
});

describe('columnas de categoría en las tablas de ranking', () => {
  it('con datos de 4 categorías (versión v1), no aparece la columna de Brotes', () => {
    const items = [{ grupo: ['fenologia', 'fruto_calidad', 'produccion', 'estres'], cobertura: { fenologia: { con_valor: 1, total: 1 } }, detalle_categorias: { fenologia: 0.5, fruto_calidad: 0.5, produccion: 0.5, brotes: null, estres: 0.5 } }];
    expect(categoriasConColumna(items)).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'estres']);
  });

  it('con datos de 5 categorías (versión v2), Brotes aparece en su lugar por peso', () => {
    const items = [{ grupo: ['fenologia', 'fruto_calidad', 'produccion', 'brotes', 'estres'], cobertura: { brotes: { con_valor: 2, total: 4 } }, detalle_categorias: { brotes: 0.6 } }];
    expect(categoriasConColumna(items)).toEqual(['fruto_calidad', 'produccion', 'fenologia', 'brotes', 'estres']);
  });

  it('basta que un individuo la tenga en su cobertura, o en su grupo, para que la columna aparezca', () => {
    expect(categoriasConColumna([{ grupo: ['fenologia'], cobertura: {}, detalle_categorias: {} }, { grupo: [], cobertura: { brotes: { con_valor: 0, total: 4 } }, detalle_categorias: {} }])).toContain('brotes');
    expect(categoriasConColumna([{ grupo: ['brotes'], cobertura: {}, detalle_categorias: {} }])).toContain('brotes');
  });

  it('las categorías de siempre se muestran aunque no haya datos; Brotes no', () => {
    expect(categoriasConColumna([])).toEqual([...CATEGORIAS_BASE].sort((a, b) => CATEGORIAS_SCORING.indexOf(a) - CATEGORIAS_SCORING.indexOf(b)));
    expect(categoriasConColumna([])).not.toContain('brotes');
  });
});
