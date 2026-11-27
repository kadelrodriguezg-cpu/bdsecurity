/** Formato compartido de puntajes, deltas y etiquetas del bloque de ranking. */
import { Badge } from '@/components/ui/badge';
import { ETIQUETA_DELTA_LABEL, type EtiquetaDelta } from '@/api/comparacion';
import { CATEGORIA_LABEL, CATEGORIAS_BASE, CATEGORIAS_SCORING, ordenarGrupo, type CategoriaScoring } from '@/api/scoring';
import { formatearCambio, formatearPuntos } from '@/lib/v3/puntaje';

/**
 * Puntaje visible (N34): delega en el único formato compartido, `lib/v3/puntaje.ts` (0–100, un decimal, coma).
 * Se conserva el nombre para las pantallas que ya lo usaban.
 */
export function formatearPuntaje(valor: number | null | undefined): string {
  return formatearPuntos(valor);
}

/** Igual que `formatearPuntaje` (el recorte a 0–1 lo hace el formato compartido). `_decimales` se ignora desde N34. */
export function formatearPuntaje01(valor: number | null | undefined, _decimales?: number): string {
  return formatearPuntos(valor);
}

/** Valores crudos de métricas: enteros sin decorar, decimales a 2 cifras. */
export function formatearValor(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  const n = Number(valor);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Nombre corto de cada categoría para mostrar el grupo de un individuo en una celda o una etiqueta. */
export const CATEGORIA_CORTA: Record<CategoriaScoring, string> = {
  fruto_calidad: 'Fruto',
  produccion: 'Producción',
  fenologia: 'Fenología',
  brotes: 'Brotes',
  estres: 'Estrés',
};

/** Abreviatura para celular (390 px), donde el grupo completo no cabe en una pestaña. */
export const CATEGORIA_ABREV: Record<CategoriaScoring, string> = {
  fruto_calidad: 'Fruto',
  produccion: 'Prod.',
  fenologia: 'Fen.',
  brotes: 'Brot.',
  estres: 'Estrés',
};

/**
 * Categorías con columna en una tabla de ranking, en orden de presentación: las de siempre y, además, las nuevas (`brotes`) solo si
 * alguna fila las midió o las tiene en su cobertura. Con la versión de 4 categorías activa no aparece una columna siempre vacía.
 */
export function categoriasConColumna(
  items: readonly { grupo?: readonly string[]; cobertura?: Partial<Record<string, unknown>> | null; detalle_categorias?: Partial<Record<string, number | null>> | null }[],
): CategoriaScoring[] {
  return CATEGORIAS_SCORING.filter((c) => CATEGORIAS_BASE.includes(c)
    || items.some((i) => i.grupo?.includes(c) || i.cobertura?.[c] !== undefined || (i.detalle_categorias?.[c] ?? null) !== null));
}

/** Grupo de comparación en compacto: «Fruto · Fenología». El nombre completo queda en el title. */
export function GrupoEtiqueta({ categorias }: { categorias: readonly CategoriaScoring[] }) {
  const ordenadas = ordenarGrupo(categorias);
  return (
    <span title={ordenadas.map((c) => CATEGORIA_LABEL[c] ?? c).join(' · ')}>
      {ordenadas.map((c) => CATEGORIA_CORTA[c] ?? c).join(' · ')}
    </span>
  );
}

export function CoberturaCategorias({
  detalle,
}: {
  detalle: Partial<Record<CategoriaScoring, number | null>> | null | undefined;
}) {
  if (!detalle) return null;
  const medidas = CATEGORIAS_SCORING.filter(
    (categoria) => detalle[categoria] !== null && detalle[categoria] !== undefined,
  ).length;
  const posibles = categoriasConColumna([{ detalle_categorias: detalle }]).length;
  return (
    <Badge variant="outline" title="Categorías con datos usadas para calcular este puntaje">
      {medidas} de {posibles} categorías
    </Badge>
  );
}

export function DatoAusente({ tipo }: { tipo: 'no_medido' | 'no_aplica' | 'sin_ronda' }) {
  const texto = tipo === 'no_medido' ? 'No medido' : tipo === 'no_aplica' ? 'No aplica' : 'Sin ronda todavía';
  return <span className="text-xs text-ink-3">{texto}</span>;
}

/** Cambio de puntaje con signo, en puntos (N34: «+8,1» / «−7,5»). Delega en el formato compartido. */
export function formatearDelta(delta: number | null | undefined): string {
  return formatearCambio(delta);
}

const VARIANTE_ETIQUETA: Record<EtiquetaDelta, 'outline' | 'success' | 'warning' | 'danger'> = {
  estable: 'outline',
  mejoro_leve: 'success',
  mejoro_marcado: 'success',
  empeoro_leve: 'warning',
  empeoro_marcado: 'danger',
};

export function EtiquetaDeltaChip({ etiqueta }: { etiqueta: EtiquetaDelta | null }) {
  if (!etiqueta) return <span className="text-ink-3">—</span>;
  return <Badge variant={VARIANTE_ETIQUETA[etiqueta]}>{ETIQUETA_DELTA_LABEL[etiqueta]}</Badge>;
}

/**
 * Badges de fuera de rango (2.1: señal visual, nunca bloqueo). "destacado" =
 * sobre el máximo esperado; "bajo" = bajo el mínimo. Cuando la métrica no
 * tiene rango_referencia la bandera viene NULL y no se muestra nada.
 */
export function BadgeFueraRango({
  superior,
  inferior,
  metricaLabel,
}: {
  superior: boolean | null | undefined;
  inferior: boolean | null | undefined;
  metricaLabel?: string;
}) {
  if (superior === true) {
    return (
      <Badge variant="success" title={`${metricaLabel ?? 'Valor'} sobre el máximo esperado del rango de referencia`}>
        destacado
      </Badge>
    );
  }
  if (inferior === true) {
    return (
      <Badge variant="warning" title={`${metricaLabel ?? 'Valor'} bajo el mínimo esperado del rango de referencia`}>
        bajo
      </Badge>
    );
  }
  return null;
}
