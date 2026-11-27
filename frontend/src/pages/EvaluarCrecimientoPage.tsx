/**
 * Evaluación reducida de Crecimiento a pantalla completa (S2-6; referencias
 * docs/diseno/v2/04 y 08, mismo patrón que EvaluarIndividuoPage). Se llega desde
 * la planilla de avance del cruce o desde el expediente del individuo, con
 * `?volver=` (la ficha a la que regresar; solo rutas de este cruce). Desde la
 * planilla hay recorrido: anterior/siguiente por número de planta y «Guardar y
 * seguir» con el siguiente individuo sin evaluar. Desde el expediente no hay
 * recorrido: cerrar o guardar vuelve ahí.
 */
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, ScanQrCode } from 'lucide-react';
import { EvaluacionReducidaForm } from '@/features/individuos/EvaluacionReducidaForm';
import { EvaluacionReducidaResumen } from '@/features/individuos/EvaluacionReducidaResumen';
import { FASE_CRECIMIENTO, codigoCorto, useFilasCrecimiento, type FilaCrecimiento } from '@/features/crecimiento/filas';
import { rutaEvaluarCrecimiento, volverDeCruce } from '@/lib/rutasIndividuo';
import { EncabezadoEvaluacion } from '@/components/shared/EncabezadoEvaluacion';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useMarcadorCambiosSinGuardar } from '@/lib/cambiosSinGuardar';

const contenedor = 'mx-auto min-h-dvh max-w-[1360px] bg-bg px-4 sm:px-6';

export function EvaluarCrecimientoPage() {
  const { id: plantaId = '', individuoId = '' } = useParams();
  const navigate = useNavigate();
  const [busqueda] = useSearchParams();
  const volver = volverDeCruce(plantaId, busqueda.get('volver'));
  const destinoVolver = volver ?? `/planta/${plantaId}`;
  const { filas, isPending, isError, isFetching, refetch } = useFilasCrecimiento(plantaId);
  // La evaluación a pantalla completa vive fuera de AppShell: marca sus valores sin guardar.
  const marcarCambios = useMarcadorCambiosSinGuardar();

  if (isPending) return <div className={contenedor}><p role="status" className="py-10 text-small text-ink-3">Cargando el individuo…</p></div>;
  if (isError || !filas) {
    return (
      <div className={`${contenedor} space-y-3 py-6`}>
        <Alert>No se pudo cargar el cruce. <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>Reintentar</Button></Alert>
        <Link to={destinoVolver} className="text-small text-brand">Volver al cruce</Link>
      </div>
    );
  }

  const indice = filas.findIndex((f) => f.individuo.id === individuoId);
  const fila: FilaCrecimiento | undefined = indice >= 0 ? filas[indice] : undefined;
  if (!fila) {
    return (
      <div className={`${contenedor} space-y-3 py-6`}>
        <Alert>Este individuo no está vivo o no pertenece a este cruce, así que no admite una evaluación de Crecimiento.</Alert>
        <Link to={destinoVolver} className="text-small text-brand">Volver al cruce</Link>
      </div>
    );
  }

  const irA = (f: FilaCrecimiento) => navigate(rutaEvaluarCrecimiento(plantaId, f.individuo.id));
  const anterior = indice > 0 ? filas[indice - 1] : null;
  const posterior = indice < filas.length - 1 ? filas[indice + 1] : null;
  // Siguiente sin evaluar a partir de este, por número de planta; sin recorrido cuando se llegó desde el expediente.
  const pendientes = filas.filter((f) => f.estado === 'pendiente' && f.individuo.id !== individuoId);
  const siguiente = volver ? null : pendientes.find((f) => (f.numero ?? Infinity) > (fila.numero ?? -Infinity)) ?? pendientes[0] ?? null;
  const hechas = filas.filter((f) => f.estado === 'hecha').length;

  return (
    <div className={contenedor}>
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-line bg-surface px-4 py-2 sm:-mx-6 sm:px-6 md:py-3">
        <EncabezadoEvaluacion
          izquierda={(
            <Link to={destinoVolver} className="inline-flex min-h-tap min-w-tap items-center gap-1 text-xs text-brand">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {volver ? 'Individuo' : 'Planilla'}
            </Link>
          )}
          codigo={fila.individuo.codigo_display}
          subtitulo={`Evaluación reducida · Crecimiento${fila.estado === 'hecha' ? ` · ya tiene ${fila.cantidad === 1 ? 'una evaluación' : `${fila.cantidad} evaluaciones`}` : ''}`}
          contador={<p className="text-xs tabular-nums text-ink-3 md:text-small">{hechas} de {filas.length} evaluados</p>}
          derecha={(
            <div className="ml-auto flex gap-2 max-md:hidden">
              {!volver && anterior && (
                <Button variant="outline" size="sm" onClick={() => irA(anterior)} aria-label={`Anterior: ${anterior.individuo.codigo_display}`}>
                  <ChevronLeft className="h-4 w-4" /> {codigoCorto(anterior.individuo.codigo_display)}
                </Button>
              )}
              {!volver && posterior && (
                <Button variant="outline" size="sm" onClick={() => irA(posterior)} aria-label={`Siguiente: ${posterior.individuo.codigo_display}`}>
                  {codigoCorto(posterior.individuo.codigo_display)} <ChevronRight className="h-4 w-4" />
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => navigate('/escanear')}>
                <ScanQrCode className="h-4 w-4" /> Escanear QR
              </Button>
            </div>
          )}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <EvaluacionReducidaForm
          key={fila.individuo.id}
          variante="pantalla"
          individuoId={fila.individuo.id}
          plantaId={plantaId}
          fase={FASE_CRECIMIENTO}
          siguiente={siguiente ? codigoCorto(siguiente.individuo.codigo_display) : undefined}
          onTocadoChange={marcarCambios}
          onCerrar={() => navigate(destinoVolver)}
          onGuardado={() => (siguiente ? irA(siguiente) : navigate(destinoVolver))}
        />
        <section aria-labelledby="eval-previas" className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <h2 id="eval-previas" className="text-body font-semibold text-ink">Evaluaciones anteriores</h2>
          <EvaluacionReducidaResumen individuoId={fila.individuo.id} fase={FASE_CRECIMIENTO} />
        </section>
      </div>
    </div>
  );
}
