import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { hayCambiosSinGuardar, reiniciarCambiosSinGuardar } from '@/lib/cambiosSinGuardar';
import { Modal } from './modal';
import { Sheet } from './sheet';

afterEach(() => { cleanup(); reiniciarCambiosSinGuardar(); });

describe('hojas y modales frente a la actualización automática', () => {
  it('una hoja con hayContenido marca cambios sin guardar mientras está abierta', () => {
    const { rerender, unmount } = render(<Sheet titulo="Nuevo" onCerrar={() => undefined} hayContenido={false}>x</Sheet>);
    expect(hayCambiosSinGuardar()).toBe(false);
    rerender(<Sheet titulo="Nuevo" onCerrar={() => undefined} hayContenido>x</Sheet>);
    expect(hayCambiosSinGuardar()).toBe(true);
    unmount();
    expect(hayCambiosSinGuardar()).toBe(false);
  });

  it('un Modal con hayContenido también marca (usa Sheet por dentro)', () => {
    const { unmount } = render(<Modal open onClose={() => undefined} title="Traslado" hayContenido>x</Modal>);
    expect(hayCambiosSinGuardar()).toBe(true);
    unmount();
    expect(hayCambiosSinGuardar()).toBe(false);
  });
});
