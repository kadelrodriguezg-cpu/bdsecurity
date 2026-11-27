/**
 * Lógica pura de «Comparar rondas» (Fase 2, S3-3): qué se resta y qué no.
 *
 * Reglas de decisión (docs/plan_fase2.md, ranking por grupos):
 *  - El grupo de una ronda es la combinación de categorías del motor que
 *    tuvieron datos. Dos rondas con grupos distintos NO se restan el puntaje
 *    total: cada uno se calculó con otras categorías.
 *  - El puntaje es el de la versión de scoring con que se calculó; con
 *    versiones distintas tampoco se resta.
 *  - Por categoría solo hay diferencia donde las dos rondas la midieron.
 *  - Por descriptor solo hay diferencia donde los dos están medidos: un
 *    valor marcado para revisión o un obligatorio que faltó no se resta.
 */
import type { EstadoDescriptor } from '@/api/protocolo';
import type { ComparacionIndividuo, EtiquetaDelta } from '@/api/comparacion';
import type { PuntajeCongelado } from '@/api/compararRondas';
import { ESTADO_RANKING_LABEL, type ItemRankingGrupos } from '@/api/rankingGrupos';
import { CATEGORIAS_SCORING, type CategoriaScoring } from '@/api/scoring';
import { estadoDescriptor } from '@/lib/esquemaFase/protocolo';
import { tieneValor, type CampoFase, type EsquemaFase } from '@/lib/esquemaFase/tipos';

// --- Descriptores -----------------------------------------------------------

export interface CeldaDescriptor {
  estado: EstadoDescriptor;
  valor: unknown;
}

/** Medido o marcado: el descriptor tiene un valor guardado. */
export const conValor = (estado: EstadoDescriptor) => estado === 'medido' || estado === 'marcado';

export type MotivoSinDiferencia = 'marcado' | 'solo_a' | 'solo_b' | 'falto_a' | 'falto_b' | 'ninguna';

export type Cambio =
  | { tipo: 'igual' }
  | { tipo: 'sube' | 'baja'; cantidad: number }
  | { tipo: 'antes' | 'despues'; dias: number }
  | { tipo: 'sin_diferencia'; motivo: MotivoSinDiferencia };

export interface FilaComparada {
  campo: CampoFase;
  a: CeldaDescriptor;
  b: CeldaDescriptor;
  /** Los dos tienen valor: entra en «Evaluados en ambas». */
  ambas: boolean;
  cambio: Cambio;
}

export interface SeccionComparada {
  id: string;
  etiqueta: string;
  filas: FilaComparada[];
}

export function celdaDe(
  campo: CampoFase,
  valores: Record<string, unknown>,
  estados: Partial<Record<string, EstadoDescriptor>> | null,
): CeldaDescriptor {
  const valor = valores[campo.clave] ?? null;
  // Un derivado lo calcula la base: existe si tiene valor y nunca «faltó».
  if (campo.rol === 'derivado') return { estado: tieneValor(valor) ? 'medido' : 'no_evaluado', valor };
  return { estado: estados?.[campo.clave] ?? estadoDescriptor(campo.clave, valor, null), valor };
}

const redondear = (n: number, decimales = 2) => Math.round(n * 10 ** decimales) / 10 ** decimales;

/** Día del año ignorando el año: las fechas de fenología de dos temporadas se comparan por calendario. */
function diaDelAnio(fecha: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha));
  if (!m) return null;
  return Date.UTC(2001, Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

export function cambioDescriptor(campo: CampoFase, a: CeldaDescriptor, b: CeldaDescriptor): Cambio {
  if (conValor(a.estado) && conValor(b.estado)) {
    if (a.estado === 'marcado' || b.estado === 'marcado') return { tipo: 'sin_diferencia', motivo: 'marcado' };
    if (campo.tipo === 'fecha') {
      const da = diaDelAnio(a.valor);
      const db = diaDelAnio(b.valor);
      if (da === null || db === null) return { tipo: 'sin_diferencia', motivo: 'ninguna' };
      if (db === da) return { tipo: 'igual' };
      return db < da ? { tipo: 'antes', dias: da - db } : { tipo: 'despues', dias: db - da };
    }
    const na = Number(a.valor);
    const nb = Number(b.valor);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return { tipo: 'sin_diferencia', motivo: 'ninguna' };
    const diferencia = redondear(nb - na);
    if (diferencia === 0) return { tipo: 'igual' };
    return { tipo: diferencia > 0 ? 'sube' : 'baja', cantidad: Math.abs(diferencia) };
  }
  if (conValor(a.estado) && b.estado === 'falto') return { tipo: 'sin_diferencia', motivo: 'falto_b' };
  if (a.estado === 'falto' && conValor(b.estado)) return { tipo: 'sin_diferencia', motivo: 'falto_a' };
  if (conValor(a.estado)) return { tipo: 'sin_diferencia', motivo: 'solo_a' };
  if (conValor(b.estado)) return { tipo: 'sin_diferencia', motivo: 'solo_b' };
  return { tipo: 'sin_diferencia', motivo: 'ninguna' };
}

/**
 * Descriptores de las dos rondas por sección del esquema. Un descriptor que en
 * ninguna de las dos rondas se evaluó (ni faltó) no tiene nada que comparar y
 * no se incluye.
 */
export function compararDescriptores<C extends string>(
  esquema: EsquemaFase<C>,
  a: { valores: Record<string, unknown>; estados: Partial<Record<string, EstadoDescriptor>> | null },
  b: { valores: Record<string, unknown>; estados: Partial<Record<string, EstadoDescriptor>> | null },
): SeccionComparada[] {
  return esquema.secciones
    .map((seccion) => ({
      id: seccion.id,
      etiqueta: seccion.etiqueta,
      filas: esquema.campos
        .filter((campo) => campo.seccion === seccion.id)
        .map((campo): FilaComparada => {
          const celdaA = celdaDe(campo, a.valores, a.estados);
          const celdaB = celdaDe(campo, b.valores, b.estados);
          return {
            campo,
            a: celdaA,
            b: celdaB,
            ambas: conValor(celdaA.estado) && conValor(celdaB.estado),
            cambio: cambioDescriptor(campo, celdaA, celdaB),
          };
        })
        .filter((fila) => fila.a.estado !== 'no_evaluado' || fila.b.estado !== 'no_evaluado'),
    }))
    .filter((seccion) => seccion.filas.length > 0);
}

// --- Puntajes ---------------------------------------------------------------

export type CategoriasRonda = Record<CategoriaScoring, number | null>;

export interface PuntajeRonda {
  numero: number;
  /** Subpuntaje por categoría; null = la lectura no cubre esta ronda (ronda en revisión, por ejemplo). */
  categorias: CategoriasRonda | null;
  /** Combinación de categorías con datos; null = no se pudo determinar. */
  grupo: CategoriaScoring[] | null;
  puntaje: number | null;
  versionNombre: string | null;
  posicionGrupo: number | null;
  tamanoGrupo: number | null;
  fuente: 'ranking' | 'congelado' | null;
  /** Nombre del ranking congelado de donde sale el puntaje. */
  congeladoNombre: string | null;
  /** Por qué el ranking vigente no le dio puntaje a esta ronda, si es el caso. */
  motivoSinPuntaje: string | null;
}

export const grupoDe = (categorias: Partial<Record<CategoriaScoring, number | null>> | null): CategoriaScoring[] | null =>
  categorias ? CATEGORIAS_SCORING.filter((c) => categorias[c] !== null && categorias[c] !== undefined) : null;

/** Subpuntajes de la ronda `numero` a partir de los pares consecutivos de la comparación de la base (serie anual). */
export function categoriasDeRonda(pares: readonly ComparacionIndividuo[] | undefined, numero: number): CategoriasRonda | null {
  const resultado: CategoriasRonda = { fruto_calidad: null, produccion: null, fenologia: null, brotes: null, estres: null };
  let hallada = false;
  for (const par of pares ?? []) {
    if (par.tipo_ronda !== 'anual') continue;
    const lado = par.numero_anterior === numero ? 'valor_anterior' : par.numero_actual === numero ? 'valor_actual' : null;
    if (!lado) continue;
    hallada = true;
    for (const delta of par.deltas_categoria) resultado[delta.categoria] = delta[lado];
  }
  return hallada ? resultado : null;
}

export function puntajeDeRonda(entrada: {
  numero: number;
  evaluacionId: string;
  pares: readonly ComparacionIndividuo[] | undefined;
  /** Fila del individuo en el ranking por grupos vigente. */
  ranking: ItemRankingGrupos | undefined;
  rankingVersionNombre: string | null | undefined;
  congelados: readonly PuntajeCongelado[] | undefined;
}): PuntajeRonda {
  const categorias = categoriasDeRonda(entrada.pares, entrada.numero);
  const base: PuntajeRonda = {
    numero: entrada.numero,
    categorias,
    grupo: grupoDe(categorias),
    puntaje: null,
    versionNombre: null,
    posicionGrupo: null,
    tamanoGrupo: null,
    fuente: null,
    congeladoNombre: null,
    motivoSinPuntaje: null,
  };
  const vigente = entrada.ranking && entrada.ranking.evaluacion_id === entrada.evaluacionId ? entrada.ranking : undefined;
  if (vigente) {
    if (vigente.puntaje !== null) {
      return {
        ...base,
        grupo: base.grupo ?? vigente.grupo,
        puntaje: vigente.puntaje,
        versionNombre: entrada.rankingVersionNombre ?? null,
        posicionGrupo: vigente.posicion_grupo,
        tamanoGrupo: vigente.tamano_grupo,
        fuente: 'ranking',
      };
    }
    return { ...base, grupo: base.grupo ?? (vigente.grupo.length > 0 ? vigente.grupo : null), motivoSinPuntaje: ESTADO_RANKING_LABEL[vigente.estado_ranking] };
  }
  const congelado = entrada.congelados?.find((c) => c.evaluacion_id === entrada.evaluacionId);
  if (congelado) {
    return {
      ...base,
      grupo: base.grupo ?? congelado.grupo,
      puntaje: congelado.puntaje,
      versionNombre: congelado.scoring_version_nombre,
      posicionGrupo: congelado.posicion_grupo,
      tamanoGrupo: congelado.tamano_grupo,
      fuente: 'congelado',
      congeladoNombre: congelado.snapshot_nombre,
    };
  }
  return base;
}

/** Mismas categorías, sin importar el orden: el `grupo` de la base va en orden del enum y el de `grupoDe` en orden de presentación. */
export const mismoGrupo = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c) => b.includes(c));

export type MotivoSinResta = 'grupos_distintos' | 'version_distinta' | 'sin_puntaje';

export type ResultadoTotal =
  | { resta: true; diferencia: number }
  | { resta: false; motivo: MotivoSinResta };

/** Diferencia del puntaje total, o por qué no se calcula. Los grupos distintos mandan sobre todo lo demás. */
export function compararTotales(a: PuntajeRonda, b: PuntajeRonda): ResultadoTotal {
  if (a.grupo && b.grupo && !mismoGrupo(a.grupo, b.grupo)) return { resta: false, motivo: 'grupos_distintos' };
  if (a.puntaje === null || b.puntaje === null) return { resta: false, motivo: 'sin_puntaje' };
  // Sin saber con qué versión se calculó uno de los dos no se puede asegurar que sean comparables.
  if (!a.versionNombre || !b.versionNombre) return { resta: false, motivo: 'sin_puntaje' };
  if (a.versionNombre !== b.versionNombre) return { resta: false, motivo: 'version_distinta' };
  return { resta: true, diferencia: redondear(b.puntaje - a.puntaje, 4) };
}

export interface CategoriaComparada {
  categoria: CategoriaScoring;
  a: number | null;
  b: number | null;
  /** Solo si las dos rondas midieron la categoría. */
  diferencia: number | null;
  /** Lectura de la base (umbrales de la versión); solo para rondas consecutivas. */
  etiqueta: EtiquetaDelta | null;
}

export function compararCategorias(a: PuntajeRonda, b: PuntajeRonda, pares: readonly ComparacionIndividuo[] | undefined): CategoriaComparada[] {
  const par = (pares ?? []).find((p) => p.tipo_ronda === 'anual' && p.numero_anterior === a.numero && p.numero_actual === b.numero);
  return CATEGORIAS_SCORING.map((categoria) => {
    const va = a.categorias?.[categoria] ?? null;
    const vb = b.categorias?.[categoria] ?? null;
    const ambas = va !== null && vb !== null;
    return {
      categoria,
      a: va,
      b: vb,
      diferencia: ambas ? redondear(vb - va, 4) : null,
      etiqueta: ambas ? par?.deltas_categoria.find((d) => d.categoria === categoria)?.etiqueta ?? null : null,
    };
  });
}

// --- Selección de rondas ----------------------------------------------------

/**
 * Dos rondas a comparar (la anterior primero). Al elegir una tercera se queda la
 * más cercana a ella: de [1, 2], elegir la 3 da [2, 3]; de [2, 3], elegir la 1 da [1, 2].
 * Elegir una ya seleccionada no cambia nada (siempre hay dos).
 */
export function elegirRonda(seleccion: readonly [number, number], elegida: number): [number, number] {
  if (seleccion.includes(elegida)) return [seleccion[0], seleccion[1]];
  const [x, y] = seleccion;
  const conserva = Math.abs(x - elegida) <= Math.abs(y - elegida) ? x : y;
  return elegida < conserva ? [elegida, conserva] : [conserva, elegida];
}

/** Lee `?rondas=1,2`; si no sirve (o no hay), las dos últimas con evaluación cerrada. */
export function rondasPorDefecto(parametro: string | null, comparables: readonly number[]): [number, number] | null {
  const pedidas = (parametro ?? '').split(',').map(Number);
  if (pedidas.length === 2 && pedidas[0] !== pedidas[1] && pedidas.every((n) => comparables.includes(n))) {
    return pedidas[0] < pedidas[1] ? [pedidas[0], pedidas[1]] : [pedidas[1], pedidas[0]];
  }
  const ordenadas = [...comparables].sort((a, b) => a - b);
  return ordenadas.length >= 2 ? [ordenadas[ordenadas.length - 2], ordenadas[ordenadas.length - 1]] : null;
}

/** Estado de cada descriptor para dibujar la huella: el de la base y, si no llegó, el que se deduce de lo guardado. */
export function estadosEfectivos<C extends string>(
  esquema: EsquemaFase<C>,
  valores: Record<string, unknown>,
  estados: Partial<Record<string, EstadoDescriptor>> | null,
): Partial<Record<string, EstadoDescriptor>> {
  return Object.fromEntries(esquema.campos.filter((c) => c.rol !== 'derivado').map((c) => [c.clave, celdaDe(c, valores, estados).estado]));
}
