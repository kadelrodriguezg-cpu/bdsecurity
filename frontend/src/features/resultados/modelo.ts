/**
 * Lógica pura de Resultados v3 (docs/rediseno_v3/resultados/resultados.md). Una sola tabla: el ranking por grupos en
 * vivo o un ranking congelado, normalizados a `FilaResultado`. Todo en 0–1 con precisión completa: el formato visible
 * vive en `lib/v3/puntaje.ts` (N34). Las categorías y sus pesos vienen de la versión activa (N33), nunca fijas.
 */
import type { RankingPorGrupos, EstadoRanking } from '@/api/rankingGrupos';
import type { SnapshotDetalle, CoberturaSnapshot, ComparacionSnapshotVivo } from '@/api/snapshots';
import type { ComparacionRondasResponse, EtiquetaDelta } from '@/api/comparacion';
import type { DetalleMetrica } from '@/api/scoring';
import type { PesoCategoria } from '@/api/resultados';
import { compararCodigos } from '@/lib/ordenNatural';

export interface Cobertura { con_valor: number; total: number }

export interface FilaResultado {
  individuo_id: string;
  codigo_display: string;
  planta_id: string | null;
  codigo_sistema: string | null;
  evaluacion_id: string | null;
  fecha_evaluacion: string | null;
  numero_ronda: number | null;
  puntaje: number | null;
  grupo: string[];
  posicion: number | null;
  tamano: number | null;
  categorias: Record<string, number | null>;
  cobertura: Record<string, Cobertura>;
  estado: EstadoRanking;
}

export const claveDeGrupo = (categorias: readonly string[]) => [...categorias].join(',');

export function filasDesdeVivo(ranking: RankingPorGrupos): FilaResultado[] {
  return ranking.items.map((i) => ({
    individuo_id: i.individuo_id,
    codigo_display: i.codigo_display,
    planta_id: i.planta_id,
    codigo_sistema: i.codigo_sistema,
    evaluacion_id: i.evaluacion_id,
    fecha_evaluacion: i.fecha_evaluacion,
    numero_ronda: i.numero_ronda,
    puntaje: i.puntaje === null ? null : Number(i.puntaje),
    grupo: [...i.grupo],
    posicion: i.posicion_grupo,
    tamano: i.tamano_grupo,
    categorias: { ...(i.detalle_categorias as Record<string, number | null>) },
    cobertura: { ...(i.cobertura as Record<string, Cobertura>) },
    estado: i.estado_ranking,
  }));
}

/**
 * Un ranking congelado solo guarda los individuos con puesto. Los congelados antes de la Fase 2 no traen el grupo: se
 * toman como un solo grupo con las categorías que tienen valor.
 */
export function filasDesdeCongelado(detalle: SnapshotDetalle, cobertura: CoberturaSnapshot = {}): FilaResultado[] {
  return detalle.resultados.map((r) => {
    const categorias = { ...(r.detalle.categorias as Record<string, number | null> | undefined) };
    const grupo = r.grupo ?? Object.keys(categorias).filter((c) => categorias[c] !== null && categorias[c] !== undefined).sort();
    return {
      individuo_id: r.individuo_id,
      codigo_display: r.codigo_display,
      planta_id: detalle.snapshot.planta_id,
      codigo_sistema: null,
      evaluacion_id: r.evaluacion_id,
      fecha_evaluacion: r.detalle.fecha_evaluacion ?? null,
      numero_ronda: r.detalle.numero_ronda ?? null,
      puntaje: Number(r.puntaje),
      grupo: [...grupo],
      posicion: r.posicion_grupo ?? r.posicion,
      tamano: r.detalle.tamano_grupo ?? null,
      categorias,
      cobertura: { ...((cobertura[r.individuo_id] ?? {}) as Record<string, Cobertura>) },
      estado: 'comparable',
    };
  });
}

/** Quién compite en un grupo: comparable, con o sin puesto todavía (grupo bajo el mínimo). */
export const compite = (f: Pick<FilaResultado, 'estado'>) => f.estado === 'comparable' || f.estado === 'pocas_plantas';

export interface GrupoDisponible { clave: string; categorias: string[]; n: number; conPosicion: boolean }

export function gruposDisponibles(filas: readonly FilaResultado[]): GrupoDisponible[] {
  const mapa = new Map<string, GrupoDisponible>();
  for (const f of filas) {
    if (!compite(f) || f.grupo.length === 0) continue;
    const clave = claveDeGrupo(f.grupo);
    const g = mapa.get(clave) ?? { clave, categorias: [...f.grupo], n: 0, conPosicion: true };
    g.n += 1;
    if (f.posicion === null) g.conPosicion = false;
    mapa.set(clave, g);
  }
  return [...mapa.values()].sort((a, b) => b.categorias.length - a.categorias.length || b.n - a.n || a.clave.localeCompare(b.clave));
}

/**
 * Grupo que se abre por defecto [Provisional]: entre los que ya tienen puestos, el de más categorías (empate: el de más
 * individuos), porque es la comparación más completa. Si ninguno llega al mínimo, el de más individuos.
 */
export function grupoPorDefecto(grupos: readonly GrupoDisponible[]): GrupoDisponible | null {
  const conPuestos = grupos.filter((g) => g.conPosicion);
  if (conPuestos.length > 0) return [...conPuestos].sort((a, b) => b.categorias.length - a.categorias.length || b.n - a.n)[0];
  return [...grupos].sort((a, b) => b.n - a.n || b.categorias.length - a.categorias.length)[0] ?? null;
}

export const filasDelGrupo = (filas: readonly FilaResultado[], clave: string) => filas.filter((f) => compite(f) && claveDeGrupo(f.grupo) === clave);

/** Mediana de los puntajes con puesto del grupo (los excluidos no cuentan). En 0–1. */
export function medianaDelGrupo(filas: readonly FilaResultado[]): number | null {
  const v = filas.filter((f) => f.posicion !== null && f.puntaje !== null).map((f) => f.puntaje as number).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export interface LineaDesglose { categoria: string; valor: number; pesoEfectivo: number; puntos: number }

/**
 * «De dónde salen los N puntos»: el motor promedia las categorías con dato, cada una con su peso, sobre la suma de los
 * pesos de esas categorías (calcular_ranking_nucleo). Por eso el peso que se muestra es el efectivo dentro del grupo;
 * con todas las categorías coincide con el de la versión. La suma de `puntos` da el puntaje.
 */
export function desglose(fila: Pick<FilaResultado, 'grupo' | 'categorias'>, pesos: readonly PesoCategoria[]): LineaDesglose[] {
  const conDato = pesos.filter((p) => fila.grupo.includes(p.categoria) && fila.categorias[p.categoria] !== null && fila.categorias[p.categoria] !== undefined);
  const total = conDato.reduce((s, p) => s + p.peso, 0);
  if (total <= 0) return [];
  return conDato.map((p) => {
    const valor = Number(fila.categorias[p.categoria]);
    const pesoEfectivo = p.peso / total;
    return { categoria: p.categoria, valor, pesoEfectivo, puntos: valor * pesoEfectivo };
  });
}

/**
 * Las categorías de un grupo en orden de presentación: por peso en la versión (la de mayor peso primero), como las columnas. La base
 * entrega el grupo en el orden de su enum; las que la versión no pesa quedan al final, en el orden en que llegaron.
 */
export function ordenarPorPeso(categorias: readonly string[], pesos: readonly PesoCategoria[]): string[] {
  const peso = (c: string) => pesos.find((p) => p.categoria === c)?.peso ?? -1;
  return [...categorias].sort((a, b) => peso(b) - peso(a));
}

/** Peso efectivo de cada categoría dentro de un grupo (encabezados de la tabla). */
export function pesosDelGrupo(categorias: readonly string[], pesos: readonly PesoCategoria[]): PesoCategoria[] {
  const delGrupo = pesos.filter((p) => categorias.includes(p.categoria));
  const total = delGrupo.reduce((s, p) => s + p.peso, 0);
  return total > 0 ? delGrupo.map((p) => ({ categoria: p.categoria, peso: p.peso / total })) : [];
}

export function coberturaBaja(fila: Pick<FilaResultado, 'cobertura'>, categoria: string, umbral: number): boolean {
  const c = fila.cobertura[categoria];
  return c !== undefined && c.total > 0 && c.con_valor / c.total < umbral;
}

export interface Plegado { excluidas: FilaResultado[]; sinPuntaje: FilaResultado[]; otrosGrupos: FilaResultado[] }

export function plegado(filas: readonly FilaResultado[], claveGrupo: string | null): Plegado {
  // G16: lo plegado se lista en orden natural de código (02-001-P2 antes que 02-001-P10).
  const porCodigo = (lista: FilaResultado[]) => lista.sort((a, b) => compararCodigos(a.codigo_display, b.codigo_display));
  return {
    excluidas: porCodigo(filas.filter((f) => f.estado === 'excluida_revision' || f.estado === 'no_comparable')),
    sinPuntaje: porCodigo(filas.filter((f) => ['sin_datos', 'sin_evaluacion', 'sin_ronda', 'sin_version'].includes(f.estado))),
    otrosGrupos: porCodigo(filas.filter((f) => compite(f) && claveDeGrupo(f.grupo) !== claveGrupo)),
  };
}

// --- Cambio -------------------------------------------------------------------

export interface Cambio { delta: number; etiqueta: EtiquetaDelta; referencia: string }

export function etiquetaDe(delta: number, umbrales: { leve: number; marcado: number }): EtiquetaDelta {
  const a = Math.abs(delta);
  if (a < umbrales.leve) return 'estable';
  if (delta > 0) return a >= umbrales.marcado ? 'mejoro_marcado' : 'mejoro_leve';
  return a >= umbrales.marcado ? 'empeoro_marcado' : 'empeoro_leve';
}

const promedioPonderado = (valores: Record<string, number | null>, pesos: readonly PesoCategoria[]) => {
  let suma = 0;
  let total = 0;
  for (const p of pesos) {
    const v = valores[p.categoria];
    if (v === null || v === undefined) continue;
    suma += Number(v) * p.peso;
    total += p.peso;
  }
  return total > 0 ? suma / total : null;
};

/**
 * Cambio de puntaje vs. la ronda anterior (anual). `obtener_comparacion_rondas` devuelve los deltas por categoría,
 * calculados con UNA versión (la vigente) para las dos rondas; el puntaje de cada ronda se arma con la misma fórmula
 * del motor (promedio ponderado de las categorías con dato) y la etiqueta con los umbrales de la versión.
 */
export function cambiosDesdeComparacion(resp: ComparacionRondasResponse, pesos: readonly PesoCategoria[], numeroActual?: number | null): Map<string, Cambio> {
  const umbrales = resp.umbrales ?? { leve: 0.05, marcado: 0.15 };
  const mapa = new Map<string, Cambio>();
  for (const ind of resp.individuos) {
    if (ind.tipo_ronda !== 'anual') continue;
    // Con una temporada elegida, el par que termina en ella (N vs. N−1); sin ella, el más reciente de cada individuo.
    if (numeroActual && ind.numero_actual !== numeroActual) continue;
    const anterior: Record<string, number | null> = {};
    const actual: Record<string, number | null> = {};
    for (const d of ind.deltas_categoria) {
      anterior[d.categoria] = d.valor_anterior;
      actual[d.categoria] = d.valor_actual;
    }
    const a = promedioPonderado(anterior, pesos);
    const b = promedioPonderado(actual, pesos);
    if (a === null || b === null) continue;
    const previo = mapa.get(ind.individuo_id);
    // Una fila por par de rondas consecutivas: se queda el par más reciente.
    if (previo && Number(previo.referencia) > ind.numero_anterior) continue;
    mapa.set(ind.individuo_id, { delta: b - a, etiqueta: etiquetaDe(b - a, umbrales), referencia: String(ind.numero_anterior) });
  }
  return mapa;
}

/**
 * Por qué un individuo no tiene cambio (nunca se muestra como «0,0 · Estable»): no tiene la ronda anterior, o la tiene
 * pero sin categorías comparables con la actual.
 */
export function motivoSinCambio(individuoId: string, resp: ComparacionRondasResponse | undefined, numeroActual?: number | null): string {
  const tienePar = resp?.individuos.some((i) => i.individuo_id === individuoId && i.tipo_ronda === 'anual' && (!numeroActual || i.numero_actual === numeroActual));
  return tienePar ? 'Sin datos comparables' : 'Sin ronda anterior';
}

// --- Temporadas (N38) ------------------------------------------------------------

export interface Temporada { numero: number; individuos: number; conCerrada: number; cerrada: boolean }

/**
 * [Provisional, N38] «Temporada cerrada» por R5 (una ronda abre una temporada): la temporada N está cerrada cuando en
 * la especie ya se abrió la N+1. La ronda por defecto es la última cerrada que tenga al menos una evaluación cerrada;
 * si no hay ninguna, null (se muestra «la última de cada individuo», con su advertencia).
 */
export function temporadas(rondas: ReadonlyArray<{ numero: number; individuos: number; con_cerrada: number }> | undefined): { lista: Temporada[]; porDefecto: number | null } {
  const conIndividuos = (rondas ?? []).filter((r) => r.individuos > 0);
  const maxima = Math.max(0, ...conIndividuos.map((r) => r.numero));
  const lista = conIndividuos.map((r) => ({ numero: r.numero, individuos: r.individuos, conCerrada: r.con_cerrada, cerrada: r.numero < maxima })).sort((a, b) => b.numero - a.numero);
  const porDefecto = lista.find((t) => t.cerrada && t.conCerrada > 0)?.numero ?? null;
  return { lista, porDefecto };
}

/** [Provisional] «Congelado vs. en vivo»: cambio del puntaje en vivo respecto del congelado (comparar_snapshot_vivo). */
export function cambiosDesdeCongelado(resp: ComparacionSnapshotVivo): Map<string, Cambio> {
  const mapa = new Map<string, Cambio>();
  for (const i of resp.individuos) {
    if (i.puntaje_snapshot === null || i.puntaje_vivo === null) continue;
    const delta = Number(i.puntaje_vivo) - Number(i.puntaje_snapshot);
    mapa.set(i.individuo_id, { delta, etiqueta: etiquetaDe(delta, resp.umbrales), referencia: 'vivo' });
  }
  return mapa;
}

// --- Columnas agregadas y filtros ----------------------------------------------

export type ValoresMetricas = Record<string, Record<string, DetalleMetrica>>;
export interface FiltroColumna { metrica: string; op: 'ge' | 'le'; valor: number }

/** Fase 5 (G8, EF24): «Tardías (enero o después)» = precocidad 1 o 2 (Tardía, ene · Muy tardía, feb o más). No cambia el puntaje. */
export const FILTRO_TARDIAS: FiltroColumna = { metrica: 'precocidad', op: 'le', valor: 2 };

/** Los filtros de columnas más el de tardías, si está activo. */
export function filtrosEfectivos(estado: Pick<EstadoUrl, 'filtros' | 'tardias'>): FiltroColumna[] {
  return estado.tardias ? [...estado.filtros, FILTRO_TARDIAS] : [...estado.filtros];
}

export const valorMetrica = (valores: ValoresMetricas | undefined, individuoId: string, metrica: string): number | null => {
  const v = valores?.[individuoId]?.[metrica]?.valor;
  return v === null || v === undefined ? null : Number(v);
};

export function aplicarFiltros<T extends Pick<FilaResultado, 'individuo_id'>>(filas: readonly T[], valores: ValoresMetricas | undefined, filtros: readonly FiltroColumna[]): T[] {
  if (filtros.length === 0) return [...filas];
  return filas.filter((f) => filtros.every((flt) => {
    const v = valorMetrica(valores, f.individuo_id, flt.metrica);
    return v !== null && (flt.op === 'ge' ? v >= flt.valor : v <= flt.valor);
  }));
}

// --- Orden ---------------------------------------------------------------------

export type ColumnaOrden = 'puesto' | 'puntaje' | 'cambio' | `cat:${string}` | `met:${string}`;
export interface Orden { columna: ColumnaOrden; dir: 'asc' | 'desc' }
export const ORDEN_INICIAL: Orden = { columna: 'puesto', dir: 'asc' };

/** Ordena con la precisión completa; los vacíos siempre al final. Desempate estable por puesto y código. */
export function ordenar(filas: readonly FilaResultado[], orden: Orden, extra: { valores?: ValoresMetricas; cambios?: Map<string, Cambio> } = {}): FilaResultado[] {
  const valor = (f: FilaResultado): number | null => {
    if (orden.columna === 'puesto') return f.posicion;
    if (orden.columna === 'puntaje') return f.puntaje;
    if (orden.columna === 'cambio') return extra.cambios?.get(f.individuo_id)?.delta ?? null;
    if (orden.columna.startsWith('cat:')) { const v = f.categorias[orden.columna.slice(4)]; return v === null || v === undefined ? null : Number(v); }
    return valorMetrica(extra.valores, f.individuo_id, orden.columna.slice(4));
  };
  const signo = orden.dir === 'asc' ? 1 : -1;
  return [...filas].sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) return (va - vb) * signo;
    return (a.posicion ?? Infinity) - (b.posicion ?? Infinity) || (b.puntaje ?? -1) - (a.puntaje ?? -1) || compararCodigos(a.codigo_display, b.codigo_display);
  });
}

// --- Estado en la URL ------------------------------------------------------------

export interface EstadoUrl {
  especie: string;
  cruce: string;
  congelado: string;
  grupo: string;
  columnas: string[];
  filtros: FiltroColumna[];
  cambio: boolean;
  cinco: boolean;
  /** Fase 5 (G8): solo las tardías (precocidad 1 o 2). */
  tardias: boolean;
  /** '' = la temporada por defecto (la última cerrada), 'ultima' = la última de cada individuo, o un número. */
  ronda: string;
  orden: Orden;
  individuo: string;
}

const COLUMNAS_ORDEN = /^(puesto|puntaje|cambio|cat:[a-z_]+|met:[a-z_0-9]+)$/;

export function leerEstado(p: URLSearchParams): EstadoUrl {
  const ordenTexto = p.get('orden') ?? '';
  const corte = ordenTexto.lastIndexOf(':');
  const col = corte > 0 ? ordenTexto.slice(0, corte) : '';
  const dir = corte > 0 ? ordenTexto.slice(corte + 1) : '';
  const ordenValida = COLUMNAS_ORDEN.test(col ?? '') && (dir === 'asc' || dir === 'desc');
  const filtros = (p.get('f') ?? '').split(',').filter(Boolean).map((t) => {
    const [metrica, op, valor] = t.split(':');
    return { metrica, op: op === 'le' ? 'le' : 'ge', valor: Number(valor) } as FiltroColumna;
  }).filter((f) => f.metrica && Number.isFinite(f.valor));
  return {
    especie: p.get('especie') ?? '',
    cruce: p.get('cruce') ?? '',
    congelado: p.get('congelado') ?? '',
    grupo: p.get('grupo') ?? '',
    columnas: [...new Set((p.get('cols') ?? '').split(',').filter(Boolean))],
    filtros,
    cambio: p.get('cambio') === '1',
    cinco: p.get('cinco') === '1',
    tardias: p.get('tardias') === '1',
    ronda: /^(ultima|[1-9][0-9]*)$/.test(p.get('ronda') ?? '') ? (p.get('ronda') as string) : '',
    orden: ordenValida ? { columna: col as ColumnaOrden, dir: dir as 'asc' | 'desc' } : ORDEN_INICIAL,
    individuo: p.get('individuo') ?? '',
  };
}

export function escribirEstado(p: URLSearchParams, cambios: Partial<EstadoUrl>): URLSearchParams {
  const next = new URLSearchParams(p);
  const fijar = (clave: string, valor: string | null) => (valor ? next.set(clave, valor) : next.delete(clave));
  if ('especie' in cambios) fijar('especie', cambios.especie ?? '');
  if ('cruce' in cambios) fijar('cruce', cambios.cruce ?? '');
  if ('congelado' in cambios) fijar('congelado', cambios.congelado ?? '');
  if ('grupo' in cambios) fijar('grupo', cambios.grupo ?? '');
  if ('columnas' in cambios) fijar('cols', (cambios.columnas ?? []).join(','));
  if ('filtros' in cambios) fijar('f', (cambios.filtros ?? []).map((f) => `${f.metrica}:${f.op}:${f.valor}`).join(','));
  if ('cambio' in cambios) fijar('cambio', cambios.cambio ? '1' : '');
  if ('cinco' in cambios) fijar('cinco', cambios.cinco ? '1' : '');
  if ('tardias' in cambios) fijar('tardias', cambios.tardias ? '1' : '');
  if ('ronda' in cambios) fijar('ronda', cambios.ronda ?? '');
  if ('orden' in cambios) {
    const o = cambios.orden ?? ORDEN_INICIAL;
    fijar('orden', o.columna === ORDEN_INICIAL.columna && o.dir === ORDEN_INICIAL.dir ? '' : `${o.columna}:${o.dir}`);
  }
  if ('individuo' in cambios) fijar('individuo', cambios.individuo ?? '');
  return next;
}

/**
 * URL equivalente en Resultados para los enlaces viejos de `/ranking` (con `?tab=`, `g_col`/`g_dir`, `p_*`) (N21).
 * Devuelve la ruta completa.
 */
export function rutaDesdeRankingViejo(p: URLSearchParams): string {
  const tab = p.get('tab') ?? 'general';
  const especie = p.get('especie') ?? '';
  if (tab === 'polinizacion-varietal') return `/resultados/polinizacion${especie ? `?especie=${encodeURIComponent(especie)}` : ''}`;
  const destino = new URLSearchParams();
  if (especie) destino.set('especie', especie);
  if (p.get('cruce')) destino.set('cruce', p.get('cruce') as string);
  const gCol = p.get('g_col');
  const gDir = p.get('g_dir');
  if (gCol && (gDir === 'asc' || gDir === 'desc')) destino.set('orden', `${gCol === 'global' ? 'puntaje' : `cat:${gCol}`}:${gDir}`);
  if (tab === 'parametro') {
    const metricas = (p.get('p_metricas') ?? '').split(',').filter(Boolean);
    const filtro = p.get('p_filtro');
    const valor = p.get('p_valor');
    const columnas = [...new Set([...metricas, ...(filtro ? [filtro] : [])])];
    if (columnas.length) destino.set('cols', columnas.join(','));
    if (filtro && valor && Number.isFinite(Number(valor))) destino.set('f', `${filtro}:${p.get('p_op') === '<=' ? 'le' : 'ge'}:${Number(valor)}`);
    const pCol = p.get('p_col');
    const pDir = p.get('p_dir');
    if (pCol && (pDir === 'asc' || pDir === 'desc')) destino.set('orden', `${pCol === 'puntaje' || pCol === 'global' ? 'puntaje' : `met:${pCol}`}:${pDir}`);
    if (p.get('p_vista') === 'grafico') destino.set('cinco', '1');
  }
  if (tab === 'comparacion') destino.set('cambio', '1');
  if (tab === 'snapshots') destino.set('congelado', 'elegir');
  const q = destino.toString();
  return `/resultados${q ? `?${q}` : ''}`;
}
