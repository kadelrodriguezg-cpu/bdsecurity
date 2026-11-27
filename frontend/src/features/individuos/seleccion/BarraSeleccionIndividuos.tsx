/**
 * Barra de acciones de la selección múltiple de individuos, compartida por las
 * dos listas del cruce (IndividuosSeccion y el Explorador de evaluación
 * anual). Fija abajo (mobile-first): en el teléfono queda sobre la
 * navegación inferior y deja libre la esquina del botón del chat.
 *
 * «Seleccionar todo» agrega TODOS los vivos del cruce que cumplen el filtro
 * vigente, no solo las filas que se ven en pantalla (la lista está
 * virtualizada: muchas filas no están dibujadas). La barra lo dice.
 */
import { Ban, QrCode, Tags, X } from 'lucide-react';
import type { Individuo } from '@/api/individuos';
import type { SeleccionMultiple } from '@/lib/useSeleccionMultiple';
import { Button } from '@/components/ui/button';

export function BarraSeleccionIndividuos({
  seleccion,
  esAdmin,
  onEtiquetas,
  onDarBaja,
  onEscanear,
  onSalir,
}: {
  seleccion: SeleccionMultiple<Individuo>;
  esAdmin: boolean;
  onEtiquetas: () => void;
  onDarBaja: () => void;
  onEscanear: () => void;
  onSalir: () => void;
}) {
  const disponibles = seleccion.seleccionables.length;
  const alcance = seleccion.seleccionablesVisibles.length;

  return (
    <div
      role="region"
      aria-label="Acciones sobre la selección"
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface shadow-lg md:bottom-0"
    >
      <div className="mx-auto max-w-5xl space-y-2 px-4 py-2.5 md:pr-32">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-small font-semibold text-ink-2" aria-live="polite">
              {seleccion.cantidad === 0
                ? `Marca los individuos (${disponibles} ${disponibles === 1 ? 'vivo disponible' : 'vivos disponibles'})`
                : `${seleccion.cantidad} ${seleccion.cantidad === 1 ? 'seleccionado' : 'seleccionados'}`}
            </p>
            {seleccion.ambitoAcotado && (
              <p className="text-small text-ink-3">
                El filtro deja {alcance} de {disponibles} vivos a la vista. «Seleccionar» agrega todos los que cumplen el filtro, aunque no se vean en pantalla.
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={seleccion.limpiar} disabled={!seleccion.hayAlgunoSeleccionado} className="-my-1 shrink-0">
            Limpiar
          </Button>
          <Button size="sm" variant="ghost" onClick={onSalir} aria-label="Salir de la selección" className="-my-1 shrink-0">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={seleccion.seleccionarTodos}
            disabled={alcance === 0 || seleccion.todosSeleccionados}
          >
            {seleccion.ambitoAcotado ? `Seleccionar los ${alcance} vivos a la vista` : 'Seleccionar todos los vivos'}
          </Button>
          <Button size="sm" variant="outline" onClick={onEscanear}>
            <QrCode className="h-3.5 w-3.5" /> Escanear QR
          </Button>
          {/* Botones flotantes de notificaciones y chat: en el teléfono solo pisan
              esta última fila (margen acá); en escritorio la barra es más baja y
              pisan toda su altura (margen en el contenedor, md:pr-32). */}
          <div className="flex flex-wrap items-center gap-2 pr-28 md:ml-auto md:pr-0">
            <Button size="sm" onClick={onEtiquetas} disabled={!seleccion.hayAlgunoSeleccionado}>
              <Tags className="h-3.5 w-3.5" /> Etiquetas
            </Button>
            {esAdmin && (
              <Button size="sm" variant="warning" onClick={onDarBaja} disabled={!seleccion.hayAlgunoSeleccionado}>
                <Ban className="h-3.5 w-3.5" /> Dar de baja
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
