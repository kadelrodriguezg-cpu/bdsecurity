/**
 * Cruces (fase 4), dentro de la especie del encabezado. Título «Cruces de <especie>» con un resumen en una línea; franja
 * con las 10 fases (tocar una filtra la lista); buscador, chip de la fase elegida, «Solo con pendientes» y «Ordenar por»;
 * tabla en escritorio y tarjetas en el celular con la ronda actual, los pendientes (como la planilla, E15) y la última
 * actividad con quién la hizo. Con «Todas las especies», el panorama. Los cruces de prueba siguen N25.
 * La URL conserva sus parámetros de siempre: `etapa`, `buscar`, `pendientes`, `orden` y `pagina` (`especie` la maneja el encabezado).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { listarCrucesAnaliticos, type CruceAnalitico, type OrdenCrucesAnaliticos, type RondaActualCruce } from '@/api/plantas';
import { ESTADOS_ORDEN, ESTADO_LABEL, type EstadoPlanta } from '@/types/domain';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { DataTableFrame } from '@/components/ui/data-table-frame';
import { PuntoEspecie } from '@/components/shell/SelectorEspecie';
import { useAuth } from '@/features/auth/AuthContext';
import { useEspacioEspecie } from '@/features/especies/EspacioEspecie';
import { Panorama } from '@/features/especies/Panorama';
import { Paginacion } from '@/components/shared/Paginacion';
import { FILAS_POR_PAGINA, FILAS_POR_PAGINA_INICIAL, rangoPagina, type FilasPorPagina } from '@/lib/paginacion';
import { useNombres } from '@/features/especies/useNombres';
import { cn } from '@/lib/utils';
import { useIncluirPruebas } from '@/lib/preferencias';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/v3/estados';
import { qk } from '@/lib/queryKeys';
import { listarTemporadasEspecie } from '@/api/rankingGrupos';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { formatearActividadCorta } from '@/lib/v3/formatos';

// U-24: sin «scoring_desc» (leía el ranking operativo antiguo). Dentro de una especie, ordenar por especie no tiene sentido.
const ORDENES: Array<[OrdenCrucesAnaliticos, string]> = [
  ['actividad_desc', 'Actividad reciente'],
  ['codigo_asc', 'Código'],
  ['estado_asc', 'Fase'],
  ['vivos_desc', 'Más individuos vivos'],
];
const fmt = new Intl.NumberFormat('es-CL');
const pl = (n: number, uno: string, varios: string) => `${fmt.format(n)} ${n === 1 ? uno : varios}`;

/** Franja del pipeline: las 10 fases en orden, con su número de cruces, una barra proporcional y un punto ámbar si hay pendientes. */
function FranjaFases({ porFase, conPendientes, activa, onElegir }: {
  porFase: Partial<Record<string, number>>;
  conPendientes: Partial<Record<string, number>>;
  activa: EstadoPlanta | '';
  onElegir: (estado: EstadoPlanta | '') => void;
}) {
  const maximo = Math.max(1, ...ESTADOS_ORDEN.map((e) => porFase[e] ?? 0));
  return (
    <nav aria-label="Cruces por fase" className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      <ol className="flex gap-2 md:grid md:grid-cols-10">
        {ESTADOS_ORDEN.map((estado, i) => {
          const n = porFase[estado] ?? 0;
          const pendientes = conPendientes[estado] ?? 0;
          const elegida = activa === estado;
          return (
            <li key={estado} className="w-[7.5rem] shrink-0 md:w-auto">
              <button
                type="button"
                aria-pressed={elegida}
                aria-label={`${ESTADO_LABEL[estado]}: ${pl(n, 'cruce', 'cruces')}${pendientes > 0 ? `, ${pl(pendientes, 'con pendientes', 'con pendientes')}` : ''}`}
                onClick={() => onElegir(elegida ? '' : estado)}
                className={cn(
                  'flex h-full w-full flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  elegida ? 'border-primary bg-brand-l ring-1 ring-primary' : 'border-line bg-surface hover:bg-surface-2',
                  n === 0 && !elegida && 'opacity-50',
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className="text-title font-semibold tabular-nums text-ink">{n}</span>
                  {pendientes > 0 && <span aria-hidden="true" title="Con pendientes" className="h-2 w-2 rounded-full bg-warn" />}
                </span>
                <span className="min-h-[2lh] text-small leading-tight text-ink-2"><span className="text-ink-3">{i + 1}.</span> {ESTADO_LABEL[estado]}</span>
                <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-track">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${(n / maximo) * 100}%` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Fase del cruce con su avance en los 10 pasos. */
function FaseConAvance({ estado }: { estado: EstadoPlanta }) {
  const indice = ESTADOS_ORDEN.indexOf(estado);
  return (
    <div className="space-y-1">
      <span className="text-sm text-ink">{ESTADO_LABEL[estado]}</span>
      <span role="img" aria-label={`Paso ${indice + 1} de ${ESTADOS_ORDEN.length}`} className="flex gap-0.5">
        {ESTADOS_ORDEN.map((e, i) => <span key={e} className={cn('h-1 w-2.5 rounded-full', i <= indice ? 'bg-brand' : 'bg-track')} />)}
      </span>
    </div>
  );
}

/** Fase 5 (G2): la ronda se lee con su temporada de julio a junio («Ronda 1 · 2025-2026»), nunca con el año calendario guardado. */
function textoRonda(ronda: RondaActualCruce, temporada: string | undefined): string {
  const nombre = ronda.tipo === 'multisitio' ? `Multisitio ${ronda.numero}` : `Ronda ${ronda.numero}`;
  return temporada ? `${nombre} · ${temporada}` : nombre;
}

function RondaActual({ ronda, temporada }: { ronda: RondaActualCruce | null | undefined; temporada?: string }) {
  if (!ronda) return <span className="text-small text-ink-3">Sin ronda abierta</span>;
  return (
    <div className="min-w-[9rem] space-y-1">
      <span className="block text-sm text-ink">{textoRonda(ronda, temporada)}</span>
      <span className="block text-small tabular-nums text-ink-3">{fmt.format(ronda.cerradas)} de {fmt.format(ronda.vivos)} cerradas</span>
      <span aria-hidden="true" className="block h-1 overflow-hidden rounded-full bg-track">
        <span className="block h-full rounded-full bg-ok" style={{ width: `${ronda.vivos > 0 ? (ronda.cerradas / ronda.vivos) * 100 : 0}%` }} />
      </span>
    </div>
  );
}

function Pendientes({ n }: { n: number | undefined }) {
  if (n && n > 0) return <span className="text-small font-medium tabular-nums text-warn">{pl(n, 'sin evaluación cerrada', 'sin evaluación cerrada')}</span>;
  return <span className="text-small font-medium text-ok">Al día</span>;
}

function Actividad({ cruce, nombreDe }: { cruce: CruceAnalitico; nombreDe: Map<string, string> }) {
  const quien = cruce.ultima_actividad_por ? nombreDe.get(cruce.ultima_actividad_por) : undefined;
  return (
    <span className="text-small text-ink-3">
      <span className="tabular-nums">{formatearActividadCorta(cruce.ultima_actividad)}</span>
      {quien && <span className="block text-ink-3">{quien}</span>}
    </span>
  );
}

const MarcaPrueba = () => <Badge variant="outline">Prueba</Badge>;

export function PlantasListaPage() {
  const [parametros, setParametros] = useSearchParams();
  const { esAdmin } = useAuth();
  const { activa, panorama } = useEspacioEspecie();
  const especieId = activa?.id ?? '';
  const estadoParam = parametros.get('etapa') ?? '';
  const estado = ESTADOS_ORDEN.includes(estadoParam as EstadoPlanta) ? estadoParam as EstadoPlanta : '';
  const busqueda = parametros.get('buscar') ?? '';
  const soloPendientes = parametros.get('pendientes') === '1';
  const ordenParam = parametros.get('orden') ?? 'actividad_desc';
  const orden = ORDENES.some(([o]) => o === ordenParam) ? ordenParam as OrdenCrucesAnaliticos : 'actividad_desc';
  const paginaParam = Number(parametros.get('pagina') ?? '1');
  const pagina = Number.isInteger(paginaParam) && paginaParam > 0 ? paginaParam - 1 : 0;
  // G18: 50 o 100 cruces por página (`filas` en la URL); la paginación es del servidor.
  const filasParam = Number(parametros.get('filas'));
  const LIMITE: FilasPorPagina = (FILAS_POR_PAGINA as readonly number[]).includes(filasParam) ? (filasParam as FilasPorPagina) : FILAS_POR_PAGINA_INICIAL;
  const [hojaFiltros, setHojaFiltros] = useState(false);
  // El botón «Filtros» del celular cuenta la fase y «Solo con pendientes» (el orden no filtra; la especie es la del encabezado).
  const filtrosActivos = [estado, soloPendientes].filter(Boolean).length;

  const actualizarFiltros = (cambios: Record<string, string>) => {
    const siguientes = new URLSearchParams(parametros);
    Object.entries(cambios).forEach(([clave, valor]) => {
      if (valor) siguientes.set(clave, valor);
      else siguientes.delete(clave);
    });
    if (!('pagina' in cambios)) siguientes.delete('pagina');
    setParametros(siguientes, { replace: true });
  };
  const quitarFiltros = () => actualizarFiltros({ etapa: '', buscar: '', pendientes: '', orden: '' });

  // Buffer local del buscador (hallazgo Grave del E2E, Fase 4 antigua): solo la versión con espera va a la URL y a la consulta.
  const [busquedaInput, setBusquedaInput] = useState(busqueda);
  const busquedaDebounced = useDebouncedValue(busquedaInput, 350);
  useEffect(() => {
    if (busquedaDebounced !== busqueda) actualizarFiltros({ buscar: busquedaDebounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busquedaDebounced]);
  useEffect(() => {
    setBusquedaInput(busqueda);
  }, [busqueda]);

  const [incluirPruebas] = useIncluirPruebas();
  const filtros = { especieId, estado, busqueda, orden, pagina, incluirPruebas, soloPendientes, limite: LIMITE };
  const cruces = useQuery({
    queryKey: qk.plantas.lista(filtros),
    queryFn: () => listarCrucesAnaliticos({
      especieId,
      estado: estado || undefined,
      busqueda: busqueda || undefined,
      orden,
      limite: LIMITE,
      offset: pagina * LIMITE,
      incluirPruebas,
      soloPendientes,
    }),
    enabled: !!especieId,
    // Al cambiar de página se sigue viendo la anterior hasta que llega la nueva (sin parpadeo del pie).
    placeholderData: (anterior) => anterior,
  });
  const nombres = useNombres((cruces.data?.items ?? []).map((c) => c.ultima_actividad_por));
  const temporadas = useQuery({ queryKey: qk.temporadas(especieId), queryFn: () => listarTemporadasEspecie(especieId), enabled: !!especieId });
  const temporadaDe = (plantaId: string, ronda: RondaActualCruce | null | undefined) =>
    ronda ? temporadas.data?.find((t) => t.planta_id === plantaId && t.tipo_ronda === ronda.tipo && t.numero_ronda === ronda.numero)?.etiqueta : undefined;

  if (!activa) return <Panorama titulo="Cruces" subtitulo="Los cruces se trabajan dentro de una especie. Entra a una." />;

  const resumen = panorama?.find((p) => p.id === activa.id);
  const total = cruces.data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE));
  const volverA = `/plantas?${parametros.toString()}`;
  const esPrueba = (marca: boolean | undefined) => incluirPruebas && marca === true;
  const hayFiltro = !!(estado || busqueda || soloPendientes);
  const descripcionFiltro = [estado ? ESTADO_LABEL[estado] : '', soloPendientes ? 'solo con pendientes' : '', busqueda ? `código «${busqueda}»` : ''].filter(Boolean).join(' · ');
  const nuevoCruce = esAdmin ? <Link to="/nueva-planta"><Button size="sm"><Plus className="h-4 w-4" /> Nuevo cruce</Button></Link> : null;

  const selectorOrden = (id: string) => (
    <div className="space-y-1">
      <Label htmlFor={id}>Ordenar por</Label>
      <Select id={id} value={orden} onChange={(event) => actualizarFiltros({ orden: event.target.value === 'actividad_desc' ? '' : event.target.value })}>
        {ORDENES.map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
      </Select>
    </div>
  );
  const chipPendientes = (
    <button
      type="button"
      aria-pressed={soloPendientes}
      onClick={() => actualizarFiltros({ pendientes: soloPendientes ? '' : '1' })}
      className={cn(
        'inline-flex min-h-tap items-center gap-1.5 rounded-full border px-3 text-small font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        soloPendientes ? 'border-warn bg-warn-l text-warn' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2',
      )}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warn" />Solo con pendientes
    </button>
  );
  const chipFase = estado && (
    <span className="inline-flex min-h-tap items-center gap-1 rounded-full border border-primary bg-brand-l pl-3 pr-1 text-small font-medium text-brand-ink">
      Fase: {ESTADO_LABEL[estado]}
      <button type="button" aria-label={`Quitar el filtro de fase ${ESTADO_LABEL[estado]}`} onClick={() => actualizarFiltros({ etapa: '' })} className="grid h-8 w-8 place-items-center rounded-full hover:bg-brand-s focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-title font-semibold text-ink"><PuntoEspecie especie={activa} className="h-3 w-3" />Cruces de {activa.nombre}</h1>
          {resumen && (
            <p className="text-body text-ink-2">
              {pl(resumen.cruces_activos, 'cruce activo', 'cruces activos')} · {pl(resumen.individuos_vivos, 'individuo vivo', 'individuos vivos')} · <span className={resumen.sin_evaluacion_cerrada > 0 ? 'text-warn' : undefined}>{fmt.format(resumen.sin_evaluacion_cerrada)} sin evaluación cerrada</span>
            </p>
          )}
        </div>
        {nuevoCruce}
      </div>

      {resumen && <FranjaFases porFase={resumen.cruces_por_fase} conPendientes={resumen.fases_con_pendientes} activa={estado} onElegir={(e) => actualizarFiltros({ etapa: e })} />}

      <div className="flex flex-wrap items-end gap-2 md:gap-3">
        <div className="min-w-0 flex-1 space-y-1 md:max-w-xs">
          <Label htmlFor="filtro-busqueda">Buscar código</Label>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" /><Input id="filtro-busqueda" className="pl-9" value={busquedaInput} onChange={(event) => setBusquedaInput(event.target.value)} placeholder="Ej. 02-001" /></div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 md:hidden"
          aria-haspopup="dialog"
          aria-label={filtrosActivos > 0 ? `Filtros (${filtrosActivos} activos)` : 'Filtros'}
          onClick={() => setHojaFiltros(true)}
        >
          <SlidersHorizontal className="h-4 w-4" /> Filtros
          {filtrosActivos > 0 && <span aria-hidden="true" className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-white">{filtrosActivos}</span>}
        </Button>
        <div className="hidden flex-wrap items-end gap-2 md:flex">
          {chipFase}
          {chipPendientes}
        </div>
        <div className="hidden w-52 md:ml-auto md:block">{selectorOrden('filtro-orden')}</div>
      </div>
      {/* En el celular, la fase elegida se ve y se quita sin abrir la hoja. */}
      {estado && <div className="md:hidden">{chipFase}</div>}

      {hojaFiltros && (
        <Sheet
          titulo="Filtros"
          subtitulo={cruces.data ? pl(total, 'cruce', 'cruces') : undefined}
          onCerrar={() => setHojaFiltros(false)}
          footer={(
            <div className="flex justify-between gap-2">
              <Button variant="outline" disabled={filtrosActivos === 0 && orden === 'actividad_desc'} onClick={() => actualizarFiltros({ etapa: '', pendientes: '', orden: '' })}>Quitar filtros</Button>
              <Button onClick={() => setHojaFiltros(false)}>Ver cruces</Button>
            </div>
          )}
        >
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="hoja-filtro-estado">Fase</Label>
              <Select id="hoja-filtro-estado" value={estado} onChange={(event) => actualizarFiltros({ etapa: event.target.value })}>
                <option value="">Todas</option>
                {ESTADOS_ORDEN.map((valor) => <option key={valor} value={valor}>{ESTADO_LABEL[valor]}</option>)}
              </Select>
            </div>
            <div>{chipPendientes}</div>
            {selectorOrden('hoja-filtro-orden')}
          </div>
        </Sheet>
      )}

      {incluirPruebas && <p role="status" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-small text-ink-2">Se incluyen los cruces de prueba (opción del menú de cuenta). Llevan la marca «Prueba».</p>}
      {!cruces.data && !cruces.isError && <EstadoCargando etiqueta="Cargando cruces…" forma="esqueleto" />}
      {cruces.isError && !cruces.data && <EstadoError mensaje="No se pudieron cargar los cruces." onReintentar={() => void cruces.refetch()} etiquetaReintentar="Reintentar cruces" />}
      {cruces.isError && cruces.data && <Alert>No se pudieron actualizar los cruces. Se conservan los datos disponibles. <Button variant="outline" disabled={cruces.isFetching} onClick={() => void cruces.refetch()}>Reintentar cruces</Button></Alert>}
      {cruces.isSuccess && total === 0 && (
        hayFiltro
          ? <EstadoVacio titulo="No hay cruces que coincidan con los filtros." accion={<Button variant="outline" size="sm" onClick={quitarFiltros}>Quitar filtros</Button>} />
          : <EstadoVacio titulo={`Todavía no hay cruces de ${activa.nombre}.`} accion={nuevoCruce ?? undefined} />
      )}

      {/* Escritorio: tabla. */}
      {total > 0 && (
        <div className="hidden md:block">
          <DataTableFrame label="Tabla de cruces" className="border border-line bg-surface px-4">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-ink-3">
                  <th className="py-3 pr-4 font-medium">Código</th>
                  <th className="py-3 pr-4 font-medium">Fase</th>
                  <th className="py-3 pr-4 text-right font-medium">Vivos</th>
                  <th className="py-3 pr-4 font-medium">Ronda actual</th>
                  <th className="py-3 pr-4 font-medium">Pendientes</th>
                  <th className="py-3 pr-4 font-medium">Última actividad</th>
                  <th className="py-3 font-medium"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {cruces.data?.items.map((cruce) => (
                  <tr key={cruce.id} className="border-b align-top last:border-0 hover:bg-surface-2">
                    <td className="py-3 pr-4"><span className="flex items-center gap-2"><Link to={`/planta/${cruce.id}`} state={{ volverA }} className="font-mono font-semibold text-primary hover:underline">{cruce.codigo_sistema}</Link>{esPrueba(cruce.es_prueba) && <MarcaPrueba />}</span></td>
                    <td className="py-3 pr-4"><FaseConAvance estado={cruce.estado} /></td>
                    <td className="py-3 pr-4 text-right font-semibold tabular-nums">{cruce.individuos_vivos}</td>
                    <td className="py-3 pr-4"><RondaActual ronda={cruce.ronda_actual} temporada={temporadaDe(cruce.id, cruce.ronda_actual)} /></td>
                    <td className="py-3 pr-4"><Pendientes n={cruce.sin_evaluacion_cerrada} /></td>
                    <td className="py-3 pr-4"><Actividad cruce={cruce} nombreDe={nombres} /></td>
                    <td className="py-3 text-right"><Link to={`/planta/${cruce.id}`} state={{ volverA }} aria-label={`Abrir ${cruce.codigo_sistema}`} className="inline-grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableFrame>
        </div>
      )}

      {/* Celular: tarjetas. */}
      <ul aria-label="Lista de cruces" className="grid gap-2 md:hidden">
        {cruces.data?.items.map((cruce) => (
          <li key={cruce.id}>
            <Link to={`/planta/${cruce.id}`} state={{ volverA }} className={cn('block space-y-2 rounded-lg border border-line bg-surface p-3 transition-colors hover:bg-surface-2', cruce.estado === 'sin_empezar' && 'text-ink-3')}>
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2"><span className="font-mono font-semibold">{cruce.codigo_sistema}</span>{esPrueba(cruce.es_prueba) && <MarcaPrueba />}</span>
                <span className="flex items-center gap-1 text-small text-ink-3">{cruce.individuos_vivos} vivos<ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
              </div>
              <FaseConAvance estado={cruce.estado} />
              <div className="flex flex-wrap items-end justify-between gap-2">
                <RondaActual ronda={cruce.ronda_actual} temporada={temporadaDe(cruce.id, cruce.ronda_actual)} />
                <Pendientes n={cruce.sin_evaluacion_cerrada} />
              </div>
              <Actividad cruce={cruce} nombreDe={nombres} />
            </Link>
          </li>
        ))}
      </ul>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-small text-ink-3">
          <span>{fmt.format(total)} de {pl(resumen?.cruces ?? total, 'cruce', 'cruces')}{descripcionFiltro ? ` · ${descripcionFiltro}` : ''}</span>
          {/* G18: el mismo pie numerado que las demás tablas, con la página que pide el servidor. */}
          <Paginacion
            className="w-full"
            estado={{
              actual: pagina + 1,
              total: totalPaginas,
              ...rangoPagina(pagina + 1, LIMITE, total),
              cantidad: total,
              porPagina: LIMITE,
              irA: (n) => actualizarFiltros({ pagina: n > 1 ? String(n) : '' }),
              cambiarPorPagina: (n) => actualizarFiltros({ filas: n === FILAS_POR_PAGINA_INICIAL ? '' : String(n) }),
            }}
          />
        </div>
      )}
    </div>
  );
}
