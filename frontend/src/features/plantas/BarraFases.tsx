/**
 * Regla de fases del cruce — reemplaza el timeline de círculos numerados
 * (EstadoStepper). Es el ÚNICO lugar que dice en qué fase está el cruce
 * (North Star, principio 2): por eso el badge de estado que vivía aparte en
 * el header de la ficha se elimina, no se duplica acá.
 *
 * Informativa, no navegable: a diferencia del mockup de referencia, acá las
 * píldoras no son clicables. En la app real no existe una "vista de fase
 * pasada" a la que saltar — FaseFormulario solo muestra el formulario de la
 * fase ACTUAL, y no hay una pantalla de solo-lectura por fase. Fingir esa
 * navegación (o peor, atarla a actualizarEstado(), una escritura real)
 * sería peor que no tenerla.
 *
 * Responsive con clases Tailwind (mismo patrón que AppLayout/Modal): las dos
 * variantes se renderizan siempre, `lg:` decide cuál se ve — sin JS de
 * detección de viewport.
 */
import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { ESTADOS_ORDEN, ESTADO_LABEL, ESTADO_LABEL_CORTO, type EstadoPlanta } from '@/types/domain';
import { cn } from '@/lib/utils';

type EstadoPaso = 'hecha' | 'actual' | 'futura';

function estadoDelPaso(indice: number, indiceActual: number): EstadoPaso {
  if (indice < indiceActual) return 'hecha';
  if (indice === indiceActual) return 'actual';
  return 'futura';
}

export function BarraFases({ actual }: { actual: EstadoPlanta }) {
  const [abierto, setAbierto] = useState(false);
  const indiceActual = ESTADOS_ORDEN.indexOf(actual);
  const pct = ((indiceActual + 1) / ESTADOS_ORDEN.length) * 100;

  return (
    <>
      {/* Escritorio: fila de píldoras */}
      <nav
        aria-label="Fases del cruce"
        className="hidden items-stretch gap-0.5 rounded-lg border bg-surface p-1.5 shadow-sm lg:flex"
      >
        {ESTADOS_ORDEN.map((estado, i) => {
          const st = estadoDelPaso(i, indiceActual);
          return (
            <div
              key={estado}
              title={st === 'futura' ? 'Fase no alcanzada todavía' : ESTADO_LABEL[estado]}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-2 text-small font-semibold',
                st === 'hecha' && 'text-ok',
                st === 'actual' && 'bg-primary text-white shadow',
                st === 'futura' && 'text-ink-3',
              )}
            >
              <span className="grid w-3.5 place-items-center">
                {st === 'hecha' && <Check className="h-3 w-3" strokeWidth={3} />}
                {st === 'actual' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span className="whitespace-nowrap">{ESTADO_LABEL_CORTO[estado]}</span>
            </div>
          );
        })}
      </nav>

      {/* Móvil/tablet: colapsado con barra de progreso + lista desplegable */}
      <div className="overflow-hidden rounded-lg border bg-surface shadow-sm lg:hidden">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="flex min-h-tap w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-micro text-ink-3">
              Fase {indiceActual + 1} de {ESTADOS_ORDEN.length}
            </span>
            <span className="text-body-l font-semibold text-primary">{ESTADO_LABEL[actual]}</span>
          </div>
          <ChevronDown className={cn('h-[18px] w-[18px] text-ink-3 transition-transform motion-reduce:transition-none', abierto && 'rotate-180')} />
        </button>
        <div className="h-[3px] bg-line-soft">
          <div className="h-full origin-left bg-primary transition-transform motion-reduce:transition-none" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        {abierto && (
          <ul className="space-y-0.5 border-t p-1.5">
            {ESTADOS_ORDEN.map((estado, i) => {
              const st = estadoDelPaso(i, indiceActual);
              return (
                <li key={estado}>
                  <div
                    className={cn(
                      'flex min-h-tap items-center gap-2.5 rounded-md px-2 py-2.5 text-body-l',
                      st === 'futura' ? 'text-ink-3' : 'text-ink-2',
                      st === 'actual' && 'bg-brand-l font-semibold text-brand-ink',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-line-soft text-micro',
                        st === 'hecha' && 'bg-ok-l text-ok',
                        st === 'actual' && 'bg-primary text-white',
                      )}
                    >
                      {st === 'hecha' ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    {ESTADO_LABEL[estado]}
                    {st === 'actual' && (
                      <span className="ml-auto text-micro font-semibold">Aquí</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
