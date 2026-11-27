/** Barra de secciones de «Resultados» y de «Administración»: enlaces a las pantallas que ya existen (sin fusionar nada). */
import { Link, Outlet, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { seccionesDe } from './destinos';

export function SeccionLayout({ destino }: { destino: 'resultados' | 'administracion' }) {
  const { pathname } = useLocation();
  const secciones = seccionesDe(destino);
  return (
    <>
      <nav aria-label="Secciones" className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {secciones.map((seccion) => {
            const activa = pathname === seccion.to || pathname.startsWith(`${seccion.to}/`);
            return (
              <li key={seccion.to}>
                <Link
                  to={seccion.to}
                  aria-current={activa ? 'page' : undefined}
                  className={cn(
                    '-mb-px flex min-h-tap items-center border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                    activa ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink',
                  )}
                >
                  {seccion.etiqueta}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
