import { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avisoFueraDeRango } from '@/lib/esquemaFase/limites';

/**
 * Campo numérico que distingue una restricción técnica de una referencia
 * agronómica. En modo referencia, salir del rango esperado avisa en ámbar pero
 * nunca bloquea (Maestro §2.5); el rango y los límites de revisión provienen del catálogo.
 */
export function CampoNumerico({
  label,
  unidad,
  min,
  max,
  valor,
  onChange,
  paso = 0.1,
  modo = 'restriccion',
  minimoTecnico,
  limiteRevisionInferior,
  limiteRevisionSuperior,
  notaReferencia,
  errorExterno,
}: {
  label: string;
  unidad: string;
  min?: number;
  max?: number;
  valor: string;
  onChange: (v: string) => void;
  paso?: number;
  modo?: 'restriccion' | 'referencia';
  minimoTecnico?: number;
  limiteRevisionInferior?: number | null;
  limiteRevisionSuperior?: number | null;
  notaReferencia?: string | null;
  /** U-07: un valor que no pasa la validación técnica (no número, negativo, no entero); es el único texto del campo y bloquea el guardado. */
  errorExterno?: string | null;
}) {
  const id = useId();
  const num = valor === '' ? null : Number(valor);
  const invalido = num !== null
    && (!Number.isFinite(num) || (minimoTecnico !== undefined && num < minimoTecnico));
  const fueraRestriccion = modo === 'restriccion'
    && num !== null
    && Number.isFinite(num)
    && ((min !== undefined && num < min) || (max !== undefined && num > max));
  const error = errorExterno ? errorExterno : invalido
    ? `Valor inválido${minimoTecnico !== undefined ? ` (mínimo técnico: ${minimoTecnico} ${unidad})` : ''}`
    : fueraRestriccion && min !== undefined && max !== undefined
      ? `Fuera de rango (${min}–${max} ${unidad})`
      : null;

  // Un solo texto por valor, ámbar y nunca bloqueante: el mismo que muestra «Antes de finalizar».
  const avisoRango = modo === 'referencia' && !error
    ? avisoFueraDeRango(label, num, unidad, { minimo_esperado: min, maximo_esperado: max, limite_revision_inferior: limiteRevisionInferior, limite_revision_superior: limiteRevisionSuperior })
    : null;
  const mensajeReferencia = avisoRango ?? (modo === 'referencia' && min === undefined && max === undefined
    ? 'Sin rango de referencia configurado. Se puede guardar.'
    : null);
  const referencia = min !== undefined && max !== undefined ? `${min}–${max}` : 'Sin ref.';

  const descripcion = [
    id + '-rango',
    error ? id + '-error' : mensajeReferencia ? id + '-referencia' : null,
    modo === 'referencia' && notaReferencia ? id + '-nota' : null,
  ].filter(Boolean).join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-body font-medium text-ink-2">
        {label} <span className="text-ink-3">{unidad}</span>
      </label>
      <div
        className={cn(
          'flex items-center overflow-hidden rounded-md border border-line-strong bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-brand-s',
          error && 'border-danger',
          avisoRango && 'border-warn',
        )}
      >
        <input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={descripcion}
          type="number"
          step={paso}
          min={minimoTecnico}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={referencia}
          className="min-h-tap min-w-0 flex-1 border-0 px-3 py-2 text-body-l outline-none"
        />
        <span id={id + '-rango'} className="flex-shrink-0 whitespace-nowrap px-2.5 tabular-nums text-small text-ink-3">
          {referencia}
        </span>
      </div>
      {error && (
        <div id={id + '-error'} className="flex items-center gap-1.5 text-small text-danger">
          <AlertTriangle className="h-3 w-3" /> {error}
        </div>
      )}
      {mensajeReferencia && !error && (
        <div id={id + '-referencia'}
          className={cn(
            'flex items-start gap-1.5 text-small',
            // Fuera del rango esperado: ámbar (revisa), nunca verde ni rojo. Sin rango configurado: gris.
            avisoRango ? 'text-warn' : 'text-ink-3',
          )}
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" /> {mensajeReferencia}
        </div>
      )}
      {modo === 'referencia' && notaReferencia && (
        <p id={id + '-nota'} className="text-micro text-ink-3">{notaReferencia}</p>
      )}
    </div>
  );
}
