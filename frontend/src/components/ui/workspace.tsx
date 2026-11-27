/**
 * Workspace fusionado: una sola superficie (borde+sombra exterior), dividida
 * internamente por líneas finas entre `Panel`s — reemplaza cards apiladas
 * (una tarjeta con borde+sombra propios por bloque) en Germinación y
 * Evaluación anual. `Panel` no tiene borde/sombra propios (los separa el
 * `WorkspaceDivisor`); si un bloque necesita ser independiente del workspace
 * (ej. un panel lateral de otra categoría de información), usa `Card` en vez
 * de `Panel`.
 */
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Workspace({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col overflow-clip rounded-lg border bg-surface shadow-sm', className)}>{children}</div>;
}

export function WorkspaceDivisor() {
  return <div className="h-px shrink-0 bg-line-soft" />;
}

export function Panel({
  titulo,
  meta,
  accion,
  children,
  className,
  scroll = false,
  maxAltura,
}: {
  titulo?: string;
  meta?: string;
  accion?: ReactNode;
  children: ReactNode;
  className?: string;
  scroll?: boolean;
  maxAltura?: number;
}) {
  return (
    <div
      className={cn('flex flex-col', className)}
      style={maxAltura ? { maxHeight: maxAltura } : undefined}
    >
      {(titulo || accion) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            {titulo && <span className="text-small font-semibold text-ink-2">{titulo}</span>}
            {meta && <span className="truncate text-small text-ink-3">{meta}</span>}
          </div>
          {accion}
        </div>
      )}
      <div className={scroll ? 'flex-1 overflow-y-auto' : 'px-4 pb-4'}>{children}</div>
    </div>
  );
}
