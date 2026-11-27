/**
 * Pestaña Ranking General, por grupos de categorías (Fase 2, Sprint 1; pantalla
 * v2 en el Sprint 2, ítem S2-4).
 *
 * Cada individuo compite solo con los que midieron las mismas categorías del
 * motor (decisión de Kadel del 22-10-2026): el puesto es dentro de su grupo y
 * solo existe si el grupo alcanza el mínimo configurado (5 por defecto);
 * debajo se muestra «pocas plantas para comparar». Las evaluaciones con un
 * valor marcado van a «excluidas por revisión». La cuenta de arriba es la de
 * la población completa (A1-077), sin el tope de 100 del ranking anterior.
 * El puntaje es el de la versión de scoring activa, sin cambios.
 *
 * Un grupo por pestaña (primero los que tienen puesto, más plantas primero; al
 * final los de pocas plantas). El orden por columna sigue siendo en cliente y
 * dentro de cada grupo; el puesto mostrado es siempre el del grupo (A1-145).
 * Es el mismo componente en /ranking, en la ficha del cruce y en el dashboard.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { type CategoriaScoring } from '@/api/scoring';
import {
  claveGrupo,
  ESTADO_RANKING_LABEL,
  obtenerRankingPorGrupos,
  type ItemRankingGrupos,
  type RankingPorGrupos,
} from '@/api/rankingGrupos';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useManualTabs } from '@/components/ui/useManualTabs';
import { cicloOrden, compararConNulosAlFinal } from '@/lib/ordenColumnas';
import { compararCodigos } from '@/lib/ordenNatural';
import { usePaginacionUrl } from '@/lib/usePaginacionUrl';
import { qk } from '@/lib/queryKeys';
import { formatearFechaCivil } from '@/lib/fechas';
import { cn } from '@/lib/utils';
import {
  EtiquetaGrupo,
  PieRanking,
  nombreGrupoCompleto,
  PanelGrupo,
  type ColumnaOrdenable,
  type OrdenRanking,
} from './RankingGrupoVista';

import type { OrdenGeneral } from '@/lib/rankingPreferencias';

export { cuentaPorPosicion } from './RankingGrupoVista';

function valorDeColumna(item: ItemRankingGrupos, columna: ColumnaOrdenable): number | null {
  if (columna === 'global') return item.puntaje;
  return item.detalle_categorias?.[columna] ?? null;
}

/** Lo que no compite: individuo, motivo y evaluación, en una lista que se lee igual en escritorio y en celular. */
function ListaFuera({ filas, label, motivo, paramPagina }: { filas: ItemRankingGrupos[]; label: string; motivo: (item: ItemRankingGrupos) => string; paramPagina: string }) {
  const paginacion = usePaginacionUrl(filas, { param: paramPagina });
  const visibles = paginacion.pagina;
  return (
    <div className="space-y-2">
      <ul aria-label={label} className="divide-y divide-line-soft rounded-lg border border-line bg-surface px-3">
        {visibles.map((item) => (
          <li key={item.individuo_id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2">
            <span className="w-36 shrink-0 break-all font-mono text-sm">{item.codigo_display}</span>
            <span className="min-w-0 flex-1 basis-40 text-sm text-ink-2">{motivo(item)}</span>
            <span className="text-xs tabular-nums text-ink-3">
              {item.fecha_evaluacion ? `Ronda ${item.numero_ronda} · ${formatearFechaCivil(item.fecha_evaluacion)}` : 'Sin evaluación'}
            </span>
          </li>
        ))}
      </ul>
      <PieRanking estado={paginacion} />
    </div>
  );
}

const motivoRevision = (item: ItemRankingGrupos) => (item.requiere_revision
  ? 'Evaluación marcada para revisión'
  : 'Un valor quedó en el límite de revisión');

/**
 * Filtro opcional por fecha de evaluación (YYYY-MM-DD, ambos extremos incluidos).
 * Solo recorta lo que se muestra: el puesto sigue siendo el del grupo completo
 * y los conteos de la población no cambian. Sin fecha de evaluación no hay cómo
 * saber si cae en el rango, así que esas filas se ocultan mientras haya filtro.
 */
export interface FiltroFechaEvaluacion { desde?: string; hasta?: string }

const enRango = (fecha: string | null, filtro: FiltroFechaEvaluacion) => {
  if (!filtro.desde && !filtro.hasta) return true;
  if (fecha === null) return false;
  return (!filtro.desde || fecha >= filtro.desde) && (!filtro.hasta || fecha <= filtro.hasta);
};

type Tono = 'neutro' | 'marca' | 'falta' | 'revisar';
const TONO: Record<Tono, string> = {
  neutro: 'bg-neutral-l text-ink-2',
  marca: 'bg-brand-l text-brand-ink',
  falta: 'bg-warn-l text-warn',
  revisar: 'bg-danger-l text-danger',
};

/** Cuenta completa de la población del alcance: cada individuo vivo cae en exactamente una de estas categorías. */
function CuentaPoblacion({ poblacion }: { poblacion: RankingPorGrupos['poblacion'] }) {
  const partes: Array<{ n: number; texto: string; tono: Tono; siempre?: boolean }> = [
    { n: poblacion.con_posicion, texto: 'con puesto', tono: 'marca', siempre: true },
    { n: poblacion.pocas_plantas, texto: 'en grupos con pocas plantas', tono: 'neutro' },
    { n: poblacion.excluidas_revision, texto: 'excluidas por revisión', tono: 'revisar' },
    { n: poblacion.no_comparables, texto: 'no comparables', tono: 'falta' },
    { n: poblacion.sin_datos, texto: 'sin datos de ninguna categoría', tono: 'neutro' },
    { n: poblacion.sin_evaluacion, texto: 'sin evaluación', tono: 'neutro' },
    { n: poblacion.sin_version, texto: 'sin puntaje disponible', tono: 'neutro' },
  ];
  return (
    <ul className="flex flex-wrap gap-2 text-sm tabular-nums" aria-label="Población del ranking">
      <li className={cn('rounded-full px-3 py-1', TONO.neutro)}><strong className="font-semibold text-ink">{poblacion.total}</strong> vivos en el alcance</li>
      {partes.filter((x) => x.siempre || x.n > 0).map((x) => (
        <li key={x.texto} className={cn('rounded-full px-3 py-1', TONO[x.tono])}><strong className="font-semibold">{x.n}</strong> {x.texto}</li>
      ))}
    </ul>
  );
}

export function RankingGeneral({ plantaId, especieId, incluirPruebas = false, orden: ordenControlado, onOrden, evaluadoEntre }: {
  plantaId?: string; especieId?: string; incluirPruebas?: boolean; orden?: OrdenGeneral; onOrden?: (orden: OrdenGeneral) => void;
  evaluadoEntre?: FiltroFechaEvaluacion;
}) {
  const [ordenLocal, setOrdenLocal] = useState<OrdenGeneral>(null);
  const orden = ordenControlado === undefined ? ordenLocal : ordenControlado;
  const setOrden = (valor: OrdenGeneral) => { setOrdenLocal(valor); onOrden?.(valor); };
  const [grupoElegido, setGrupoElegido] = useState<string | null>(null);

  const ranking = useQuery({
    queryKey: qk.ranking.grupos({ plantaId, especieId, incluirPruebas }),
    queryFn: () => obtenerRankingPorGrupos({ plantaId, especieId, incluirPruebas }),
  });

  const desde = evaluadoEntre?.desde;
  const hasta = evaluadoEntre?.hasta;
  const filtroFecha = Boolean(desde || hasta);
  const datosVisibles = useMemo(() => (ranking.data && (desde || hasta)
    ? { ...ranking.data, items: ranking.data.items.filter((i) => enRango(i.fecha_evaluacion, { desde, hasta })) }
    : ranking.data), [ranking.data, desde, hasta]);
  const secciones = useMemo(() => armarSecciones(datosVisibles, orden), [datosVisibles, orden]);

  const pestanas = (secciones?.grupos ?? []).filter((g) => !filtroFecha || g.filas.length > 0);
  const claves = pestanas.map((g) => claveGrupo(g.categorias));
  const activa = grupoElegido !== null && claves.includes(grupoElegido) ? grupoElegido : claves[0] ?? '';
  const tabs = useManualTabs(claves, activa, setGrupoElegido);

  const avisoLectura = ranking.isError ? (
    <Alert>
      No se pudo cargar el ranking.{ranking.data && ' Se conservan los datos disponibles.'}
      <Button type="button" variant="outline" disabled={ranking.isFetching} onClick={() => void ranking.refetch()}>Reintentar ranking</Button>
    </Alert>
  ) : null;
  if (!ranking.data || !secciones) return avisoLectura ?? <p role="status" className="text-sm text-ink-3">Cargando ranking…</p>;

  const resultado = ranking.data;
  const { poblacion } = resultado;
  if (poblacion.total === 0) {
    if (!ranking.isSuccess) return avisoLectura;
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-8 text-center">
        <ClipboardList className="h-6 w-6 text-ink-3" />
        <p className="text-sm text-ink-3">No hay individuos vivos para comparar en este alcance.</p>
      </div>
    );
  }

  const alternarOrden = (columna: ColumnaOrdenable) => setOrden(cicloOrden(orden, columna));
  const grupoActivo = pestanas.find((g) => claveGrupo(g.categorias) === activa);

  return (
    <div className="space-y-4">
      {avisoLectura}
      <div className="space-y-2">
        <p className="text-sm text-ink-3">
          Cada grupo reúne
          a los individuos que midieron las mismas categorías; el puesto es dentro del grupo y el mismo puntaje comparte puesto.
        </p>
        <CuentaPoblacion poblacion={poblacion} />
      </div>

      {filtroFecha && (
        <p className="text-xs text-ink-3">
          Solo se muestran las evaluaciones{desde ? ` desde el ${formatearFechaCivil(desde)}` : ''}{hasta ? ` hasta el ${formatearFechaCivil(hasta)}` : ''}.
          El puesto sigue siendo el del grupo completo.
        </p>
      )}

      {pestanas.length === 0 ? (
        <p className="rounded-lg border border-dashed py-6 text-center text-sm text-ink-3">
          {filtroFecha ? 'Ninguna evaluación del rango cae en un grupo.' : 'Todavía ningún grupo tiene evaluaciones para comparar.'}
        </p>
      ) : (
        <div className="space-y-3">
          {/* Pestañas subrayadas de 2 px (DESIGN.md); en celular se desplazan dentro de su barra, no la página. */}
          <div role="tablist" aria-label="Grupos de categorías" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 [scrollbar-width:thin]">
            {pestanas.map((g, indice) => {
              const clave = claves[indice];
              const nombre = nombreGrupoCompleto(g.categorias);
              const cuenta = g.filas.length < g.n ? `${g.filas.length} de ${g.n}` : String(g.n);
              const primeraSinPuesto = !g.conPosicion && (indice === 0 || pestanas[indice - 1].conPosicion);
              return (
                <div key={clave} role="presentation" className="flex shrink-0 items-end gap-1">
                  {primeraSinPuesto && indice > 0 && <span aria-hidden="true" className="mx-1 mb-2.5 h-5 w-px bg-line" />}
                  <button
                    {...tabs.tabProps(clave)}
                    aria-label={`${nombre}, ${cuenta} ${g.n === 1 ? 'planta' : 'plantas'}${g.conPosicion ? '' : ', sin puesto'}`}
                    className={cn(
                      'inline-flex min-h-tap items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                      activa === clave ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink-2',
                    )}
                  >
                    <span aria-hidden="true"><EtiquetaGrupo categorias={g.categorias} /></span>
                    <span aria-hidden="true" className={cn('rounded-full px-2 text-xs tabular-nums', activa === clave ? 'bg-brand-l text-brand-ink' : 'bg-neutral-l text-ink-2')}>{cuenta}</span>
                    {!g.conPosicion && <span aria-hidden="true" className="text-xs font-normal text-ink-3 max-sm:hidden">sin puesto</span>}
                  </button>
                </div>
              );
            })}
          </div>

          {grupoActivo && (
            <div {...tabs.panelProps(activa)} className="space-y-3 focus-visible:outline-none">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="min-w-0 break-words font-semibold text-ink">
                  {nombreGrupoCompleto(grupoActivo.categorias)}{' '}
                  <span className="font-normal text-ink-3">
                    ({grupoActivo.filas.length < grupoActivo.n ? `${grupoActivo.filas.length} de ${grupoActivo.n}` : grupoActivo.n} {grupoActivo.n === 1 ? 'planta' : 'plantas'})
                  </span>
                </h3>
                {!grupoActivo.conPosicion && (
                  <span className="rounded-full bg-neutral-l px-3 py-1 text-xs text-ink-2">
                    Pocas plantas para comparar: {grupoActivo.n} de {resultado.minimo_evaluaciones_grupo} necesarias. Sin puesto hasta que el grupo llegue al mínimo.
                  </span>
                )}
              </div>
              <PanelGrupo
                label={`Grupo ${nombreGrupoCompleto(grupoActivo.categorias)}`}
                categorias={grupoActivo.categorias}
                filas={grupoActivo.filas}
                paramPagina="pagr"
                orden={orden}
                onAlternarOrden={alternarOrden}
                onOrden={setOrden}
                umbral={resultado.cobertura_advertencia}
                mostrarCruce={!plantaId}
              />
            </div>
          )}
          {claves.filter((c) => c !== activa).map((c) => <div key={c} {...tabs.panelProps(c)} hidden />)}
        </div>
      )}

      {secciones.excluidas.length > 0 && (
        <section aria-labelledby="ranking-excluidas">
          <details className="group">
            <summary className="flex min-h-tap cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
              <ChevronRight className="h-4 w-4 shrink-0 self-center text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
              <h3 id="ranking-excluidas" className="font-semibold text-ink-2">
                Excluidas por revisión <span className="font-normal text-ink-3">({secciones.excluidas.length})</span>
              </h3>
              <span className="text-xs text-ink-3">No entran a ningún grupo hasta que alguien revise el valor marcado.</span>
            </summary>
            <div className="mt-2">
              <ListaFuera label="Individuos excluidos por revisión" filas={secciones.excluidas} motivo={motivoRevision} paramPagina="pagx" />
            </div>
          </details>
        </section>
      )}

      {secciones.fuera.length > 0 && (
        // Plegado por defecto (Sprint 1.1): en un cruce con 378 sin comparar, la lista tapaba el ranking.
        <section aria-labelledby="ranking-fuera">
          <details className="group">
            <summary className="flex min-h-tap cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
              <ChevronRight className="h-4 w-4 shrink-0 self-center text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
              <h3 id="ranking-fuera" className="font-semibold text-ink-2">
                Fuera de comparación <span className="font-normal text-ink-3">({secciones.fuera.length})</span>
              </h3>
              <span className="text-xs text-ink-3">
                {secciones.motivosFuera.map(([estado, n]) => `${ESTADO_RANKING_LABEL[estado]}: ${n}`).join(' · ')}
              </span>
            </summary>
            <div className="mt-2">
              <ListaFuera label="Individuos fuera de comparación" filas={secciones.fuera} motivo={(item) => ESTADO_RANKING_LABEL[item.estado_ranking]} paramPagina="pagf" />
            </div>
          </details>
        </section>
      )}

      <p className="text-xs text-ink-3">
        «—» en una categoría significa que ninguno de sus descriptores tiene valor; no es un cero. «Cobertura baja» (en ámbar) avisa
        que menos de la mitad de los descriptores de esa categoría tienen valor; no excluye a la evaluación.
      </p>
    </div>
  );
}

function armarSecciones(datos: RankingPorGrupos | undefined, orden: OrdenRanking) {
  if (!datos) return null;
  const porGrupo = new Map<string, ItemRankingGrupos[]>();
  const excluidas: ItemRankingGrupos[] = [];
  const fuera: ItemRankingGrupos[] = [];
  for (const item of datos.items) {
    if (item.estado_ranking === 'comparable' || item.estado_ranking === 'pocas_plantas') {
      const clave = claveGrupo(item.grupo);
      porGrupo.set(clave, [...(porGrupo.get(clave) ?? []), item]);
    } else if (item.estado_ranking === 'excluida_revision') excluidas.push(item);
    else fuera.push(item);
  }
  const ordenar = (filas: ItemRankingGrupos[]) => (orden === null
    ? filas // orden del servidor: puesto en el grupo, luego puntaje y código
    : [...filas].sort((a, b) => compararConNulosAlFinal(
      valorDeColumna(a, orden.columna),
      valorDeColumna(b, orden.columna),
      orden.direccion,
      compararCodigos(a.codigo_display, b.codigo_display),
    )));
  const porCodigo = (a: ItemRankingGrupos, b: ItemRankingGrupos) => compararCodigos(a.codigo_display, b.codigo_display);
  return {
    // Con puesto primero (más plantas primero); los de pocas plantas al final, también de mayor a menor.
    grupos: datos.grupos
      .map((g) => ({
        categorias: g.categorias as CategoriaScoring[],
        n: g.n,
        conPosicion: g.con_posicion,
        filas: ordenar(porGrupo.get(claveGrupo(g.categorias)) ?? []),
      }))
      .sort((a, b) => Number(b.conPosicion) - Number(a.conPosicion) || b.n - a.n),
    excluidas: [...excluidas].sort(porCodigo),
    fuera: [...fuera].sort(porCodigo),
    // Conteo por motivo, de mayor a menor: «Sin ronda iniciada: 325 · Sin evaluación cerrada: 52».
    motivosFuera: [...fuera.reduce((m, i) => m.set(i.estado_ranking, (m.get(i.estado_ranking) ?? 0) + 1), new Map<ItemRankingGrupos['estado_ranking'], number>())].sort((a, b) => b[1] - a[1]),
  };
}
