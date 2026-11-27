/**
 * Etiqueta individual: qué codifica el QR que se ve en pantalla y los dos que se
 * dibujan ocultos para el PDF (URL para grande/mediana, corto para la pequeña).
 * `qrcode.react` se sustituye por componentes que solo exponen su `value`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('qrcode.react', async () => {
  const React = await import('react');
  return {
    QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="qr-pantalla" data-value={value} />,
    QRCodeCanvas: React.forwardRef<HTMLCanvasElement, { value: string }>(function CanvasFalso({ value }, ref) {
      return <canvas data-testid="qr-oculto" data-value={value} ref={ref} />;
    }),
  };
});

import { QRGenerator } from './QRGenerator';

afterEach(cleanup);

const CRUCE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const INDIVIDUO = '11111111-2222-3333-4444-555555555555';
const ORIGIN = window.location.origin;

function valores(contenedor: HTMLElement) {
  return {
    pantalla: contenedor.querySelector('[data-testid="qr-pantalla"]')?.getAttribute('data-value'),
    ocultos: [...contenedor.querySelectorAll('[data-testid="qr-oculto"]')].map((c) => c.getAttribute('data-value')),
  };
}

describe('QRGenerator — etiqueta de un individuo', () => {
  it('el QR es el del individuo: URL con origen en pantalla y para grande/mediana, ruta sin origen para la pequeña', () => {
    const { container, getByText } = render(
      <QRGenerator plantaId={CRUCE} codigoSistema="02-001" individuo={{ id: INDIVIDUO, codigo: '02-001-P07' }} />,
    );
    const v = valores(container);
    expect(v.pantalla).toBe(`${ORIGIN}/individuo/${INDIVIDUO}`);
    expect(v.ocultos).toEqual([`${ORIGIN}/individuo/${INDIVIDUO}`, `/individuo/${INDIVIDUO}`]);
    // Nunca el UUID pelado (que significa «cruce») ni el id del cruce.
    for (const valor of [v.pantalla, ...v.ocultos]) {
      expect(valor).not.toBe(INDIVIDUO);
      expect(valor).not.toContain(CRUCE);
    }
    // La etiqueta imprime solo el número corto, nunca el código completo del cruce.
    expect(getByText('P07')).toBeInTheDocument();
  });
});

describe('QRGenerator — etiqueta de un cruce (sin cambios respecto de lo ya impreso)', () => {
  it('URL /planta/<uuid> para grande/mediana y UUID pelado para la pequeña', () => {
    const { container, queryByText } = render(<QRGenerator plantaId={CRUCE} codigoSistema="02-001" compacto />);
    const v = valores(container);
    expect(v.pantalla).toBe(`${ORIGIN}/planta/${CRUCE}`);
    expect(v.ocultos).toEqual([`${ORIGIN}/planta/${CRUCE}`, CRUCE]);
    expect(queryByText(/^P\d+$/)).not.toBeInTheDocument();
  });
});
