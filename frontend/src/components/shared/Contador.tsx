/**
 * Contador +/- para campos numéricos enteros no negativos (flores cruzadas,
 * semillas, conteo F1/F2, cantidad de plántulas nuevas). Reemplaza el input
 * numérico desnudo cuando el valor es un conteo de campo, más rápido de
 * ajustar con el pulgar que tipear en el celular.
 */
import { useId } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function Contador({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
}) {
  const actual = value ?? 0;
  const id = useId();

  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-tap shrink-0 px-0"
          onClick={() => onChange(Math.max(min, actual - 1))}
          aria-label={`Restar ${label}`}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          value={value ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : Math.max(min, Number(v)));
          }}
          className="min-w-0 w-20 text-center"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-tap shrink-0 px-0"
          onClick={() => onChange(actual + 1)}
          aria-label={`Sumar ${label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
