import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ESQUEMA_EVALUACION_ANUAL } from '@/lib/esquemaFase/evaluacionAnual';
import { Stepper1a5 } from './Stepper1a5';

afterEach(cleanup);

describe('Stepper1a5', () => {
  it('conserva 1-5 por defecto y permite vaciar el valor activo', () => {
    const onChange = vi.fn();
    render(
      <Stepper1a5
        label="Vigor"
        value={3}
        onChange={onChange}
        labelMin="muy bajo"
        labelMax="muy alto"
      />,
    );

    const grupo = screen.getByRole('group', { name: 'Vigor' });
    expect(within(grupo).getAllByRole('button')).toHaveLength(5);
    expect(within(grupo).queryByRole('button', { name: '0' })).not.toBeInTheDocument();
    fireEvent.click(within(grupo).getByRole('button', { name: '3' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('1 = muy bajo')).toBeInTheDocument();
  });

  it('admite 0-5 cuando minimo es cero', () => {
    const onChange = vi.fn();
    render(
      <Stepper1a5
        label="Presencia de yemas florales"
        value={undefined}
        onChange={onChange}
        labelMin="ausentes"
        labelMax="muy abundantes"
        minimo={0}
      />,
    );

    const grupo = screen.getByRole('group', { name: 'Presencia de yemas florales' });
    expect(within(grupo).getAllByRole('button')).toHaveLength(6);
    fireEvent.click(within(grupo).getByRole('button', { name: '0' }));
    expect(onChange).toHaveBeenCalledWith(0);
    expect(screen.getByText('0 = ausentes')).toBeInTheDocument();
  });

  it('anuncia grupo y extremos, permite seleccionar y deseleccionar sin enviar formulario', () => {
    const submit = vi.fn((e) => e.preventDefault());
    function Arnes() { const [value, setValue] = useState<number>(); return <form onSubmit={submit}><Stepper1a5 label="Firmeza" value={value} onChange={setValue} labelMin="blando" labelMax="firme" /></form>; }
    render(<Arnes />);
    const grupo = screen.getByRole('group', { name: 'Firmeza' });
    expect(grupo).toHaveAccessibleDescription('1 = blando 5 = firme');
    const dos = within(grupo).getByRole('button', { name: '2' });
    fireEvent.click(dos);
    expect(dos).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(dos);
    expect(dos).toHaveAttribute('aria-pressed', 'false');
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('Stepper1a5 con etiquetas por nivel (precocidad)', () => {
  const escala = ESQUEMA_EVALUACION_ANUAL.campos.find((c) => c.clave === 'precocidad')!.escala!;
  function Precocidad() {
    const [valor, setValor] = useState<number | undefined>();
    return <Stepper1a5 label="Precocidad" value={valor} onChange={setValor} labelMin={escala.etiquetaMinimo} labelMax={escala.etiquetaMaximo} etiquetasNivel={escala.etiquetasNivel} />;
  }

  it('nombra el mes de cosecha de cada nivel y escribe el elegido (mayor sigue siendo más temprana)', () => {
    render(<Precocidad />);
    expect(screen.getByText('1 = Muy tardía (feb o más)')).toBeInTheDocument();
    expect(screen.getByText('5 = Muy temprana (oct – inicio nov)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '4 · Temprana (nov)' }));
    expect(screen.getByText('4 = Temprana (nov)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '4 · Temprana (nov)' }));
    expect(screen.queryByText('4 = Temprana (nov)')).not.toBeInTheDocument();
  });
});
