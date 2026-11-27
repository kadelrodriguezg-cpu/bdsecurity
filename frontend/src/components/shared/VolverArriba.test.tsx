import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { UMBRAL_VOLVER_ARRIBA_PX, VolverArriba } from './VolverArriba';

afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(window, 'scrollY', { value: 0, configurable: true }); });

const desplazarA = (y: number) => act(() => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  window.dispatchEvent(new Event('scroll'));
});

it('U-10: «Volver arriba» aparece solo después de bajar y lleva al inicio de la página', () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  render(<VolverArriba />);
  expect(screen.queryByRole('button', { name: 'Volver arriba' })).not.toBeInTheDocument();
  desplazarA(UMBRAL_VOLVER_ARRIBA_PX + 1);
  fireEvent.click(screen.getByRole('button', { name: 'Volver arriba' }));
  expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  desplazarA(10);
  expect(screen.queryByRole('button', { name: 'Volver arriba' })).not.toBeInTheDocument();
});
