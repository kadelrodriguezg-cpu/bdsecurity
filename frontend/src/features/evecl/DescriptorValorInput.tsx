import type { ComponentProps, Ref } from 'react';
import { Input } from '@/components/ui/input';

export function DescriptorValorInput({
  id,
  unidad,
  esTexto,
  valor,
  alCambiar,
  inputRef,
  ...atributos
}: {
  id: string;
  unidad: string | null;
  esTexto: boolean;
  valor: string;
  alCambiar: (valor: string) => void;
  inputRef?: Ref<HTMLInputElement>;
} & Pick<ComponentProps<typeof Input>, 'aria-invalid' | 'aria-describedby'>) {
  return (
    <div className="relative">
      <Input
        {...atributos}
        ref={inputRef}
        id={id}
        type={esTexto ? 'text' : 'number'}
        inputMode={esTexto ? 'text' : 'decimal'}
        min={esTexto ? undefined : 0}
        step={esTexto ? undefined : 'any'}
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        className={unidad ? 'pr-28 font-mono' : 'font-mono'}
        placeholder="—"
      />
      {unidad ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">
          {unidad}
        </span>
      ) : null}
    </div>
  );
}
