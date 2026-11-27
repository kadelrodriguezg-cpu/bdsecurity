import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Badge({
  className,
  variant = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'outline' | 'success' | 'warning' | 'danger' }) {
  const styles = {
    default: 'bg-brand-l text-brand-ink',
    outline: 'border border-line-strong text-ink-2',
    success: 'bg-ok-l text-ok',
    warning: 'bg-warn-l text-warn',
    danger: 'bg-danger-l text-danger',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
