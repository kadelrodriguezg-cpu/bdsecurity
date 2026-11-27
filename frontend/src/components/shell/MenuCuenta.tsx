/** Menú de cuenta del encabezado: nombre y rol, Mi perfil, EVECL (fuera de la navegación principal, N2) y Cerrar sesión. */
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronDown, CircleUserRound, FlaskConical, LogOut } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { EveclNavBadge } from '@/features/evecl/EveclNavBadge';
import { cn } from '@/lib/utils';
import { useIncluirPruebas } from '@/lib/preferencias';
import { etiquetaRol } from '@/lib/etiquetas';

function iniciales(nombre: string | undefined): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

const itemClase = 'flex min-h-tap w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function MenuCuenta({ onSalir }: { onSalir: () => void }) {
  const { perfil, esAdmin } = useAuth();
  const { pathname } = useLocation();
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const nombre = perfil?.nombre ?? 'Mi cuenta';
  const rol = etiquetaRol(esAdmin ? 'admin' : 'operario');
  const [incluirPruebas, setIncluirPruebas] = useIncluirPruebas();

  // Al navegar, el menú se cierra.
  useEffect(() => { setAbierto(false); }, [pathname]);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return;
      evento.stopPropagation();
      setAbierto(false);
      boton.current?.focus();
    };
    const alPulsarFuera = (evento: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener('keydown', alTeclear);
    document.addEventListener('mousedown', alPulsarFuera);
    return () => {
      document.removeEventListener('keydown', alTeclear);
      document.removeEventListener('mousedown', alPulsarFuera);
    };
  }, [abierto]);

  return (
    <div ref={raiz} className="relative">
      <button
        ref={boton}
        type="button"
        aria-label={`Menú de cuenta, ${nombre}`}
        aria-expanded={abierto}
        aria-controls={abierto ? panelId : undefined}
        onClick={() => setAbierto((actual) => !actual)}
        className={cn(
          'flex min-h-tap min-w-tap items-center justify-center gap-2 rounded-md px-1 text-sm text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary xl:px-2',
          abierto && 'bg-surface-2',
        )}
      >
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-l text-xs font-semibold text-brand-ink">{iniciales(perfil?.nombre)}</span>
        <span aria-hidden="true" className="hidden max-w-[10rem] truncate xl:inline">{nombre}</span>
        <ChevronDown aria-hidden="true" className="hidden h-4 w-4 xl:block" />
      </button>

      {abierto && (
        <div
          id={panelId}
          role="group"
          aria-label="Cuenta"
          className="absolute right-0 top-[calc(100%+0.25rem)] z-40 w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-line bg-surface p-2 shadow-xl"
        >
          <div className="border-b border-line px-3 pb-2 pt-1">
            <p className="truncate text-sm font-semibold">{nombre}</p>
            <p className="text-small text-ink-3">{rol}</p>
          </div>
          <ul className="mt-1 grid gap-0.5">
            <li>
              <Link to="/perfil" className={itemClase}><CircleUserRound className="h-5 w-5" aria-hidden="true" />Mi perfil</Link>
            </li>
            <li>
              <Link to="/evecl" className={itemClase}><FlaskConical className="h-5 w-5" aria-hidden="true" /><EveclNavBadge /></Link>
            </li>
            {esAdmin && (
              <li>
                {/* N4: «Incluir pruebas» es una opción global de admin; se guarda en este equipo. */}
                <label className={cn(itemClase, 'cursor-pointer')}>
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={incluirPruebas} onChange={(evento) => setIncluirPruebas(evento.target.checked)} />
                  Incluir cruces de prueba
                </label>
              </li>
            )}
            <li>
              <button type="button" onClick={() => { setAbierto(false); onSalir(); }} className={itemClase}>
                <LogOut className="h-5 w-5" aria-hidden="true" />Cerrar sesión
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
