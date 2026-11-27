/**
 * [Provisional] Reemplazo del gráfico de los 5 mejores de Ranking Parámetro (resultados.md lo dejaba «sin resolver»):
 * un panel opcional sobre la tabla, que se abre con «Ver los 5 mejores», con los cinco primeros según la columna por la
 * que está ordenada la tabla (puntaje, una categoría o un descriptor agregado), en barras horizontales.
 */
import { etiquetaCategoria, etiquetaMetrica } from '@/api/resultados';
import { formatearCategoria, formatearPuntos } from '@/lib/v3/puntaje';
import { formatearDescriptor } from './piezas';
import { valorMetrica, type Orden, type FilaResultado, type ValoresMetricas } from './modelo';

export function CincoMejores({ filas, orden, valores }: { filas: readonly FilaResultado[]; orden: Orden; valores: ValoresMetricas | undefined }) {
  const columna = orden.columna === 'puesto' || orden.columna === 'cambio' ? 'puntaje' : orden.columna;
  const leer = (f: FilaResultado): number | null => {
    if (columna === 'puntaje') return f.puntaje;
    if (columna.startsWith('cat:')) return f.categorias[columna.slice(4)] ?? null;
    return valorMetrica(valores, f.individuo_id, columna.slice(4));
  };
  const titulo = columna === 'puntaje' ? 'puntaje' : columna.startsWith('cat:') ? etiquetaCategoria(columna.slice(4)) : etiquetaMetrica(columna.slice(4));
  const texto = (v: number) => (columna === 'puntaje' ? formatearPuntos(v) : columna.startsWith('cat:') ? formatearCategoria(v) : formatearDescriptor(v));
  const top = filas.map((f) => ({ f, v: leer(f) })).filter((x): x is { f: FilaResultado; v: number } => x.v !== null).slice(0, 5);
  const max = Math.max(0, ...top.map((x) => x.v));
  return (
    <section aria-label="Los 5 mejores" className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-body font-semibold text-ink">Los 5 mejores en {titulo} <span className="font-normal text-ink-3">(según el orden de la tabla)</span></h2>
      {top.length === 0 ? <p className="text-small text-ink-3">Sin valores para mostrar.</p> : (
        <ol className="space-y-1.5">
          {top.map(({ f, v }) => (
            <li key={f.individuo_id} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2 text-small">
              <span className="truncate font-mono text-ink">{f.codigo_display}</span>
              <span aria-hidden="true" className="h-2 rounded-full bg-track"><span className="block h-2 rounded-full bg-primary" style={{ width: `${max > 0 ? (v / max) * 100 : 0}%` }} /></span>
              <span className="text-right tabular-nums text-ink">{texto(v)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
