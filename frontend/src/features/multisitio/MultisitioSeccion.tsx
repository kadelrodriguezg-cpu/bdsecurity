/**
 * Sección Multisitio a nivel de cruce (Sprint 7, layout de 2.4.5 del
 * documento maestro): arriba el pipeline de procedimientos (mismo
 * componente reusable que Crecimiento/Evaluación anual — 2.6: siempre
 * objetivo tipo cruce, con predio/individuo opcionales), debajo el mapa
 * interactivo acotado a este cruce y, como bloque propio aparte (2.8,
 * Sprint 7.5.1), el clima histórico por predio — mapa y clima son ambos
 * contexto geográfico pero de naturaleza distinta (espacial vs. temporal),
 * por eso no se fusionan en un solo componente. Las rondas multisitio por
 * individuo viven en la columna de individuos (IndividuosSeccion), no acá.
 */
import { ProcedimientosSeccion } from '@/features/fases/ProcedimientosSeccion';
import { MapaCruceFicha } from './MapaCruceFicha';
import { ClimaPredioBloque } from './ClimaPredioBloque';
import { ChevronDown, CloudSun, MapPinned } from 'lucide-react';

function BloqueContextoColapsable({
  titulo,
  icono,
  children,
}: {
  titulo: string;
  icono: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-[var(--r-l)] border border-line bg-surface">
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink">
        <span className="flex items-center gap-2">{icono}{titulo}</span>
        <ChevronDown className="h-4 w-4 text-ink-3 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line-soft p-3">{children}</div>
    </details>
  );
}

export function MultisitioSeccion({ plantaId }: { plantaId: string }) {
  return (
    <div className="space-y-4">
      <ProcedimientosSeccion plantaId={plantaId} />
      <BloqueContextoColapsable titulo="Mapa del cruce" icono={<MapPinned className="h-4 w-4 text-primary" />}>
        <MapaCruceFicha plantaId={plantaId} />
      </BloqueContextoColapsable>
      <BloqueContextoColapsable titulo="Clima histórico por predio" icono={<CloudSun className="h-4 w-4 text-primary" />}>
        <ClimaPredioBloque plantaId={plantaId} />
      </BloqueContextoColapsable>
    </div>
  );
}
