/**
 * Sheet — modal/overlay para formularios largos con footer de acciones
 * (North Star v5, Ronda 2 UI). No reemplaza `Modal` (que sigue sirviendo
 * Trasplante/Crecimiento/Traslado sin cambios) — agrega lo que Modal no
 * tiene: subtítulo, footer con slot propio (indicador de borrador +
 * botones), y `hayContenido` para que Escape/click-en-overlay/botón-X pidan
 * confirmación antes de cerrar, igual que debe pedirla el botón "Cancelar"
 * del formulario que lo usa (mismo criterio, un solo punto de cierre real).
 *
 * Mismo patrón responsive que Modal/AppLayout: un componente, clases
 * `sm:`/`md:` deciden centrado en escritorio vs. hoja inferior en celular,
 * sin JS de detección de dispositivo.
 */
import { useEffect, useId, useRef, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMarcarCambiosSinGuardar } from '@/lib/cambiosSinGuardar';
import { useSalidaAnimada } from './useSalidaAnimada';

const selectorEnfocables = 'button, input:not([type="hidden"]), select, textarea, a[href], [tabindex]';

function enfocablesEn(contenedor: HTMLElement | null): HTMLElement[] {
  return Array.from(contenedor?.querySelectorAll<HTMLElement>(selectorEnfocables) ?? [])
    .filter((elemento) => {
      if (elemento.tabIndex < 0 || elemento.matches(':disabled') || elemento.closest('[hidden], [inert]')) return false;
      for (let actual: HTMLElement | null = elemento; actual; actual = actual.parentElement) {
        const estilo = getComputedStyle(actual);
        if (estilo.display === 'none' || estilo.visibility === 'hidden' || estilo.visibility === 'collapse') return false;
      }
      return true;
    });
}

export function Sheet({
  titulo,
  subtitulo,
  onCerrar,
  children,
  footer,
  hayContenido = false,
  size = 'form',
}: {
  titulo: string;
  subtitulo?: string;
  onCerrar: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Si hay contenido sin guardar, Escape/overlay/botón-X/gesto confirman antes de cerrar. */
  hayContenido?: boolean;
  /** Dimensión visual solamente; no altera montaje, foco, Escape ni cierre. */
  size?: 'form' | 'evaluacion' | 'ancho' | 'chat';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const contenidoRef = useRef<HTMLDivElement>(null);
  const tiradorRef = useRef<HTMLDivElement>(null);
  const arrastreRef = useRef<{ pointerId: number; x: number; y: number; desplazamiento: number } | null>(null);
  const tituloId = useId();
  const salida = useSalidaAnimada(onCerrar);

  // Bug real (reproducido con Testing Library): con `hayContenido` en las
  // deps del efecto de abajo, tipear el PRIMER carácter en cualquier campo
  // (el momento en que hayContenido pasa de false a true) hacía que el
  // efecto se re-ejecutara y volviera a robar el foco hacia el botón de
  // cerrar (X) — el primer elemento enfocable del DOM. El campo donde el
  // usuario estaba escribiendo quedaba con el foco perdido, así que
  // "dejaba de aceptar tecleo" justo después del primer carácter. El foco
  // inicial y el listener de Escape se registran una sola vez al montar;
  // `intentarCerrar` lee `hayContenido`/`onCerrar` vía refs para que la
  // confirmación siga usando el valor más reciente sin depender de ellos
  // en el efecto.
  const hayContenidoRef = useRef(hayContenido);
  hayContenidoRef.current = hayContenido;
  // Mientras esta hoja tenga contenido sin guardar, la app no se recarga sola por una versión nueva.
  useMarcarCambiosSinGuardar(hayContenido);

  const intentarCerrar = () => {
    if (salida.iniciada.current) return false;
    if (hayContenidoRef.current && !window.confirm('Tienes cambios sin guardar. ¿Descartar el borrador?')) return false;
    // Capturar la posición visible también si está volviendo de un gesto corto.
    if (ref.current) {
      ref.current.style.setProperty('--sheet-exit-transform', getComputedStyle(ref.current).transform || 'none');
    }
    salida.iniciar();
    return true;
  };

  // Solo la cabecera inicia el gesto: el contenido conserva scroll y edición.
  // La visibilidad CSS del tirador delimita la hoja móvil sin otro breakpoint.
  const iniciarArrastre = (e: PointerEvent<HTMLDivElement>) => {
    if (salida.iniciada.current || arrastreRef.current || e.isPrimary === false || e.button !== 0) return;
    if (!tiradorRef.current || getComputedStyle(tiradorRef.current).display === 'none') return;
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
    if (ref.current) {
      const transform = getComputedStyle(ref.current).transform;
      ref.current.style.transform = transform || 'none';
      ref.current.setAttribute('data-interactuado', '');
      ref.current.setAttribute('data-arrastrando', '');
    }
    arrastreRef.current = {
      pointerId: e.pointerId, x: e.clientX, y: e.clientY,
      // Permite retomar un regreso/entrada todavía en curso sin saltar al origen.
      desplazamiento: Math.max(0, (ref.current?.getBoundingClientRect().bottom ?? 0) - window.innerHeight),
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const moverArrastre = (e: PointerEvent<HTMLDivElement>) => {
    const inicio = arrastreRef.current;
    if (!inicio || inicio.pointerId !== e.pointerId || !ref.current) return;
    const dy = e.clientY - inicio.y;
    const dx = Math.abs(e.clientX - inicio.x);
    ref.current.style.transform = `translateY(${Math.max(0, inicio.desplazamiento + (Math.abs(dy) > dx ? dy : 0))}px)`;
  };

  const cancelarArrastre = (e: PointerEvent<HTMLDivElement>) => {
    if (arrastreRef.current?.pointerId !== e.pointerId) return;
    arrastreRef.current = null;
    ref.current?.removeAttribute('data-arrastrando');
    ref.current?.style.removeProperty('transform');
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const terminarArrastre = (e: PointerEvent<HTMLDivElement>) => {
    const inicio = arrastreRef.current;
    if (!inicio || inicio.pointerId !== e.pointerId) return;
    const dy = e.clientY - inicio.y;
    const dx = Math.abs(e.clientX - inicio.x);
    if (dy >= 72 && dy > dx * 1.5 && intentarCerrar()) {
      // Soltar la captura sin restablecer la posición antes de la salida.
      arrastreRef.current = null;
      ref.current?.removeAttribute('data-arrastrando');
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } else {
      cancelarArrastre(e);
    }
  };

  useEffect(() => {
    const focoAnterior = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (salida.iniciada.current) {
        if (e.key === 'Tab' || e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        intentarCerrar();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const enfocables = enfocablesEn(ref.current);
      if (enfocables.length === 0) {
        e.preventDefault();
        ref.current.focus();
        return;
      }
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (!enfocables.includes(document.activeElement as HTMLElement)) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus();
      } else if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const contenidoEnfocable = enfocablesEn(contenidoRef.current);
    const inicial = contenidoEnfocable.find((elemento) => elemento.hasAttribute('data-autofocus'))
      ?? contenidoEnfocable[0] ?? enfocablesEn(ref.current)[0] ?? ref.current;
    inicial?.focus();
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflowPrevio;
      focoAnterior?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      data-cerrando={salida.cerrando || undefined}
      onPointerDownCapture={(e) => { if (salida.iniciada.current) { e.preventDefault(); e.stopPropagation(); } }}
      onMouseDownCapture={(e) => { if (salida.iniciada.current) { e.preventDefault(); e.stopPropagation(); } }}
      onClickCapture={(e) => { if (salida.iniciada.current) { e.preventDefault(); e.stopPropagation(); } }}
      onKeyDownCapture={(e) => { if (salida.iniciada.current) { e.preventDefault(); e.stopPropagation(); } }}
      className={cn(
        'motion-sheet fixed inset-0 z-50 flex items-end justify-center',
        size === 'chat' ? 'sm:items-stretch sm:justify-end' : 'sm:items-center sm:p-4',
      )}
      onClick={intentarCerrar}
    >
      <div aria-hidden="true" data-cerrando={salida.cerrando || undefined} className="motion-overlay absolute inset-0 bg-ink/50 backdrop-blur-[2px]" />
      <div
        ref={ref}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={tituloId}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && (e.animationName === 'overlay-exit' || e.animationName === 'sheet-exit')) salida.finalizar();
        }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'motion-dialog relative flex max-h-[86dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl',
          size === 'chat' && 'motion-dialog-chat',
          size === 'chat'
            ? 'h-[86dvh] pb-[env(safe-area-inset-bottom)] sm:h-full sm:max-h-none sm:w-[min(760px,calc(100vw-48px))] sm:rounded-none sm:pb-0'
            : size === 'ancho'
            ? 'sm:max-h-[90vh] sm:w-[calc(100vw-64px)] sm:max-w-4xl'
            : size === 'evaluacion'
              ? 'sm:max-h-[92vh] sm:w-[calc(100vw-48px)] sm:max-w-6xl'
              : 'sm:max-h-[86vh] sm:w-[480px] sm:max-w-[calc(100vw-32px)]',
        )}
      >
        <div
          className="shrink-0 touch-pan-x sm:touch-auto"
          onPointerDown={iniciarArrastre}
          onPointerMove={moverArrastre}
          onPointerUp={terminarArrastre}
          onPointerCancel={cancelarArrastre}
          onLostPointerCapture={cancelarArrastre}
        >
          <div ref={tiradorRef} aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-line sm:hidden" />
          <div className="flex items-start justify-between gap-2 border-b p-4">
            <div className="min-w-0">
              <h2 id={tituloId} className="text-title font-semibold">{titulo}</h2>
              {subtitulo && <div className="mt-0.5 font-mono text-body text-ink-2">{subtitulo}</div>}
            </div>
            <button
              type="button"
              onClick={intentarCerrar}
              aria-label="Cerrar"
              className="grid min-h-tap min-w-tap shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink-2"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div ref={contenidoRef} className={cn('flex-1', size === 'chat' ? 'min-h-0 overflow-hidden p-0' : 'overflow-y-auto p-4')}>{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-surface-2 p-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
