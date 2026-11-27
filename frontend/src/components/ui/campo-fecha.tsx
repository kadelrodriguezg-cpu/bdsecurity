import { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { hoyChileISO } from '@/lib/fechas';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { Label } from './label';

export interface CampoFechaProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  ayuda?: string;
  min?: string;
  max?: string;
  advertirFuturo?: boolean;
  fechaMinimaContextual?: string | null;
  etiquetaFechaMinima?: string;
}

function fechaLegible(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return dia && mes && anio ? `${dia}-${mes}-${anio}` : fecha;
}

/** Fecha civil: selector nativo accesible, valor ISO y advertencias de dominio. */
export function CampoFecha({
  id,
  label,
  value,
  onChange,
  required,
  disabled,
  className,
  ayuda,
  min,
  max,
  advertirFuturo = true,
  fechaMinimaContextual,
  etiquetaFechaMinima = 'la fecha de referencia',
}: CampoFechaProps) {
  const descripcionId = useId();
  const hoy = hoyChileISO();
  const advertencia = value && advertirFuturo && value > hoy
    ? `La fecha ${fechaLegible(value)} está en el futuro. Confirma que sea correcta antes de guardar.`
    : value && fechaMinimaContextual && value < fechaMinimaContextual
      ? `La fecha es anterior a ${etiquetaFechaMinima} (${fechaLegible(fechaMinimaContextual)}). Confirma la secuencia.`
      : null;

  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={id}>{label}{required ? ' *' : ''}</Label>
      <Input
        id={id}
        type="date"
        className="min-w-0 max-w-full"
        value={value}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        aria-describedby={ayuda || advertencia ? descripcionId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {(ayuda || advertencia) && (
        <div id={descripcionId} className={cn('text-small', advertencia ? 'flex items-start gap-1.5 text-warn' : 'text-ink-3')}>
          {advertencia && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span>{advertencia ?? ayuda}</span>
        </div>
      )}
    </div>
  );
}
