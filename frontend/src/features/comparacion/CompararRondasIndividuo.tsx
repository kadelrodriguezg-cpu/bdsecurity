/**
 * Comparar rondas de un individuo (Fase 2, S3-3; referencia
 * docs/diseno/v2/05-comparar-rondas.html). Dos rondas de la serie anual lado a
 * lado: puntaje y grupo de cada una, subpuntaje por categoría y, descriptor por
 * descriptor, el valor, su estado (medido · faltó · no evaluado · marcado) y la
 * diferencia solo donde las dos están medidas. Solo lectura. Nunca muestra
 * linaje. Las reglas de qué se resta viven en compararRondas.ts.
 */
import { formatearFecha } from '@/lib/v3/formatos';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft } from 'lucide-react';
import { listarPuntajesCongelados, listarRondasDeIndividuo, type RondaComparable } from '@/api/compararRondas';
import { obtenerComparacionRondas } from '@/api/comparacion';
import { obtenerEstadosEvaluacion, type EstadoDescriptor } from '@/api/protocolo';
import { obtenerRankingPorGrupos } from '@/api/rankingGrupos';
import { CATEGORIA_LABEL } from '@/api/scoring';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { HuellaEvaluacion, LeyendaHuella } from '@/features/evaluaciones/HuellaEvaluacion';
import { ESTADO_EVALUACION_LABEL } from '@/features/individuos/DetalleEvaluacion';
import { EtiquetaDeltaChip, formatearPuntaje } from '@/features/ranking/formato';
import { useEsquemaEvaluacionAnual } from '@/lib/esquemaFase/useEsquemaFase';
import { etiquetaDeNivel, type CampoFase } from '@/lib/esquemaFase/tipos';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { AvisoComparacion, AvisoGruposDistintos, formatearDiferenciaPuntaje, nombreGrupo } from './Avisos';
import {
  compararCategorias,
  compararDescriptores,
  compararTotales,
  conValor,
  elegirRonda,
  estadosEfectivos,
  puntajeDeRonda,
  rondasPorDefecto,
  type Cambio,
  type CeldaDescriptor,
  type FilaComparada,
  type PuntajeRonda,
} from './compararRondas';
import { temporadaDeRonda } from '@/lib/temporada';

const formatoNumero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });

// Fase 5 (G2): la ronda se nombra con su temporada de julio a junio, no con el año calendario guardado.
const nombreRonda = (r: Pick<RondaComparable, 'numero_ronda' | 'fecha_inicio' | 'created_at'>) => { const t = temporadaDeRonda(r); return `Ronda ${r.numero_ronda}${t ? ` · ${t}` : ''}`; };

const PILDORA = 'inline-flex min-h-tap items-center gap-1.5 rounded-full border px-3 text-small disabled:cursor-not-allowed disabled:opacity-50';
const PILDORA_ACTIVA = 'border-brand bg-brand-l text-brand-ink';
const PILDORA_REPOSO = 'border-line bg-surface text-ink-2 hover:bg-surface-2';

function Pildora({ activa, onClick, disabled, title, children }: {
  activa: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={activa} onClick={onClick} disabled={disabled} title={title} className={cn(PILDORA, activa ? PILDORA_ACTIVA : PILDORA_REPOSO)}>
      {children}
    </button>
  );
}

/** Valor de una celda: la cifra y su unidad aparte; el estado escrito cuando no hay valor. */
function ValorCelda({ campo, celda }: { campo: CampoFase; celda: CeldaDescriptor }) {
  if (celda.estado === 'falto') return <span className="rounded-full bg-warn-t px-2 py-0.5 text-warn">Faltó</span>;
  if (!conValor(celda.estado)) return <span className="text-ink-4">no evaluado</span>;
  const numero = Number(celda.valor);
  // Escala con texto por nivel: se escribe el nivel («Hasta la mitad»), no el número.
  const cifra = campo.tipo === 'fecha' ? formatearFecha(String(celda.valor)) : etiquetaDeNivel(campo, celda.valor) ?? (Number.isFinite(numero) ? formatoNumero.format(numero) : String(celda.valor));
  return (
    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5 gap-y-0.5 whitespace-nowrap">
      <span className="text-ink">
        {cifra}
        {campo.tipo !== 'fecha' && campo.unidad && <small className="ml-0.5 text-ink-3">{campo.unidad}</small>}
      </span>
      {celda.estado === 'marcado' && <span className="rounded-full bg-danger-l px-2 text-danger">Revisar</span>}
    </span>
  );
}

function CambioCelda({ campo, cambio, numeroA, numeroB }: { campo: CampoFase; cambio: Cambio; numeroA: number; numeroB: number }) {
  const unidad = campo.tipo !== 'fecha' && campo.unidad ? ` ${campo.unidad}` : '';
  const icono = 'h-3.5 w-3.5 shrink-0';
  switch (cambio.tipo) {
    case 'igual': return <span className="text-ink-3">igual</span>;
    case 'sube': return <span className="inline-flex items-center gap-1 text-ink-2"><ArrowUp className={icono} aria-hidden="true" />sube {formatoNumero.format(cambio.cantidad)}{unidad}</span>;
    case 'baja': return <span className="inline-flex items-center gap-1 text-ink-2"><ArrowDown className={icono} aria-hidden="true" />baja {formatoNumero.format(cambio.cantidad)}{unidad}</span>;
    case 'antes': return <span className="inline-flex items-center gap-1 text-ink-2"><ArrowLeft className={icono} aria-hidden="true" />{cambio.dias} {cambio.dias === 1 ? 'día' : 'días'} antes</span>;
    case 'despues': return <span className="inline-flex items-center gap-1 text-ink-2"><ArrowRight className={icono} aria-hidden="true" />{cambio.dias} {cambio.dias === 1 ? 'día' : 'días'} después</span>;
    case 'sin_diferencia':
      switch (cambio.motivo) {
        case 'solo_a': return <span className="text-ink-3">solo ronda {numeroA}</span>;
        case 'solo_b': return <span className="text-ink-3">solo ronda {numeroB}</span>;
        case 'falto_a': return <span className="text-warn">faltó en ronda {numeroA}</span>;
        case 'falto_b': return <span className="text-warn">faltó en ronda {numeroB}</span>;
        case 'marcado': return <span className="text-ink-3" title="Un valor marcado para revisión no se resta">sin diferencia</span>;
        default: return <span className="text-ink-3">—</span>;
      }
  }
}

function TarjetaRonda({ ronda, puntaje, plantaId, estados, cargando }: {
  ronda: RondaComparable;
  puntaje: PuntajeRonda;
  plantaId: string;
  estados: Partial<Record<string, EstadoDescriptor>>;
  /** Las lecturas de puntaje aún no llegan: no se afirma que falte. */
  cargando: boolean;
}) {
  const esquema = useEsquemaEvaluacionAnual();
  const evaluacion = ronda.evaluacion!;
  return (
    <div className="min-w-0 space-y-3 p-4">
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-body-l font-semibold text-ink">{nombreRonda(ronda)}</span>
          <span className="rounded-full bg-ok-l px-2.5 py-0.5 text-small text-ok">{ESTADO_EVALUACION_LABEL[evaluacion.estado]}</span>
        </p>
        <p className="text-small text-ink-3">
          <span className="tabular-nums">{formatearFecha(evaluacion.fecha)}</span>
          {evaluacion.evaluador ? ` · ${evaluacion.evaluador}` : ''}
          {' · '}
          <Link to={`/planta/${plantaId}/evaluacion/${evaluacion.id}`} className="text-brand underline underline-offset-4">Ver evaluación</Link>
        </p>
      </div>

      <div className="space-y-0.5">
        {cargando ? <p role="status" className="text-ink-3">Leyendo puntaje…</p> : puntaje.puntaje !== null ? (
          <p className="text-ink-2">
            <span className="tabular-nums text-display font-semibold text-ink">{formatearPuntaje(puntaje.puntaje)}</span>
            {puntaje.posicionGrupo !== null
              ? <span className="text-ink-3"> · puesto {puntaje.posicionGrupo} de {puntaje.tamanoGrupo} en su grupo</span>
              : <span className="text-ink-3"> · sin puesto en su grupo</span>}
          </p>
        ) : (
          <p className="text-ink-3">{puntaje.motivoSinPuntaje ? `Sin puntaje: ${puntaje.motivoSinPuntaje.toLowerCase()}.` : 'Puntaje no disponible.'}</p>
        )}
        <p className="text-small text-ink-2">Grupo: {nombreGrupo(puntaje.grupo)}</p>
        <p className="text-small text-ink-3">
          {puntaje.fuente === 'ranking' && 'Ranking vigente'}
          {puntaje.fuente === 'congelado' && `Congelado en «${puntaje.congeladoNombre}»`}
        </p>
      </div>

      <HuellaEvaluacion esquema={esquema} estados={estados} sinLeyenda />
    </div>
  );
}

export function CompararRondasIndividuo({ individuoId, plantaId }: { individuoId: string; plantaId: string }) {
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const [soloAmbas, setSoloAmbas] = useState(true);
  const esquema = useEsquemaEvaluacionAnual();

  const rondasQuery = useQuery({ queryKey: qk.comparacion.rondasIndividuo(individuoId), queryFn: () => listarRondasDeIndividuo(individuoId) });
  const rondas = rondasQuery.data?.rondas ?? [];
  const comparables = rondas.filter((r) => r.evaluacion);
  const seleccion = rondasPorDefecto(parametros.get('rondas'), comparables.map((r) => r.numero_ronda));
  const rondaA = seleccion ? comparables.find((r) => r.numero_ronda === seleccion[0]) : undefined;
  const rondaB = seleccion ? comparables.find((r) => r.numero_ronda === seleccion[1]) : undefined;

  const estadosA = useQuery({ queryKey: qk.protocolo.estados(rondaA?.evaluacion?.id ?? ''), queryFn: () => obtenerEstadosEvaluacion(rondaA!.evaluacion!.id), enabled: Boolean(rondaA), staleTime: 30_000 });
  const estadosB = useQuery({ queryKey: qk.protocolo.estados(rondaB?.evaluacion?.id ?? ''), queryFn: () => obtenerEstadosEvaluacion(rondaB!.evaluacion!.id), enabled: Boolean(rondaB), staleTime: 30_000 });
  const pares = useQuery({ queryKey: qk.comparacion.individuo(individuoId), queryFn: () => obtenerComparacionRondas({ individuoId }), enabled: Boolean(seleccion) });
  const ranking = useQuery({
    queryKey: qk.ranking.grupos({ plantaId, especieId: undefined, incluirPruebas: false }),
    queryFn: () => obtenerRankingPorGrupos({ plantaId }),
    enabled: Boolean(seleccion),
  });
  const congelados = useQuery({ queryKey: qk.comparacion.congelados(individuoId), queryFn: () => listarPuntajesCongelados(individuoId), enabled: Boolean(seleccion) });

  const codigo = rondasQuery.data?.individuo.codigo_display ?? '';
  const volver = (
    <Link to={`/planta/${plantaId}`} className="inline-flex min-h-tap items-center gap-1 text-small text-brand">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {codigo ? `Planilla de ronda · ${codigo}` : 'Planilla de ronda'}
    </Link>
  );

  if (rondasQuery.isPending) return <div className="mx-auto max-w-[1360px] space-y-4">{volver}<p role="status" className="text-small text-ink-3">Cargando rondas…</p></div>;
  if (rondasQuery.isError) {
    return (
      <div className="mx-auto max-w-[1360px] space-y-4">
        {volver}
        <Alert>No se pudieron cargar las rondas de este individuo. <Button variant="outline" size="sm" onClick={() => void rondasQuery.refetch()}>Reintentar</Button></Alert>
      </div>
    );
  }
  if (!rondasQuery.data) {
    return <div className="mx-auto max-w-[1360px] space-y-4">{volver}<Alert>Este individuo todavía no tiene rondas de evaluación anual.</Alert></div>;
  }

  const cabecera = (
    <section aria-labelledby="t-cmp" className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="min-w-0">
        <h1 id="t-cmp" className="text-title font-semibold text-ink">Comparar rondas · <span className="font-mono">{codigo}</span></h1>
        <p className="text-small text-ink-3">El mismo individuo a lo largo del tiempo</p>
      </div>
      {seleccion && (
        <div role="group" aria-label="Rondas a comparar" className="flex flex-wrap gap-1.5">
          {rondas.map((r) => (
            <Pildora
              key={r.id}
              activa={seleccion.includes(r.numero_ronda)}
              disabled={!r.evaluacion}
              title={r.evaluacion ? undefined : 'Sin evaluación cerrada'}
              onClick={() => navegar(`?rondas=${elegirRonda(seleccion, r.numero_ronda).join(',')}`, { replace: true })}
            >
              {nombreRonda(r)}
            </Pildora>
          ))}
        </div>
      )}
    </section>
  );

  if (!seleccion || !rondaA?.evaluacion || !rondaB?.evaluacion) {
    return (
      <div className="mx-auto max-w-[1360px] space-y-4">
        {volver}
        {cabecera}
        <section aria-label="Sin rondas para comparar" className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="mx-auto max-w-md text-body text-ink-2">
            Hay {comparables.length === 0 ? 'ninguna ronda' : 'una sola ronda'} con evaluación cerrada. Comparar necesita al menos dos: la comparación aparece cuando la segunda ronda quede completa.
          </p>
        </section>
      </div>
    );
  }

  const evA = rondaA.evaluacion;
  const evB = rondaB.evaluacion;
  const valoresA = evA as unknown as Record<string, unknown>;
  const valoresB = evB as unknown as Record<string, unknown>;
  const secciones = compararDescriptores(esquema, { valores: valoresA, estados: estadosA.data?.estados ?? null }, { valores: valoresB, estados: estadosB.data?.estados ?? null });
  const todas = secciones.flatMap((s) => s.filas);
  const enAmbas = todas.filter((f) => f.ambas).length;
  const ocultas = todas.length - enAmbas;
  const visibles = (filas: FilaComparada[]) => (soloAmbas ? filas.filter((f) => f.ambas) : filas);

  const entrada = (ronda: RondaComparable) => ({
    numero: ronda.numero_ronda,
    evaluacionId: ronda.evaluacion!.id,
    pares: pares.data?.individuos,
    ranking: ranking.data?.items.find((i) => i.individuo_id === individuoId),
    rankingVersionNombre: ranking.data?.scoring_version_nombre,
    congelados: congelados.data,
  });
  const puntajeA = puntajeDeRonda(entrada(rondaA));
  const puntajeB = puntajeDeRonda(entrada(rondaB));
  const total = compararTotales(puntajeA, puntajeB);
  const categorias = compararCategorias(puntajeA, puntajeB, pares.data?.individuos);
  const leyendoPuntaje = pares.isPending || ranking.isPending || congelados.isPending;
  const leyendoEstados = estadosA.isPending || estadosB.isPending;
  const lecturaPuntajeFalla = (pares.isError || ranking.isError || congelados.isError);

  return (
    <div className="mx-auto max-w-[1360px] space-y-4">
      <Link to={`/planta/${plantaId}/evaluacion/${evB.id}`} className="inline-flex min-h-tap items-center gap-1 text-small text-brand">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Evaluación de la ronda {rondaB.numero_ronda} · {codigo}
      </Link>
      {cabecera}

      <section aria-label="Rondas comparadas" className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
          <TarjetaRonda cargando={leyendoPuntaje} ronda={rondaA} puntaje={puntajeA} plantaId={plantaId} estados={estadosEfectivos(esquema, valoresA, estadosA.data?.estados ?? null)} />
          <TarjetaRonda cargando={leyendoPuntaje} ronda={rondaB} puntaje={puntajeB} plantaId={plantaId} estados={estadosEfectivos(esquema, valoresB, estadosB.data?.estados ?? null)} />
        </div>
        <div className="space-y-3 border-t border-line p-4">
          <LeyendaHuella />
          {leyendoPuntaje ? null : total.resta ? (
            <p className="text-small text-ink-2">
              Mismo grupo: el total {total.diferencia === 0 ? 'no cambió' : `cambió ${formatearDiferenciaPuntaje(total.diferencia)}`} entre las rondas {rondaA.numero_ronda} y {rondaB.numero_ronda}.
            </p>
          ) : total.motivo === 'grupos_distintos' ? (
            <AvisoGruposDistintos numeroA={rondaA.numero_ronda} grupoA={puntajeA.grupo ?? []} numeroB={rondaB.numero_ronda} grupoB={puntajeB.grupo ?? []} />
          ) : total.motivo === 'version_distinta' ? (
            <AvisoComparacion>
              Las dos rondas se puntuaron con criterios distintos, así que el puntaje total no se resta. Compara por categoría y por descriptor.
            </AvisoComparacion>
          ) : (
            <AvisoComparacion>
              {lecturaPuntajeFalla
                ? 'No se pudo leer el puntaje de las rondas. Compara por categoría y por descriptor.'
                : 'El puntaje de las rondas anteriores no está disponible: solo se conserva el de la ronda vigente y el de los rankings congelados. Compara por categoría y por descriptor.'}
            </AvisoComparacion>
          )}
        </div>
      </section>

      <section aria-labelledby="t-cat" className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line p-4">
          <h2 id="t-cat" className="text-body-l font-semibold text-ink">Puntaje por categoría</h2>
          <span className="text-small text-ink-3">Solo se resta donde las dos rondas midieron la categoría</span>
        </div>
        {pares.isPending ? <p role="status" className="p-4 text-small text-ink-3">Leyendo categorías…</p>
          : pares.isError ? <p className="p-4 text-small text-ink-3">No se pudieron leer las categorías de estas rondas.</p>
            : !puntajeA.categorias || !puntajeB.categorias ? (
              <p className="p-4 text-small text-ink-3">Una de las dos rondas no tiene subpuntajes por categoría: está en revisión, es no comparable o tiene un valor marcado. Los valores siguen disponibles abajo.</p>
            ) : (
              <table className="w-full table-fixed text-small">
                <caption className="sr-only">Puntaje total y por categoría de las rondas {rondaA.numero_ronda} y {rondaB.numero_ronda}</caption>
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th scope="col" className="w-[32%] px-3 py-2 font-normal sm:w-[40%] sm:px-4">Categoría</th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">Ronda {rondaA.numero_ronda}</th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">Ronda {rondaB.numero_ronda}</th>
                    <th scope="col" className="w-[28%] px-3 py-2 text-right font-normal sm:w-[26%] sm:px-4">Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line-soft">
                    <th scope="row" className="px-3 py-2.5 text-left font-normal sm:px-4 text-ink">Puntaje total</th>
                    <td className="px-2 py-2.5 text-right tabular-nums text-ink">{formatearPuntaje(puntajeA.puntaje)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-ink">{formatearPuntaje(puntajeB.puntaje)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums sm:px-4">
                      {total.resta ? <span className="text-ink-2">{formatearDiferenciaPuntaje(total.diferencia)}</span> : <span className="text-ink-3" title="Ver el aviso de arriba">no se resta</span>}
                    </td>
                  </tr>
                  {categorias.map((c) => (
                    <tr key={c.categoria} className="border-b border-line-soft last:border-0">
                      <th scope="row" className="px-3 py-2.5 text-left font-normal sm:px-4 text-ink-2">{CATEGORIA_LABEL[c.categoria]}</th>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{c.a === null ? <span className="text-ink-4">no medida</span> : <span className="text-ink">{formatearPuntaje(c.a)}</span>}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{c.b === null ? <span className="text-ink-4">no medida</span> : <span className="text-ink">{formatearPuntaje(c.b)}</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums sm:px-4">
                        {c.diferencia === null ? <span className="text-ink-3">—</span>
                          : (
                            <span className="inline-flex flex-col items-end gap-1">
                              <span className="text-ink-2">{formatearDiferenciaPuntaje(c.diferencia)}</span>
                              {c.etiqueta && <EtiquetaDeltaChip etiqueta={c.etiqueta} />}
                            </span>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
      </section>

      <section aria-labelledby="t-tab" className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line p-4">
          <h2 id="t-tab" className="text-body-l font-semibold text-ink">Descriptor por descriptor</h2>
          <div role="group" aria-label="Qué descriptores mostrar" className="flex flex-wrap gap-1.5">
            <Pildora activa={soloAmbas} onClick={() => setSoloAmbas(true)}>Evaluados en ambas <span className="tabular-nums text-ink-3">{enAmbas}</span></Pildora>
            <Pildora activa={!soloAmbas} onClick={() => setSoloAmbas(false)}>Todos <span className="tabular-nums text-ink-3">{todas.length}</span></Pildora>
          </div>
        </div>
        <p className="border-b border-line-soft px-4 py-2 text-small text-ink-3" id="nota-descriptores">
          {soloAmbas
            ? ocultas === 0 ? 'Todos los descriptores se midieron en las dos rondas.' : `${ocultas} ${ocultas === 1 ? 'descriptor oculto' : 'descriptores ocultos'}: no se midieron en las dos rondas.`
            : 'Se muestran todos; los que no se midieron en las dos rondas no tienen diferencia.'}
        </p>
        {(estadosA.isError || estadosB.isError) && <p className="border-b border-line-soft px-4 py-2 text-small text-ink-3">No se pudieron leer los estados del protocolo: se muestran según lo guardado, sin distinguir lo que faltó.</p>}
        {leyendoEstados ? <p role="status" className="p-4 text-small text-ink-3">Leyendo el estado de cada descriptor…</p> : enAmbas === 0 && soloAmbas ? (
          <p className="p-4 text-small text-ink-3">Ningún descriptor se midió en las dos rondas. Elige «Todos» para ver lo que cada una midió.</p>
        ) : (
          <table className="w-full table-fixed text-small" aria-describedby="nota-descriptores">
            <caption className="sr-only">Valores de cada descriptor en las rondas {rondaA.numero_ronda} y {rondaB.numero_ronda}</caption>
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th scope="col" className="w-[32%] px-3 py-2 font-normal sm:w-[40%] sm:px-4">Descriptor</th>
                <th scope="col" className="px-2 py-2 text-right font-normal">Ronda {rondaA.numero_ronda}<span className="block whitespace-nowrap text-ink-3 sm:inline"><span className="hidden sm:inline"> · </span>{formatearFecha(evA.fecha)}</span></th>
                <th scope="col" className="px-2 py-2 text-right font-normal">Ronda {rondaB.numero_ronda}<span className="block whitespace-nowrap text-ink-3 sm:inline"><span className="hidden sm:inline"> · </span>{formatearFecha(evB.fecha)}</span></th>
                <th scope="col" className="w-[28%] px-3 py-2 text-right font-normal sm:w-[26%] sm:px-4">Cambio</th>
              </tr>
            </thead>
            <tbody>
              {secciones.map((seccion) => {
                const filas = visibles(seccion.filas);
                if (filas.length === 0) return null;
                return [
                  <tr key={`s-${seccion.id}`} className="bg-surface-2">
                    <th colSpan={4} scope="colgroup" className="px-3 py-2 text-left font-normal text-ink-2 sm:px-4">{seccion.etiqueta}</th>
                  </tr>,
                  ...filas.map((fila) => (
                    <tr key={fila.campo.clave} className="border-b border-line-soft">
                      <th scope="row" className="px-3 py-2.5 text-left font-normal sm:px-4 text-ink-2">{fila.campo.etiqueta}</th>
                      <td className="px-2 py-2.5 text-right tabular-nums"><ValorCelda campo={fila.campo} celda={fila.a} /></td>
                      <td className="px-2 py-2.5 text-right tabular-nums"><ValorCelda campo={fila.campo} celda={fila.b} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums sm:px-4"><CambioCelda campo={fila.campo} cambio={fila.cambio} numeroA={rondaA.numero_ronda} numeroB={rondaB.numero_ronda} /></td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        )}
        <p className="border-t border-line px-4 py-3 text-small text-ink-3">
          «Sube» y «baja» describen el valor, no si es mejor o peor: eso depende del descriptor. Las fechas se comparan por día del año. Un valor marcado para revisión o un obligatorio que faltó no se resta.
        </p>
      </section>
    </div>
  );
}
