/**
 * Selector de cruce con buscador (fase 5, decisión G17): reemplaza a los <select> de cruces. Se escribe «07» y se filtra; los
 * cruces van en orden natural (lib/ordenNatural) y, si se pide, «Toda la especie» primero. Patrón combobox de ARIA: flechas
 * para recorrer, Enter para elegir, Escape para cerrar. Con cientos de cruces se dibujan los primeros y se pide escribir.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compararCodigos } from '@/lib/ordenNatural';

export interface CruceElegible { id: string; codigo_sistema: string; es_prueba?: boolean }

/** Cuántas opciones se dibujan sin escribir nada. */
const MAXIMO_VISIBLE = 100;

const etiquetaCruce = (c: CruceElegible) => (c.es_prueba ? `${c.codigo_sistema} (prueba)` : c.codigo_sistema);

export function SelectorCruce({ id, etiqueta, cruces, valor, onCambiar, opcionTodos, disabled, className }: {
  id: string;
  /** Nombre accesible (y del <label> si lo hay afuera con htmlFor=id). */
  etiqueta: string;
  cruces: readonly CruceElegible[];
  /** id del cruce elegido; '' = la opción «todos». */
  valor: string;
  onCambiar: (cruceId: string) => void;
  /** Texto de la opción que no acota a un cruce (p. ej. «Toda la especie»); sin él no se ofrece. */
  opcionTodos?: string;
  disabled?: boolean;
  className?: string;
}) {
  const idLista = useId();
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState<string | null>(null);
  const [activo, setActivo] = useState(0);
  const lista = useRef<HTMLUListElement>(null);

  const ordenados = useMemo(() => [...cruces].sort((a, b) => compararCodigos(a.codigo_sistema, b.codigo_sistema)), [cruces]);
  const texto = (consulta ?? '').trim().toLowerCase();
  const coincidencias = texto ? ordenados.filter((c) => c.codigo_sistema.toLowerCase().includes(texto)) : ordenados;
  const opciones: Array<{ id: string; texto: string }> = [
    ...(opcionTodos && !texto ? [{ id: '', texto: opcionTodos }] : []),
    ...coincidencias.slice(0, MAXIMO_VISIBLE).map((c) => ({ id: c.id, texto: etiquetaCruce(c) })),
  ];
  const ocultas = coincidencias.length - Math.min(coincidencias.length, MAXIMO_VISIBLE);
  const elegido = cruces.find((c) => c.id === valor);
  const textoElegido = elegido ? etiquetaCruce(elegido) : (opcionTodos ?? '');

  const abrir = () => { if (!disabled) { setAbierto(true); setActivo(0); } };
  const cerrar = () => { setAbierto(false); setConsulta(null); };
  const elegir = (cruceId: string) => { onCambiar(cruceId); cerrar(); };
  const mover = (paso: number) => {
    if (!abierto) { abrir(); return; }
    setActivo((i) => {
      const sig = Math.min(Math.max(0, i + paso), Math.max(0, opciones.length - 1));
      lista.current?.querySelectorAll('[role="option"]')[sig]?.scrollIntoView?.({ block: 'nearest' });
      return sig;
    });
  };

  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={abierto && opciones[activo] ? `${idLista}-${activo}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={opcionTodos ?? 'Buscar cruce'}
        value={consulta ?? textoElegido}
        // Al tomar el foco se selecciona lo que se muestra: lo que se escriba lo reemplaza (no se mezcla con «Toda la especie»).
        onFocus={(e) => { abrir(); e.currentTarget.select(); }}
        onBlur={cerrar}
        onChange={(e) => { setConsulta(e.target.value); setAbierto(true); setActivo(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
          else if (e.key === 'Enter' && abierto) { e.preventDefault(); if (opciones[activo]) elegir(opciones[activo].id); }
          else if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
        }}
        className="min-h-tap w-full rounded-md border border-line-strong bg-white py-2 pl-3 pr-9 text-body text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
      {abierto && (
        <div className="absolute z-30 mt-1 w-full min-w-[12rem] overflow-hidden rounded-md border border-line bg-surface shadow-lg">
          <ul ref={lista} id={idLista} role="listbox" aria-label={etiqueta} className="max-h-72 overflow-y-auto py-1">
            {opciones.map((o, i) => (
              <li
                key={o.id || 'todos'}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={i === activo}
                // mouseDown (no click): se elige antes de que el blur del input cierre la lista.
                onMouseDown={(e) => { e.preventDefault(); elegir(o.id); }}
                onMouseEnter={() => setActivo(i)}
                className={cn(
                  'flex min-h-tap cursor-pointer items-center px-3 font-mono text-body',
                  i === activo ? 'bg-brand-l text-brand-ink' : 'text-ink',
                  o.id === valor && 'font-semibold',
                  o.id === '' && 'font-sans',
                )}
              >
                {o.texto}
              </li>
            ))}
          </ul>
          {opciones.length === 0 && <p className="px-3 py-2 text-small text-ink-3">Ningún cruce con «{(consulta ?? '').trim()}».</p>}
          {ocultas > 0 && <p className="border-t border-line-soft px-3 py-2 text-small text-ink-3">Escribe para ver los otros {ocultas}.</p>}
        </div>
      )}
    </div>
  );
}
