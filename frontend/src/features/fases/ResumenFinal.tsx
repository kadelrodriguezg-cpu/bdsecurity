/**
 * Vista de resumen que se muestra automáticamente al llegar a
 * `proceso_finalizado` (no es un paso de confirmación aparte — el mecanismo
 * de avance ya existente sigue siendo el único camino para llegar acá).
 * Los datos del cruce se arman en cliente con las funciones de api/ existentes
 * (decenas de filas). El bloque de individuos viene de una sola RPC agregada
 * (resumenIndividuosDeCruce, B8): antes era un N+1 de varias consultas por
 * individuo y por ronda.
 *
 * "Responsable" queda deliberadamente fuera: el schema no trackea quién creó
 * un cruce (`plantas` no tiene `created_by`), así que no se inventa un proxy.
 */
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { obtenerDatosFase, listarPolinizacionEventos, listarCosechaFrutos, listarGerminacionEventos, listarInsumoIdsDePlanta, listarSustratosDePlanta, ESCARIFICACION_SUBTIPO_LABEL } from '@/api/fases';
import { resumenIndividuosDeCruce, ESTADO_VITAL_LABEL, CRITERIO_BAJA_LABEL, type ResumenIndividuoCruce } from '@/api/individuos';
import { listarContenedores, listarInsumos, listarPredios, listarSustratos } from '@/api/catalogos';
import { etiquetaContenedor } from '@/lib/contenedores';
import { fichaTieneLinaje, ESTADO_LABEL, type FichaPlanta } from '@/types/domain';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatearFechaCivil } from '@/lib/fechas';
import { qk } from '@/lib/queryKeys';

interface ResumenIndividuo {
  id: string;
  codigoDisplay: string;
  estadoVital: string;
  evaluacionesCount: number;
  pcrCount: number;
  observaciones: string[];
  emplazamientoActual: string | null;
}

function aResumenIndividuo(ind: ResumenIndividuoCruce): ResumenIndividuo {
  return {
    id: ind.individuo_id,
    codigoDisplay: ind.codigo_display,
    estadoVital: ESTADO_VITAL_LABEL[ind.estado_vital],
    evaluacionesCount: ind.evaluaciones_count,
    pcrCount: ind.pcr_count,
    observaciones: ind.observaciones.map((b) => `${CRITERIO_BAJA_LABEL[b.criterio]}: ${b.nota}`),
    emplazamientoActual: ind.tiene_emplazamiento
      ? `${ind.predio_nombre ?? '—'} · ${ind.sector_nombre ?? '—'}`
      : null,
  };
}

async function construirResumen(plantaId: string) {
  const [datosFase, polinizacionEventos, frutos, germinacionEventos, insumoIds, sustratosPlanta, individuos, contenedores, insumosCatalogo, predios, sustratosCatalogo] = await Promise.all([
    obtenerDatosFase(plantaId),
    listarPolinizacionEventos(plantaId),
    listarCosechaFrutos(plantaId),
    listarGerminacionEventos(plantaId),
    listarInsumoIdsDePlanta(plantaId),
    listarSustratosDePlanta(plantaId),
    resumenIndividuosDeCruce(plantaId),
    listarContenedores(false),
    listarInsumos(false),
    listarPredios(false),
    listarSustratos(false),
  ]);

  const contenedorElegido = datosFase.contenedor_id ? contenedores.find((c) => c.id === datosFase.contenedor_id) : undefined;
  const contenedorNombre = contenedorElegido ? etiquetaContenedor(contenedorElegido) : null;
  const predioNombre = datosFase.predio_id ? predios.find((p) => p.id === datosFase.predio_id)?.nombre ?? null : null;
  const insumoNombres = insumoIds.map((id) => insumosCatalogo.find((i) => i.id === id)?.nombre ?? '—');
  const sustratos = sustratosPlanta.map((s) => ({ nombre: sustratosCatalogo.find((c) => c.id === s.sustrato_id)?.nombre ?? '—', porcentaje: s.porcentaje }));

  const individuosResumen = individuos.map(aResumenIndividuo);

  return { datosFase, polinizacionEventos, frutos, germinacionEventos, insumoNombres, sustratos, contenedorNombre, predioNombre, individuos: individuosResumen };
}

export function ResumenFinal({ ficha, especieNombre }: { ficha: FichaPlanta; especieNombre?: string }) {
  const { data, isLoading } = useQuery({ queryKey: qk.resumenFinal.planta(ficha.id), queryFn: () => construirResumen(ficha.id) });

  if (isLoading || !data) return <p className="text-sm text-ink-3">Armando el resumen…</p>;

  const totalGerminado = data.germinacionEventos.reduce((acc, e) => acc + e.cantidad_nueva, 0);
  const totalFloresCruzadas = data.polinizacionEventos.reduce((acc, e) => acc + e.n_flores_cruzadas, 0);
  const ultimaFechaPolinizacion = data.polinizacionEventos.length > 0 ? data.polinizacionEventos[data.polinizacionEventos.length - 1].fecha : null;

  return (
    <Card className="border-brand-c bg-brand-l">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          Resumen del proceso
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><dt className="text-xs text-ink-3">Estado</dt><dd>{ESTADO_LABEL[ficha.estado]}</dd></div>
          <div><dt className="text-xs text-ink-3">Especie</dt><dd>{especieNombre ?? '—'}</dd></div>
          <div><dt className="text-xs text-ink-3">Código</dt><dd className="font-mono">{ficha.codigo_sistema}</dd></div>
          <div><dt className="text-xs text-ink-3">Fecha de creación</dt><dd>{formatearFechaCivil(ficha.created_at)}</dd></div>
        </dl>

        {fichaTieneLinaje(ficha) && (
          <div className="rounded-md border border-line bg-surface-2 p-3">
            <p className="text-xs font-semibold text-ink-2">Linaje (confidencial)</p>
            <dl className="mt-1 grid grid-cols-3 gap-3">
              <div><dt className="text-xs text-ink-3">Cruzamiento</dt><dd>{ficha.cruzamiento ?? '—'}</dd></div>
              <div><dt className="text-xs text-ink-3">Mamá</dt><dd>{ficha.mama_nombre ?? ficha.mama ?? '—'}</dd></div>
              <div><dt className="text-xs text-ink-3">Papá</dt><dd>{ficha.papa_nombre ?? ficha.papa ?? '—'}</dd></div>
            </dl>
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
          <h4 className="text-xs font-semibold text-ink-2">Fases completadas</h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {ultimaFechaPolinizacion && (
              <div><dt className="text-xs text-ink-3">Polinización</dt><dd>{formatearFechaCivil(ultimaFechaPolinizacion)} · {totalFloresCruzadas} flores ({data.polinizacionEventos.length} sesión{data.polinizacionEventos.length === 1 ? '' : 'es'})</dd></div>
            )}
            {data.datosFase.fecha_cosecha && (
              <div><dt className="text-xs text-ink-3">Cosecha</dt><dd>{formatearFechaCivil(data.datosFase.fecha_cosecha)} · {data.frutos.length} frutos</dd></div>
            )}
            {data.datosFase.escarificacion_subtipo && (
              <div><dt className="text-xs text-ink-3">Escarificación</dt><dd>{ESCARIFICACION_SUBTIPO_LABEL[data.datosFase.escarificacion_subtipo]}</dd></div>
            )}
            {data.datosFase.semillas_sembradas != null && (
              <div><dt className="text-xs text-ink-3">Semillas sembradas</dt><dd>{data.datosFase.semillas_sembradas}</dd></div>
            )}
            {data.germinacionEventos.length > 0 && (
              <div><dt className="text-xs text-ink-3">Germinación</dt><dd>{totalGerminado} germinadas</dd></div>
            )}
            {data.contenedorNombre && (
              <div><dt className="text-xs text-ink-3">Contenedor</dt><dd>{data.contenedorNombre}</dd></div>
            )}
            {data.predioNombre && (
              <div><dt className="text-xs text-ink-3">Predio destino</dt><dd>{data.predioNombre}</dd></div>
            )}
          </dl>
          {(data.insumoNombres.length > 0 || data.sustratos.length > 0) && (
            <div className="space-y-0.5 text-xs text-ink-3">
              {data.insumoNombres.length > 0 && <p>Insumos: {data.insumoNombres.join(', ')}</p>}
              {data.sustratos.length > 0 && <p>Sustratos: {data.sustratos.map((s) => `${s.nombre} (${s.porcentaje}%)`).join(', ')}</p>}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <h4 className="text-xs font-semibold text-ink-2">Individuos ({data.individuos.length})</h4>
          {data.individuos.length === 0 ? (
            <p className="text-xs text-ink-3">Este cruce no llegó a individualizarse.</p>
          ) : (
            <ul className="divide-y rounded-md border text-xs">
              {data.individuos.map((ind) => (
                <li key={ind.id} className="space-y-1 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-semibold">{ind.codigoDisplay}</span>
                    <Badge variant="outline" className="text-small">{ind.estadoVital}</Badge>
                  </div>
                  <p className="text-ink-3">{ind.evaluacionesCount} evaluación(es) · {ind.pcrCount} PCR</p>
                  {ind.emplazamientoActual && <p className="text-ink-3">Emplazamiento actual: {ind.emplazamientoActual}</p>}
                  {ind.observaciones.length > 0 && <p className="text-ink-3">Obs.: {ind.observaciones.join(' · ')}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
