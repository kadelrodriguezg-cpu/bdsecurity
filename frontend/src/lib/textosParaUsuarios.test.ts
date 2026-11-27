/**
 * Guardia de lenguaje: los textos que ve quien usa la app (operario o admin) no pueden traer jerga del equipo de
 * desarrollo: nombres de versiones de puntaje, «provisional», códigos de decisión, «scoring», «snapshot», «RPC»,
 * recordatorios internos («por ahora», «hipótesis», «pendiente de Efraín»…).
 *
 * Recorre el código fuente con el compilador de TypeScript y mira solo los textos: literales de cadena, plantillas y
 * texto dentro de JSX (los comentarios y los identificadores no cuentan). Un texto «visible» tiene al menos dos
 * palabras, así que los nombres internos de una sola pieza (`obtener_scoring_planta`, claves, rutas) no se revisan.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..');

/** Lo que no debe aparecer en un texto visible. */
const PROHIBIDO: Array<[RegExp, string]> = [
  [/provisional/i, '«provisional»'],
  [/mezcla\s+temporadas/i, '«mezcla temporadas»'],
  [/scoring/i, '«scoring»'],
  [/snapshot/i, '«snapshot»'],
  [/\bRPC\b/, '«RPC»'],
  [/versi[oó]n de puntaje/i, 'nombre o mención de la versión de puntaje'],
  [/versi[oó]n «/i, 'nombre de una versión entre comillas'],
  [/\bpeso \d/i, 'encabezado «peso N»'],
  [/\b(?:N|S|EF)\d{1,2}\b/, 'código de decisión (N38, S1, EF…)'],
  [/\bpaso \d/i, '«paso N»'],
  [/\bsprint\b/i, '«sprint»'],
  [/\bmigraci[oó]n\b/i, '«migración»'],
  [/hip[oó]tesis/i, '«hipótesis»'],
  [/Efra[ií]n/i, '«Efraín»'],
  [/por ahora/i, '«por ahora»'],
  [/todav[ií]a no se implement|no se implement[oó] a[uú]n|pendiente de implement/i, 'recordatorio de lo que falta construir'],
];

/** Excepciones deliberadas: archivo (relativo a src, con «/») → textos permitidos. */
const PERMITIDO: Record<string, RegExp[]> = {
  // El CSV que descarga el admin lleva la versión de puntaje en su fila de encabezado (trazabilidad). No es pantalla.
  'features/resultados/exportar.ts': [/versi[oó]n de puntaje/i],
};

function archivos(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (/\.tsx?$/.test(nombre) && !/\.(test|spec)\.tsx?$|\.d\.ts$|database\.types\.ts$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

function textos(ruta: string): Array<{ linea: number; texto: string }> {
  const fuente = readFileSync(ruta, 'utf8');
  const sf = ts.createSourceFile(ruta, fuente, ts.ScriptTarget.Latest, true, ruta.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const encontrados: Array<{ linea: number; texto: string }> = [];
  const agregar = (nodo: ts.Node, texto: string) => {
    const limpio = texto.replace(/\s+/g, ' ').trim();
    if (!/\S+\s+\S+/.test(limpio)) return; // una sola palabra: nombre interno, no un texto para leer
    if (/[a-z]_[a-z]/.test(limpio)) return; // snake_case: columnas y nombres de la base (consultas), no texto para leer
    encontrados.push({ linea: sf.getLineAndCharacterOfPosition(nodo.getStart()).line + 1, texto: limpio });
  };
  const visitar = (nodo: ts.Node) => {
    if (ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) return;
    if (ts.isJsxText(nodo)) agregar(nodo, nodo.text);
    else if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) agregar(nodo, nodo.text);
    else if (ts.isTemplateExpression(nodo)) agregar(nodo, nodo.head.text + nodo.templateSpans.map((s) => ` ${s.literal.text}`).join(''));
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return encontrados;
}

describe('Textos para quien usa la app: sin jerga del equipo de desarrollo', () => {
  const lista = archivos(RAIZ);

  it('revisa el código fuente (no queda vacío)', () => {
    expect(lista.length).toBeGreaterThan(100);
  });

  it('ningún texto visible trae nombres de versión, «provisional», códigos de decisión ni recordatorios internos', () => {
    const faltas: string[] = [];
    for (const ruta of lista) {
      const rel = relative(RAIZ, ruta).split(sep).join('/');
      for (const { linea, texto } of textos(ruta)) {
        for (const [patron, nombre] of PROHIBIDO) {
          if (!patron.test(texto)) continue;
          if ((PERMITIDO[rel] ?? []).some((p) => p.test(texto))) continue;
          faltas.push(`${rel}:${linea} · ${nombre} · «${texto.slice(0, 110)}»`);
        }
      }
    }
    expect(faltas, `Textos con jerga interna:\n${faltas.join('\n')}`).toEqual([]);
  });

  it('la guardia detecta de verdad: un texto con jerga sí se marca', () => {
    expect(PROHIBIDO.some(([p]) => p.test('Se muestra la última ronda: mezcla temporadas'))).toBe(true);
    expect(PROHIBIDO.some(([p]) => p.test('Puntaje de 0 a 100 · versión «Selección v2 provisional»'))).toBe(true);
    expect(PROHIBIDO.some(([p]) => p.test('Mostrando la última evaluación de cada individuo (pueden ser de temporadas distintas)'))).toBe(false);
  });
});
