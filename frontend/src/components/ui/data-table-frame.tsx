import { cn } from '@/lib/utils';

/** Región desplazable y enfocable para tablas científicas en pantallas pequeñas. */
export function DataTableFrame({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'max-h-[70vh] overflow-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[1] [&_thead]:bg-surface [&_thead]:shadow-[0_1px_0_var(--line)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
