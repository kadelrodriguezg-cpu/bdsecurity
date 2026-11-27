/**
 * Selector 1-5 para los descriptores de escala (fenología, fruto, estrés).
 * Nunca desnudo: siempre expone qué significa cada extremo, aunque sea con un
 * texto corto (la tabla completa de anclas del Excel queda para más adelante).
 * Click de nuevo sobre el valor activo lo vacía (todos los descriptores son
 * opcionales: "detallado pero no condicionante").
 * Con `etiquetasNivel` (p. ej. la precocidad, con el mes de cosecha de cada nivel) cada botón se anuncia con su texto y,
 * bajo los extremos, se escribe el nivel elegido: los botones siguen siendo números para que quepan en el celular.
 */
import { useId } from 'react';
import { cn } from '@/lib/utils';

export function Stepper1a5({
  label,
  value,
  onChange,
  labelMin,
  labelMax,
  minimo = 1,
  grande = false,
  etiquetasNivel,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  labelMin: string;
  labelMax: string;
  minimo?: 0 | 1;
  /** Pantalla completa en celular: botones de 52 px (referencia 08). */
  grande?: boolean;
  /** Texto de cada nivel, de menor a mayor (`esquema_fase_campo.etiquetas_nivel`). */
  etiquetasNivel?: readonly string[];
}) {
  const id = useId();
  const valores = minimo === 0 ? [0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5];

  return (
    <div role="group" aria-labelledby={id} aria-describedby={id + '-extremos'} className="space-y-1 md:w-fit">
      <span id={id} className="text-xs text-ink-2">{label}</span>
      <div className="flex gap-1.5 max-md:w-full md:flex-wrap">
        {valores.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            aria-label={etiquetasNivel?.[n - minimo] ? `${n} · ${etiquetasNivel[n - minimo]}` : undefined}
            title={etiquetasNivel?.[n - minimo]}
            onClick={() => onChange(value === n ? undefined : n)}
            className={cn(
              'flex min-h-tap min-w-tap shrink-0 items-center max-md:flex-1 justify-center rounded-md border text-sm font-medium',
              grande && 'max-md:min-h-[52px] max-md:text-base',
              value === n ? 'border-primary bg-primary text-white' : 'border-line-strong bg-white hover:bg-surface-2',
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div id={id + '-extremos'} className="flex flex-wrap justify-between gap-x-2 text-micro text-ink-3">
        <span>{minimo} = {labelMin}</span>{' '}
        <span>5 = {labelMax}</span>
      </div>
      {etiquetasNivel && value !== undefined && etiquetasNivel[value - minimo] && (
        <p className="text-small text-ink-2">{value} = {etiquetasNivel[value - minimo]}</p>
      )}
    </div>
  );
}
