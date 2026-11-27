/**
 * Contrato v3 (docs/rediseno_v3/contrato.md, §5): los estados de página que hoy se resuelven de seis maneras distintas.
 * Cargando, vacío y error tienen cada uno UNA forma; el encabezado de página, otra. No los usa ninguna pantalla todavía.
 */
import type { ReactNode } from 'react';
import { CircleAlert, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Cargando. Siempre `role="status"` (hoy solo lo declara el ranking: informe UX U-31) y `aria-busy`. Con `forma="esqueleto"` muestra
 * barras grises con la forma del contenido; con `forma="texto"`, solo el texto. El texto accesible es el mismo en ambos.
 */
export function EstadoCargando({ etiqueta = 'Cargando…', forma = 'texto', lineas = 3, className }: {
  etiqueta?: string;
  forma?: 'texto' | 'esqueleto';
  lineas?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn('space-y-2', className)}>
      {forma === 'esqueleto' ? (
        <>
          <span className="sr-only">{etiqueta}</span>
          <div aria-hidden="true" className="space-y-2 motion-safe:animate-pulse">
            {Array.from({ length: Math.max(1, lineas) }, (_, i) => (
              <div key={i} className={cn('h-4 rounded bg-track', i === lineas - 1 ? 'w-2/3' : 'w-full')} />
            ))}
          </div>
        </>
      ) : (
        <p className="text-small text-ink-3">{etiqueta}</p>
      )}
    </div>
  );
}

/** Vacío: borde punteado, ícono, qué pasa y, si corresponde, qué hacer (una sola acción). */
export function EstadoVacio({ titulo, descripcion, icono, accion, className }: {
  titulo: string;
  descripcion?: ReactNode;
  icono?: ReactNode;
  accion?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-8 text-center', className)}>
      <span className="text-ink-3" aria-hidden="true">{icono ?? <Inbox className="h-6 w-6" />}</span>
      <p className="text-body font-semibold text-ink">{titulo}</p>
      {descripcion && <p className="max-w-md text-small text-ink-2">{descripcion}</p>}
      {accion}
    </div>
  );
}

/** Error: ícono, mensaje en palabras del equipo (no técnicas) y «Reintentar» si hay algo que reintentar. `role="alert"`. */
export function EstadoError({ titulo = 'No se pudo cargar', mensaje, onReintentar, etiquetaReintentar = 'Reintentar', className }: {
  titulo?: string;
  mensaje?: ReactNode;
  onReintentar?: () => void;
  etiquetaReintentar?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-2 rounded-lg border border-danger bg-danger-l px-4 py-6 text-center text-danger', className)}>
      <CircleAlert className="h-6 w-6" aria-hidden="true" />
      <p className="text-body font-semibold">{titulo}</p>
      {mensaje && <p className="max-w-md text-small">{mensaje}</p>}
      {onReintentar && <Button variant="outline" size="sm" onClick={onReintentar}>{etiquetaReintentar}</Button>}
    </div>
  );
}

export type EstadoEncabezado = 'listo' | 'cargando' | 'error';

/**
 * Encabezado de página: un `h1` de 20 px en 600 con subtítulo gris y, a la derecha, las acciones (a lo sumo una sólida, DESIGN.md).
 * Hoy trece pantallas repiten ese `<h1>` suelto. En `cargando` el título ya se ve (la página se sabe cuál es) y el subtítulo es una
 * barra gris; en `error` el subtítulo se reemplaza por `mensajeError`.
 */
export function EncabezadoPagina({ titulo, subtitulo, acciones, estado = 'listo', mensajeError = 'No se pudo cargar esta pantalla.', className }: {
  titulo: string;
  subtitulo?: ReactNode;
  acciones?: ReactNode;
  estado?: EstadoEncabezado;
  mensajeError?: string;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)} aria-busy={estado === 'cargando' || undefined}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold text-ink">{titulo}</h1>
        {estado === 'cargando' ? (
          <div aria-hidden="true" className="h-4 w-48 rounded bg-track motion-safe:animate-pulse" />
        ) : estado === 'error' ? (
          <p role="alert" className="text-small text-danger">{mensajeError}</p>
        ) : subtitulo ? (
          <p className="text-small text-ink-3">{subtitulo}</p>
        ) : null}
      </div>
      {acciones && estado !== 'error' && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}
