/**
 * Bug real (Ronda 2b, reportado por Kadel): en el Sheet de "Nueva
 * evaluación", Calibre/Brix dejaban de aceptar tecleo justo después del
 * primer carácter, mostrando "Fuera de rango" desde el inicio. Causa: el
 * `useEffect` que hace foco inicial dependía de `[hayContenido]` — tipear
 * el primer carácter en cualquier campo (el momento en que hayContenido
 * pasa de false a true) hacía que el efecto se re-ejecutara y volviera a
 * robar el foco hacia el botón de cerrar (X), el primer elemento enfocable
 * del DOM. Reproducido con Testing Library antes de arreglarlo (no se dio
 * por resuelto sin verificarlo).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { Sheet } from './sheet';
import { Modal } from './modal';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function terminarSalida() {
  animacion(screen.getByRole('dialog'), 'sheet-exit');
}

function animacion(elemento: HTMLElement, nombre: string) {
  // Sin AnimationEvent, React 18 detecta el evento WebKit en jsdom.
  const evento = new Event('webkitAnimationEnd', { bubbles: true });
  Object.defineProperty(evento, 'animationName', { value: nombre });
  fireEvent(elemento, evento);
}

function Arnes() {
  const [hay, setHay] = useState(false);
  const [cerrado, setCerrado] = useState(false);
  if (cerrado) return <p>cerrado</p>;
  return (
    <Sheet titulo="Prueba" onCerrar={() => setCerrado(true)} hayContenido={hay}>
      <input placeholder="campo" onChange={(e) => setHay(e.target.value !== '')} />
    </Sheet>
  );
}

describe('Sheet — foco no se roba al escribir (bug Calibre/Brix)', () => {
  it('mueve el foco al contenido y lo restaura al elemento que abrió el diálogo', () => {
    function ConDisparador() {
      const [abierto, setAbierto] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setAbierto(true)}>Abrir</button>
          {abierto && <Sheet titulo="Foco" onCerrar={() => setAbierto(false)}><input aria-label="Primero" /></Sheet>}
        </>
      );
    }
    render(<ConDisparador />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    abrir.focus();
    fireEvent.click(abrir);
    expect(screen.getByLabelText('Primero')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    terminarSalida();
    expect(abrir).toHaveFocus();
  });

  it('el foco se queda en el input tras escribir el primer carácter (hayContenido false→true) y los siguientes', () => {
    render(<Arnes />);
    const input = screen.getByPlaceholderText('campo') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '1' } });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '18' } });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('18');
  });

  it('Escape con hayContenido=true sigue pidiendo confirmación antes de cerrar (no se rompió al sacar hayContenido de las deps)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Arnes />);
    const input = screen.getByPlaceholderText('campo') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'x' } });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.queryByText('cerrado')).toBeNull();

    confirmSpy.mockReturnValue(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('cerrado')).toBeNull();
    terminarSalida();
    expect(screen.getByText('cerrado')).toBeInTheDocument();

    confirmSpy.mockRestore();
  });
});

describe('Sheet — salida y limpieza', () => {
  it('difiere el cierre, ignora eventos hijos y llama una sola vez aunque se cierre repetidamente', () => {
    vi.useFakeTimers();
    const cerrar = vi.fn();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const accion = vi.fn();
    render(<Sheet titulo="Salida" onCerrar={cerrar} hayContenido><button onClick={accion}>Acción</button></Sheet>);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirmar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Acción'));
    expect(accion).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: 'k', ctrlKey: true })).toBe(true);
    expect(fireEvent.mouseDown(screen.getByText('Acción'))).toBe(false);
    expect(fireEvent.pointerDown(screen.getByText('Acción'))).toBe(false);
    animacion(screen.getByText('Acción'), 'overlay-exit');
    animacion(screen.getByRole('dialog'), 'overlay-enter');
    expect(cerrar).not.toHaveBeenCalled();
    terminarSalida();
    expect(cerrar).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it('usa timeout de seguridad si no llega animationend y el callback más reciente', () => {
    vi.useFakeTimers();
    const anterior = vi.fn();
    const actual = vi.fn();
    const { rerender } = render(<Sheet titulo="Salida" onCerrar={anterior}>Texto</Sheet>);
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    act(() => vi.advanceTimersByTime(299));
    expect(anterior).not.toHaveBeenCalled();
    rerender(<Sheet titulo="Salida" onCerrar={actual}>Texto</Sheet>);
    act(() => vi.advanceTimersByTime(1));
    expect(anterior).not.toHaveBeenCalled();
    expect(actual).toHaveBeenCalledTimes(1);
  });

  it('restaura overflow y foco al desmontar durante la salida y cancela el timeout', () => {
    vi.useFakeTimers();
    document.body.style.overflow = 'scroll';
    const disparador = document.createElement('button');
    document.body.append(disparador);
    disparador.focus();
    const cerrar = vi.fn();
    const { unmount } = render(<Sheet titulo="Salida" onCerrar={cerrar}>Texto</Sheet>);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    expect(disparador).toHaveFocus();
    act(() => vi.advanceTimersByTime(1000));
    expect(cerrar).not.toHaveBeenCalled();
    disparador.remove();
    document.body.style.overflow = '';
  });

  it('cierra inmediatamente con reduced-motion y restaura el foco', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const origen = document.createElement('button');
    document.body.append(origen);
    origen.focus();
    render(<Arnes />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('cerrado')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(origen).toHaveFocus();
    origen.remove();
  });

  it('finaliza una salida pendiente si se activa reduced-motion', () => {
    let cambiar = () => {};
    const media = { matches: false, addEventListener: (_: string, cb: () => void) => { cambiar = cb; }, removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    render(<Arnes />);
    fireEvent.keyDown(document, { key: 'Escape' });
    media.matches = true;
    act(() => cambiar());
    expect(screen.getByText('cerrado')).toBeInTheDocument();
  });

  it('Modal comparte la salida propia y permite el desmontaje inmediato decidido por el padre', () => {
    vi.useFakeTimers();
    const cerrar = vi.fn();
    const { rerender } = render(<Modal open onClose={cerrar} title="Modal">Texto</Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cerrar).not.toHaveBeenCalled();
    terminarSalida();
    expect(cerrar).toHaveBeenCalledTimes(1);
    rerender(<Modal open={false} onClose={cerrar} title="Modal">Texto</Modal>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<Modal open onClose={cerrar} title="Modal">Texto</Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(<Modal open={false} onClose={cerrar} title="Modal">Texto</Modal>);
    act(() => vi.advanceTimersByTime(1000));
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Sheet — navegación por teclado', () => {
  it('enfoca el primer enlace al abrir un menú y omite controles no disponibles', () => {
    render(<Sheet titulo="Más" onCerrar={() => {}}><button disabled>No disponible</button><a href="/plantas">Cruces</a></Sheet>);
    expect(screen.getByRole('link', { name: 'Cruces' })).toHaveFocus();
  });
  it('usa el cierre si el contenido no contiene controles', () => {
    render(<Sheet titulo="Información" onCerrar={() => {}}>Texto</Sheet>);
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
  });
  it('recupera el foco que escapó y envuelve Tab en ambas direcciones', () => {
    render(<><button>Exterior</button><Sheet titulo="Más" onCerrar={() => {}}><a href="/plantas">Cruces</a></Sheet></>);
    const cierre = screen.getByRole('button', { name: 'Cerrar' });
    const enlace = screen.getByRole('link');
    screen.getByRole('button', { name: 'Exterior' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cierre).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(enlace).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cierre).toHaveFocus();
  });
  it('retiene Tab en el diálogo si todos los controles dejan de estar disponibles', () => {
    render(<Sheet titulo="Vacío" onCerrar={() => {}}>Texto</Sheet>);
    screen.getByRole('button', { name: 'Cerrar' }).setAttribute('disabled', '');
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog')).toHaveFocus();
  });
});

function puntero(elemento: HTMLElement, tipo: string, x: number, y: number, pointerId = 1) {
  const evento = new Event(tipo, { bubbles: true, cancelable: true });
  Object.defineProperties(evento, {
    pointerId: { value: pointerId },
    clientX: { value: x },
    clientY: { value: y },
    button: { value: 0 },
    isPrimary: { value: true },
  });
  fireEvent(elemento, evento);
}

describe('Sheet — gesto de cierre desde la cabecera móvil', () => {
  it('continúa la salida desde el desplazamiento visible y cierra una sola vez', () => {
    const cerrar = vi.fn();
    render(<Sheet titulo="Gesto" size="chat" onCerrar={cerrar}>Contenido</Sheet>);
    const titulo = screen.getByRole('heading', { name: 'Gesto' });
    puntero(titulo, 'pointerdown', 150, 20);
    puntero(titulo, 'pointermove', 155, 100);
    expect(screen.getByRole('dialog').style.transform).toBe('translateY(80px)');
    puntero(titulo, 'pointerup', 155, 100);
    expect(cerrar).not.toHaveBeenCalled();
    const dialogo = screen.getByRole('dialog');
    expect(dialogo.style.transform).toBe('translateY(80px)');
    expect(dialogo.style.getPropertyValue('--sheet-exit-transform')).toBe('translateY(80px)');
    expect(dialogo).not.toHaveAttribute('data-arrastrando');
    // Un lostpointercapture posterior a pointerup no borra el punto de salida.
    puntero(titulo, 'lostpointercapture', 155, 100);
    expect(dialogo.style.transform).toBe('translateY(80px)');
    animacion(dialogo.parentElement!.firstElementChild as HTMLElement, 'overlay-fade-out');
    expect(cerrar).not.toHaveBeenCalled();
    terminarSalida();
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it.each([[155, 55], [250, 100], [150, -100]])('no cierra con un gesto corto, lateral o hacia arriba (%s, %s)', (x, y) => {
    const cerrar = vi.fn();
    render(<Sheet titulo="Gesto" onCerrar={cerrar}>Contenido</Sheet>);
    const titulo = screen.getByRole('heading', { name: 'Gesto' });
    puntero(titulo, 'pointerdown', 150, 20);
    puntero(titulo, 'pointermove', x, y);
    puntero(titulo, 'pointerup', x, y);
    expect(screen.getByRole('dialog').parentElement).not.toHaveAttribute('data-cerrando');
    expect(screen.getByRole('dialog').style.transform).toBe('');
    expect(screen.getByRole('dialog')).toHaveAttribute('data-interactuado');
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-arrastrando');
    expect(cerrar).not.toHaveBeenCalled();
  });

  it('cancela el desplazamiento si el navegador interrumpe el gesto y permite volver a intentarlo', () => {
    const cerrar = vi.fn();
    render(<Sheet titulo="Gesto" onCerrar={cerrar}>Contenido</Sheet>);
    const titulo = screen.getByRole('heading', { name: 'Gesto' });
    puntero(titulo, 'pointerdown', 150, 20);
    puntero(titulo, 'pointermove', 150, 120);
    puntero(titulo, 'pointercancel', 150, 120);
    puntero(titulo, 'pointerup', 150, 120);
    expect(screen.getByRole('dialog').style.transform).toBe('');
    expect(cerrar).not.toHaveBeenCalled();
    puntero(titulo, 'pointerdown', 150, 20);
    puntero(titulo, 'pointerup', 150, 120);
    terminarSalida();
    expect(cerrar).toHaveBeenCalledOnce();
  });

  it('no intercepta gestos iniciados en contenido ni terminados por otro puntero', () => {
    const cerrar = vi.fn();
    render(<Sheet titulo="Gesto" onCerrar={cerrar}><p>Mensajes</p></Sheet>);
    const contenido = screen.getByText('Mensajes');
    puntero(contenido, 'pointerdown', 150, 20);
    puntero(contenido, 'pointerup', 150, 150);
    expect(cerrar).not.toHaveBeenCalled();
    const titulo = screen.getByRole('heading', { name: 'Gesto' });
    puntero(titulo, 'pointerdown', 150, 20);
    puntero(titulo, 'pointerup', 150, 150, 2);
    expect(screen.getByRole('dialog').parentElement).not.toHaveAttribute('data-cerrando');
    puntero(titulo, 'pointercancel', 150, 150);
  });

  it('respeta el borrador más reciente y la decisión de conservarlo', () => {
    const cerrar = vi.fn();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { rerender } = render(<Sheet titulo="Gesto" onCerrar={cerrar}>Contenido</Sheet>);
    rerender(<Sheet titulo="Gesto" onCerrar={cerrar} hayContenido>Contenido</Sheet>);
    const titulo = screen.getByRole('heading', { name: 'Gesto' });
    puntero(titulo, 'pointerdown', 150, 20);
    puntero(titulo, 'pointerup', 150, 120);
    expect(confirmar).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog').style.transform).toBe('');
    expect(cerrar).not.toHaveBeenCalled();
    confirmar.mockReturnValue(true);
    puntero(titulo, 'pointerdown', 150, 20);
    puntero(titulo, 'pointerup', 150, 120);
    terminarSalida();
    expect(cerrar).toHaveBeenCalledOnce();
  });

  it('cierra sin animación con movimiento reducido y restaura el foco', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    function GestoConDisparador() {
      const [abierto, setAbierto] = useState(false);
      return <><button onClick={() => setAbierto(true)}>Abrir</button>{abierto && <Sheet titulo="Gesto" onCerrar={() => setAbierto(false)}>Contenido</Sheet>}</>;
    }
    render(<GestoConDisparador />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    abrir.focus();
    fireEvent.click(abrir);
    const titulo = screen.getByRole('heading', { name: 'Gesto' });
    puntero(titulo, 'pointerdown', 150, 20);
    puntero(titulo, 'pointerup', 150, 120);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(abrir).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });
});
