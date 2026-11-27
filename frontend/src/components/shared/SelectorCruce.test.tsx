/** Fase 5 (G17): selector de cruce con buscador, en orden natural y con «Toda la especie» primero. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SelectorCruce } from './SelectorCruce';

afterEach(cleanup);

const cruces = ['02-080', '07-001', '02-001', '02-1000', '07-010', '02-002'].map((c, i) => ({ id: `c${i}`, codigo_sistema: c, es_prueba: c === '07-010' }));
const montar = (valor = '', onCambiar = vi.fn()) => {
  render(<SelectorCruce id="cruce" etiqueta="Cruce" cruces={cruces} valor={valor} onCambiar={onCambiar} opcionTodos="Toda la especie" />);
  return onCambiar;
};
const opciones = () => within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);

describe('SelectorCruce', () => {
  it('muestra lo elegido y, al abrir, «Toda la especie» primero y los cruces en orden natural', () => {
    montar('c0');
    const combo = screen.getByRole('combobox', { name: 'Cruce' });
    expect(combo).toHaveValue('02-080');
    fireEvent.focus(combo);
    expect(combo).toHaveAttribute('aria-expanded', 'true');
    expect(opciones()).toEqual(['Toda la especie', '02-001', '02-002', '02-080', '02-1000', '07-001', '07-010 (prueba)']);
  });

  it('se escribe «07» y se filtra; Enter elige la primera coincidencia', () => {
    const onCambiar = montar();
    const combo = screen.getByRole('combobox', { name: 'Cruce' });
    fireEvent.change(combo, { target: { value: '07' } });
    expect(opciones()).toEqual(['07-001', '07-010 (prueba)']);
    fireEvent.keyDown(combo, { key: 'Enter' });
    expect(onCambiar).toHaveBeenCalledWith('c1');
  });

  it('con flechas se recorre; Escape cierra sin cambiar', () => {
    const onCambiar = montar();
    const combo = screen.getByRole('combobox', { name: 'Cruce' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: '02-001' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onCambiar).not.toHaveBeenCalled();
  });

  it('un clic en una opción la elige; «Toda la especie» devuelve vacío', () => {
    const onCambiar = montar('c0');
    fireEvent.focus(screen.getByRole('combobox', { name: 'Cruce' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: '02-1000' }));
    expect(onCambiar).toHaveBeenLastCalledWith('c3');
    fireEvent.focus(screen.getByRole('combobox', { name: 'Cruce' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Toda la especie' }));
    expect(onCambiar).toHaveBeenLastCalledWith('');
  });

  it('sin coincidencias lo dice', () => {
    montar();
    fireEvent.change(screen.getByRole('combobox', { name: 'Cruce' }), { target: { value: '99' } });
    expect(screen.getByText('Ningún cruce con «99».')).toBeInTheDocument();
  });

  it('funciona con cientos de cruces: se dibujan los primeros y se pide escribir para acotar', () => {
    const muchos = Array.from({ length: 450 }, (_, i) => ({ id: `m${i}`, codigo_sistema: `02-${String(i + 1).padStart(3, '0')}`, es_prueba: false }));
    render(<SelectorCruce id="cruce" etiqueta="Cruce" cruces={muchos} valor="" onCambiar={vi.fn()} opcionTodos="Toda la especie" />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Cruce' }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option').length).toBeLessThanOrEqual(101);
    expect(screen.getByText(/Escribe para ver los otros/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Cruce' }), { target: { value: '02-449' } });
    expect(opciones()).toEqual(['02-449']);
  });
});

describe('SelectorCruce al tomar el foco', () => {
  it('selecciona el texto mostrado, para que lo que se escriba lo reemplace (no «Toda la especi70e»)', () => {
    montar();
    const combo = screen.getByRole('combobox', { name: 'Cruce' }) as HTMLInputElement;
    fireEvent.focus(combo);
    expect(combo.selectionStart).toBe(0);
    expect(combo.selectionEnd).toBe('Toda la especie'.length);
  });
});
