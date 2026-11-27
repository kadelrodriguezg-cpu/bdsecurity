/**
 * Guardia de la identidad v2 (tramo D, jerarquía): lo que DESIGN.md prohíbe no
 * puede volver a entrar fuera de EVECL.
 *  - Sin versalitas decorativas (`uppercase`, `tracking-wide`, `small-caps`).
 *  - Nada por encima de 600 (`font-bold`).
 *  - Nada por debajo de 12 px: ni `text-[Npx]` ni los tamaños propios de Tailwind.
 *
 * Exentos: `features/evecl/` y sus páginas (su propia pasada), los tests y la fuente de 9 px
 * del «!» dentro de la celda de 12 px de `HuellaEvaluacion` (un glifo, no texto).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest corre con raíz en frontend/ (vitest.config.ts).
const RAIZ = process.cwd();
const SRC = path.join(RAIZ, 'src');

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(tsx|css)$/.test(nombre) ? [ruta] : [];
  });
}

/** Páginas del módulo EVECL (fuera de alcance de esta pasada). */
const PAGINA_EVECL = /^pages\/(Evecl|FichaEvecl|Ensayo)/;

const rel = (ruta: string) => path.relative(SRC, ruta).split(path.sep).join('/');
const fuentes = archivos(SRC)
  .map((ruta) => ({ nombre: rel(ruta), texto: readFileSync(ruta, 'utf8') }))
  .filter(({ nombre }) => !nombre.startsWith('features/evecl/') && !PAGINA_EVECL.test(nombre) && !/\.test\.tsx$/.test(nombre));

function hallar(patron: RegExp, exento: (nombre: string) => boolean = () => false): string[] {
  const hallazgos: string[] = [];
  for (const { nombre, texto } of fuentes) {
    if (exento(nombre)) continue;
    texto.split('\n').forEach((linea, i) => {
      if (patron.test(linea)) hallazgos.push(`${nombre}:${i + 1}`);
    });
  }
  return hallazgos;
}

describe('identidad v2: jerarquía', () => {
  it('no hay versalitas decorativas', () => {
    expect(hallar(/\buppercase\b|\btracking-(wide|wider|widest)\b|small-caps/)).toEqual([]);
  });

  it('no hay negrita de 700', () => {
    expect(hallar(/\bfont-(bold|extrabold|black)\b/)).toEqual([]);
  });

  it('no hay tamaños arbitrarios por debajo de 12 px', () => {
    const chico = /\btext-\[(\d+(?:\.\d+)?)px\]/;
    const hallazgos = hallar(
      /\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/,
      (nombre) => nombre === 'features/evaluaciones/HuellaEvaluacion.tsx',
    );
    expect(hallazgos).toEqual([]);
    expect(chico.test('text-[12px]')).toBe(true);
  });

  it('los tamaños propios de Tailwind respetan el piso de 12 px', () => {
    const config = readFileSync(path.join(RAIZ, 'tailwind.config.ts'), 'utf8');
    for (const nombre of ['small', 'micro', 'body']) {
      const px = Number(config.match(new RegExp(`\\b${nombre}:\\s*'([0-9.]+)px'`))?.[1]);
      expect(px, nombre).toBeGreaterThanOrEqual(12);
    }
  });
});
