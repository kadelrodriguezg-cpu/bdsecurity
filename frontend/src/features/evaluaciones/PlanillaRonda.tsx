/**
 * Planilla de ronda (Fase 2, referencia docs/diseno/v2/01 y 07): una fila por
 * individuo vivo de la ronda vigente del cruce, en orden de recorrido (número
 * de planta; no hay dato de hilera). El avance se mide por evaluación cerrada,
 * nunca por puntaje (A1-144). Un borrador ajeno se muestra como tal y no
 * ofrece continuar (A1-061).
 *
 * S3-2: un selector deja ver las rondas anteriores de la serie (solo lectura:
 * no se inicia ronda ni se evalúa, pero se abre cada evaluación) y, para el
 * admin, «Ver valores» cambia la tabla de avance por la matriz de valores
 * (hash #valores). Al operario no se le ofrece ni se le dibuja por URL.
 *
 * Fase 5 (G13, G14, G18): el filtro (`filtro`), la búsqueda (`q`) y la página (`pag`, `filas`) viven en la URL; al volver
 * de evaluar (`desde=`) se abre en la página de esa planta, visible y resaltada un momento, con el aviso que traiga. El
 * buscador pone primero el número exacto (lib/buscarCodigo).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { useParametrosUrl } from '@/lib/useParametrosUrl';
import { ChevronRight, ClipboardList, ScanQrCode, Search, Settings2 } from 'lucide-react';
import { obtenerPlanillaRonda, type FilaPlanilla, type PlanillaRonda as Planilla } from '@/api/protocolo';
import { contarObligatoriosDeEstados, notaFila, resumenSecciones } from '@/lib/esquemaFase/protocolo';
import { useEsquemaEvaluacionAnual } from '@/lib/esquemaFase/useEsquemaFase';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { VolverArriba } from '@/components/shared/VolverArriba';
import { Button } from '@/components/ui/button';
import { iniciarRonda, iniciarRondaMultisitio, type TipoRonda } from '@/api/rondas';
import { IniciarRondaLote, invalidarTrasIniciar, motivoFallo } from './IniciarRondaLote';
import { BarraAvance, ChipEstadoPlanilla, PildorasFiltro, horaModificacion } from './PlanillaPiezas';
import { Paginacion } from '@/components/shared/Paginacion';
import { usePaginacionUrl } from '@/lib/usePaginacionUrl';
import { buscarPorCodigo } from '@/lib/buscarCodigo';
import { quitarDesde } from './recorrido';
import { ChipEstado, MarcaVisitaNueva, aRevisar, corto, faltanObligatorios, visitaNuevaEnBorrador } from './filaPlanilla';
import { MatrizValores } from './MatrizValores';
import { MarcarNoEvaluada } from './MarcarNoEvaluada';
import { AvancePorPredio, SIN_PREDIO, agruparPorPredio } from './AvancePorPredio';

/** Clave de la píldora «Todos los predios» (un nombre de predio no puede ser vacío). */
const TODOS_LOS_PREDIOS = '';

type Vista = 'avance' | 'valores';
type Filtro = 'todos' | 'pendientes' | 'sin_ronda' | 'borradores' | 'revisar' | 'faltantes' | 'completas' | 'no_evaluadas';

const esPendiente = (f: FilaPlanilla) => f.estado === 'sin_iniciar' || f.estado === 'sin_ronda';

/** Cuánto dura el resaltado de la planta de la que se volvió (G13). */
const MS_RESALTADO = 3000;

/** Orden de las píldoras. */
const FILTROS: readonly Filtro[] = ['todos', 'pendientes', 'sin_ronda', 'borradores', 'revisar', 'faltantes', 'completas', 'no_evaluadas'];
const leerFiltro = (valor: string | null): Filtro | null => ((FILTROS as readonly string[]).includes(valor ?? '') ? (valor as Filtro) : null);

const CUMPLE: Record<Exclude<Filtro, 'faltantes'>, (f: FilaPlanilla) => boolean> = {
  todos: () => true,
  // Sprint 1.1: «Pendientes» = con la ronda iniciada y sin evaluar; «Sin ronda» va aparte.
  pendientes: (f) => f.estado === 'sin_iniciar',
  sin_ronda: (f) => f.estado === 'sin_ronda',
  // U-09: también las filas cerradas con un borrador de visita nueva encima.
  borradores: (f) => f.estado === 'borrador' || visitaNuevaEnBorrador(f),
  revisar: aRevisar,
  completas: (f) => f.estado === 'completa',
  // Fase 5 (G3): marcadas «No evaluada en esta ronda».
  no_evaluadas: (f) => f.estado === 'no_evaluada',
};

const ETIQUETA_FILTRO: Record<Filtro, string> = {
  todos: 'Todos',
  pendientes: 'Sin empezar',
  sin_ronda: 'Sin ronda',
  borradores: 'Borradores',
  revisar: 'Revisar',
  faltantes: 'Con faltantes',
  completas: 'Cerradas',
  no_evaluadas: 'No evaluadas',
};

function BarraObligatorios({ llenos, total }: { llenos: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="tabular-nums text-ink-2">{llenos}/{total}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-track" aria-hidden="true">
        <span className="block h-full rounded-full bg-brand" style={{ width: `${(llenos / total) * 100}%` }} />
      </span>
    </span>
  );
}

/** Rondas 1..N de la serie (N = la vigente); la elegida va marcada. Solo con dos o más rondas. */
function SelectorRonda({ vigente, elegida, tipo, onElegir }: { vigente: number; elegida: number; tipo: TipoRonda; onElegir: (numero: number) => void }) {
  return (
    <div role="group" aria-label={`Ronda de la serie ${tipo}`} className="flex flex-col gap-1 max-md:w-full">
      <span className="text-small text-ink-3">Ronda</span>
      <div className="inline-flex rounded-md border border-line bg-neutral-l p-0.5 max-md:w-full">
        {Array.from({ length: vigente }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={n === elegida}
            onClick={() => onElegir(n)}
            className={cn(
              'min-h-tap whitespace-nowrap rounded-[6px] px-3 text-small max-md:flex-1',
              n === elegida ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
            )}
          >
            {n === vigente ? `Ronda ${n} · vigente` : `Ronda ${n}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** «Avance» o «Ver valores» (solo admin, solo escritorio: la matriz es ancha). */
function SelectorVista({ vista, onElegir }: { vista: Vista; onElegir: (vista: Vista) => void }) {
  return (
    <div role="group" aria-label="Vista de la planilla" className="inline-flex rounded-md border border-line bg-neutral-l p-0.5 max-md:hidden">
      {(['avance', 'valores'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={vista === v}
          onClick={() => onElegir(v)}
          className={cn('min-h-tap rounded-[6px] px-3 text-small', vista === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
        >
          {v === 'avance' ? 'Avance' : 'Ver valores'}
        </button>
      ))}
    </div>
  );
}

/** «Iniciar ronda» de una sola planta (cualquier usuario; la RPC valida). */
function BotonIniciarRonda({ fila, numero, plantaId, tipo }: { fila: FilaPlanilla; numero: number; plantaId: string; tipo: TipoRonda }) {
  const queryClient = useQueryClient();
  const inicio = useMutation({
    mutationFn: () => (tipo === 'multisitio' ? iniciarRondaMultisitio : iniciarRonda)(fila.individuo_id, numero),
    onSettled: () => invalidarTrasIniciar(queryClient, plantaId),
  });
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Button size="sm" variant="outline" disabled={inicio.isPending} onClick={() => inicio.mutate()}>
        {inicio.isPending ? 'Iniciando…' : `Iniciar ronda ${numero}`}
      </Button>
      {inicio.isError && <span role="alert" className="max-w-[16rem] text-right text-small text-danger">{motivoFallo(inicio.error)}</span>}
    </span>
  );
}

export function PlanillaRonda({
  plantaId,
  esAdmin,
  tipo = 'anual',
  predioDe,
  miNombre,
  onAbrir,
  onEvaluar,
  onDefinirProtocolo,
}: {
  plantaId: string;
  esAdmin: boolean;
  /** Serie de la ronda: la anual (por defecto) o la multisitio (contador propio). */
  tipo?: TipoRonda;
  /**
   * Solo multisitio: nombre del predio de cada individuo (null = sin emplazamiento). Con él la planilla muestra el
   * avance de cada predio y se puede filtrar por predio. Debe ser estable entre renders. Nunca ordena ni compara predios.
   */
  predioDe?: (individuoId: string) => string | null;
  /** Nombre corto de quien usa la app: se muestra como evaluador en las evaluaciones propias que lo dejaron vacío (U-20). */
  miNombre?: string | null;
  /** Selecciona el individuo en el expediente. */
  onAbrir: (individuoId: string) => void;
  /**
   * Abre el formulario de evaluación del individuo. G11/G13: recibe el filtro con que se abrió (para que «Siguiente» lo
   * siga) y la URL de esta planilla (para volver igual que estaba).
   */
  onEvaluar: (individuoId: string, contexto?: { filtro: string; planilla: string }) => void;
  /** Sin esta función no se ofrece definir ni cambiar el protocolo (hoy solo la serie anual tiene editor). */
  onDefinirProtocolo?: (planilla: Planilla) => void;
}) {
  const esquema = useEsquemaEvaluacionAnual();
  const navigate = useNavigate();
  const ubicacion = useLocation();
  const [parametros, setParametros] = useParametrosUrl();
  // G13: filtro y búsqueda en la URL (null = el filtro por omisión: en celular se sale a terreno y van primero los pendientes).
  const filtro = leerFiltro(parametros.get('filtro'));
  const busqueda = parametros.get('q') ?? '';
  const desde = parametros.get('desde');
  const avisoVuelta = (ubicacion.state as { aviso?: string } | null)?.aviso ?? null;
  // Cambiar el filtro o la búsqueda vuelve a la página 1 y olvida la planta de la que se volvió.
  const fijarEnUrl = (clave: 'filtro' | 'q', valor: string) => setParametros((p) => {
    if (valor) p.set(clave, valor); else p.delete(clave);
    p.delete('pag');
    p.delete('desde');
  });
  const setFiltro = (f: Filtro) => fijarEnUrl('filtro', f);
  const setBusqueda = (texto: string) => fijarEnUrl('q', texto);
  // Fase 5 (G3): la ronda de una planta que el admin está marcando como «No evaluada».
  const [marcando, setMarcando] = useState<{ rondaId: string; numero: number; codigo: string } | null>(null);
  const vigenteQuery = useQuery({ queryKey: qk.protocolo.planilla(plantaId, undefined, tipo), queryFn: () => obtenerPlanillaRonda(plantaId, undefined, tipo) });
  // S3-2: la ronda que se mira (null = la vigente). Una ronda anterior se pide por su número a la misma RPC.
  const [rondaElegida, setRondaElegida] = useState<number | null>(null);
  const numeroVigente = vigenteQuery.data?.numero_ronda ?? null;
  const rondaPasada = rondaElegida !== null && numeroVigente !== null && rondaElegida < numeroVigente ? rondaElegida : null;
  const esPasada = rondaPasada !== null;
  const pasadaQuery = useQuery({
    queryKey: qk.protocolo.planilla(plantaId, rondaPasada ?? 0, tipo),
    queryFn: () => obtenerPlanillaRonda(plantaId, rondaPasada!, tipo),
    enabled: esPasada,
  });
  const query = esPasada ? pasadaQuery : vigenteQuery;
  const planilla = query.data;
  // «Ver valores» vive en el hash (#valores) para poder enlazarlo; solo un admin lo obtiene, un operario siempre ve el avance.
  const vista: Vista = esAdmin && ubicacion.hash === '#valores' ? 'valores' : 'avance';
  const elegirVista = (v: Vista) => navigate({ pathname: ubicacion.pathname, search: ubicacion.search, hash: v === 'valores' ? '#valores' : '' }, { replace: true });
  const descriptores = planilla?.protocolo?.descriptores ?? null;

  const todasLasFilas = useMemo(() => planilla?.individuos ?? [], [planilla]);
  // Multisitio: el predio elegido acota la lista y los conteos; el encabezado sigue midiendo toda la ronda.
  const grupos = useMemo(() => (predioDe ? agruparPorPredio(todasLasFilas, predioDe) : []), [todasLasFilas, predioDe]);
  const [predioElegido, setPredioElegido] = useState<string | null>(null);
  const predioActivo = predioElegido !== null && grupos.some((g) => g.predio === predioElegido) ? predioElegido : null;
  const filas = useMemo(
    () => (predioActivo !== null && predioDe ? todasLasFilas.filter((f) => (predioDe(f.individuo_id) ?? SIN_PREDIO) === predioActivo) : todasLasFilas),
    [todasLasFilas, predioActivo, predioDe],
  );
  // U-06: «Con faltantes» = cerradas con obligatorios sin medir (un subconjunto de «Completas», como «Revisar»).
  const cumple = useMemo(() => (clave: Filtro, f: FilaPlanilla) => (clave === 'faltantes' ? faltanObligatorios(f, descriptores, esquema) > 0 : CUMPLE[clave](f)), [descriptores, esquema]);
  const conteos = useMemo(
    () => Object.fromEntries(FILTROS.map((clave) => [clave, filas.filter((f) => cumple(clave, f)).length])) as Record<Filtro, number>,
    [filas, cumple],
  );
  const enCelular = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;
  const filtroActivo: Filtro = filtro ?? (enCelular && !esPasada && conteos.pendientes > 0 ? 'pendientes' : 'todos');
  // G14: el número exacto primero; dentro de cada nivel, el orden de recorrido.
  const visibles = useMemo(
    () => buscarPorCodigo(filas.filter((f) => cumple(filtroActivo, f)), busqueda, (f) => ({ codigo: f.codigo_display, numero: f.numero })),
    [filas, filtroActivo, busqueda, cumple],
  );
  // En una ronda anterior no se recorre ni se evalúa: no hay «siguiente».
  const siguiente = esPasada ? undefined : filas.find((f) => f.estado === 'sin_iniciar') ?? filas.find((f) => (f.estado === 'borrador' && f.es_mia) || (visitaNuevaEnBorrador(f) && f.borrador_mio));
  // Paginación (G18): los filtros, la búsqueda y los conteos son sobre todo el cruce; solo se dibuja una página.
  const paginacion = usePaginacionUrl(visibles, { reinicio: [predioActivo, rondaPasada] });
  const { pagina } = paginacion;

  // G13: al volver de evaluar, la página de la planta de la que se volvió (o donde estaría, si ya no cumple el filtro),
  // con la planta visible y resaltada un momento. Se hace una vez por cada `desde`, cuando la planilla ya cargó.
  const [resaltada, setResaltada] = useState<string | null>(null);
  const desdeAtendido = useRef<string | null>(null);
  const planillaLista = !!query.data;
  useEffect(() => {
    if (!desde || !planillaLista || desdeAtendido.current === desde) return;
    desdeAtendido.current = desde;
    let indice = visibles.findIndex((f) => f.individuo_id === desde);
    if (indice >= 0) setResaltada(desde);
    else {
      const numero = todasLasFilas.find((f) => f.individuo_id === desde)?.numero ?? null;
      const despues = numero === null ? -1 : visibles.findIndex((f) => (f.numero ?? Infinity) > numero);
      indice = despues < 0 ? visibles.length - 1 : Math.max(0, despues - 1);
    }
    const objetivo = paginacion.paginaDe(indice);
    if (objetivo !== paginacion.actual) paginacion.irA(objetivo);
  }, [desde, planillaLista, visibles, todasLasFilas, paginacion]);
  const paginaActual = paginacion.actual;
  useLayoutEffect(() => {
    // La fila existe recién cuando se dibuja su página: se intenta en cada cambio de página mientras dure el resaltado.
    if (resaltada) document.querySelector(`[data-individuo="${resaltada}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [resaltada, paginaActual]);
  useEffect(() => {
    if (!resaltada) return undefined;
    const t = setTimeout(() => setResaltada(null), MS_RESALTADO);
    return () => clearTimeout(t);
  }, [resaltada]);
  const evaluar = (individuoId: string) => onEvaluar(individuoId, { filtro: filtroActivo, planilla: quitarDesde(`${ubicacion.pathname}${ubicacion.search}`) });

  const selector = numeroVigente !== null && numeroVigente >= 2
    ? <SelectorRonda vigente={numeroVigente} elegida={rondaPasada ?? numeroVigente} tipo={tipo} onElegir={(n) => setRondaElegida(n === numeroVigente ? null : n)} />
    : null;

  // Mismo armazón que la planilla (el selector queda en el mismo sitio del árbol): al cambiar de ronda no se pierde el foco.
  const armazon = (resto: ReactNode) => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">{selector}{resto}</div>
    </div>
  );
  if (query.isPending) {
    return armazon(<p role="status" className="text-small text-ink-3">{esPasada ? `Cargando planilla de la ronda ${rondaPasada}…` : 'Cargando planilla de ronda…'}</p>);
  }
  if (query.isError || !planilla) {
    return armazon(
      <Alert>
        No se pudo cargar la planilla de ronda.{' '}
        <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Reintentar</Button>
      </Alert>,
    );
  }
  if (planilla.numero_ronda === null && todasLasFilas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center">
        <ClipboardList className="h-5 w-5 text-ink-3" />
        <p className="text-body text-ink-3">Este cruce todavía no tiene individuos vivos para evaluar.</p>
      </div>
    );
  }
  // Sin ninguna ronda todavía: la planilla muestra a los vivos para iniciar la ronda 1.
  const numero = planilla.numero_ronda ?? 1;
  const conNumero: Planilla = { ...planilla, numero_ronda: numero };

  const { avance } = planilla;
  const porRevisar = todasLasFilas.filter(aRevisar).length;
  const pendientes = avance.sin_iniciar;
  const secciones = resumenSecciones(esquema, descriptores);
  const nombres = (lista: string[]) => (lista.length <= 1 ? lista.join('') : `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`);
  const conObligatorios = secciones.filter((s) => s.obligatorios.length > 0).map((s) => s.etiqueta);
  const soloOpcionales = secciones.filter((s) => s.nivel === 'opcional').map((s) => s.etiqueta);
  // Fase 5 (G3): plantas que no cerraron la ronda anterior (sin evaluar o en borrador): se evalúan en esa ronda sin ir al expediente.
  const atrasadas = esPasada ? [] : todasLasFilas.filter((f) => f.anterior && (f.anterior.estado === 'sin_iniciar' || f.anterior.estado === 'borrador'));
  const primeraAtrasada = atrasadas.find((f) => f.anterior?.estado === 'sin_iniciar') ?? null;
  const evaluarEnRonda = (individuoId: string, n: number) => navigate(`/planta/${plantaId}/${tipo === 'multisitio' ? 'multisitio' : 'evaluar'}/${individuoId}?ronda=${n}`);
  // Los próximos cuatro sin evaluar, empezando por el siguiente.
  const recorrido = esPasada ? [] : filas.filter((f) => f.estado === 'sin_iniciar').slice(0, 4);
  // La columna de predio sobra si ya se eligió uno.
  const conPredio = !!predioDe && predioActivo === null;
  const nOblig = Object.values(descriptores ?? {}).filter((n) => n === 'obligatorio').length;

  // U-20: «Evaluador» es texto libre y casi siempre queda vacío al evaluar desde la app. Si hay una evaluación y no se escribió, se
  // atribuye a la cuenta solo si es mía; la de otra persona queda «—», porque esta lectura trae `es_mia` pero no el nombre de quien la creó.
  const evaluadorDe = (f: FilaPlanilla): string => f.evaluador?.trim() || (f.evaluacion_id && f.es_mia && miNombre ? miNombre : '—');
  const enlace = (texto: string, onClick: () => void) => (
    <button type="button" className="min-h-tap px-2 text-small text-brand underline-offset-4 hover:underline" onClick={onClick}>{texto}</button>
  );
  const accion = (f: FilaPlanilla): ReactNode => {
    // Ronda anterior: solo lectura. Se abre lo que hay; lo que no se evaluó queda dicho.
    if (esPasada) {
      if (!f.evaluacion_id) return <span className="whitespace-nowrap text-small text-ink-3">Sin evaluar</span>;
      return aRevisar(f) && f.estado === 'completa'
        ? <Button size="sm" variant="outline" className="border-danger-l text-danger" onClick={() => verEvaluacion(f)}>Revisar</Button>
        : enlace('Ver', () => verEvaluacion(f));
    }
    // Multisitio: quien aún no tiene predio no recibe ronda; primero se registra su traslado (en Individuos).
    if (f.estado === 'sin_ronda' && predioDe && predioDe(f.individuo_id) === null) return enlace('Registrar traslado', () => onAbrir(f.individuo_id));
    if (f.estado === 'sin_ronda') return <BotonIniciarRonda fila={f} numero={numero} plantaId={plantaId} tipo={tipo} />;
    if (f.estado === 'no_evaluada') return <span className="whitespace-nowrap text-small text-ink-3">Sin evaluar</span>;
    if (esPendiente(f)) {
      // Fase 5 (G3): el admin puede dejarla «No evaluada en esta ronda», con motivo.
      return esAdmin && f.ronda_id
        ? (
          <span className="inline-flex items-center justify-end gap-1">
            {enlace('Evaluar', () => evaluar(f.individuo_id))}
            <button
              type="button"
              aria-label={`No evaluada en la ronda ${numero} · ${corto(f)}`}
              className="min-h-tap px-2 text-small text-ink-3 underline-offset-4 hover:text-ink hover:underline"
              onClick={() => setMarcando({ rondaId: f.ronda_id as string, numero, codigo: corto(f) })}
            >
              No evaluada…
            </button>
          </span>
        )
        : enlace('Evaluar', () => evaluar(f.individuo_id));
    }
    if (f.estado === 'borrador') {
      return f.es_mia || esAdmin
        ? <Button size="sm" variant="outline" onClick={() => evaluar(f.individuo_id)}>Continuar</Button>
        : <span className="whitespace-nowrap text-small text-ink-3">De otra persona</span>;
    }
    const principal = aRevisar(f)
      ? <Button size="sm" variant="outline" className="border-danger-l text-danger" onClick={() => verEvaluacion(f)}>Revisar</Button>
      : enlace('Ver', () => verEvaluacion(f));
    // U-09: solo su autor puede continuar el borrador de la visita nueva; si es de otra persona, queda el marcador sin acción.
    return puedeContinuarVisita(f)
      ? <span className="inline-flex items-center justify-end gap-1">{principal}{enlace('Continuar visita', () => evaluar(f.individuo_id))}</span>
      : principal;
  };
  const puedeContinuarVisita = (f: FilaPlanilla) => !esPasada && visitaNuevaEnBorrador(f) && f.borrador_mio === true;
  // Una evaluación cerrada se lee a pantalla completa (docs/diseno/v2/02).
  const verEvaluacion = (f: FilaPlanilla) => (f.evaluacion_id ? navigate(`/planta/${plantaId}/evaluacion/${f.evaluacion_id}`) : onAbrir(f.individuo_id));
  // Celular: la fila entera es el botón; un borrador ajeno abre el expediente.
  const tocarFila = (f: FilaPlanilla) => {
    if (esPasada) { if (f.evaluacion_id) verEvaluacion(f); else onAbrir(f.individuo_id); return; }
    // El toque en una fila cerrada abre su lectura, también con un borrador de visita nueva encima (U-09): continuar la visita es un control aparte.
    if (f.estado === 'sin_iniciar' || (f.estado === 'borrador' && (f.es_mia || esAdmin))) evaluar(f.individuo_id);
    else if (f.estado === 'completa') verEvaluacion(f);
    else onAbrir(f.individuo_id);
  };

  return (
    <div className="space-y-4">
      {/* Encabezado: avance de la ronda, protocolo y siguiente del recorrido. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {selector}
        <div className="min-w-0 flex-1 space-y-1.5 sm:min-w-[18rem]">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-body text-ink">
            <span>
              <span className="font-semibold">Ronda {numero}</span>
              <span className="text-ink-3"> · {tipo} · </span>
              <span className="tabular-nums">{avance.completa} de {avance.vivos} cerradas</span>
            </span>
          </p>
          <BarraAvance avance={{ vivos: avance.vivos, completas: avance.completa, porRevisar, borradores: avance.borrador, pendientes, sinRonda: avance.sin_ronda, noEvaluadas: avance.no_evaluada ?? 0 }} />
        </div>
        <p className="min-w-0 max-w-sm flex-1 text-small text-ink-2 max-md:hidden">
          {planilla.protocolo ? (
            <>
              Protocolo «{planilla.protocolo.nombre}» (versión {planilla.protocolo.version}):{' '}
              {nOblig} obligatorios
              {conObligatorios.length > 0 && ` (${nombres(conObligatorios)})`}.
              {soloOpcionales.length > 0 && ` ${nombres(soloOpcionales)}: opcional.`}
            </>
          ) : 'Esta ronda no tiene protocolo: no hay descriptores obligatorios.'}
        </p>
        <div className="flex flex-wrap gap-2 max-md:w-full">
          {esAdmin && onDefinirProtocolo && !esPasada && (
            <Button size="sm" variant="outline" onClick={() => onDefinirProtocolo(conNumero)}>
              <Settings2 className="h-3.5 w-3.5" /> {planilla.protocolo ? 'Cambiar protocolo' : 'Definir protocolo'}
            </Button>
          )}
          {siguiente && (
            <Button size="sm" className="max-md:min-h-[52px] max-md:w-full max-md:text-body-l" onClick={() => evaluar(siguiente.individuo_id)}>
              Evaluar siguiente · <span className="font-mono">{corto(siguiente)}</span>
            </Button>
          )}
        </div>
      </div>

      {esPasada && (
        <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-2">
          <span>Ronda anterior, solo lectura: se abre cada evaluación, pero no se inicia ni se evalúa.</span>
          <button type="button" className="min-h-tap text-brand underline-offset-4 hover:underline" onClick={() => setRondaElegida(null)}>Ir a la ronda {numeroVigente}</button>
        </p>
      )}

      {avisoVuelta && <p role="status" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-small text-ink-2">{avisoVuelta}</p>}

      {esAdmin && !esPasada && <IniciarRondaLote plantaId={plantaId} planilla={planilla} tipo={tipo} elegible={predioDe && ((f) => predioDe(f.individuo_id) !== null)} onDefinirProtocolo={onDefinirProtocolo && (() => onDefinirProtocolo(conNumero))} />}

      {!esPasada && atrasadas.length > 0 && (
        <section aria-label="Pendientes de la ronda anterior" className="space-y-2 rounded-lg border border-warn bg-warn-l p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-body font-semibold text-ink">Pendientes de la ronda anterior</h3>
              <p className="text-small text-ink-2">
                {atrasadas.length === 1 ? '1 planta no cerró' : `${atrasadas.length} plantas no cerraron`} la ronda {numero - 1}. Evalúalas en esa ronda
                {esAdmin ? ' o márcalas como no evaluadas' : ''} para que puedan entrar a la ronda {numero}.
              </p>
            </div>
            {primeraAtrasada && (
              <Button size="sm" variant="outline" onClick={() => evaluarEnRonda(primeraAtrasada.individuo_id, numero - 1)}>
                Evaluar pendientes de la ronda {numero - 1}
              </Button>
            )}
          </div>
          <ul className="divide-y divide-line rounded-md border border-line bg-surface">
            {atrasadas.map((f) => (
              <li key={f.individuo_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-small text-ink">{corto(f)}</span>
                  <ChipEstadoPlanilla estado={f.anterior?.estado === 'borrador' ? 'borrador' : 'pendiente'} />
                </span>
                <span className="inline-flex items-center gap-1">
                  <Button size="sm" variant="outline" aria-label={`Evaluar la ronda ${numero - 1} · ${corto(f)}`} onClick={() => evaluarEnRonda(f.individuo_id, numero - 1)}>
                    {f.anterior?.estado === 'borrador' ? 'Continuar' : 'Evaluar'} ronda {numero - 1}
                  </Button>
                  {esAdmin && f.anterior?.estado === 'sin_iniciar' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`No evaluada en la ronda ${numero - 1} · ${corto(f)}`}
                      onClick={() => setMarcando({ rondaId: (f.anterior as NonNullable<FilaPlanilla['anterior']>).ronda_id, numero: numero - 1, codigo: corto(f) })}
                    >
                      No evaluada…
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {marcando && <MarcarNoEvaluada plantaId={plantaId} rondaId={marcando.rondaId} numeroRonda={marcando.numero} codigo={marcando.codigo} onCerrar={() => setMarcando(null)} />}

      {predioDe && grupos.length > 0 && (
        <section aria-label="Predios" className="space-y-3">
          <PildorasFiltro
            etiqueta="Filtrar por predio"
            opciones={[
              { clave: TODOS_LOS_PREDIOS, etiqueta: 'Todos los predios', conteo: todasLasFilas.length },
              ...grupos.map((g) => ({ clave: g.predio, etiqueta: g.predio, conteo: g.vivos })),
            ]}
            activa={predioActivo ?? TODOS_LOS_PREDIOS}
            onElegir={(clave) => setPredioElegido(clave === TODOS_LOS_PREDIOS ? null : clave)}
          />
          <AvancePorPredio grupos={grupos} />
        </section>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-tap min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink-3 md:max-w-xs">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="sr-only">Buscar individuo por número o código</span>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Número o código"
                className="min-w-0 flex-1 bg-transparent py-2 text-body text-ink outline-none placeholder:text-ink-3"
              />
            </label>
            <Button type="button" variant="outline" onClick={() => navigate('/escanear')}>
              <ScanQrCode className="h-4 w-4" /> <span className="max-md:hidden">Escanear </span>QR
            </Button>
          </div>

          {/* U-10: filtros y encabezado de columnas pegados bajo la barra superior (69 px) al recorrer una planilla larga. */}
          <div className="sticky top-[69px] z-[9] flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-surface py-2 max-md:flex-nowrap">
            <PildorasFiltro
              enUnaLinea
              etiqueta="Filtrar individuos"
              opciones={FILTROS
                .filter((f) => (f !== 'sin_ronda' && f !== 'faltantes' && f !== 'no_evaluadas') || conteos[f] > 0 || filtroActivo === f)
                .map((f) => ({ clave: f, etiqueta: ETIQUETA_FILTRO[f], conteo: conteos[f] }))}
              activa={filtroActivo}
              onElegir={setFiltro}
            />
            {esAdmin && <SelectorVista vista={vista} onElegir={elegirVista} />}
          </div>

          {visibles.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-small text-ink-3">Ningún individuo con ese filtro.</p>
          ) : (
            <>
              {/* Escritorio, «Ver valores» (solo admin): matriz de valores. */}
              {vista === 'valores' && (
                <MatrizValores
                  plantaId={plantaId}
                  numero={numero}
                  tipo={tipo}
                  filas={pagina}
                  descriptores={descriptores}
                  esquema={esquema}
                  onAbrir={onAbrir}
                  onVer={verEvaluacion}
                />
              )}
              {/* Escritorio: tabla de avance. */}
              {vista === 'avance' && <table className="hidden w-full text-left text-small md:table">
                <caption className="sr-only">Individuos de la ronda {numero} en orden de recorrido</caption>
                <thead className="sticky top-[135px] z-[8] border-b border-line bg-surface text-ink-3">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-normal">Individuo</th>
                    {conPredio && <th scope="col" className="py-2 pr-3 font-normal">Predio</th>}
                    <th scope="col" className="py-2 pr-3 font-normal">Estado</th>
                    <th scope="col" className="py-2 pr-3 font-normal">Obligatorios</th>
                    <th scope="col" className="py-2 pr-3 font-normal">Nota</th>
                    <th scope="col" className="py-2 pr-3 font-normal">Evaluador</th>
                    <th scope="col" className="py-2 pr-3 font-normal">Modificado</th>
                    <th scope="col" className="py-2 text-right font-normal"><span className="sr-only">Acción</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.map((f) => {
                    const oblig = contarObligatoriosDeEstados(descriptores, f.estados, esquema);
                    return (
                      <tr
                        key={f.individuo_id}
                        data-individuo={f.individuo_id}
                        data-resaltada={resaltada === f.individuo_id ? 'true' : undefined}
                        className={cn('border-b border-line-soft transition-colors duration-700', siguiente?.individuo_id === f.individuo_id && 'bg-brand-l', resaltada === f.individuo_id && 'bg-warn-l')}
                      >
                        <td className="py-1.5 pr-3"><button type="button" className="min-h-tap font-mono text-ink underline-offset-4 hover:text-brand hover:underline" title="Abrir en Individuos" onClick={() => onAbrir(f.individuo_id)}>{corto(f)}</button></td>
                        {conPredio && <td className="max-w-[10rem] truncate whitespace-nowrap py-1.5 pr-3 text-ink-2" title={predioDe(f.individuo_id) ?? SIN_PREDIO}>{predioDe(f.individuo_id) ?? SIN_PREDIO}</td>}
                        <td className="py-1.5 pr-3"><span className="flex flex-wrap items-center gap-1.5"><ChipEstado fila={f} descriptores={descriptores} /><MarcaVisitaNueva fila={f} /></span></td>
                        <td className="py-1.5 pr-3">{f.estados && oblig.total > 0 ? <BarraObligatorios {...oblig} /> : <span className="text-ink-3">—</span>}</td>
                        <td className={cn('py-1.5 pr-3', aRevisar(f) ? 'text-danger' : 'text-ink-2')}>{notaFila(esquema, descriptores, f)}</td>
                        <td className="max-w-[9rem] truncate whitespace-nowrap py-1.5 pr-3 text-ink-2" title={evaluadorDe(f) ?? undefined}>{evaluadorDe(f)}</td>
                        <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums text-ink-3">{f.evaluacion_updated_at ? horaModificacion(f.evaluacion_updated_at) : '—'}</td>
                        <td className="py-1.5 text-right">{accion(f)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}

              {/* Celular: filas táctiles en orden de recorrido. */}
              <ul className="space-y-2 md:hidden">
                {pagina.map((f) => {
                  const oblig = contarObligatoriosDeEstados(descriptores, f.estados, esquema);
                  const nota = notaFila(esquema, descriptores, f);
                  const esSiguiente = siguiente?.individuo_id === f.individuo_id;
                  const ajeno = f.estado === 'borrador' && !f.es_mia && !esAdmin;
                  return (
                    <li key={f.individuo_id} data-individuo={f.individuo_id} data-resaltada={resaltada === f.individuo_id ? 'true' : undefined}>
                      <div className={cn('overflow-hidden rounded-lg border bg-surface transition-colors duration-700', esSiguiente ? 'border-brand ring-1 ring-brand' : 'border-line', resaltada === f.individuo_id && 'bg-warn-l')}>
                      <button
                        type="button"
                        onClick={() => tocarFila(f)}
                        className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left"
                      >
                        <span className="w-14 shrink-0 font-mono text-body-l font-semibold text-ink">{corto(f)}</span>
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <ChipEstado fila={f} descriptores={descriptores} />
                            <MarcaVisitaNueva fila={f} />
                            {f.estados && oblig.total > 0 && <span className={cn('text-small tabular-nums', faltanObligatorios(f, descriptores, esquema) > 0 ? 'text-warn' : 'text-ink-3')}>{oblig.llenos}/{oblig.total}</span>}
                            {conPredio && <span className="text-small text-ink-3">{predioDe(f.individuo_id) ?? SIN_PREDIO}</span>}
                            {esSiguiente && <span className="text-small text-brand">siguiente</span>}
                            {ajeno && <span className="text-small text-ink-3">de otra persona</span>}
                          </span>
                          {nota && <span className={cn('block truncate text-small', aRevisar(f) ? 'text-danger' : 'text-ink-3')}>{nota}</span>}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                      </button>
                      {puedeContinuarVisita(f) && (
                        <div className="border-t border-line-soft px-4">
                          <button type="button" onClick={() => evaluar(f.individuo_id)} className="min-h-tap text-small font-semibold text-brand underline-offset-4 hover:underline">Continuar visita</button>
                        </div>
                      )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <Paginacion estado={paginacion} sufijo={visibles.length !== filas.length ? ` (de ${filas.length} vivos)` : undefined} />
            </>
          )}
        </div>

        {/* Escritorio ancho: lo que sigue en el recorrido y lo que hay que revisar. */}
        <aside className="hidden space-y-4 xl:block">
          {recorrido.length > 0 && (
            <section aria-label="Sigue en el recorrido" className="rounded-lg border border-line p-4">
              <h3 className="text-body font-semibold text-ink">
                Sigue en el recorrido
              </h3>
              <ul className="mt-2 divide-y divide-line-soft">
                {recorrido.map((f, i) => (
                  <li key={f.individuo_id} className="flex min-h-[44px] items-center gap-3 py-1.5">
                    <span className="w-12 font-mono text-ink">{corto(f)}</span>
                    <ChipEstado fila={f} descriptores={descriptores} />
                    {i === 0 && <Button size="sm" className="ml-auto" onClick={() => evaluar(f.individuo_id)}>Evaluar</Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {conteos.revisar > 0 && (
            <section aria-label="Por revisar" className="rounded-lg border border-line p-4">
              <h3 className="flex items-center justify-between gap-2 text-body font-semibold text-ink">
                Por revisar <span className="rounded-full bg-danger-l px-2 text-small tabular-nums text-danger">{conteos.revisar}</span>
              </h3>
              <ul className="mt-2 divide-y divide-line-soft">
                {filas.filter(aRevisar).slice(0, 3).map((f) => (
                  <li key={f.individuo_id}>
                    <button type="button" onClick={() => onAbrir(f.individuo_id)} className="flex min-h-[44px] w-full items-center gap-3 py-1.5 text-left text-small hover:bg-surface-2">
                      <span className="w-12 font-mono text-body text-ink">{corto(f)}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{notaFila(esquema, descriptores, f)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {conteos.revisar > 3 && (
                <button type="button" className="mt-1 min-h-tap text-small text-brand underline-offset-4 hover:underline" onClick={() => setFiltro('revisar')}>
                  Ver las {conteos.revisar}
                </button>
              )}
            </section>
          )}
        </aside>
      </div>

      <VolverArriba />
    </div>
  );
}
