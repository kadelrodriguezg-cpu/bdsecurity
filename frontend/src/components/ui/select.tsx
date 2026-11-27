/**
 * Select nativo estilizado (desviación deliberada del Select de Radix/shadcn):
 * en el celular de un operario de campo, el <select> nativo abre el picker del
 * sistema operativo — más grande, más usable con guantes y sol que un dropdown
 * custom. En escritorio se ve igual de prolijo.
 */
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex min-h-tap w-full rounded-md border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
