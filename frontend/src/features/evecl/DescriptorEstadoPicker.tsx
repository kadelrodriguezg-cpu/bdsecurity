import type { EveclDescriptorEstado, EveclEje } from '@/api/evecl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { hoyChileISO } from '@/lib/fechas';

export function DescriptorEstadoPicker({
  nombre,
  estados,
  valor,
  alCambiar,
  eje,
  fechaObservada,
  alCambiarFecha,
}: {
  nombre: string;
  estados: EveclDescriptorEstado[];
  valor: number | null;
  alCambiar: (nota: number | null) => void;
  /** Cuando eje='fenologia' se muestra, junto al picker, un campo de fecha opcional. */
  eje?: EveclEje;
  fechaObservada?: string | null;
  alCambiarFecha?: (fecha: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label={nombre}>
        {estados.map((estado) => {
          const activo = valor === estado.nota;
          return (
            <button
              key={estado.nota}
              type="button"
              aria-pressed={activo}
              onClick={() => alCambiar(activo ? null : estado.nota)}
              className={cn(
                'min-h-tap min-w-tap rounded-md border px-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                activo
                  ? 'border-brand bg-brand-l text-brand-ink'
                  : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
              )}
            >
              <span className="block text-sm font-medium">{estado.label}</span>
              <span className="block font-mono text-[10px] opacity-75">UPOV {estado.nota}</span>
            </button>
          );
        })}
      </div>
      {eje === 'fenologia' ? (
        <div className="space-y-1">
          <Label htmlFor={`fecha-observada-${nombre}`} className="text-xs text-ink-3">Fecha observada (opcional)</Label>
          <Input
            id={`fecha-observada-${nombre}`}
            type="date"
            className="w-auto"
            max={hoyChileISO()}
            value={fechaObservada ?? ''}
            onChange={(evento) => alCambiarFecha?.(evento.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}
