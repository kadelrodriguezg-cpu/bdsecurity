/**
 * Piezas visuales del ranking por grupos (Fase 2, S2-4; referencia
 * docs/diseno/v2/03 adaptada a las decisiones de Kadel del 22-10-2026):
 * una tabla por grupo en escritorio y una lista de tarjetas en celular, con
 * puesto (empates «3=»), puntaje 0–1 y una columna por categoría del motor
 * con su cobertura. No calcula nada: muestra lo que devuelve la RPC.
 */
import { ArrowDown, ArrowUp, ArrowUpDown, TriangleAlert } from 'lucide-react';
import { CATEGORIA_LABEL, ordenarGrupo, type CategoriaScoring } from '@/api/scoring';
import type { ItemRankingGrupos } from '@/api/rankingGrupos';
import { DataTableFrame } from '@/components/ui/data-table-frame';
import { Select } from '@/components/ui/select';
import type { OrdenColumna } from '@/lib/ordenColumnas';
import { cn } from '@/lib/utils';
import { Paginacion } from '@/components/shared/Paginacion';
import { usePaginacionUrl } from '@/lib/usePaginacionUrl';
import { CATEGORIA_ABREV, CATEGORIA_CORTA, categoriasConColumna, formatearPuntaje01 } from './formato';

export type ColumnaOrdenable = 'global' | CategoriaScoring;
export type OrdenRanking = OrdenColumna<ColumnaOrdenable> | null;

/** Cuántos individuos del grupo comparten cada puesto (empates: mismo puntaje publicado). */
export function cuentaPorPosicion(filas: readonly Pick<ItemRankingGrupos, 'posicion_grupo'>[]) {
  const cuenta = new Map<number, number>();
  for (const f of filas) if (f.posicion_grupo !== null) cuenta.set(f.posicion_grupo, (cuenta.get(f.posicion_grupo) ?? 0) + 1);
  return cuenta;
}

/** Cobertura de la categoría bajo el umbral de advertencia (decisión: < 50 %). */
export function coberturaBaja(item: Pick<ItemRankingGrupos, 'cobertura'>, categoria: CategoriaScoring, umbral: number): boolean {
  const cob = item.cobertura?.[categoria];
  return cob !== undefined && cob.total > 0 && cob.con_valor / cob.total < umbral;
}

/** «Fruto · Producción · Fenología · Estrés» (orden por peso), con la versión de celular y el nombre completo accesible. */
export function EtiquetaGrupo({ categorias }: { categorias: readonly CategoriaScoring[] }) {
  const ordenadas = ordenarGrupo(categorias);
  return (
    <>
      <span className="max-sm:hidden">{ordenadas.map((c) => CATEGORIA_CORTA[c]).join(' · ')}</span>
      <span className="sm:hidden">{ordenadas.map((c) => CATEGORIA_ABREV[c]).join(' · ')}</span>
    </>
  );
}

export const nombreGrupoCompleto = (categorias: readonly CategoriaScoring[]) => ordenarGrupo(categorias).map((c) => CATEGORIA_LABEL[c]).join(' · ');

function Puesto({ item, empatado }: { item: ItemRankingGrupos; empatado: boolean }) {
  if (item.posicion_grupo === null) return <span className="text-xs text-ink-3">Sin puesto</span>;
  return (
    <span className="whitespace-nowrap" title={empatado ? 'Mismo puntaje: comparten el puesto' : undefined}>
      <span className="tabular-nums text-ink">{item.posicion_grupo}{empatado && <span aria-hidden="true">=</span>}</span>
      {empatado && <span className="sr-only"> (empate)</span>}
      <span className="text-xs text-ink-3">{' '}de {item.tamano_grupo}</span>
    </span>
  );
}

/** Valor de una categoría con su cobertura debajo; ámbar y con texto si está bajo el umbral. */
function ValorCategoria({ item, categoria, umbral, compacto = false }: { item: ItemRankingGrupos; categoria: CategoriaScoring; umbral: number; compacto?: boolean }) {
  const valor = item.grupo.includes(categoria) ? item.detalle_categorias?.[categoria] : null;
  if (valor === null || valor === undefined) {
    return <span className="text-ink-3" title="Categoría sin ningún descriptor con valor; no es un cero">—<span className="sr-only">No medido</span></span>;
  }
  const cob = item.cobertura?.[categoria];
  const baja = coberturaBaja(item, categoria, umbral);
  return (
    <span className="block">
      <span className="tabular-nums">{formatearPuntaje01(valor)}</span>
      {cob && (
        <span className={cn('mt-0.5 flex items-start gap-1 text-xs tabular-nums', baja ? 'text-warn' : 'text-ink-3')}>
          {baja && <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />}
          <span>{baja && !compacto ? 'Cobertura baja · ' : ''}{cob.con_valor} de {cob.total}</span>
        </span>
      )}
    </span>
  );
}

function ChipPrueba({ item }: { item: ItemRankingGrupos }) {
  return item.es_prueba ? <span className="ml-2 rounded-full bg-neutral-l px-2 py-0.5 text-xs text-ink-2">prueba</span> : null;
}

function EncabezadoOrdenable({ etiqueta, activo, onClick, className, fijo }: {
  etiqueta: string; activo: OrdenColumna<ColumnaOrdenable> | null; onClick: () => void; className?: string; fijo?: boolean;
}) {
  if (fijo) return <th className={cn('py-2 pr-3 font-medium', className)}>{etiqueta}</th>;
  const Icono = activo === null ? ArrowUpDown : activo.direccion === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={cn('py-1 pr-3 font-medium', className)} aria-sort={activo === null ? 'none' : activo.direccion === 'asc' ? 'ascending' : 'descending'}>
      <button
        type="button"
        onClick={onClick}
        className={cn('inline-flex min-h-[44px] min-w-[44px] items-center gap-1 rounded px-1 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', activo && 'text-brand')}
      >
        {etiqueta}
        <Icono className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </th>
  );
}

interface PropsPanel {
  filas: ItemRankingGrupos[];
  /** G18: parámetro de la URL con la página de esta tabla (paginación numerada de 50 o 100 filas). */
  paramPagina?: string;
  orden: OrdenRanking;
  onAlternarOrden: (columna: ColumnaOrdenable) => void;
  onOrden: (orden: OrdenRanking) => void;
  umbral: number;
  /** Con alcance de especie los individuos son de varios cruces: se muestra el cruce. */
  mostrarCruce: boolean;
  label: string;
  /** Sin orden por columna (resultados congelados): los encabezados no son botones. */
  sinOrden?: boolean;
}

/** Umbral de cobertura baja por defecto (decisión de Kadel: < 50 %); el vivo lo trae de `configuracion_ranking`, el snapshot no lo guarda. */
export const COBERTURA_ADVERTENCIA_DEFECTO = 0.5;

/** G18: el pie de paginación numerada de una tabla del ranking; nada si cabe en una página. */
export function PieRanking({ estado }: { estado: Parameters<typeof Paginacion>[0]['estado'] }) {
  return estado.total > 1 ? <Paginacion estado={estado} /> : null;
}

/** Ordenar en celular, donde no hay encabezados de columna. */
function OrdenCelular({ categorias, orden, onOrden }: { categorias: readonly CategoriaScoring[]; orden: OrdenRanking; onOrden: (orden: OrdenRanking) => void }) {
  const valor = orden ? `${orden.columna}:${orden.direccion}` : '';
  const opciones: Array<{ columna: ColumnaOrdenable; etiqueta: string }> = [
    { columna: 'global', etiqueta: 'Puntaje' },
    ...ordenarGrupo(categorias).map((c) => ({ columna: c as ColumnaOrdenable, etiqueta: CATEGORIA_LABEL[c] })),
  ];
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2 md:hidden">
      <span className="shrink-0">Ordenar por</span>
      <Select
        value={valor}
        onChange={(event) => {
          const [columna, direccion] = event.target.value.split(':');
          onOrden(columna ? { columna: columna as ColumnaOrdenable, direccion: direccion as 'asc' | 'desc' } : null);
        }}
      >
        <option value="">Puesto en el grupo</option>
        {opciones.flatMap(({ columna, etiqueta }) => [
          <option key={`${columna}:desc`} value={`${columna}:desc`}>{etiqueta}, mayor primero</option>,
          <option key={`${columna}:asc`} value={`${columna}:asc`}>{etiqueta}, menor primero</option>,
        ])}
      </Select>
    </label>
  );
}

export function PanelGrupo({ categorias, ...p }: PropsPanel & { categorias: CategoriaScoring[] }) {
  const porPosicion = cuentaPorPosicion(p.filas);
  // G18: la página vive en la URL; cambiar de grupo o de orden vuelve a la primera.
  const paginacion = usePaginacionUrl(p.filas, { param: p.paramPagina ?? 'pag', reinicio: [p.label, p.orden?.columna, p.orden?.direccion] });
  const visibles = paginacion.pagina;
  // Las columnas salen de los datos: `brotes` solo aparece si algún individuo de la tabla la midió.
  const columnas = categoriasConColumna(p.filas);
  const empatado = (item: ItemRankingGrupos) => item.posicion_grupo !== null && (porPosicion.get(item.posicion_grupo) ?? 0) > 1;
  const columnaActiva = (c: ColumnaOrdenable) => (p.orden?.columna === c ? p.orden : null);

  return (
    <div className="space-y-3">
      {!p.sinOrden && <OrdenCelular categorias={categorias} orden={p.orden} onOrden={p.onOrden} />}

      {/* Escritorio: tabla con una columna por categoría del motor; las que el grupo no midió quedan en «—». */}
      <div className="hidden md:block">
        <DataTableFrame label={p.label} className="max-h-none">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-ink-3">
                <th className="py-2 pr-3 font-medium">Puesto</th>
                <th className="py-2 pr-3 font-medium">Individuo</th>
                {p.mostrarCruce && <th className="py-2 pr-3 font-medium">Cruce</th>}
                <EncabezadoOrdenable fijo={p.sinOrden} etiqueta="Puntaje" activo={columnaActiva('global')} onClick={() => p.onAlternarOrden('global')} />
                {columnas.map((c) => (
                  <EncabezadoOrdenable key={c} fijo={p.sinOrden} etiqueta={CATEGORIA_LABEL[c]} activo={columnaActiva(c)} onClick={() => p.onAlternarOrden(c)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((item) => (
                <tr key={item.individuo_id} className={cn('border-b border-line-soft align-top last:border-0', item.posicion_grupo === null && 'text-ink-2')}>
                  <td className="whitespace-nowrap py-2 pr-3"><Puesto item={item} empatado={empatado(item)} /></td>
                  <td className="whitespace-nowrap py-2 pr-3"><span className="font-mono">{item.codigo_display}</span><ChipPrueba item={item} /></td>
                  {p.mostrarCruce && <td className="whitespace-nowrap py-2 pr-3 font-mono text-ink-3">{item.codigo_sistema}</td>}
                  <td className="py-2 pr-3 tabular-nums font-semibold">{formatearPuntaje01(item.puntaje)}</td>
                  {columnas.map((c) => (
                    <td key={c} className="min-w-[7.5rem] py-2 pr-3"><ValorCategoria item={item} categoria={c} umbral={p.umbral} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableFrame>
      </div>

      {/* Celular: una tarjeta por individuo, sin scroll horizontal. */}
      <ul className="space-y-2 md:hidden" aria-label={p.label}>
        {visibles.map((item) => (
          <li key={item.individuo_id} className={cn('rounded-lg border border-line bg-surface p-3', item.posicion_grupo === null && 'bg-surface-2')}>
            <div className="flex items-start gap-3">
              <div className="min-w-[3.25rem] shrink-0 text-lg tabular-nums leading-tight"><Puesto item={item} empatado={empatado(item)} /></div>
              <div className="min-w-0 flex-1">
                <p className="break-all font-mono text-sm text-ink">{item.codigo_display}<ChipPrueba item={item} /></p>
                {p.mostrarCruce && <p className="font-mono text-xs text-ink-3">Cruce {item.codigo_sistema}</p>}
              </div>
              <p className="text-right tabular-nums text-lg font-semibold leading-tight">
                {formatearPuntaje01(item.puntaje)}
                <span className="block font-sans text-xs font-normal text-ink-3">puntaje</span>
              </p>
            </div>
            <dl className={cn('mt-3 grid gap-x-2 border-t border-line-soft pt-3', columnas.length > 4 ? 'grid-cols-5' : 'grid-cols-4')}>
              {columnas.map((c) => (
                <div key={c} className="min-w-0">
                  <dt className="truncate text-xs text-ink-3" title={CATEGORIA_LABEL[c]}>{CATEGORIA_ABREV[c]}</dt>
                  <dd className="text-[13px]"><ValorCategoria item={item} categoria={c} umbral={p.umbral} compacto /></dd>
                </div>
              ))}
            </dl>
            {columnas.some((c) => item.grupo.includes(c) && coberturaBaja(item, c, p.umbral)) && (
              <p className="mt-2 flex items-start gap-1 text-xs text-warn">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                Cobertura baja en {columnas.filter((c) => item.grupo.includes(c) && coberturaBaja(item, c, p.umbral)).map((c) => CATEGORIA_LABEL[c]).join(', ')}: menos de la mitad de los descriptores tienen valor.
              </p>
            )}
          </li>
        ))}
      </ul>

      <PieRanking estado={paginacion} />
    </div>
  );
}
