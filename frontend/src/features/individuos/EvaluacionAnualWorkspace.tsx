/**
 * Maestro-detalle de individuos (Ronda 2 UI). Nació para Evaluación anual; desde
 * v3 paso 4 (N16) su lista y su expediente son LA lista de individuos de todas
 * las fases con individuos, también Trasplante (paso 5, N22: la lista vieja
 * IndividuosSeccion se borró). La fase (`estadoCruce`) decide qué acciones
 * ofrece el expediente.
 *
 * Ronda 2b: Actividad reciente/Alertas se mudaron a Zona D
 * (features/plantas/ContextoLateral.tsx, misma lógica, sin duplicarla acá)
 * y el panel de KPIs de 4 tiles se disolvió en la línea de metadatos del
 * encabezado del explorador de individuos — ya no se calcula por separado
 * en este archivo. Lo que queda: Ranking (RankingTabla, sin cambios) +
 * lista/expediente.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, ListChecks, Search, Sprout, X } from 'lucide-react';
import { esEtiquetable, listarIndividuosDePlanta, ESTADO_VITAL_LABEL, type Individuo } from '@/api/individuos';
import { empatesPorIndividuo, obtenerRankingPorGrupos, sinEvaluacionCompleta } from '@/api/rankingGrupos';
import { formatearPuntaje01 } from '@/features/ranking/formato';
import { cn } from '@/lib/utils';
import { Workspace, Panel } from '@/components/ui/workspace';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RankingTabla } from './RankingTabla';
import { qk } from '@/lib/queryKeys';
import { useSeleccionMultiple, type SeleccionMultiple } from '@/lib/useSeleccionMultiple';
import { AccionesSeleccionIndividuos } from './seleccion/AccionesSeleccionIndividuos';
import { ExpedienteIndividuo } from './ExpedienteIndividuo';
import { useAuth } from '@/features/auth/AuthContext';
import { nombreCorto } from '@/lib/nombres';
import { Sheet } from '@/components/ui/sheet';
import { obtenerPlanillaRonda, type PlanillaRonda as Planilla } from '@/api/protocolo';
import { PlanillaRonda } from '@/features/evaluaciones/PlanillaRonda';
import { ProtocoloRondaEditor } from '@/features/evaluaciones/ProtocoloRondaEditor';
import { parametrosRecorrido } from '@/features/evaluaciones/recorrido';
import { buscarPorCodigo } from '@/lib/buscarCodigo';
import { useEsEscritorio } from '@/lib/useEsEscritorio';
import type { EstadoPlanta } from '@/types/domain';

const chipEstado = (estado: Individuo['estado_vital']) => ({
  vivo: 'bg-ok-l text-ok',
  descartado: 'bg-neutral-l text-ink-2',
  muerto: 'bg-neutral-l text-ink-3',
}[estado]);

export function EvaluacionAnualWorkspace({
  plantaId,
  codigoSistema,
  individuoFocoId = null,
  pestana,
  onIrAIndividuos,
  estadoCruce = 'evaluacion_anual',
}: {
  plantaId: string;
  codigoSistema: string;
  /** Individuo al que se abrió la ficha (`?individuo=`, p. ej. al escanear su etiqueta). Solo selecciona y desplaza: no ejecuta ninguna acción. */
  individuoFocoId?: string | null;
  /**
   * Sprint 1.1: la ficha de Evaluación anual va en pestañas. El workspace queda
   * montado mientras dure la ficha (conserva selección, mensajes y protocolo en
   * edición) y muestra solo la parte de la pestaña activa; null = ninguna.
   */
  pestana: 'planilla' | 'ranking' | 'individuos' | null;
  /** Pide a la ficha que muestre la pestaña Individuos (p. ej. al tocar un código en la planilla). */
  onIrAIndividuos: () => void;
  /** v3 paso 4: la lista y el expediente sirven a todas las fases con individuos; la fase decide las acciones del expediente. */
  estadoCruce?: EstadoPlanta;
}) {
  const [sel, setSel] = useState<string | null>(null);
  // En el celular, 'detalle' abre el expediente en una hoja sobre la lista (en escritorio siempre está al lado).
  const [vistaMovil, setVistaMovil] = useState<'lista' | 'detalle'>('lista');
  const esEscritorio = useEsEscritorio();
  const [filtro, setFiltro] = useState('');
  const [soloVivos, setSoloVivos] = useState(false);
  const listaRef = useRef<ListaMaestraHandle>(null);
  const { esAdmin, perfil } = useAuth();
  // Pedido de la planilla para abrir el formulario del individuo seleccionado (contador: cada clic es un pedido nuevo).
  const [solicitudEvaluacion, setSolicitudEvaluacion] = useState(0);
  const [protocoloEnEdicion, setProtocoloEnEdicion] = useState<Planilla | null>(null);
  const [protocoloTocado, setProtocoloTocado] = useState(false);

  const individuosQuery = useQuery({
    queryKey: qk.individuos.lista(plantaId),
    queryFn: () => listarIndividuosDePlanta(plantaId),
  });
  // Puntaje, puesto y «pendiente de evaluación» salen del ranking por grupos del cruce (misma clave de caché que
  // RankingGeneral y RankingTabla): ninguna pantalla puede decir algo distinto del ranking.
  const rankingQuery = useQuery({
    queryKey: qk.ranking.grupos({ plantaId, especieId: undefined, incluirPruebas: false }),
    queryFn: () => obtenerRankingPorGrupos({ plantaId, especieId: undefined, incluirPruebas: false }),
  });
  // Misma consulta (y caché) que PlanillaRonda.
  const planillaQuery = useQuery({
    queryKey: qk.protocolo.planilla(plantaId),
    queryFn: () => obtenerPlanillaRonda(plantaId),
  });

  const individuos = individuosQuery.data;
  const ranking = rankingQuery.data;
  const rankingConfirmado = rankingQuery.isSuccess;
  const fallidas = [{ nombre: 'individuos', query: individuosQuery }, { nombre: 'ranking', query: rankingQuery }].filter(({ query }) => query.isError);

  const focoEnLista = !!individuoFocoId && !!individuos?.some((i) => i.id === individuoFocoId);
  useEffect(() => {
    if (!sel && individuos && individuos.length > 0) setSel(focoEnLista ? individuoFocoId : individuos[0].id);
  }, [individuos, sel, focoEnLista, individuoFocoId]);

  const rankingPorIndividuo = useMemo(() => new Map((ranking?.items ?? []).map((s) => [s.individuo_id, s])), [ranking]);
  const empates = useMemo(() => empatesPorIndividuo(ranking?.items ?? []), [ranking]);

  const vivos = (individuos ?? []).filter((i) => i.estado_vital === 'vivo');
  // Pendiente = sin evaluación completa en la ronda actual; un puntaje nulo por revisión no es «pendiente».
  const sinEvaluar = vivos.filter((i) => {
    const item = rankingPorIndividuo.get(i.id);
    return !item || sinEvaluacionCompleta(item);
  });

  // Memoizada porque además de renderizar la lista es el ámbito de
  // "seleccionar todos": recrearla en cada render obligaría al hook de
  // selección a rearmar su índice de visibles cada vez.
  // Fase 5 (G14): el número exacto primero (P78 antes que P178), igual que en la planilla.
  const lista = useMemo(
    () => buscarPorCodigo(
      (individuos ?? []).filter((i) => !soloVivos || i.estado_vital === 'vivo'),
      filtro,
      (i) => ({ codigo: i.codigo_display, numero: null }),
    ),
    [individuos, soloVivos, filtro],
  );

  const seleccionar = (id: string) => {
    setSel(id);
    setVistaMovil('detalle');
  };

  const individuoSel = (individuos ?? []).find((i) => i.id === sel);

  const navigate = useNavigate();
  const abrirDesdePlanilla = (id: string, evaluar: boolean, contexto?: { filtro: string; planilla: string }) => {
    // Con la ronda ya iniciada, la evaluación se hace a pantalla completa
    // (docs/diseno/v2/04); si no, el individuo se abre en la pestaña Individuos.
    // Fase 5 (G11, G13): la ruta lleva el filtro de la planilla y su URL, para seguir el filtro y volver igual.
    if (evaluar && planillaQuery.data?.individuos.find((f) => f.individuo_id === id)?.ronda_id) {
      navigate(`/planta/${plantaId}/evaluar/${id}${contexto ? `?${parametrosRecorrido(contexto.filtro, contexto.planilla)}` : ''}`);
      return;
    }
    seleccionar(id);
    desplazarA.current = id;
    if (evaluar) setSolicitudEvaluacion((n) => n + 1);
    onIrAIndividuos();
  };

  // La lista virtualizada solo existe en la pestaña Individuos: al llegar a
  // ella se desplaza al individuo pedido desde otra pestaña.
  const desplazarA = useRef<string | null>(null);
  useEffect(() => {
    if (pestana !== 'individuos' || !desplazarA.current) return;
    const id = desplazarA.current;
    desplazarA.current = null;
    const indice = lista.findIndex((i) => i.id === id);
    if (indice >= 0) requestAnimationFrame(() => listaRef.current?.scrollToIndex(indice));
  }, [pestana, lista]);

  // Posicionamiento al abrir la ficha desde la etiqueta de un individuo: una vez
  // por individuo pedido (no pisa la selección que haga el usuario después).
  // Es equivalente a tocar esa fila: selecciona, la centra en la lista
  // virtualizada y, en móvil, muestra su expediente.
  const focoAplicado = useRef<string | null>(null);
  useEffect(() => {
    if (!individuoFocoId || !focoEnLista || focoAplicado.current === individuoFocoId) return;
    focoAplicado.current = individuoFocoId;
    setSel(individuoFocoId);
    setVistaMovil('detalle');
    const indice = lista.findIndex((i) => i.id === individuoFocoId);
    if (indice >= 0) listaRef.current?.scrollToIndex(indice);
  }, [individuoFocoId, focoEnLista, lista]);

  // Selección múltiple para acciones en lote (etiquetas y, para admin, dar de
  // baja), con la barra compartida seleccion/AccionesSeleccionIndividuos.
  //
  // El universo (`items`) es el cruce COMPLETO y la vista filtrada (`visibles`)
  // va aparte: son dos cosas distintas a propósito. Lo marcado se cuenta contra
  // el cruce, así que sobrevive a escribir o borrar en el buscador; en cambio
  // "Seleccionar todos" abarca solo lo que se está viendo, para que buscar un
  // código puntual y apretar el botón no termine marcando los 378.
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const listaCompleta = useMemo(() => individuos ?? [], [individuos]);
  const seleccion = useSeleccionMultiple<Individuo>({
    items: listaCompleta,
    obtenerId: (individuo) => individuo.id,
    esSeleccionable: esEtiquetable,
    visibles: lista,
  });
  const { limpiar } = seleccion;

  const salirDeSeleccion = () => {
    limpiar();
    setModoSeleccion(false);
  };

  const pl = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);
  const metaExplorador = individuos
    ? `${individuos.length} ${pl(individuos.length, 'individuo', 'individuos')} · ${vivos.length} ${pl(vivos.length, 'vivo', 'vivos')} · ${individuos.length - vivos.length} de baja · ${rankingConfirmado ? `${sinEvaluar.length} ${pl(sinEvaluar.length, 'pendiente', 'pendientes')} de evaluación` : 'Pendientes de evaluación sin confirmar'}`
    : undefined;

  const crearExpediente = (enHoja: boolean) => (individuoSel ? (
    <ExpedienteIndividuo
      esAdmin={esAdmin}
      individuo={individuoSel}
      plantaId={plantaId}
      codigoSistema={codigoSistema}
      ranking={rankingPorIndividuo.get(individuoSel.id)}
      empatadoCon={empates.get(individuoSel.id)}
      onVolver={() => setVistaMovil('lista')}
      solicitudEvaluacion={solicitudEvaluacion}
      enHoja={enHoja}
      estadoCruce={estadoCruce}
    />
  ) : null);
  const expediente = crearExpediente(false);

  if (pestana === null) return null;
  if (!individuos) return individuosQuery.isError
    ? <Alert>No se pudieron cargar los individuos. <Button variant="outline" disabled={individuosQuery.isFetching} onClick={() => void individuosQuery.refetch()}>Reintentar individuos</Button></Alert>
    : <EsqueletoPestana etiqueta="Cargando individuos…" />;
  if (individuos.length === 0 && individuosQuery.isSuccess) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-body text-ink-3">
        Este cruce todavía no tiene individuos individualizados.
      </div>
    );
  }

  const sheetProtocolo = protocoloEnEdicion && protocoloEnEdicion.numero_ronda !== null && (
    <Sheet
      titulo={protocoloEnEdicion.protocolo ? 'Cambiar protocolo' : 'Definir protocolo'}
      subtitulo={`${codigoSistema} · ronda ${protocoloEnEdicion.numero_ronda}`}
      onCerrar={() => setProtocoloEnEdicion(null)}
      hayContenido={protocoloTocado}
      size="ancho"
    >
      <ProtocoloRondaEditor
        plantaId={plantaId}
        numeroRonda={protocoloEnEdicion.numero_ronda}
        actual={protocoloEnEdicion.protocolo?.descriptores ?? null}
        nombreActual={protocoloEnEdicion.protocolo?.nombre}
        onGuardado={() => setProtocoloEnEdicion(null)}
        onCancelar={() => setProtocoloEnEdicion(null)}
        onTocadoChange={setProtocoloTocado}
      />
    </Sheet>
  );
  const avisos = (
    <>
      {fallidas.map(({ nombre, query }) => <Alert key={nombre}>No se pudo actualizar {nombre}. Los datos disponibles pueden estar desactualizados. <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Reintentar {nombre}</Button></Alert>)}
    </>
  );

  if (pestana === 'planilla') {
    return (
      <div className="space-y-3.5">
        {avisos}
        <Workspace>
          <Panel titulo="Planilla de ronda">
            <PlanillaRonda
              plantaId={plantaId}
              esAdmin={esAdmin}
              miNombre={nombreCorto(perfil?.nombre)}
              onAbrir={(id) => abrirDesdePlanilla(id, false)}
              onEvaluar={(id, contexto) => abrirDesdePlanilla(id, true, contexto)}
              onDefinirProtocolo={(planilla) => { setProtocoloTocado(false); setProtocoloEnEdicion(planilla); }}
            />
          </Panel>
        </Workspace>
        {sheetProtocolo}
      </div>
    );
  }

  if (pestana === 'ranking') {
    return (
      <Workspace>
        <Panel titulo="Ranking">
          <RankingTabla plantaId={plantaId} individuos={individuos} />
        </Panel>
      </Workspace>
    );
  }

  return (
    <div className="space-y-3.5">
      {avisos}
      {!ranking && !rankingQuery.isError && <p role="status" className="text-small text-ink-3">Cargando ranking…</p>}
      {/*
        v3 paso 3 (docs/rediseno_v3/ficha.md): una sola lista. En escritorio
        (768 px o más, N12) el expediente es un panel lateral junto a la lista;
        en el celular la lista queda siempre visible y el expediente se abre en
        una hoja encima (antes reemplazaba a la lista).
      */}
      <Workspace>
        <div className="grid grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
          <ListaMaestra
            ref={listaRef}
            lista={lista}
            seleccionado={sel}
            onSeleccionar={seleccionar}
            rankingPorIndividuo={rankingPorIndividuo}
            filtro={filtro}
            onFiltroChange={setFiltro}
            soloVivos={soloVivos}
            onSoloVivosChange={setSoloVivos}
            meta={metaExplorador}
            modoSeleccion={modoSeleccion}
            onEntrarSeleccion={() => setModoSeleccion(true)}
            onSalirSeleccion={salirDeSeleccion}
            seleccion={seleccion}
            className="md:border-r md:border-line-soft"
          />
          {esEscritorio && (
            <div className="max-h-[560px] overflow-y-auto">
              {expediente ?? <div className="p-6 text-center text-body text-ink-3">Selecciona un individuo de la lista.</div>}
            </div>
          )}
        </div>
      </Workspace>

      {!esEscritorio && vistaMovil === 'detalle' && individuoSel && (
        <Sheet titulo={individuoSel.codigo_display} onCerrar={() => setVistaMovil('lista')} size="ancho">
          {crearExpediente(true)}
        </Sheet>
      )}

      {modoSeleccion && (
        <AccionesSeleccionIndividuos
          seleccion={seleccion}
          individuos={listaCompleta}
          codigoSistema={codigoSistema}
          onSalir={salirDeSeleccion}
        />
      )}
    </div>
  );
}

/** Esqueleto con la forma de una pestaña: ocupa su lugar definitivo mientras carga. */
export function EsqueletoPestana({ etiqueta = 'Cargando…' }: { etiqueta?: string }) {
  return (
    <div role="status" className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <span className="sr-only">{etiqueta}</span>
      <div aria-hidden="true" className="h-5 w-48 animate-pulse rounded bg-track motion-reduce:animate-none" />
      <div aria-hidden="true" className="h-2 w-full animate-pulse rounded bg-track motion-reduce:animate-none" />
      {Array.from({ length: 6 }, (_, i) => <div key={i} aria-hidden="true" className="h-10 w-full animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />)}
    </div>
  );
}

export interface ListaMaestraHandle {
  scrollToIndex: (index: number) => void;
}

// Altura real medida de una fila renderizada (min-h-tap + padding vertical
// py-2.5): fija a propósito, es lo que permite calcular posiciones sin medir
// cada nodo. Si el diseño de la fila cambia, hay que remedir.
const ALTURA_FILA_PX = 48;
// Recuadro con scroll interno propio, ~16 filas visibles a la vez — el resto
// del cruce (hasta el total real) se monta/desmonta al hacer scroll en vez
// de vivir entero en el DOM.
const ALTURA_LISTA_PX = ALTURA_FILA_PX * 16;

const ListaMaestra = forwardRef<
  ListaMaestraHandle,
  {
    lista: Individuo[];
    seleccionado: string | null;
    onSeleccionar: (id: string) => void;
    rankingPorIndividuo: Map<string, { puntaje: number | null }>;
    filtro: string;
    onFiltroChange: (v: string) => void;
    soloVivos: boolean;
    onSoloVivosChange: (v: boolean) => void;
    /** Línea de metadatos discreta: "N individuos · N vivos · N de baja · N pendientes de evaluación". */
    meta?: string;
    /** Modo de selección activo (etiquetas, baja en lote): cada fila muestra su checkbox. */
    modoSeleccion: boolean;
    onEntrarSeleccion: () => void;
    onSalirSeleccion: () => void;
    /** Selección sobre el cruce completo (no sobre `lista`, que está filtrada). */
    seleccion: SeleccionMultiple<Individuo>;
    className?: string;
  }
>(function ListaMaestra(
  {
    lista,
    seleccionado,
    onSeleccionar,
    rankingPorIndividuo,
    filtro,
    onFiltroChange,
    soloVivos,
    onSoloVivosChange,
    meta,
    modoSeleccion,
    onEntrarSeleccion,
    onSalirSeleccion,
    seleccion,
    className,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizador = useVirtualizer({
    count: lista.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ALTURA_FILA_PX,
    overscan: 8,
  });

  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number) => virtualizador.scrollToIndex(index, { align: 'center' }),
  }), [virtualizador]);

  return (
    <Panel className={className}>
      <div className="mb-3 pt-3">
        <div className="flex items-start justify-between gap-2">
          <span className="text-small font-semibold text-ink-2">Explorador de individuos</span>
          {modoSeleccion ? (
            <Button size="sm" variant="outline" onClick={onSalirSeleccion}>
              <X className="h-3.5 w-3.5" /> Salir
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onEntrarSeleccion}>
              <ListChecks className="h-3.5 w-3.5" /> Seleccionar
            </Button>
          )}
        </div>
        {meta && <p className="mt-0.5 text-small text-ink-3">{meta}</p>}
      </div>

      <div className="mb-2 flex gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-2.5 text-ink-3">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={filtro}
            onChange={(e) => onFiltroChange(e.target.value)}
            aria-label="Buscar individuo por código"
            placeholder="Buscar código…"
            className="min-w-0 flex-1 bg-transparent py-2 text-body text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <button
          type="button"
          onClick={() => onSoloVivosChange(!soloVivos)}
          aria-pressed={soloVivos}
          className={cn(
            'min-h-tap shrink-0 whitespace-nowrap rounded-md border px-2.5 text-small font-semibold',
            soloVivos ? 'border-primary bg-brand-l text-brand-ink' : 'border-line-strong bg-surface-2 text-ink-2',
          )}
        >
          Solo vivos
        </button>
      </div>
      {lista.length === 0 ? (
        <ul className="-mx-4">
          <li className="flex flex-col items-center gap-1.5 py-6 text-center">
            <Sprout className="h-5 w-5 text-ink-3" />
            <p className="text-small text-ink-3">Ningún individuo coincide con el filtro.</p>
          </li>
        </ul>
      ) : (
        <div ref={scrollRef} className="-mx-4 overflow-y-auto" style={{ height: Math.min(ALTURA_LISTA_PX, lista.length * ALTURA_FILA_PX) }}>
          <ul className="relative w-full" style={{ height: virtualizador.getTotalSize() }}>
            {virtualizador.getVirtualItems().map((fila) => {
              const i = lista[fila.index];
              const score = rankingPorIndividuo.get(i.id)?.puntaje ?? null;
              return (
                <li
                  key={i.id}
                  className="absolute left-0 top-0 w-full"
                  style={{ height: fila.size, transform: `translateY(${fila.start}px)` }}
                >
                  {/* El checkbox va DENTRO de la altura fija de la fila (h-full),
                      nunca encima ni debajo: ALTURA_FILA_PX es lo que usa el
                      virtualizador para calcular posiciones, así que el modo
                      selección no puede cambiar cuánto mide una fila. */}
                  <div className="flex h-full items-center">
                  {modoSeleccion && (
                    <label
                      className={cn(
                        'flex h-full shrink-0 items-center pl-3',
                        seleccion.puedeSeleccionar(i.id) ? 'cursor-pointer' : 'cursor-not-allowed',
                      )}
                      title={
                        seleccion.puedeSeleccionar(i.id)
                          ? undefined
                          : `${ESTADO_VITAL_LABEL[i.estado_vital]}: no se etiquetan individuos dados de baja`
                      }
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary disabled:opacity-40"
                        checked={seleccion.estaSeleccionado(i.id)}
                        disabled={!seleccion.puedeSeleccionar(i.id)}
                        onChange={() => seleccion.alternar(i.id)}
                        aria-label={`Seleccionar ${i.codigo_display}`}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => onSeleccionar(i.id)}
                    className={cn(
                      'flex h-full min-h-tap w-full items-center gap-2.5 border-l-[3px] border-transparent px-4 text-left',
                      seleccionado === i.id && 'border-primary bg-brand-l',
                      i.estado_vital !== 'vivo' && 'opacity-60',
                    )}
                  >
                    <span className="font-mono text-body font-semibold">{i.codigo_display.split('-').pop()}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-micro font-medium', chipEstado(i.estado_vital))}>
                      {i.estado_vital === 'vivo' ? 'Vivo' : i.estado_vital === 'descartado' ? 'Descartado' : 'Muerto'}
                    </span>
                    <span className="ml-auto tabular-nums text-body text-ink-2">{formatearPuntaje01(score, 2)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-ink-3" />
                  </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
});
