import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { SelectorNiveles } from './SelectorNiveles';

afterEach(cleanup);

const NIVELES = ['Solo en la punta', 'Hasta la mitad', 'Toda la vara'] as const;

describe('SelectorNiveles', () => {
  it('escribe el texto de cada nivel en su botón y entrega el número del nivel elegido', () => {
    const onChange = vi.fn();
    render(<SelectorNiveles label="Distribución de flores y frutos en la vara" value={undefined} onChange={onChange} niveles={NIVELES} />);
    const grupo = screen.getByRole('group', { name: 'Distribución de flores y frutos en la vara' });
    const botones = within(grupo).getAllByRole('button');
    expect(botones.map((b) => b.textContent)).toEqual(['Solo en la punta', 'Hasta la mitad', 'Toda la vara']);
    fireEvent.click(within(grupo).getByRole('button', { name: 'Hasta la mitad' }));
    expect(onChange).toHaveBeenCalledWith(2);
    fireEvent.click(within(grupo).getByRole('button', { name: 'Solo en la punta' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(within(grupo).getByRole('button', { name: 'Toda la vara' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it('volver a tocar el nivel activo lo vacía (el descriptor es opcional)', () => {
    const onChange = vi.fn();
    render(<SelectorNiveles label="Distribución" value={2} onChange={onChange} niveles={NIVELES} />);
    const activo = screen.getByRole('button', { name: 'Hasta la mitad' });
    expect(activo).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Toda la vara' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(activo);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('elige, cambia y vacía sin enviar el formulario que lo contiene', () => {
    const submit = vi.fn((e) => e.preventDefault());
    function Arnes() {
      const [valor, setValor] = useState<number>();
      return <form onSubmit={submit}><SelectorNiveles label="Distribución" value={valor} onChange={setValor} niveles={NIVELES} /></form>;
    }
    render(<Arnes />);
    const media = screen.getByRole('button', { name: 'Hasta la mitad' });
    fireEvent.click(media);
    expect(media).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Toda la vara' }));
    expect(media).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Toda la vara' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Toda la vara' }));
    expect(screen.getByRole('button', { name: 'Toda la vara' })).toHaveAttribute('aria-pressed', 'false');
    expect(submit).not.toHaveBeenCalled();
  });

  it('el primer nivel puede empezar en otro número (minimo)', () => {
    const onChange = vi.fn();
    render(<SelectorNiveles label="Nivel" value={undefined} onChange={onChange} niveles={['Bajo', 'Alto']} minimo={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bajo' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('los botones son táctiles (altura mínima) y en pantalla completa de celular son más altos', () => {
    render(<SelectorNiveles label="Nivel" value={undefined} onChange={vi.fn()} niveles={NIVELES} grande />);
    const boton = screen.getByRole('button', { name: 'Solo en la punta' });
    expect(boton.className).toContain('min-h-tap');
    expect(boton.className).toContain('max-md:min-h-[52px]');
  });
});
