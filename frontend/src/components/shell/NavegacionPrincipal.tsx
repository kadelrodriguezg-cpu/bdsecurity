/** Navegación principal: horizontal en el encabezado (escritorio) y barra inferior (celular). Una sola lista de destinos para las dos. */
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import type { Destino } from './destinos';

export function NavEscritorio({ destinos, pathname }: { destinos: Destino[]; pathname: string }) {
  return (
    <nav aria-label="Navegación principal" data-nav="escritorio" className="hidden items-center gap-1 md:flex">
      {destinos.map((destino) => {
        const activo = destino.activo(pathname);
        const Icono = destino.icono;
        return (
          <Link
            key={destino.id}
            to={destino.to}
            aria-current={activo ? 'page' : undefined}
            className={cn(
              'flex min-h-tap items-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:px-3',
              activo ? 'bg-brand-l text-brand-ink' : 'text-ink-2 hover:bg-surface-2',
            )}
          >
            <Icono aria-hidden="true" className="h-4 w-4" />
            {destino.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}

/** Barra inferior. `oculta` la quita mientras el teclado del celular está abierto. */
export function NavMovil({ destinos, pathname, oculta }: { destinos: Destino[]; pathname: string; oculta: boolean }) {
  return (
    <nav
      aria-label="Navegación principal"
      data-nav="movil"
      hidden={oculta}
      className={cn(
        'fixed inset-x-0 bottom-0 z-20 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden',
        destinos.length === 4 ? 'grid-cols-4' : 'grid-cols-3',
      )}
    >
      {destinos.map((destino) => {
        const activo = destino.activo(pathname);
        const Icono = destino.icono;
        return (
          <Link
            key={destino.id}
            to={destino.to}
            aria-current={activo ? 'page' : undefined}
            className={cn(
              'flex min-h-[60px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
              activo ? 'font-semibold text-primary' : 'text-ink-3',
            )}
          >
            <Icono aria-hidden="true" className="h-5 w-5" />
            {destino.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
