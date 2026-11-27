import type { ReactNode } from 'react';
import { Save } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Estado de persistencia local, independiente del guardado en el servidor. */
export function EstadoBorradorLocal({ estado, errorPersistencia, textoIdle, compacto = true, className, ambito }: {
  estado: 'idle' | 'guardando' | 'guardado';
  errorPersistencia: string | null;
  textoIdle?: string;
  compacto?: boolean;
  /** Clases extra del texto (p. ej. su lugar en la cuadrícula del encabezado). */
  className?: string;
  /** U-05: dónde vive el borrador (p. ej. «solo en este teléfono»); se añade al texto de «guardado». */
  ambito?: ReactNode;
}) {
  if (errorPersistencia) return <span role="alert" className={cn('order-first block w-full min-w-0 basis-full text-small font-semibold text-danger', className)}>{errorPersistencia}</span>;
  return (
    <span role="status" aria-live="polite" aria-atomic="true" className={cn(
      compacto ? 'flex items-center gap-1.5 text-micro font-semibold' : 'text-xs',
      estado === 'guardado' && compacto ? 'text-ok' : 'text-ink-3',
      className,
    )}>
      {estado === 'guardando' ? 'Guardando borrador local…' : estado === 'guardado'
        ? compacto ? <><Save className="motion-reveal h-3 w-3" /> Borrador guardado localmente{ambito}</> : 'Borrador local guardado'
        : textoIdle ?? null}
    </span>
  );
}
