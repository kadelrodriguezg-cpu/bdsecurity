import { useManualTabs } from '@/components/ui/useManualTabs';
/**
 * Expediente de un individuo dentro del maestro-detalle de Evaluación anual
 * (Ronda 2 UI). Tabs Resumen / Evaluaciones / PCR — reemplaza el scroll
 * único que crecía indefinidamente con los años (6+ rondas y PCRs).
 *
 * Solo se monta cuando el cruce está en fase 'evaluacion_anual' (ver
 * EvaluacionAnualWorkspace). Reutiliza las mismas funciones de api/rondas.ts
 * con las MISMAS query keys que RondasSeccion/EvaluacionesLista/PcrLista
 * (fuera de alcance, sin tocar) — así la invalidación de caché existente ya
 * refresca este componente también.
 *
 * Individuo vivo: todas las secciones + acciones (Nueva evaluación / PCR /
 * Clonar / Marcar baja). Descartado o muerto: banner de baja, cero botones
 * de acción, tabs de historial siguen navegables en solo lectura.
 *
 * Sprint 1.2: la evaluación anual se abre a pantalla completa
 * (EvaluarIndividuoPage) y al cerrar vuelve a este expediente; «Iniciar ronda
 * N+1» exige la ronda actual cerrada (solo frontend, la base todavía no lo
 * exige: Sprint 2).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQueries, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronLeft, FileText, ClipboardList, Beaker, FileDown, Info, CalendarPlus, Copy, Ban, QrCode } from 'lucide-react';
import { listarRondas, listarEvaluacionesDeRonda, listarPcrDeRonda, iniciarRonda, buscarBorradorDeRonda, quitarRondaNoEvaluada, urlFirmadaPdfPcr, type EvaluacionRow, type PcrRow } from '@/api/rondas';
import { mensajeInicioRonda } from '@/lib/confirmacionRonda';
import { listarBajaMotivos, listarReactivaciones, reactivarIndividuo, clonarIndividuo, ESTADO_VITAL_LABEL, CRITERIO_BAJA_LABEL, type Individuo } from '@/api/individuos';
import { ESTADO_RANKING_LABEL, type ItemRankingGrupos } from '@/api/rankingGrupos';
import { CATEGORIA_CORTA, formatearPuntaje01 } from '@/features/ranking/formato';
import { ordenarGrupo } from '@/api/scoring';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { qk } from '@/lib/queryKeys';
import { QRGenerator } from '@/features/qr/QRGenerator';
import { PcrForm } from './PcrForm';
import { BajaForm } from './BajaForm';
import { resumenDescriptores } from './DetalleEvaluacion';
import { AccionesFaseIndividuo } from './AccionesFaseIndividuo';
import type { EstadoPlanta } from '@/types/domain';
import type { Correccion } from '@/api/correcciones';
import { textoCorreccion, useCorrecciones } from '@/features/evaluaciones/HistorialCorrecciones';
import { formatearActividad, formatearFecha } from '@/lib/v3/formatos';
import { temporadaDeRonda } from '@/lib/temporada';
import { etiquetaMotivoNoEvaluada, etiquetaAnio, textoEmpate } from '@/lib/etiquetas';
import { MarcarNoEvaluada } from '@/features/evaluaciones/MarcarNoEvaluada';
import { invalidarTrasIniciar } from '@/features/evaluaciones/IniciarRondaLote';

const chipEstado = (estado: Individuo['estado_vital']) => ({
  vivo: 'bg-ok-l text-ok',
  descartado: 'bg-neutral-l text-ink-2',
  muerto: 'bg-neutral-l text-ink-3',
}[estado]);

type ModalTipo = 'pcr' | 'baja' | null;
type Seccion = 'resumen' | 'evaluaciones' | 'pcr';

export function ExpedienteIndividuo({
  individuo,
  plantaId,
  codigoSistema,
  ranking,
  empatadoCon,
  onVolver,
  enHoja = false,
  estadoCruce = 'evaluacion_anual',
  solicitudEvaluacion = 0,
  esAdmin = false,
}: {
  individuo: Individuo;
  plantaId: string;
  codigoSistema: string;
  /** Fila del individuo en el ranking por grupos del cruce (puntaje y puesto en su grupo). */
  ranking: ItemRankingGrupos | undefined;
  /** G19: con cuántos otros individuos de su grupo comparte el puesto. */
  empatadoCon?: number;
  onVolver?: () => void;
  /** Dentro de una hoja (celular): la hoja ya muestra el código y se cierra con su X; no se repiten. */
  enHoja?: boolean;
  /** Fase del cruce (v3 paso 4): decide qué acciones propias de la fase se ofrecen. Por defecto, Evaluación anual. */
  estadoCruce?: EstadoPlanta;
  /** Pedido de la planilla de ronda para abrir el formulario (contador; cada valor nuevo es un pedido). */
  solicitudEvaluacion?: number;
  /** Fase 5 (G3): el admin puede marcar la ronda actual «No evaluada» o quitar esa marca. */
  esAdmin?: boolean;
}) {
  const queryClient = useQueryClient();
  const [seccion, setSeccion] = useState<Seccion>('resumen');
  const tabs = useManualTabs<Seccion>(['resumen', 'evaluaciones', 'pcr'], seccion, setSeccion);
  const [modal, setModal] = useState<ModalTipo>(null);
  const [tocado, setTocado] = useState(false);
  const [errorClon, setErrorClon] = useState<string | null>(null);
  const [mostrarQr, setMostrarQr] = useState(false);

  const vivo = individuo.estado_vital === 'vivo';
  const esAnual = estadoCruce === 'evaluacion_anual';
  // Mismas fases en que la lista vieja dejaba clonar (en Proceso finalizado ya no).
  const puedeClonar = ['trasplante', 'crecimiento', 'evaluacion_anual', 'traslado_destino'].includes(estadoCruce);

  const rondasQuery = useQuery({ queryKey: qk.rondas.individuo(individuo.id), queryFn: () => listarRondas(individuo.id) });
  const motivosQuery = useQuery({
    queryKey: qk.baja.motivos(individuo.id),
    queryFn: () => listarBajaMotivos(individuo.id),
    enabled: !vivo,
  });

  const rondas = rondasQuery.data;
  const motivos = motivosQuery.data;
  // Fase 5 (G4): reactivaciones de la planta (historial) y la acción del admin.
  const reactivacionesQuery = useQuery({ queryKey: [...qk.baja.motivos(individuo.id), 'reactivaciones'], queryFn: () => listarReactivaciones(individuo.id) });
  const [reactivando, setReactivando] = useState(false);
  const [motivoReactivar, setMotivoReactivar] = useState('');
  const reactivar = useMutation({
    mutationFn: () => reactivarIndividuo(individuo.id, motivoReactivar.trim()),
    onSuccess: () => {
      setReactivando(false);
      setMotivoReactivar('');
      void queryClient.invalidateQueries({ queryKey: qk.individuos.lista(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.individuos.resumen(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.baja.motivos(individuo.id) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.planta.detalle(plantaId) });
    },
  });

  const evalQueries = useQueries({
    queries: (rondas ?? []).map((r) => ({
      queryKey: qk.evaluaciones.ronda(r.id),
      queryFn: () => listarEvaluacionesDeRonda(r.id),
      enabled: !!rondas,
    })),
  });
  const pcrQueries = useQueries({
    queries: (rondas ?? []).map((r) => ({
      queryKey: qk.pcr.ronda(r.id),
      queryFn: () => listarPcrDeRonda(r.id),
      enabled: !!rondas,
    })),
  });

  const evaluacionesPorRonda = new Map<string, EvaluacionRow[]>((rondas ?? []).map((r, i) => [r.id, evalQueries[i]?.data ?? []]));
  const pcrPorRonda = new Map<string, PcrRow[]>((rondas ?? []).map((r, i) => [r.id, pcrQueries[i]?.data ?? []]));
  const todasEvaluaciones = [...evaluacionesPorRonda.values()].flat();
  const todosPcr = [...pcrPorRonda.values()].flat();

  const evaluacionesConfirmadas = rondasQuery.isSuccess && evalQueries.every((q) => q.isSuccess);
  const pcrConfirmados = rondasQuery.isSuccess && pcrQueries.every((q) => q.isSuccess);
  const actividadConfirmada = evaluacionesConfirmadas && pcrConfirmados && (vivo || motivosQuery.isSuccess);
  const estadoEvaluacion = new Map((rondas ?? []).map((r, i) => [r.id, evalQueries[i]]));
  const estadoPcr = new Map((rondas ?? []).map((r, i) => [r.id, pcrQueries[i]]));
  const lecturas = [
    { nombre: 'rondas', query: rondasQuery },
    ...(!vivo ? [{ nombre: 'motivos de baja', query: motivosQuery }] : []),
    ...evalQueries.map((query, i) => ({ nombre: 'evaluaciones de ronda ' + rondas![i].numero_ronda, query })),
    ...pcrQueries.map((query, i) => ({ nombre: 'PCR de ronda ' + rondas![i].numero_ronda, query })),
  ];
  const fallidas = lecturas.filter(({ query }) => query.isError);
  const cargandoLecturas = lecturas.some(({ query }) => query.isPending);

  const ultimaRonda = rondas && rondas.length > 0 ? [...rondas].sort((a, b) => b.numero_ronda - a.numero_ronda)[0] : null;
  const quedanRondas = (rondas?.length ?? 0) < 3;
  // La ronda está cerrada cuando tiene una evaluación completa o corregida
  // (el historial solo trae esas). Sin confirmar no se da por cerrada.
  // Fase 5 (G3): una ronda marcada «No evaluada» también cuenta como cerrada para iniciar la siguiente.
  const rondaNoEvaluada = !!ultimaRonda?.no_evaluada_motivo;
  const rondaActualCerrada = !!ultimaRonda && (rondaNoEvaluada || (
    !!estadoEvaluacion.get(ultimaRonda.id)?.isSuccess
    && (evaluacionesPorRonda.get(ultimaRonda.id)?.length ?? 0) > 0));
  const [marcandoNoEvaluada, setMarcandoNoEvaluada] = useState(false);
  const quitarNoEvaluada = useMutation({
    mutationFn: () => quitarRondaNoEvaluada(ultimaRonda!.id),
    onSuccess: () => invalidarTrasIniciar(queryClient, plantaId),
  });
  // Mismo query key que el formulario: un borrador en curso se ve acá y allá.
  const borradorQuery = useQuery({
    queryKey: qk.evaluaciones.borrador(ultimaRonda?.id ?? ''),
    queryFn: () => buscarBorradorDeRonda(ultimaRonda!.id),
    enabled: vivo && !!ultimaRonda,
  });
  const borrador = borradorQuery.data ?? null;

  // La evaluación anual se hace a pantalla completa; al cerrar o finalizar se
  // vuelve a este expediente en la pestaña Individuos.
  const navigate = useNavigate();
  const irAEvaluar = () => {
    if (!ultimaRonda) return;
    const volver = `/planta/${plantaId}?pestana=individuos&individuo=${individuo.id}`;
    navigate(`/planta/${plantaId}/evaluar/${individuo.id}?ronda=${ultimaRonda.numero_ronda}&volver=${encodeURIComponent(volver)}`);
  };

  const iniciarRondaMutacion = useMutation({
    mutationFn: (numeroEsperado: number) => iniciarRonda(individuo.id, numeroEsperado),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.rondas.individuo(individuo.id) });
      void queryClient.invalidateQueries({ queryKey: qk.individuos.resumen(plantaId) });
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
    },
    onError: () => { void queryClient.invalidateQueries({ queryKey: qk.rondas.individuo(individuo.id) }); },
  });

  const confirmarRonda = () => {
    const numero = (ultimaRonda?.numero_ronda ?? 0) + 1;
    if (window.confirm(mensajeInicioRonda(numero, 'anual'))) iniciarRondaMutacion.mutate(numero);
  };

  const clonMutacion = useMutation({
    mutationFn: () => clonarIndividuo(individuo.id, plantaId),
    onSuccess: () => {
      setErrorClon(null);
      void queryClient.invalidateQueries({ queryKey: qk.individuos.lista(plantaId) });
      // Sprint 9 (auditoría del patrón de la sección 5): el trigger
      // auditar_escritura_individuo ya audita 'creacion_individuo' en
      // cualquier INSERT (incluido un clon) — sin esto la bitácora no
      // mostraba la entrada hasta vencer el staleTime.
      void queryClient.invalidateQueries({ queryKey: qk.auditoria.planta(plantaId) });
    },
    onError: (e) => {
      setErrorClon(e instanceof Error ? e.message : 'No se pudo clonar el individuo.');
      void queryClient.invalidateQueries({ queryKey: qk.individuos.lista(plantaId) });
    },
  });

  // A8: la última corrección de cada evaluación corregida (solo se consulta si hay alguna).
  const correcciones = useCorrecciones(individuo.id, todasEvaluaciones.some((e) => e.estado === 'corregida'));
  const ultimaCorreccion = new Map<string, Correccion>();
  for (const c of correcciones.data ?? []) if (!ultimaCorreccion.has(c.evaluacion_id)) ultimaCorreccion.set(c.evaluacion_id, c);

  // Última actividad de ESTE individuo — simple, sin consultas nuevas: se
  // deriva de los datos ya cargados para las tabs Evaluaciones/PCR/baja.
  type Actividad = { tipo: 'evaluacion' | 'pcr' | 'baja'; ocurrioEn: string; detalle: string };
  const actividad: Actividad[] = [
    ...todasEvaluaciones.map((e): Actividad => ({
      tipo: 'evaluacion',
      ocurrioEn: e.created_at,
      detalle: resumenDescriptores(e),
    })),
    ...todosPcr.map((p): Actividad => ({ tipo: 'pcr', ocurrioEn: p.created_at, detalle: p.realizado ? 'Realizado' : 'No realizado' })),
    ...(motivos ?? []).map((m): Actividad => ({ tipo: 'baja', ocurrioEn: m.created_at, detalle: CRITERIO_BAJA_LABEL[m.criterio] })),
  ].sort((a, b) => new Date(b.ocurrioEn).getTime() - new Date(a.ocurrioEn).getTime());
  const ultimaActividad = actividad[0] ?? null;

  // `tocado` es un solo flag compartido por los 3 tipos de modal (evaluación/
  // PCR/baja) — se resetea explícitamente al abrir y cerrar cualquiera, para
  // que no se filtre "hay contenido sin guardar" de una sesión de sheet a la
  // siguiente (PcrForm/BajaForm no reportan su propio estado sucio, así que
  // si no se resetea, un `tocado=true` viejo de Evaluación quedaría pegado
  // al abrir después el sheet de PCR o Baja).
  const abrirModal = (tipo: Exclude<ModalTipo, null>) => {
    setTocado(false);
    setModal(tipo);
  };
  const cerrarModal = () => {
    setModal(null);
    setTocado(false);
  };

  // La planilla pide evaluar este individuo: se abre el formulario cuando su
  // ronda está confirmada (una vez por pedido).
  const solicitudAtendida = useRef(0);
  useEffect(() => {
    if (solicitudEvaluacion === 0 || solicitudEvaluacion === solicitudAtendida.current) return;
    if (!vivo || !ultimaRonda) return;
    solicitudAtendida.current = solicitudEvaluacion;
    irAEvaluar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- irAEvaluar solo depende de ultimaRonda
  }, [solicitudEvaluacion, vivo, ultimaRonda]);

  return (
    <div className="p-4">
      {cargandoLecturas && <p role="status">Cargando información del individuo…</p>}
      {fallidas.map(({ nombre, query }) => <Alert key={nombre}>No se pudieron cargar {nombre}. {query.data !== undefined ? 'Se conservan los datos disponibles.' : ''} <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Reintentar {nombre}</Button></Alert>)}
      <div className="flex items-center gap-2.5 pb-3.5">
        {onVolver && !enHoja && (
          // md:hidden: en el maestro-detalle de escritorio ambos paneles están
          // siempre visibles a la vez (no hay "atrás" al que volver); el botón
          // solo tiene sentido en el layout apilado de móvil, que reusa este
          // mismo componente en vez de una variante aparte.
          <button type="button" onClick={onVolver} className="grid min-h-tap min-w-tap place-items-center rounded-md text-ink-3 hover:bg-neutral-l md:hidden">
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>
        )}
        <div>
          {!enHoja && <div className="font-mono text-title font-semibold">{individuo.codigo_display}</div>}
          <div className="mt-1 flex gap-1.5">
            <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-micro font-medium', chipEstado(individuo.estado_vital))}>
              {ESTADO_VITAL_LABEL[individuo.estado_vital]}
            </span>
            {individuo.clon_de_id && <span className="text-small text-ink-3">(clon)</span>}
          </div>
        </div>
      </div>

      {estadoCruce !== 'evaluacion_anual' && (
        <AccionesFaseIndividuo individuo={individuo} plantaId={plantaId} codigoSistema={codigoSistema} estadoCruce={estadoCruce} />
      )}

      {!vivo && (
        <div className={'mb-3.5 rounded-md border border-line bg-surface-2 p-3'}>
          <div className="text-body font-semibold text-ink">
            {individuo.estado_vital === 'muerto' ? 'Muerte natural registrada' : 'Individuo descartado'}
            {individuo.fecha_baja && <span className="ml-1 tabular-nums font-normal">· {formatearFecha(individuo.fecha_baja)}</span>}
          </div>
          <div className="my-2 flex flex-wrap gap-1.5">
            {(motivos ?? []).map((m) => (
              <span key={m.id} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-micro text-ink-2">
                {CRITERIO_BAJA_LABEL[m.criterio]}
              </span>
            ))}
          </div>
          <div className="text-small text-ink-2">
            {esAdmin ? 'El registro se conserva íntegro para trazabilidad.' : 'Sin acciones disponibles. El registro se conserva íntegro para trazabilidad.'}
          </div>
          {esAdmin && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setReactivando(true)}>Reactivar planta</Button>
          )}
        </div>
      )}

      {(reactivacionesQuery.data ?? []).length > 0 && (
        <ul aria-label="Reactivaciones" className="mb-3.5 space-y-1 rounded-md border border-line bg-surface-2 p-3 text-small text-ink-2">
          {(reactivacionesQuery.data ?? []).map((r) => (
            <li key={r.id}>
              <span className="font-medium text-ink">Reactivada el {formatearFecha(r.created_at)}</span>
              {' · '}{r.motivo}
              <span className="text-ink-3"> (antes: {ESTADO_VITAL_LABEL[r.estado_anterior]}{r.fecha_baja_anterior ? ` el ${formatearFecha(r.fecha_baja_anterior)}` : ''})</span>
            </li>
          ))}
        </ul>
      )}

      {reactivando && (
        <Sheet
          titulo={`Reactivar ${individuo.codigo_display}`}
          onCerrar={() => { setReactivando(false); reactivar.reset(); }}
          hayContenido={motivoReactivar.trim().length > 0}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => { setReactivando(false); reactivar.reset(); }}>Cancelar</Button>
              <Button disabled={!motivoReactivar.trim() || reactivar.isPending} onClick={() => reactivar.mutate()}>{reactivar.isPending ? 'Reactivando…' : 'Reactivar'}</Button>
            </div>
          )}
        >
          <div className="space-y-3 text-small text-ink-2">
            <p>La planta vuelve a quedar viva. La baja y sus motivos se conservan en su historial, junto con esta reactivación, tu nombre y el motivo.</p>
            <div className="space-y-1">
              <label htmlFor="motivo-reactivar" className="block font-medium text-ink">Motivo (obligatorio)</label>
              <textarea
                id="motivo-reactivar"
                rows={2}
                maxLength={500}
                value={motivoReactivar}
                onChange={(e) => setMotivoReactivar(e.target.value)}
                placeholder="Ej. Baja registrada por error en otra planta"
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
              />
            </div>
            {reactivar.isError && <Alert>{reactivar.error instanceof Error ? reactivar.error.message : 'No se pudo reactivar la planta.'}</Alert>}
          </div>
        </Sheet>
      )}

      <div className="flex flex-wrap gap-0.5 rounded-md border border-line-soft bg-surface-2 p-1" role="tablist" aria-label="Secciones del individuo">
        {([
          { id: 'resumen' as const, label: 'Resumen', icon: FileText, badge: 0 },
          { id: 'evaluaciones' as const, label: 'Evaluaciones', icon: ClipboardList, badge: todasEvaluaciones.length },
          { id: 'pcr' as const, label: 'PCR', icon: Beaker, badge: todosPcr.length },
        ]).map((s) => (
          <button
            key={s.id}
            {...tabs.tabProps(s.id)}
            className={cn(
              'flex min-h-tap flex-1 shrink-0 whitespace-nowrap px-2 items-center justify-center gap-1.5 rounded-md text-small font-semibold text-ink-3',
              seccion === s.id && 'bg-surface text-brand-ink shadow-sm',
            )}
          >
            <s.icon className="h-3.5 w-3.5" /> {s.label}
            {s.badge > 0 && (
              <span className={cn('min-w-[16px] rounded-full bg-line-soft px-1.5 text-center text-micro font-medium text-ink-2', seccion === s.id && 'bg-brand-l text-brand-ink')}>
                {s.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div {...tabs.panelProps(seccion)} className="pt-3.5">
        {seccion === 'resumen' && (
          <div className="space-y-3.5">
            <div>
              <div className="text-small font-semibold text-ink-2">Última actividad</div>
              {ultimaActividad ? (
                <p className="mt-1 text-body">
                  {{ evaluacion: 'Evaluación', pcr: 'PCR', baja: 'Baja' }[ultimaActividad.tipo]} — {ultimaActividad.detalle}
                  <span className="ml-1 text-ink-3">({formatearActividad(ultimaActividad.ocurrioEn)})</span>
                </p>
              ) : (
                <p className="mt-1 text-body text-ink-3">{actividadConfirmada ? 'Sin actividad registrada.' : 'Actividad sin confirmar.'}</p>
              )}
            </div>

            {vivo && borrador && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-body">
                <span>
                  <span className="font-semibold">Borrador en curso</span>
                  <span className="text-ink-3"> · Ronda {ultimaRonda?.numero_ronda}, guardado {formatearActividad(borrador.updated_at)}</span>
                </span>
                <Button size="sm" variant="outline" onClick={irAEvaluar}>Continuar</Button>
              </div>
            )}
            {vivo && evaluacionesConfirmadas && todasEvaluaciones.length === 0 && !borrador && (borradorQuery.isSuccess || !ultimaRonda) && (
              <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-body text-ink-2">Sin evaluaciones registradas.{esAnual ? ' La primera ronda se puede cargar ahora.' : ''}</p>
            )}
            {!vivo && todasEvaluaciones.length === 0 && evaluacionesConfirmadas && (
              <p className="text-body text-ink-3">Sin evaluaciones registradas.</p>
            )}

            <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5">
              <div>
                <dt className="text-micro text-ink-3">Última evaluación</dt>
                <dd className="mt-0.5 tabular-nums text-body-l">
                  {ultimaRonda && (evaluacionesPorRonda.get(ultimaRonda.id)?.length ?? 0) > 0
                    ? `Ronda ${ultimaRonda.numero_ronda}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-micro text-ink-3">Puntaje actual</dt>
                <dd className="mt-0.5 tabular-nums text-body-l font-semibold text-brand-ink">
                  {formatearPuntaje01(ranking?.puntaje)}
                  {ranking?.puntaje != null && etiquetaAnio(ranking.numero_ronda) && <span className="font-normal text-ink-3"> · {etiquetaAnio(ranking.numero_ronda)}</span>}
                </dd>
                {ranking && (
                  <dd className="mt-0.5 text-small text-ink-3">
                    {ranking.posicion_grupo !== null
                      // G20: el puesto dice su alcance (el ranking del cruce); G19: con cuántos empata.
                      ? <>Puesto {ranking.posicion_grupo} de {ranking.tamano_grupo} dentro del cruce {codigoSistema}{textoEmpate(empatadoCon) ? ` · ${textoEmpate(empatadoCon)}` : ''} ({ordenarGrupo(ranking.grupo).map((c) => CATEGORIA_CORTA[c]).join(' · ')})</>
                      : ESTADO_RANKING_LABEL[ranking.estado_ranking]}
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-micro text-ink-3">PCR</dt>
                <dd className="mt-0.5 text-body-l">{todosPcr.length > 0 ? `${todosPcr.length} adjunto(s)` : <span className="italic text-ink-3">{pcrConfirmados ? 'sin PCR' : 'Sin confirmar'}</span>}</dd>
              </div>
              <div>
                <dt className="text-micro text-ink-3">Rondas</dt>
                <dd className="mt-0.5 tabular-nums text-body-l">{rondas ? `${rondas.length} de 3` : 'Sin confirmar'}</dd>
              </div>
            </dl>
          </div>
        )}

        {seccion === 'evaluaciones' && (
          <div className="space-y-2">
            {!rondas || (!rondasQuery.isSuccess && rondas.length === 0) ? <p>Rondas sin confirmar.</p> : rondas.length === 0 ? (
              <p className="py-4 text-center text-small text-ink-3">Sin evaluaciones registradas.</p>
            ) : (
              [...rondas].sort((a, b) => b.numero_ronda - a.numero_ronda).map((r, i) => (
                <GrupoRonda
                  key={r.id}
                  titulo={`Ronda ${r.numero_ronda}`}
                  meta={[temporadaDeRonda(r) && `Temporada ${temporadaDeRonda(r)}`, r.no_evaluada_motivo && `No evaluada · ${etiquetaMotivoNoEvaluada(r.no_evaluada_motivo, r.no_evaluada_detalle)}`].filter(Boolean).join(' · ')}
                  defaultAbierto={i === 0}
                >
                  {(evaluacionesPorRonda.get(r.id) ?? []).length === 0 && !estadoEvaluacion.get(r.id)?.isSuccess ? <p className="px-3 py-2 text-small text-ink-3">Evaluaciones sin confirmar.</p> : (evaluacionesPorRonda.get(r.id) ?? []).length === 0 ? (
                    <p className="px-3 py-2 text-small text-ink-3">Esta ronda todavía no tiene evaluaciones cargadas.</p>
                  ) : (
                    <ul className="divide-y divide-line-soft">
                      {(evaluacionesPorRonda.get(r.id) ?? []).map((ev) => <FilaEvaluacionExpediente key={ev.id} evaluacion={ev} plantaId={plantaId} correccion={ultimaCorreccion.get(ev.id)} />)}
                    </ul>
                  )}
                  {vivo && r.id === ultimaRonda?.id && (
                    <div className="px-3 pb-2.5 pt-1.5">
                      <Button size="sm" variant="outline" onClick={irAEvaluar}>{borrador ? 'Continuar borrador' : 'Nueva evaluación'}</Button>
                    </div>
                  )}
                </GrupoRonda>
              ))
            )}
          </div>
        )}

        {seccion === 'pcr' && (
          <div className="space-y-2">
            {!rondas || (!rondasQuery.isSuccess && rondas.length === 0) ? <p>Rondas sin confirmar.</p> : rondas.length === 0 ? (
              <p className="py-4 text-center text-small text-ink-3">Sin análisis PCR cargados.</p>
            ) : (
              [...rondas].sort((a, b) => b.numero_ronda - a.numero_ronda).map((r, i) => (
                <GrupoRonda key={r.id} titulo={`Ronda ${r.numero_ronda}`} meta={temporadaDeRonda(r) ? `Temporada ${temporadaDeRonda(r)}` : ''} defaultAbierto={i === 0}>
                  {(pcrPorRonda.get(r.id) ?? []).length === 0 && !estadoPcr.get(r.id)?.isSuccess ? <p className="px-3 py-2 text-small text-ink-3">PCR sin confirmar.</p> : (pcrPorRonda.get(r.id) ?? []).length === 0 ? (
                    <p className="px-3 py-2 text-small text-ink-3">Esta ronda todavía no tiene PCR cargado.</p>
                  ) : (
                    <ul className="divide-y divide-line-soft">
                      {(pcrPorRonda.get(r.id) ?? []).map((p) => <FilaPcr key={p.id} pcr={p} />)}
                    </ul>
                  )}
                  {vivo && (
                    <div className="px-3 pb-2.5 pt-1.5">
                      <Button size="sm" variant="outline" onClick={() => abrirModal('pcr')}>Adjuntar PCR</Button>
                    </div>
                  )}
                </GrupoRonda>
              ))
            )}
          </div>
        )}
      </div>

      {(['resumen', 'evaluaciones', 'pcr'] as const).filter((id) => id !== seccion).map((id) => <div key={id} {...tabs.panelProps(id)} hidden />)}

      {vivo && (
        <div className="mt-4 space-y-2.5 border-t pt-3.5">
          {/* Iniciar ronda / nueva evaluación anual: solo en Evaluación anual (v3 paso 4). */}
          {!esAnual ? null : !rondas || (!rondasQuery.isSuccess && rondas.length === 0) ? <p>Rondas sin confirmar.</p> : rondas.length === 0 ? (
            <Button size="lg" className="w-full" onClick={confirmarRonda} disabled={iniciarRondaMutacion.isPending || !rondasQuery.isSuccess || rondasQuery.isFetching}>
              <CalendarPlus className="h-4 w-4" /> {iniciarRondaMutacion.isPending ? 'Iniciando…' : 'Iniciar ronda 1'}
            </Button>
          ) : rondaNoEvaluada && ultimaRonda ? (
            <div className="space-y-1.5 rounded-md border border-line bg-surface-2 px-3 py-2 text-small text-ink-2">
              <p>Ronda {ultimaRonda.numero_ronda}: <strong className="font-medium text-ink">No evaluada · {etiquetaMotivoNoEvaluada(ultimaRonda.no_evaluada_motivo as string, ultimaRonda.no_evaluada_detalle)}</strong>. No entra al ranking de esta ronda.</p>
              {esAdmin && (
                <Button size="sm" variant="outline" onClick={() => quitarNoEvaluada.mutate()} disabled={quitarNoEvaluada.isPending}>
                  {quitarNoEvaluada.isPending ? 'Quitando…' : 'Quitar «No evaluada»'}
                </Button>
              )}
              {quitarNoEvaluada.isError && <Alert>{quitarNoEvaluada.error instanceof Error ? quitarNoEvaluada.error.message : 'No se pudo quitar la marca.'}</Alert>}
            </div>
          ) : (
            <Button size="lg" className="w-full" onClick={irAEvaluar}>{borrador ? 'Continuar borrador' : 'Nueva evaluación'}</Button>
          )}
          {iniciarRondaMutacion.isError && (
            <Alert>{iniciarRondaMutacion.error instanceof Error ? iniciarRondaMutacion.error.message : 'No se pudo iniciar la ronda.'}</Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {rondas && rondas.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => abrirModal('pcr')}>Adjuntar PCR</Button>
            )}
            {esAnual && rondas && rondas.length > 0 && quedanRondas && (
              <Button
                size="sm"
                variant="outline"
                onClick={confirmarRonda}
                disabled={!rondaActualCerrada || iniciarRondaMutacion.isPending || !rondasQuery.isSuccess || rondasQuery.isFetching}
                aria-describedby={!rondaActualCerrada ? 'motivo-siguiente-ronda' : undefined}
              >
                <CalendarPlus className="h-3.5 w-3.5" /> Iniciar ronda {rondas.length + 1}
              </Button>
            )}
            {esAdmin && esAnual && ultimaRonda && !rondaActualCerrada && !borrador && estadoEvaluacion.get(ultimaRonda.id)?.isSuccess && (
              <Button size="sm" variant="outline" onClick={() => setMarcandoNoEvaluada(true)}>
                No evaluada en la ronda {ultimaRonda.numero_ronda}…
              </Button>
            )}
            {puedeClonar && (
              <Button size="sm" variant="outline" onClick={() => clonMutacion.mutate()} disabled={clonMutacion.isPending}>
                <Copy className="h-3.5 w-3.5" /> {clonMutacion.isPending ? 'Clonando…' : 'Clonar'}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setMostrarQr((v) => !v)}>
              <QrCode className="h-3.5 w-3.5" /> Imprimir etiqueta
            </Button>
            <Button size="sm" variant="warning" onClick={() => abrirModal('baja')}>
              <Ban className="h-3.5 w-3.5" /> Marcar baja
            </Button>
          </div>
          {esAnual && rondas && rondas.length > 0 && quedanRondas && ultimaRonda && !rondaActualCerrada && estadoEvaluacion.get(ultimaRonda.id)?.isSuccess && (
            <p id="motivo-siguiente-ronda" className="text-small text-ink-3">
              Termina la ronda {ultimaRonda.numero_ronda} antes de iniciar la {ultimaRonda.numero_ronda + 1}.
            </p>
          )}
          {errorClon && <Alert>{errorClon}</Alert>}
          {mostrarQr && (
            <div className="rounded-md bg-surface-2 p-3">
              <QRGenerator plantaId={plantaId} codigoSistema={codigoSistema} individuo={{ id: individuo.id, codigo: individuo.codigo_display }} />
            </div>
          )}
        </div>
      )}

      {marcandoNoEvaluada && ultimaRonda && (
        <MarcarNoEvaluada
          plantaId={plantaId}
          rondaId={ultimaRonda.id}
          numeroRonda={ultimaRonda.numero_ronda}
          codigo={individuo.codigo_display.split('-').pop() ?? individuo.codigo_display}
          onCerrar={() => setMarcandoNoEvaluada(false)}
        />
      )}
      {modal === 'pcr' && ultimaRonda && (
        <Sheet titulo="Adjuntar PCR" subtitulo={individuo.codigo_display} onCerrar={cerrarModal} hayContenido={tocado}>
          <PcrFormConCancelar
            rondaId={ultimaRonda.id}
            plantaId={plantaId}
            codigoDisplay={individuo.codigo_display}
            onGuardado={cerrarModal}
            onCerrar={cerrarModal}
            onTocadoChange={setTocado}
          />
        </Sheet>
      )}
      {modal === 'baja' && (
        <Sheet titulo="Marcar baja" subtitulo={individuo.codigo_display} onCerrar={cerrarModal} hayContenido={tocado}>
          <BajaFormConCancelar
            individuoId={individuo.id}
            plantaId={plantaId}
            onGuardado={cerrarModal}
            onCerrar={cerrarModal}
            onTocadoChange={setTocado}
          />
        </Sheet>
      )}
    </div>
  );
}

/** Disclosure de una ronda — mismo criterio visual que SeccionColapsable, local a este archivo (evaluaciones/PCR agrupados por ronda). */
function GrupoRonda({ titulo, meta, defaultAbierto, children }: { titulo: string; meta: string; defaultAbierto: boolean; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(defaultAbierto);
  return (
    <div className="overflow-hidden rounded-md border border-line-soft">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex min-h-tap w-full items-center justify-between gap-2 bg-surface-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-body font-semibold">
          {abierto ? <ChevronDown className="h-3.5 w-3.5 text-ink-3" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-3" />}
          {titulo}
        </span>
        <span className="tabular-nums text-small text-ink-3">{meta}</span>
      </button>
      {abierto && <div className="border-t border-line-soft">{children}</div>}
    </div>
  );
}

/** Evaluación de una ronda: resumen y enlace a LA lectura de evaluación (`/planta/:id/evaluacion/:id`, v3 paso 3). */
function FilaEvaluacionExpediente({ evaluacion, plantaId, correccion }: { evaluacion: EvaluacionRow; plantaId: string; correccion?: Correccion }) {
  const { pathname, search } = useLocation();
  return (
    <li className="text-small">
      <Link
        to={`/planta/${plantaId}/evaluacion/${evaluacion.id}`}
        state={{ volverA: `${pathname}${search}` }}
        className="flex min-h-tap w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <span className="flex min-w-0 flex-col">
          <span className="tabular-nums text-ink">{formatearFecha(evaluacion.fecha)}{evaluacion.evaluador ? ` · ${evaluacion.evaluador}` : ''}</span>
          <span className="text-ink-3">{resumenDescriptores(evaluacion)}</span>
          {/* A8: la corrección queda a la vista en el historial del individuo (quién, cuándo y por qué). */}
          {correccion && <span className="text-ink-2">{textoCorreccion(correccion)}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-brand">
          Ver evaluación
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

function FilaPcr({ pcr }: { pcr: PcrRow }) {
  const [error, setError] = useState<string | null>(null);
  const abrirPdf = async () => {
    if (!pcr.informe_pdf_url) return;
    try {
      const url = await urlFirmadaPdfPcr(pcr.informe_pdf_url);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el PDF.');
    }
  };
  return (
    <li className="space-y-1 px-3 py-2.5 text-small">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{pcr.realizado ? 'PCR realizado' : 'PCR no realizado'}</span>
        {pcr.fecha && <span className="tabular-nums text-ink-3">{formatearFecha(pcr.fecha)}</span>}
      </div>
      {pcr.informe_pdf_url ? (
        <button type="button" onClick={abrirPdf} className="flex items-center gap-1.5 text-primary hover:underline">
          <FileDown className="h-3.5 w-3.5" /> Ver informe PDF
        </button>
      ) : (
        <p className="flex items-center gap-1.5 text-ink-3"><Info className="h-3 w-3" /> Sin informe PDF adjunto.</p>
      )}
      {error && <p className="text-danger">{error}</p>}
    </li>
  );
}

/** PcrForm no tiene botón Cancelar propio (RondasSeccion, fuera de alcance, no lo necesitaba) — se agrega acá sin tocar PcrForm.tsx. */
function PcrFormConCancelar(props: Parameters<typeof PcrForm>[0] & { onCerrar: () => void; onTocadoChange: (t: boolean) => void }) {
  const { onCerrar, onTocadoChange, ...resto } = props;
  return (
    <div className="space-y-3">
      <PcrForm {...resto} onTocadoChange={onTocadoChange} />
      <ConfirmarCancelar onCerrar={onCerrar} />
    </div>
  );
}

function BajaFormConCancelar(props: Parameters<typeof BajaForm>[0] & { onCerrar: () => void; onTocadoChange: (t: boolean) => void }) {
  const { onCerrar, onTocadoChange, ...resto } = props;
  return (
    <div className="space-y-3">
      <BajaForm {...resto} onTocadoChange={onTocadoChange} />
      <ConfirmarCancelar onCerrar={onCerrar} />
    </div>
  );
}

/** Pie Cancelar compartido. Cada formulario publica su estado dirty al Sheet
 * mediante onTocadoChange; el cierre se confirma en una sola capa. */
function ConfirmarCancelar({ onCerrar }: { onCerrar: () => void }) {
  return (
    <div className="flex justify-end border-t pt-3">
      <Button type="button" variant="outline" onClick={onCerrar}>Cancelar</Button>
    </div>
  );
}
