/**
 * Selector de pocos niveles con TEXTO en cada botón (hoy: «Distribución de flores y frutos en la vara», 3 niveles:
 * «Solo en la punta» · «Hasta la mitad» · «Toda la vara»). Mismo estilo y misma regla que `Stepper1a5`: botones táctiles,
 * `aria-pressed`, y volver a tocar el nivel activo lo vacía porque el descriptor es opcional. A diferencia del 1-5, el
 * nombre de cada nivel va escrito en el botón (un «2» suelto no dice nada).
 */
import { useId } from 'react';
import { cn } from '@/lib/utils';

export function SelectorNiveles({
  label,
  value,
  onChange,
  niveles,
  minimo = 1,
  grande = false,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  /** Texto de cada nivel, de menor a mayor. */
  niveles: readonly string[];
  /** Valor numérico del primer nivel. */
  minimo?: number;
  /** Pantalla completa en celular: botones de 52 px, como `Stepper1a5`. */
  grande?: boolean;
}) {
  const id = useId();

  return (
    <div role="group" aria-labelledby={id} className="space-y-1 md:w-fit">
      <span id={id} className="text-xs text-ink-2">{label}</span>
      <div className="flex gap-1.5 max-md:w-full md:flex-wrap">
        {niveles.map((texto, i) => {
          const n = minimo + i;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={value === n}
              onClick={() => onChange(value === n ? undefined : n)}
              className={cn(
                'flex min-h-tap min-w-tap shrink-0 flex-col items-center justify-center rounded-md border px-2.5 py-1 text-center text-sm font-medium leading-tight max-md:flex-1',
                grande && 'max-md:min-h-[52px] max-md:text-base',
                value === n ? 'border-primary bg-primary text-white' : 'border-line-strong bg-white hover:bg-surface-2',
              )}
            >
              {texto}
            </button>
          );
        })}
      </div>
    </div>
  );
}
