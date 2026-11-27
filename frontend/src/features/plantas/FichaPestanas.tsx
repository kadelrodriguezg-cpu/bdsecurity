/**
 * Ficha del cruce (v3, paso 3: docs/rediseno_v3/ficha.md). UNA sola ficha para
 * todas las fases: encabezado + pestañas. Las fases con rondas (Crecimiento,
 * Evaluación anual, Multisitio, Proceso finalizado) tienen sus pestañas de
 * siempre; las demás (Sin empezar → Trasplante) tienen «Fase» (el formulario
 * de la fase), «Individuos» (si ya hay) y «Bitácora». Antes esas fases usaban
 * una ficha por zonas aparte.
 *
 * Cabecera: identidad, fases, la fase (el operario la ve como lectura; el admin
 * la cambia, U-03), linaje (solo quien lo ve), resumen de la ronda y actividad,
 * chat del cruce y, para el admin, el enlace a Administrar cruces (la gestión
 * del cruce ya no vive en la ficha, N4).
 * Debajo, solo las pestañas: nada apilado. La pestaña activa vive en la URL
 * (`?pestana=`), así sobrevive a recargar y a volver atrás. Las pestañas ya
 * visitadas quedan montadas (ocultas) para no perder un formulario a medio
 * llenar ni volver a cargar al regresar.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, MessageCircle, QrCode, Settings2 } from 'lucide-react';
import { ESTADO_LABEL, fichaTieneLinaje, type EstadoPlanta, type FichaPlanta } from '@/types/domain';
import { listarIndividuosDePlanta } from '@/api/individuos';
import { obtenerPlanillaRonda } from '@/api/protocolo';
import { obtenerUltimaActividadDeCruce } from '@/api/actividad';
import { qk } from '@/lib/queryKeys';
import { useMarcarCambiosSinGuardar } from '@/lib/cambiosSinGuardar';
import { cn } from '@/lib/utils';
import { formatearActividad } from '@/lib/v3/formatos';
import { useManualTabs } from '@/components/ui/useManualTabs';
import { Alert } from '@/components/ui/alert';
import { BarraFases } from './BarraFases';
import { AvanzarEstado } from './AvanzarEstado';
import { LinajePanel } from './LinajePanel';
import { ResumenBitacora } from './Bitacora';
import { QRGenerator } from '@/features/qr/QRGenerator';
import { EventosLista } from '@/features/eventos/EventosLista';
import { FaseFormulario } from '@/features/fases/FaseFormulario';
import { TrasplanteWorkspace } from '@/features/fases/TrasplanteWorkspace';
import { useAuth } from '@/features/auth/AuthContext';
import { ResumenFinal } from '@/features/fases/ResumenFinal';
import { EvaluacionAnualWorkspace } from '@/features/individuos/EvaluacionAnualWorkspace';
import { useChatPanel } from '@/features/chat/ChatPanelContext';
import { PlanillaCrecimiento } from '@/features/crecimiento/PlanillaCrecimiento';
import { useFilasCrecimiento } from '@/features/crecimiento/filas';
import { PlanillaMultisitio } from '@/features/multisitio/PlanillaMultisitio';

export type Pestana = 'fase' | 'planilla' | 'ranking' | 'individuos' | 'procedimientos' | 'multisitio' | 'resumen' | 'bitacora';

const ETIQUETA: Record<Pestana, string> = {
  fase: 'Fase',
  planilla: 'Planilla de ronda',
  ranking: 'Ranking',
  individuos: 'Individuos',
  procedimientos: 'Procedimientos',
  multisitio: 'Multisitio',
  resumen: 'Resumen',
  bitacora: 'Bitácora',
};

/** Pestañas por fase. La primera de cada lista es la de entrada. «Individuos» en las fases sin rondas aparece solo si ya hay individuos. */
const SIN_RONDAS: readonly Pestana[] = ['fase', 'individuos', 'bitacora'];
const PESTANAS: Partial<Record<EstadoPlanta, readonly Pestana[]>> = {
  sin_empezar: SIN_RONDAS,
  polinizacion: SIN_RONDAS,
  cosecha: SIN_RONDAS,
  siembra_semilla: SIN_RONDAS,
  germinacion: SIN_RONDAS,
  // En Trasplante el espacio de la fase ya es donde nacen y se listan los individuos.
  trasplante: ['fase', 'bitacora'],
  crecimiento: ['planilla', 'individuos', 'procedimientos', 'bitacora'],
  evaluacion_anual: ['planilla', 'ranking', 'individuos', 'procedimientos', 'bitacora'],
  traslado_destino: ['planilla', 'multisitio', 'individuos', 'bitacora'],
  proceso_finalizado: ['resumen', 'individuos', 'bitacora'],
};

export const fichaConPestanas = (estado: EstadoPlanta) => PESTANAS[estado] !== undefined;

/** La planilla se llama según la fase: ronda (anual y multisitio) o evaluación (Crecimiento no tiene rondas); «Fase», con el nombre de la fase. */
const etiquetaPestana = (p: Pestana, estado: EstadoPlanta) => {
  if (p === 'fase') return ESTADO_LABEL[estado];
  return p === 'planilla' && estado === 'crecimiento' ? 'Planilla de evaluación' : ETIQUETA[p];
};

function useResumenCruce(ficha: FichaPlanta) {
  const enEvaluacionAnual = ficha.estado === 'evaluacion_anual';
  const enCrecimiento = ficha.estado === 'crecimiento';
  const enMultisitio = ficha.estado === 'traslado_destino';
  const actividad = useQuery({ queryKey: qk.actividad.planta(ficha.id), queryFn: () => obtenerUltimaActividadDeCruce(ficha.id) });
  const individuos = useQuery({ queryKey: qk.individuos.lista(ficha.id), queryFn: () => listarIndividuosDePlanta(ficha.id) });
  // Misma consulta (y caché) que la planilla.
  const planilla = useQuery({ queryKey: qk.protocolo.planilla(ficha.id), queryFn: () => obtenerPlanillaRonda(ficha.id), enabled: enEvaluacionAnual });
  // Mismas consultas (y caché) que las planillas de Multisitio y de Crecimiento.
  const planillaMultisitio = useQuery({ queryKey: qk.protocolo.planilla(ficha.id, undefined, 'multisitio'), queryFn: () => obtenerPlanillaRonda(ficha.id, undefined, 'multisitio'), enabled: enMultisitio });
  const crecimiento = useFilasCrecimiento(ficha.id, enCrecimiento);
  return { enEvaluacionAnual, enCrecimiento, enMultisitio, actividad, individuos, planilla, planillaMultisitio, crecimiento };
}

/** Línea de avance del resumen de la cabecera: verde si no queda nada pendiente, ámbar si sí. */
function LineaAvance({ pendiente, titulo, texto }: { pendiente: boolean; titulo: string; texto: string }) {
  return (
    <p className={cn('flex items-start gap-1.5', pendiente ? 'text-warn' : 'text-ok')}>
      {pendiente
        ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span><span className="font-semibold">{titulo}:</span> {texto}</span>
    </p>
  );
}

function ResumenCruce({ ficha }: { ficha: FichaPlanta }) {
  const { abrirChat } = useChatPanel();
  const { enEvaluacionAnual, enCrecimiento, enMultisitio, actividad, planilla, planillaMultisitio, crecimiento } = useResumenCruce(ficha);
  const avance = planilla.data?.avance;
  const sinEvaluar = avance ? avance.sin_iniciar + avance.borrador : 0;
  const avanceMultisitio = planillaMultisitio.data?.avance;
  const sinCerrarMultisitio = avanceMultisitio ? avanceMultisitio.sin_ronda + avanceMultisitio.sin_iniciar + avanceMultisitio.borrador : 0;
  const pendientesCrecimiento = crecimiento.filas?.filter((f) => f.estado === 'pendiente').length ?? 0;
  return (
    <div className="flex flex-col gap-3 border-t border-line-soft pt-3 text-small md:flex-row md:flex-wrap md:items-start md:gap-x-8">
      {enEvaluacionAnual && avance && planilla.data?.numero_ronda != null && (
        <p className={cn('flex items-start gap-1.5', avance.sin_ronda + sinEvaluar > 0 ? 'text-warn' : 'text-ok')}>
          {avance.sin_ronda + sinEvaluar > 0
            ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span>
            <span className="font-semibold">Ronda {planilla.data.numero_ronda}:</span>{' '}
            {avance.sin_ronda + sinEvaluar === 0
              ? 'todos los vivos tienen su evaluación cerrada.'
              : [
                avance.sin_ronda > 0 && `${avance.sin_ronda} sin ronda iniciada`,
                sinEvaluar > 0 && `${sinEvaluar} sin evaluación cerrada`,
              ].filter(Boolean).join(' · ')}
          </span>
        </p>
      )}
      {enMultisitio && avanceMultisitio && planillaMultisitio.data?.numero_ronda != null && (
        <LineaAvance
          pendiente={sinCerrarMultisitio > 0}
          titulo={`Ronda multisitio ${planillaMultisitio.data.numero_ronda}`}
          texto={sinCerrarMultisitio === 0 ? 'todos los vivos tienen su evaluación cerrada.' : `${avanceMultisitio.completa} de ${avanceMultisitio.vivos} con evaluación cerrada`}
        />
      )}
      {enCrecimiento && crecimiento.filas && crecimiento.filas.length > 0 && (
        <LineaAvance
          pendiente={pendientesCrecimiento > 0}
          titulo="Crecimiento"
          texto={pendientesCrecimiento === 0 ? 'todos los vivos tienen su evaluación.' : `${crecimiento.filas.length - pendientesCrecimiento} de ${crecimiento.filas.length} individuos evaluados`}
        />
      )}
      <p className="flex min-w-0 items-start gap-1.5 text-ink-2">
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
        {actividad.isError ? <span className="text-danger">No se pudo cargar la actividad.</span>
          : actividad.data ? (
            <span className="min-w-0">
              <span className="text-ink-3">Actividad reciente:</span> {actividad.data.detalle}
              {actividad.data.usuarioNombre && <> · {actividad.data.usuarioNombre}</>}
              <span className="text-ink-3"> · {formatearActividad(actividad.data.ocurrioEn)}</span>
            </span>
          ) : <span className="text-ink-3">{actividad.isPending ? 'Cargando actividad…' : 'Sin actividad registrada.'}</span>}
      </p>
      <button
        type="button"
        onClick={() => abrirChat({ tipo: 'cruce', entidadId: ficha.id })}
        className="inline-flex min-h-tap items-center gap-1.5 self-start font-medium text-brand hover:text-brand-d md:ml-auto md:-mt-2.5"
      >
        <MessageCircle className="h-4 w-4" aria-hidden="true" /> Abrir chat del cruce
      </button>
    </div>
  );
}

function CabeceraFicha({ ficha, especieNombre, formTocado }: { ficha: FichaPlanta; especieNombre?: string; formTocado: boolean }) {
  const tieneLinaje = fichaTieneLinaje(ficha);
  const { esAdmin } = useAuth();
  const { individuos } = useResumenCruce(ficha);
  const vivos = individuos.data?.filter((i) => i.estado_vital === 'vivo').length;
  const deBaja = individuos.data ? individuos.data.length - (vivos ?? 0) : undefined;
  return (
    <header className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-baseline gap-x-3 font-mono text-title font-semibold text-ink">
            {ficha.codigo_sistema}
            <span className="font-sans text-body font-normal text-ink-2">{especieNombre ?? 'Especie…'}</span>
          </h1>
          <p className="text-small tabular-nums text-ink-3">
            {individuos.data ? `${vivos} individuos vivos · ${deBaja} dados de baja` : ' '}
          </p>
        </div>
        {/* La gestión del cruce (archivar, reiniciar, purgar) vive solo en Administrar cruces (N4). */}
        {esAdmin && (
          <Link
            to={`/cruzamientos?cruce=${ficha.id}`}
            className="inline-flex min-h-tap items-center gap-1.5 text-small font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" /> Gestionar en Administrar cruces
          </Link>
        )}
      </div>
      <BarraFases actual={ficha.estado} />
      <AvanzarEstado plantaId={ficha.id} estadoActual={ficha.estado} formTocado={formTocado} />
      {tieneLinaje && <LinajePanel ficha={ficha} />}
      <ResumenCruce ficha={ficha} />
    </header>
  );
}

function PestanaBitacora({ ficha }: { ficha: FichaPlanta }) {
  const tieneLinaje = fichaTieneLinaje(ficha);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="ficha-historial" className="min-w-0 space-y-2">
        <h2 id="ficha-historial" className="text-body font-semibold text-ink">Historial</h2>
        <EventosLista plantaId={ficha.id} codigoSistema={ficha.codigo_sistema} estadoCruce={ficha.estado} />
      </section>
      {tieneLinaje && (
        <div className="space-y-4">
          <section aria-labelledby="ficha-bitacora" className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <h2 id="ficha-bitacora" className="text-body font-semibold text-ink">Bitácora</h2>
            <ResumenBitacora plantaId={ficha.id} />
          </section>
          <section aria-labelledby="ficha-qr" className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <h2 id="ficha-qr" className="flex items-center gap-1.5 text-body font-semibold text-ink"><QrCode className="h-4 w-4" aria-hidden="true" /> Código QR</h2>
            <QRGenerator plantaId={ficha.id} codigoSistema={ficha.codigo_sistema} compacto />
          </section>
        </div>
      )}
    </div>
  );
}

export function FichaConPestanas({ ficha, especieNombre, volverA, individuoFocoId, focoAusente }: {
  ficha: FichaPlanta;
  especieNombre?: string;
  volverA: string;
  individuoFocoId: string | null;
  focoAusente: boolean;
}) {
  const individuosCruce = useQuery({ queryKey: qk.individuos.lista(ficha.id), queryFn: () => listarIndividuosDePlanta(ficha.id) });
  const hayIndividuos = (individuosCruce.data?.length ?? 0) > 0;
  const pestanas = useMemo(
    () => (PESTANAS[ficha.estado] ?? []).filter((p) => p !== 'individuos' || PESTANAS[ficha.estado] !== SIN_RONDAS || hayIndividuos),
    [ficha.estado, hayIndividuos],
  );
  const [busqueda, setBusqueda] = useSearchParams();
  const pedida = busqueda.get('pestana') as Pestana | null;
  // Abierta desde la etiqueta de un individuo: se entra por Individuos.
  const porDefecto: Pestana = individuoFocoId && pestanas.includes('individuos') ? 'individuos' : pestanas[0];
  const activa: Pestana = pedida && pestanas.includes(pedida) ? pedida : porDefecto;
  const elegir = (p: Pestana) => setBusqueda((actual) => {
    const siguiente = new URLSearchParams(actual);
    siguiente.set('pestana', p);
    return siguiente;
  }, { replace: true });
  const tabs = useManualTabs(pestanas, activa, elegir);

  const [visitadas, setVisitadas] = useState<ReadonlySet<Pestana>>(() => new Set([activa]));
  useEffect(() => { setVisitadas((v) => (v.has(activa) ? v : new Set(v).add(activa))); }, [activa]);
  const [formTocado, setFormTocado] = useState(false);
  useEffect(() => setFormTocado(false), [ficha.estado]);
  // Cosecha y demás formularios de fase (vía onTocadoChange): sin guardar = sin recarga automática.
  useMarcarCambiosSinGuardar(formTocado);

  const esAnual = ficha.estado === 'evaluacion_anual';
  // Desde la planilla, un código abre al individuo en su pestaña (donde están su expediente y su traslado).
  const abrirIndividuo = useCallback((individuoId: string) => setBusqueda((actual) => {
    const siguiente = new URLSearchParams(actual);
    siguiente.set('pestana', 'individuos');
    siguiente.set('individuo', individuoId);
    return siguiente;
  }), [setBusqueda]);
  const contenido = useMemo<Partial<Record<Pestana, ReactNode>>>(() => ({
    fase: ficha.estado === 'trasplante'
      ? <TrasplanteWorkspace plantaId={ficha.id} codigoSistema={ficha.codigo_sistema} individuoFocoId={individuoFocoId} />
      : <FaseFormulario plantaId={ficha.id} codigoSistema={ficha.codigo_sistema} estado={ficha.estado} onTocadoChange={setFormTocado} />,
    planilla: ficha.estado === 'crecimiento'
      ? <PlanillaCrecimiento plantaId={ficha.id} onAbrir={abrirIndividuo} />
      : <PlanillaMultisitio plantaId={ficha.id} onAbrir={abrirIndividuo} />,
    procedimientos: <FaseFormulario plantaId={ficha.id} codigoSistema={ficha.codigo_sistema} estado={ficha.estado} onTocadoChange={setFormTocado} />,
    multisitio: <FaseFormulario plantaId={ficha.id} codigoSistema={ficha.codigo_sistema} estado={ficha.estado} onTocadoChange={setFormTocado} />,
    resumen: <ResumenFinal ficha={ficha} especieNombre={especieNombre} />,
    // v3 paso 4 (N16): la misma lista y el mismo expediente que en Evaluación anual, también aquí.
    individuos: esAnual ? null : (
      <EvaluacionAnualWorkspace plantaId={ficha.id} codigoSistema={ficha.codigo_sistema} individuoFocoId={individuoFocoId} pestana="individuos" estadoCruce={ficha.estado} onIrAIndividuos={() => undefined} />
    ),
    bitacora: <PestanaBitacora ficha={ficha} />,
  }), [ficha, especieNombre, esAnual, individuoFocoId, abrirIndividuo]);

  // En Evaluación anual, Planilla, Ranking e Individuos los dibuja un único
  // workspace que vive mientras dure la ficha (estado compartido entre ellas).
  const pestanaWorkspace = esAnual && (activa === 'planilla' || activa === 'ranking' || activa === 'individuos') ? activa : null;

  return (
    <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen overflow-x-clip px-4 sm:px-8">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <nav aria-label="Volver al contexto">
          <Link to={volverA} className="inline-flex min-h-tap items-center gap-2 text-small font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Volver a la lista o vista anterior
          </Link>
        </nav>
        {focoAusente && <Alert role="status">No se encontró ese individuo en este cruce. Se muestra la ficha completa.</Alert>}
        <CabeceraFicha ficha={ficha} especieNombre={especieNombre} formTocado={formTocado} />

        <div role="tablist" aria-label="Secciones de la ficha" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          {pestanas.map((p) => (
            <button
              key={p}
              {...tabs.tabProps(p)}
              className={cn(
                'min-h-tap shrink-0 whitespace-nowrap border-b-2 px-3 text-body transition-colors motion-reduce:transition-none',
                activa === p ? 'border-brand font-semibold text-ink' : 'border-transparent text-ink-3 hover:text-ink',
              )}
            >
              {etiquetaPestana(p, ficha.estado)}
            </button>
          ))}
        </div>

        {/* Una sola instancia del workspace (misma posición en el árbol): al
            pasar de Planilla a Individuos conserva la selección y el protocolo en edición. */}
        {esAnual && (
          <div key="workspace" {...(pestanaWorkspace ? tabs.panelProps(pestanaWorkspace) : {})} hidden={!pestanaWorkspace}>
            <EvaluacionAnualWorkspace
              plantaId={ficha.id}
              codigoSistema={ficha.codigo_sistema}
              individuoFocoId={individuoFocoId}
              pestana={pestanaWorkspace}
              onIrAIndividuos={() => elegir('individuos')}
            />
          </div>
        )}
        {pestanas.map((p) => {
          const delWorkspace = esAnual && (p === 'planilla' || p === 'ranking' || p === 'individuos');
          if (delWorkspace) return p === pestanaWorkspace ? null : <div key={p} {...tabs.panelProps(p)} hidden />;
          return (
            <div key={p} {...tabs.panelProps(p)} hidden={activa !== p}>
              {visitadas.has(p) && contenido[p]}
            </div>
          );
        })}
      </div>
    </div>
  );
}
