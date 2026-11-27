import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { CampoFecha } from './campo-fecha';

describe('CampoFecha', () => {
  it('mantiene un input date nativo con valor ISO', () => {
    render(<CampoFecha id="fecha" label="Fecha" value="2026-07-17" onChange={() => {}} />);
    const input = screen.getByLabelText('Fecha') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-07-17');
  });

  it('advierte sin bloquear una secuencia temporal inusual', () => {
    render(
      <CampoFecha
        id="fecha"
        label="Fecha"
        value="2026-07-10"
        fechaMinimaContextual="2026-07-12"
        etiquetaFechaMinima="la germinación anterior"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/anterior a la germinación anterior/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-07-10')).not.toHaveAttribute('aria-invalid');
  });
});
