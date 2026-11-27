/**
 * Coherencia entre lo que el SQL puede emitir y las etiquetas del frontend.
 *
 * Lee las migraciones del repositorio (no una base) y falla si alguien agrega
 * un motivo de exclusión o una métrica de scoring en SQL sin su etiqueta en
 * scoring.ts. Sin etiqueta, la UI muestra la clave cruda y el ranking agrupa
 * mal (RankingGeneral separa por motivo_exclusion).
 *
 * - Motivos: literales `then '...'` de la ÚLTIMA definición (create function)
 *   de cada función que asigna motivo_exclusion.
 * - Métricas: literales de cada `insert into scoring_metrica`, descontando los
 *   valores de los enums que comparten esas filas (categoría, dirección,
 *   método de normalización, tratamiento de nulos).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { METRICA_LABEL, MOTIVO_EXCLUSION_LABEL } from './scoring';

// Vitest corre con raíz en frontend/ (vitest.config.ts); en jsdom
// import.meta.url no es una URL file:, por eso se resuelve desde cwd.
const DIR_MIGRACIONES = path.resolve(process.cwd(), '..', 'supabase', 'migrations');

const migraciones = readdirSync(DIR_MIGRACIONES)
  .filter((nombre) => nombre.endsWith('.sql'))
  .sort()
  .map((nombre) => ({ nombre, sql: readFileSync(path.join(DIR_MIGRACIONES, nombre), 'utf8') }));

/** Cuerpo (entre dollar quotes) de la última definición completa de la función. */
function cuerpoUltimaDefinicion(funcion: string): { archivo: string; cuerpo: string } {
  const definicion = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${funcion}\\s*\\(`, 'gi');
  let encontrada: { archivo: string; cuerpo: string } | null = null;
  for (const { nombre, sql } of migraciones) {
    for (const coincidencia of sql.matchAll(definicion)) {
      const resto = sql.slice(coincidencia.index);
      const apertura = resto.match(/\$[a-z_]*\$/i);
      if (!apertura || apertura.index === undefined) continue;
      const inicio = apertura.index + apertura[0].length;
      const fin = resto.indexOf(apertura[0], inicio);
      if (fin < 0) continue;
      encontrada = { archivo: nombre, cuerpo: resto.slice(inicio, fin) };
    }
  }
  if (!encontrada) throw new Error(`No hay definición de ${funcion} en las migraciones.`);
  return encontrada;
}

/** Valores de un enum: los del `create type` más los que agregan después las migraciones (`alter type … add value`). */
function valoresEnum(tipo: string): string[] {
  const patron = new RegExp(`create\\s+type\\s+(public\\.)?${tipo}\\s+as\\s+enum\\s*\\(([^)]*)\\)`, 'i');
  const agregado = new RegExp(`alter\\s+type\\s+(public\\.)?${tipo}\\s+add\\s+value\\s+(if\\s+not\\s+exists\\s+)?'([^']+)'`, 'gi');
  let valores: string[] | null = null;
  for (const { sql } of migraciones) {
    const coincidencia = sql.match(patron);
    if (coincidencia && !valores) valores = [...coincidencia[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }
  if (!valores) throw new Error(`No hay enum ${tipo} en las migraciones.`);
  for (const { sql } of migraciones) for (const m of sql.matchAll(agregado)) valores.push(m[3]);
  return valores;
}

function motivosEmitidos(): Set<string> {
  const motivos = new Set<string>();
  // Funciones que asignan motivo_exclusion en su salida.
  for (const funcion of ['calcular_ranking_operativo', 'obtener_ranking_global_filtrado']) {
    const { cuerpo } = cuerpoUltimaDefinicion(funcion);
    for (const m of cuerpo.matchAll(/then\s+'([a-z_]+)'/g)) motivos.add(m[1]);
  }
  return motivos;
}

function metricasConfiguradas(): Set<string> {
  const ajenos = new Set([
    ...valoresEnum('categoria_scoring'),
    ...valoresEnum('direccion_scoring'),
    ...valoresEnum('metodo_normalizacion_scoring'),
    ...valoresEnum('tratamiento_nulos_scoring'),
  ]);
  const metricas = new Set<string>();
  for (const { sql } of migraciones) {
    for (const insercion of sql.matchAll(/insert\s+into\s+(public\.)?scoring_metrica\b[^;]*;/gi)) {
      for (const m of insercion[0].matchAll(/'([a-z][a-z0-9_]*)'/g)) {
        if (!ajenos.has(m[1])) metricas.add(m[1]);
      }
    }
  }
  return metricas;
}

describe('etiquetas de scoring coherentes con el SQL', () => {
  it('encuentra los motivos y las métricas en las migraciones (el extractor no quedó vacío)', () => {
    expect(motivosEmitidos().size).toBeGreaterThanOrEqual(8);
    expect(metricasConfiguradas().size).toBeGreaterThanOrEqual(20);
  });

  it('todo motivo_exclusion que el SQL puede emitir tiene etiqueta', () => {
    const sinEtiqueta = [...motivosEmitidos()].filter((motivo) => !(motivo in MOTIVO_EXCLUSION_LABEL));
    expect(sinEtiqueta).toEqual([]);
  });

  it('toda métrica configurada en scoring_metrica tiene etiqueta', () => {
    const sinEtiqueta = [...metricasConfiguradas()].filter((metrica) => !(metrica in METRICA_LABEL));
    expect(sinEtiqueta).toEqual([]);
  });
});
