/**
 * Tabla de Resultados (escritorio): Puesto · Individuo · Puntaje (con la raya de la mediana) · una columna por categoría
 * del grupo, en orden de peso (los pesos no se muestran aquí: van en «Cómo se calcula», solo para el admin) · columnas agregadas · Cambio. La fila elegida se resalta y
 * su detalle va al panel lateral.
 */
import { ArrowDown, ArrowUp } from 'lucide-react';
import { etiquetaCategoria, etiquetaMetrica, type PesoCategoria } from '@/api/resultados';
import { formatearCategoria, formatearPuntos } from '@/lib/v3/puntaje';
import { etiquetaAnio, textoEmpate } from '@/lib/etiquetas';
import { cn } from '@/lib/utils';
import { BarraCategoria, BarraPuntaje, ChipCambio, formatearDescriptor, PuntoCobertura } from './piezas';
import { coberturaBaja, valorMetrica, type Cambio, type ColumnaOrden, type FilaResultado, type Orden, type ValoresMetricas } from './modelo';

function Encabezado({ columna, orden, onOrden, children, className }: {
  columna: ColumnaOrden;
  orden: Orden;
  onOrden: (o: Orden) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const activa = orden.columna === columna;
  // Primer toque: lo mejor arriba (puesto ascendente; el resto descendente).
  const siguiente: Orden = activa ? { columna, dir: orden.dir === 'asc' ? 'desc' : 'asc' } : { columna, dir: columna === 'puesto' ? 'asc' : 'desc' };
  return (
    <th scope="col" aria-sort={activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-2 py-2 text-left align-bottom font-medium', className)}>
      <button type="button" onClick={() => onOrden(siguiente)} className="inline-flex items-end gap-1 rounded text-left text-small text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span>{children}</span>
        {activa && (orden.dir === 'asc' ? <ArrowUp className="mb-0.5 h-3 w-3" aria-hidden="true" /> : <ArrowDown className="mb-0.5 h-3 w-3" aria-hidden="true" />)}
      </button>
    </th>
  );
}

export function TablaResultados({ filas, pesosGrupo, columnas, valores, cambios, sinCambio, tituloCambio, mediana, umbralCobertura, seleccion, onSeleccion, orden, onOrden, empates }: {
  filas: readonly FilaResultado[];
  pesosGrupo: readonly PesoCategoria[];
  columnas: readonly string[];
  valores: ValoresMetricas | undefined;
  cambios: Map<string, Cambio> | undefined;
  /** Motivo cuando un individuo no tiene cambio calculable. */
  sinCambio?: (individuoId: string) => string;
  tituloCambio: string;
  mediana: number | null;
  umbralCobertura: number;
  seleccion: string;
  onSeleccion: (individuoId: string) => void;
  orden: Orden;
  onOrden: (o: Orden) => void;
  /** G19: con cuántos otros comparte el puesto cada individuo (solo los que empatan). */
  empates?: Map<string, number>;
}) {
  return (
    <table className="w-full min-w-[820px] text-small">
      <thead className="border-b border-line">
        <tr>
          <Encabezado columna="puesto" orden={orden} onOrden={onOrden} className="w-24 pl-4">Puesto</Encabezado>
          <th scope="col" className="px-2 py-2 text-left align-bottom text-small font-medium text-ink-2">Individuo</th>
          <Encabezado columna="puntaje" orden={orden} onOrden={onOrden} className="w-44">Puntaje</Encabezado>
          {pesosGrupo.map((p) => (
            <Encabezado key={p.categoria} columna={`cat:${p.categoria}`} orden={orden} onOrden={onOrden} className="w-24">
              <span className="block">{etiquetaCategoria(p.categoria)}</span>
            </Encabezado>
          ))}
          {columnas.map((m) => (
            <Encabezado key={m} columna={`met:${m}`} orden={orden} onOrden={onOrden}>
              <span className="rounded bg-brand-l px-1.5 py-0.5 text-brand-ink">{etiquetaMetrica(m)}</span>
            </Encabezado>
          ))}
          {cambios && <Encabezado columna="cambio" orden={orden} onOrden={onOrden} className="pr-4">{tituloCambio}</Encabezado>}
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => {
          const elegida = f.individuo_id === seleccion;
          return (
            <tr
              key={f.individuo_id}
              aria-selected={elegida}
              onClick={() => onSeleccion(f.individuo_id)}
              className={cn('cursor-pointer border-b border-line-soft last:border-0 hover:bg-surface-2', elegida && 'bg-brand-l hover:bg-brand-l')}
            >
              <td className="py-3 pl-4 pr-2 tabular-nums">
                {f.posicion !== null ? <><span className="text-body font-semibold text-ink">{f.posicion}</span><span className="text-ink-3"> de {f.tamano}</span></> : <span className="text-ink-3">sin puesto</span>}
                {textoEmpate(empates?.get(f.individuo_id)) && <span className="block whitespace-nowrap text-micro text-ink-3">{' '}· {textoEmpate(empates?.get(f.individuo_id))}</span>}
              </td>
              <td className="px-2 py-3">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSeleccion(f.individuo_id); }}
                  className="rounded font-mono font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {f.codigo_display}
                </button>
              </td>
              <td className="px-2 py-3">
                <span className="block text-body-l font-semibold tabular-nums text-ink">
                  {formatearPuntos(f.puntaje)}
                  {etiquetaAnio(f.numero_ronda) && <span className="ml-2 text-small font-normal text-ink-3">{etiquetaAnio(f.numero_ronda)}</span>}
                </span>
                <BarraPuntaje valor={f.puntaje} mediana={mediana} className="mt-1.5" />
              </td>
              {pesosGrupo.map((p) => (
                <td key={p.categoria} className="px-2 py-3 tabular-nums text-ink">
                  {formatearCategoria(f.categorias[p.categoria])}
                  {coberturaBaja(f, p.categoria, umbralCobertura) && <PuntoCobertura />}
                  <BarraCategoria valor={f.categorias[p.categoria] ?? null} />
                </td>
              ))}
              {columnas.map((m) => <td key={m} className="px-2 py-3 tabular-nums text-ink">{formatearDescriptor(valorMetrica(valores, f.individuo_id, m))}</td>)}
              {cambios && <td className="px-2 py-3 pr-4"><ChipCambio cambio={cambios.get(f.individuo_id)} sinCambio={sinCambio?.(f.individuo_id)} /></td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
