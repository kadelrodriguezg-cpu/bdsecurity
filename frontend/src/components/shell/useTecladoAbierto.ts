import { useEffect, useState } from 'react';

const TIPOS_SIN_TECLADO = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'image']);

/** ¿El elemento abre el teclado del celular al enfocarlo? (campos de texto, áreas de texto y contenido editable). */
export function abreTeclado(elemento: EventTarget | null): boolean {
  if (!(elemento instanceof HTMLElement)) return false;
  if (elemento instanceof HTMLTextAreaElement) return true;
  if (elemento instanceof HTMLInputElement) return !TIPOS_SIN_TECLADO.has(elemento.type);
  return elemento.isContentEditable === true || ['', 'true', 'plaintext-only'].includes(elemento.getAttribute('contenteditable') ?? 'no');
}

/**
 * Verdadero mientras hay un campo de texto enfocado. La barra inferior se oculta entonces para no tapar el teclado
 * ni el campo (en Android el teclado reduce la ventana y la barra fija quedaría encima).
 */
export function useTecladoAbierto(): boolean {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const alEnfocar = (evento: FocusEvent) => setAbierto(abreTeclado(evento.target));
    const alDesenfocar = (evento: FocusEvent) => setAbierto(abreTeclado(evento.relatedTarget));
    document.addEventListener('focusin', alEnfocar);
    document.addEventListener('focusout', alDesenfocar);
    return () => {
      document.removeEventListener('focusin', alEnfocar);
      document.removeEventListener('focusout', alDesenfocar);
    };
  }, []);
  return abierto;
}
