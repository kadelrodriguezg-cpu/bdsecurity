/**
 * Contrato v3 (docs/rediseno_v3/contrato.md, §4): nombres de las categorías del puntaje, **salidos de los datos**.
 *
 * El puntaje tiene cinco categorías (decisión S1: Brotes y varas como categoría propia; el enum de la base ya tiene `brotes`, migración
 * 20261025100000). Una categoría se identifica por su clave (texto) y se describe con esta función; la quinta está nombrada (decisión
 * S10: clave `brotes`, «Brotes y varas», corto «Brotes», abreviatura «Brot.»). Lo que no se conoce se muestra con un nombre derivado
 * de la clave, sin romper nada.
 */

export interface CategoriaDescrita {
  /** Clave tal como llega de la base (`fenologia`, `fruto_calidad`…). */
  clave: string;
  /** Nombre completo: «Fruto/Calidad». */
  etiqueta: string;
  /** Nombre corto para celdas y etiquetas: «Fruto». */
  corta: string;
  /** Abreviatura para 390 px, donde el nombre no cabe en una pestaña: «Fen.». */
  abreviatura: string;
}

type Descripcion = Omit<CategoriaDescrita, 'clave'>;

/**
 * Las categorías conocidas, en el orden en que se presentan: el de los pesos de la versión 2 (decisiones S10 y EF9; 40 · 30 · 15 · 10 · 5):
 * Fruto/Calidad, Producción, Fenología, Brotes y varas, Estrés. Una categoría que no aparece en los datos (por ejemplo `brotes` en un
 * ranking calculado con la versión de 4 categorías) no aparece en pantalla.
 */
const CONOCIDAS: Record<string, Descripcion> = {
  fruto_calidad: { etiqueta: 'Fruto/Calidad', corta: 'Fruto', abreviatura: 'Fruto' },
  produccion: { etiqueta: 'Producción', corta: 'Producción', abreviatura: 'Prod.' },
  fenologia: { etiqueta: 'Fenología', corta: 'Fenología', abreviatura: 'Fen.' },
  brotes: { etiqueta: 'Brotes y varas', corta: 'Brotes', abreviatura: 'Brot.' },
  estres: { etiqueta: 'Estrés', corta: 'Estrés', abreviatura: 'Estrés' },
};
const ORDEN_CONOCIDAS = Object.keys(CONOCIDAS);

/** «brotes_varas_basales» → «Brotes varas basales»: nombre provisional de una clave que el frontend aún no conoce. */
export function nombreDesdeClave(clave: string): string {
  const texto = clave.replace(/[_-]+/g, ' ').trim();
  return texto === '' ? clave : texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Describe una categoría. `desdeDatos` permite que la base (o el motor) diga cómo se llama una categoría nueva sin tocar el
 * frontend; manda sobre lo conocido solo si trae etiqueta propia.
 */
export function describirCategoria(clave: string, desdeDatos?: Partial<Descripcion>): CategoriaDescrita {
  const base = CONOCIDAS[clave];
  const etiqueta = desdeDatos?.etiqueta ?? base?.etiqueta ?? nombreDesdeClave(clave);
  return {
    clave,
    etiqueta,
    corta: desdeDatos?.corta ?? base?.corta ?? etiqueta,
    abreviatura: desdeDatos?.abreviatura ?? base?.abreviatura ?? (etiqueta.length > 5 ? `${etiqueta.slice(0, 4)}.` : etiqueta),
  };
}

/** Ordena claves de categoría: primero las conocidas en su orden, después las demás por nombre. Devuelve una copia sin repetidos. */
export function ordenarCategorias(claves: Iterable<string>): string[] {
  const unicas = [...new Set(claves)];
  const rango = (c: string) => { const i = ORDEN_CONOCIDAS.indexOf(c); return i === -1 ? ORDEN_CONOCIDAS.length : i; };
  return unicas.sort((a, b) => rango(a) - rango(b) || a.localeCompare(b, 'es'));
}

/** Las categorías que aparecen en los datos (por ejemplo, en los `grupo` de los ítems del ranking), ordenadas y descritas. */
export function categoriasDeDatos(grupos: Iterable<readonly string[]>): CategoriaDescrita[] {
  const claves = new Set<string>();
  for (const grupo of grupos) for (const c of grupo) claves.add(c);
  return ordenarCategorias(claves).map((c) => describirCategoria(c));
}

/** El grupo de un individuo en una frase: «Fruto · Fenología · Producción · Estrés» (en el orden de las categorías). */
export function etiquetaDeGrupo(grupo: readonly string[], forma: keyof Pick<CategoriaDescrita, 'etiqueta' | 'corta' | 'abreviatura'> = 'corta'): string {
  return ordenarCategorias(grupo).map((c) => describirCategoria(c)[forma]).join(' · ');
}
