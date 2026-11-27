import { useManualTabs } from '@/components/ui/useManualTabs';
import { useState } from 'react';
import { ClipboardList, FlaskConical, Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IndividualizarPanel } from '@/features/plantas/IndividualizarPanel';
import { EvaluacionAnualWorkspace } from '@/features/individuos/EvaluacionAnualWorkspace';
import { ProcedimientosSeccion } from './ProcedimientosSeccion';
import { cn } from '@/lib/utils';

type PestanaTrasplante = 'individuos' | 'procedimientos' | 'evaluaciones';

const PESTANAS = [
  { id: 'individuos' as const, label: 'Individuos', icono: Sprout },
  { id: 'procedimientos' as const, label: 'Procedimientos', icono: ClipboardList },
  { id: 'evaluaciones' as const, label: 'Evaluaciones', icono: FlaskConical },
];

/**
 * Individuos y Procedimientos permanecen montados y solo cambian su
 * visibilidad — así alternar pestañas no reinicia el formulario de
 * individualizar ni regenera la idempotency_key de ProcedimientosSeccion.
 * Evaluaciones (la lista única de individuos, v3 paso 5) es la excepción: monta/desmonta con la
 * pestaña. No tiene borrador que perder (es una lista + ranking, sin
 * formulario propio) y desde que su lista se virtualizó
 * (@tanstack/react-virtual) SÍ importa el momento del montaje — el
 * virtualizador mide el contenedor una sola vez al montar, y si el panel
 * está en `display:none` en ese instante mide 0px; nada dispara una
 * remedición después, así que la lista queda vacía para siempre hasta
 * recargar la página. Montarlo solo cuando la pestaña está activa evita
 * el problema de raíz en vez de parchearlo.
 */
export function TrasplanteWorkspace({
  plantaId,
  codigoSistema,
  individuoFocoId = null,
}: {
  plantaId: string;
  codigoSistema: string;
  /** Individuo al que se abrió la ficha (`?individuo=`). La lista de individuos vive en la pestaña «Evaluaciones»: se abre ahí. */
  individuoFocoId?: string | null;
}) {
  const [activa, setActiva] = useState<PestanaTrasplante>(individuoFocoId ? 'evaluaciones' : 'individuos');
  const tabs = useManualTabs(PESTANAS.map((p) => p.id), activa, setActiva);

  return (
    <section className="space-y-3">
      <div className="flex gap-1 overflow-x-auto rounded-md border border-line bg-surface-2 p-1" role="tablist" aria-label="Trabajo de trasplante">
        {PESTANAS.map(({ id, label, icono: Icono }) => (
          <Button
            key={id}
            {...tabs.tabProps(id)}
            variant={activa === id ? 'default' : 'ghost'}
            size="sm"
            className="shrink-0"
          >
            <Icono className="h-4 w-4" /> {label}
          </Button>
        ))}
      </div>

      <div {...tabs.panelProps('individuos')} className={cn(activa !== 'individuos' && 'hidden')}>
        <IndividualizarPanel plantaId={plantaId} />
      </div>
      <div {...tabs.panelProps('procedimientos')} className={cn(activa !== 'procedimientos' && 'hidden')}>
        <ProcedimientosSeccion plantaId={plantaId} />
      </div>
      <div {...tabs.panelProps('evaluaciones')} className={cn(activa !== 'evaluaciones' && 'hidden')}>
        {activa === 'evaluaciones' && (
          // La misma lista y el mismo expediente que en las demás fases (N22); individualizar sigue en la pestaña «Individuos».
          <EvaluacionAnualWorkspace plantaId={plantaId} codigoSistema={codigoSistema} individuoFocoId={individuoFocoId} pestana="individuos" estadoCruce="trasplante" onIrAIndividuos={() => undefined} />
        )}
      </div>
    </section>
  );
}
