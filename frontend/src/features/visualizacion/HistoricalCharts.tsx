import { formatearMesAnio } from '@/lib/v3/formatos';
import { formatearPuntos } from '@/lib/v3/puntaje';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PuntoSerieCantidad, PuntoSerieScoring } from '@/api/visualizacion';

type PuntoGrafico = { periodo: string; valor: number | null; detalle: string };
const etiquetaPeriodo = (periodo: string) => formatearMesAnio(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)));

const entero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

/** `formatoEje`: cómo se escribe un valor en el eje (por defecto, entero con separador chileno). */
function LineaHistorica({ titulo, descripcion, puntos, sufijo = '', formatoEje = (v: number) => entero.format(v) }: { titulo: string; descripcion: string; puntos: PuntoGrafico[]; sufijo?: string; formatoEje?: (valor: number) => string }) {
  const trazado = useMemo(() => {
    const disponibles = puntos.filter((punto): punto is PuntoGrafico & { valor: number } => punto.valor !== null);
    if (disponibles.length === 0) return null;
    const valores = disponibles.map((punto) => punto.valor);
    const minimo = Math.min(...valores); const maximo = Math.max(...valores); const rango = maximo - minimo || 1;
    const ancho = 560; const alto = 180; const margen = 18; const pasos = Math.max(puntos.length - 1, 1);
    const coordenadas = puntos.flatMap((punto, indice) => punto.valor === null ? [] : [{ ...punto, x: margen + (indice / pasos) * (ancho - margen * 2), y: alto - margen - ((punto.valor - minimo) / rango) * (alto - margen * 2) }]);
    return { ancho, alto, minimo, maximo, coordenadas, linea: coordenadas.map((punto) => `${punto.x},${punto.y}`).join(' ') };
  }, [puntos]);

  return <Card><CardHeader><CardTitle className="text-sm">{titulo}</CardTitle><p className="text-xs text-ink-3">{descripcion}</p></CardHeader><CardContent>{!trazado ? <p className="py-8 text-center text-sm text-ink-3">No hay observaciones comparables en este período.</p> : <div className="space-y-2"><div className="flex justify-between text-xs text-ink-3"><span>{formatoEje(trazado.minimo)}{sufijo}</span><span>{formatoEje(trazado.maximo)}{sufijo}</span></div><svg viewBox={`0 0 ${trazado.ancho} ${trazado.alto}`} role="img" aria-label={`${titulo}: ${descripcion}`} className="h-48 w-full overflow-visible" preserveAspectRatio="none"><line x1="18" x2={trazado.ancho - 18} y1={trazado.alto - 18} y2={trazado.alto - 18} className="stroke-line" strokeWidth="1" /><polyline points={trazado.linea} fill="none" className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{trazado.coordenadas.map((punto) => <circle key={punto.periodo} cx={punto.x} cy={punto.y} r="4" className="fill-primary"><title>{`${etiquetaPeriodo(punto.periodo)}: ${punto.detalle}`}</title></circle>)}</svg><div className="flex justify-between gap-2 text-xs text-ink-3"><span>{etiquetaPeriodo(puntos[0]?.periodo ?? '')}</span><span>{etiquetaPeriodo(puntos[puntos.length - 1]?.periodo ?? '')}</span></div></div>}</CardContent></Card>;
}

export function HistoricalCharts({ scoring, individuosVivos, procedimientos }: { scoring: PuntoSerieScoring[]; individuosVivos: PuntoSerieCantidad[]; procedimientos: PuntoSerieCantidad[] }) {
  const puntosScoring = useMemo(() => scoring.map((punto) => ({ periodo: punto.periodo, valor: punto.puntaje_promedio, detalle: punto.puntaje_promedio === null ? 'sin evaluación elegible' : `${formatearPuntos(punto.puntaje_promedio, { unidad: true })} (${punto.evaluaciones_elegibles} evaluaciones)` })), [scoring]);
  const puntosVivos = useMemo(() => individuosVivos.map((punto) => ({ periodo: punto.periodo, valor: punto.cantidad, detalle: `${punto.cantidad} individuos vivos` })), [individuosVivos]);
  const puntosProcedimientos = useMemo(() => procedimientos.map((punto) => ({ periodo: punto.periodo, valor: punto.cantidad, detalle: `${punto.cantidad} procedimientos` })), [procedimientos]);
  return <div className="grid gap-4 xl:grid-cols-3"><LineaHistorica titulo="Puntaje promedio" descripcion="Solo evaluaciones completas, comparables y sin revisión." puntos={puntosScoring} sufijo=" puntos" formatoEje={(v) => formatearPuntos(v)} /><LineaHistorica titulo="Individuos vivos" descripcion="Evolución mensual de individuos físicos en la especie." puntos={puntosVivos} sufijo=" individuos" /><LineaHistorica titulo="Actividad de procedimientos" descripcion="Procedimientos asociados explícitamente a cruces de esta especie." puntos={puntosProcedimientos} sufijo=" procedimientos" /></div>;
}
