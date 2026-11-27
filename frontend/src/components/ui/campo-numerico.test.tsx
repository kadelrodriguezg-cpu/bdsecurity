import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { CampoNumerico } from './campo-numerico';
afterEach(cleanup);
describe('CampoNumerico accesible', () => {
  it('asocia etiqueta y error con IDs únicos', () => {
    render(<><CampoNumerico label="Calibre" unidad="mm" valor="-1" minimoTecnico={0} onChange={() => {}} /><CampoNumerico label="Calibre" unidad="mm" valor="2" onChange={() => {}} /></>);
    const inputs = screen.getAllByRole('spinbutton', { name: 'Calibre mm' });
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(inputs[0]).toHaveAttribute('aria-invalid', 'true');
    expect(inputs[0]).toHaveAccessibleDescription(/Valor inválido/);
    expect(inputs[1]).toHaveAttribute('aria-invalid', 'false');
  });
  it('avisa fuera del rango esperado y explica la nota sin marcar inválido el valor (U-07)', () => {
    render(<CampoNumerico label="Calibre" unidad="mm" valor="30" min={10} max={20} modo="referencia" notaReferencia="Referencia del catálogo" onChange={() => {}} />);
    const input = screen.getByRole('spinbutton', { name: 'Calibre mm' });
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).toHaveAccessibleDescription(/fuera del rango esperado: revisa \(10–20 mm\).*Referencia del catálogo/);
  });
});
