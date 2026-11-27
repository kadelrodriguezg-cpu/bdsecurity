/**
 * Guardia de la identidad v2 (tramo B): fuera de EVECL no puede haber colores
 * escritos a mano. Todo color sale de los tokens (clases `brand`, `ink-*`,
 * `line`, `surface-*`, `warn`, `danger`, `ok`...) o, cuando el código no
 * admite clases (Leaflet, SVG), de `lib/colores.ts`.
 *
 * Permitido y por qué:
 *  - `features/evecl/` y sus páginas (`pages/Evecl*`, `FichaEvecl*`, `Ensayo*`):
 *    el módulo EVECL tiene su propia pasada de identidad.
 *  - `*.test.*`: los tests escriben valores literales para comprobar.
 *  - `types/database.types.ts`: autogenerado.
 *  - `lib/colores.ts`: el único lugar con hex (repite los tokens de index.css).
 *  - `index.css`: la definición de los tokens (`:root`) y los estilos de
 *    impresión de etiquetas/EVECL, que van sobre papel y no usan la paleta.
 *  - `white` y `black` de Tailwind (`bg-white`, `text-white`): son blanco y
 *    negro sin matiz; `surface` y `ink` los cubren, pero no son un color suelto.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLORES, PALETA_SERIES } from './colores';

// Vitest corre con raíz en frontend/ (vitest.config.ts).
const SRC = path.resolve(process.cwd(), 'src');

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(ts|tsx|css)$/.test(nombre) ? [ruta] : [];
  });
}

const relativa = (ruta: string) => path.relative(SRC, ruta).split(path.sep).join('/');

const EXENTO = (rel: string) =>
  rel.startsWith('features/evecl/') ||
  /^pages\/(Evecl|FichaEvecl|Ensayo)/.test(rel) ||
  /\.test\.(ts|tsx)$/.test(rel) ||
  rel === 'types/database.types.ts' ||
  rel === 'lib/colores.ts';

/** index.css sin la definición de tokens ni la sección de impresión. */
function cssRevisable(texto: string): string {
  const sinRaiz = texto.replace(/:root\s*\{[\s\S]*?\n {2}\}/, '');
  const corte = sinRaiz.indexOf('La impresión de etiquetas sigue aislada');
  return corte === -1 ? sinRaiz : sinRaiz.slice(0, corte);
}

const PALETAS = 'amber|sky|yellow|orange|emerald|green|red|blue|violet|purple|indigo|rose|teal|cyan|lime|fuchsia|pink|slate|gray|zinc|neutral|stone';
const UTILIDADES = 'bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent|shadow|caret|placeholder';
const PATRONES: Array<[string, RegExp]> = [
  ['color de la paleta de Tailwind', new RegExp(`\\b(?:${UTILIDADES})-(?:${PALETAS})-\\d{2,3}\\b`, 'g')],
  ['hex escrito a mano', /#[0-9a-fA-F]{3,8}\b/g],
  ['rgb/hsl escrito a mano', /\b(?:rgba?|hsla?)\(/g],
];

describe('identidad v2: colores sueltos fuera de EVECL', () => {
  const fuentes = archivos(SRC)
    .map((ruta) => ({ rel: relativa(ruta), ruta }))
    .filter(({ rel }) => !EXENTO(rel));

  it('encuentra los archivos que debe revisar', () => {
    expect(fuentes.length).toBeGreaterThan(100);
  });

  it.each(PATRONES)('no hay %s', (_nombre, patron) => {
    const hallazgos: string[] = [];
    for (const { rel, ruta } of fuentes) {
      const bruto = readFileSync(ruta, 'utf8');
      const texto = rel === 'index.css' ? cssRevisable(bruto) : bruto;
      texto.split('\n').forEach((linea, i) => {
        const coincidencias = linea.match(patron);
        if (coincidencias) hallazgos.push(`${rel}:${i + 1} ${coincidencias.join(', ')}`);
      });
    }
    expect(hallazgos).toEqual([]);
  });
});

describe('lib/colores.ts repite los tokens de index.css', () => {
  const css = readFileSync(path.join(SRC, 'index.css'), 'utf8');
  const token = (nombre: string) => css.match(new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`))?.[1].toLowerCase();

  it.each([
    ['acento', '--brand'],
    ['acentoHover', '--brand-d'],
    ['ok', '--ok'],
    ['falta', '--warn'],
    ['revisar', '--danger'],
    ['tinta', '--ink'],
    ['tinta2', '--ink-2'],
    ['tinta4', '--ink-4'],
    ['borde', '--line'],
    ['superficie', '--surface'],
  ] as const)('%s coincide con %s', (clave, variable) => {
    expect(COLORES[clave]).toBe(token(variable));
  });

  it.each([
    ['indigo', '--chart-1'],
    ['verdeAzulado', '--chart-2'],
    ['ocre', '--chart-3'],
    ['violeta', '--chart-4'],
    ['verde', '--chart-5'],
  ] as const)('serie %s coincide con %s', (clave, variable) => {
    expect(PALETA_SERIES[clave]).toBe(token(variable));
  });
});

describe('modificadores de opacidad sobre tokens', () => {
  // Los tokens son `var(--x)`: Tailwind no genera `bg-brand/10` ni similares, así que la
  // clase no hace nada. Se usan los tonos lavados (`brand-l`, `danger-l`, `ok-l`...).
  // Pendientes conocidos: el fondo del Sheet (`bg-ink/50`) y la variante `warning` del botón.
  const CONOCIDOS = new Set(['components/ui/sheet.tsx', 'components/ui/button.tsx']);
  it('no hay clases como bg-primary/10', () => {
    const patron = /\b(?:bg|border|text|ring|divide)-(?:primary|brand|danger|warn|ok|ink|line|surface)(?:-[a-z0-9]+)?\/\d+/;
    const hallazgos: string[] = [];
    for (const ruta of archivos(SRC)) {
      const nombre = relativa(ruta);
      if (EXENTO(nombre) || CONOCIDOS.has(nombre)) continue;
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        if (patron.test(linea)) hallazgos.push(`${nombre}:${i + 1}`);
      });
    }
    expect(hallazgos).toEqual([]);
  });
});
