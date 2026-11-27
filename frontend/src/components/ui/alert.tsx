import { type HTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Alert({
  className,
  variant = 'error',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: 'error' | 'success' }) {
  const Icon = variant === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border p-3 text-sm',
        variant === 'error' ? 'border-danger bg-danger-l text-danger' : 'border-ok bg-ok-l text-ok',
        className,
      )}
      {...props}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
