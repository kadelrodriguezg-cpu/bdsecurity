import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { LoaderCircle } from 'lucide-react';

const buttonVariants = cva(
  'motion-press inline-flex min-h-tap items-center justify-center gap-2 rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-white hover:bg-brand-d',
        outline: 'border border-line-strong bg-white hover:bg-surface-2',
        warning: 'border border-warn/30 bg-warn-l text-warn hover:bg-warn-l/70',
        destructive: 'bg-danger text-white hover:opacity-90',
        ghost: 'hover:bg-neutral-l',
        // Acción de fila: enlace con área táctil de 44 px (DESIGN.md); solo «Continuar» y «Revisar» van como botón.
        link: 'px-2 text-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'px-4 py-2',
        sm: 'px-3 py-2 text-xs',
        lg: 'h-12 px-6 text-base', // táctil: dedos con guantes en el campo
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  cargando?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, cargando = false, disabled, children, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}
      disabled={cargando || disabled} aria-busy={cargando || props['aria-busy']}>
      {cargando && <span aria-hidden="true" className="inline-flex animate-spin"><LoaderCircle className="h-4 w-4" /></span>}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
