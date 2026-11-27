/**
 * Selector de especie del encabezado, junto al logo (fase 4): punto de color + nombre de la especie + ▾. El menú tiene
 * «Todas las especies» y luego cada especie con su número de cruces. Todos los roles pueden cambiar de especie; solo el
 * admin ve «Nueva especie» y «Configurar descriptores».
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Check, ChevronDown, LayoutGrid, Plus, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { useEspacioEspecieOpcional } from '@/features/especies/EspacioEspecie';
import { colorEspecie } from '@/lib/especies';
import { cn } from '@/lib/utils';

const itemClase = 'flex min-h-tap w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function PuntoEspecie({ especie, className }: { especie: { id: string; nombre: string }; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: colorEspecie(especie) }} />;
}

const cruces = (n: number) => `${n} ${n === 1 ? 'cruce' : 'cruces'}`;

export function SelectorEspecie() {
  const { esAdmin } = useAuth();
  const espacio = useEspacioEspecieOpcional();
  const { pathname } = useLocation();
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panelId = useId();

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

  // Sin espacio de especie (pruebas del shell aisladas) no hay selector.
  if (!espacio) return null;
  const { especies, panorama, activa, listo, cambiar } = espacio;
  const elegir = (especieId: string | null) => {
    setAbierto(false);
    cambiar(especieId);
  };
  const nombre = activa?.nombre ?? 'Todas las especies';
  const crucesDe = (id: string) => panorama?.find((p) => p.id === id)?.cruces;

  return (
    <div ref={raiz} className="relative min-w-0 shrink">
      <button
        ref={boton}
        type="button"
        aria-label={`Especie: ${nombre}. Cambiar de especie`}
        aria-expanded={abierto}
        aria-controls={abierto ? panelId : undefined}
        disabled={!listo}
        onClick={() => setAbierto((actual) => !actual)}
        className={cn(
          'flex min-h-tap min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold text-ink md:gap-2 md:px-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60',
          abierto && 'bg-surface-2',
        )}
      >
        {activa ? <PuntoEspecie especie={activa} /> : <LayoutGrid aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-3" />}
        <span className="max-w-[5.5rem] truncate sm:max-w-[10rem]">{listo ? nombre : 'Especie'}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-3" />
      </button>

      {abierto && (
        <div
          id={panelId}
          role="group"
          aria-label="Especies"
          className="absolute left-0 top-[calc(100%+0.25rem)] z-40 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-line bg-surface p-2 shadow-xl"
        >
          <ul className="grid gap-0.5">
            <li>
              <button type="button" aria-pressed={activa === null} onClick={() => elegir(null)} className={itemClase}>
                <LayoutGrid aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-3" />
                <span className="flex-1 font-medium text-ink">Todas las especies</span>
                {activa === null && <Check aria-hidden="true" className="h-4 w-4 text-primary" />}
              </button>
            </li>
            <li aria-hidden="true" className="my-1 border-t border-line-soft" />
          </ul>
          <ul className="grid max-h-[min(60vh,24rem)] gap-0.5 overflow-y-auto">
            {especies.map((especie) => {
              const n = crucesDe(especie.id);
              const elegida = activa?.id === especie.id;
              return (
                <li key={especie.id}>
                  <button type="button" aria-pressed={elegida} onClick={() => elegir(especie.id)} className={itemClase}>
                    <PuntoEspecie especie={especie} />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{especie.nombre}</span>
                    {n !== undefined && <span className="shrink-0 text-small tabular-nums text-ink-3">{cruces(n)}</span>}
                    {elegida && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {esAdmin && (
            <ul className="mt-1 grid gap-0.5 border-t border-line-soft pt-1">
              <li><Link to="/catalogos?tipo=especies" className={itemClase}><Plus aria-hidden="true" className="h-4 w-4" />Nueva especie</Link></li>
              <li><Link to="/catalogos?tipo=descriptores" className={itemClase}><SlidersHorizontal aria-hidden="true" className="h-4 w-4" />Configurar descriptores</Link></li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
