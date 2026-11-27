import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createRef } from 'react';
import { Button } from './button';

afterEach(cleanup);

it('sin cargando conserva nombre, ref, atributos y acción', () => {
  const click = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  render(<Button ref={ref} type="submit" onClick={click}>Guardar</Button>);
  const boton = screen.getByRole('button', { name: 'Guardar' });
  expect(ref.current).toBe(boton);
  expect(boton).toHaveAttribute('type', 'submit');
  expect(boton).not.toHaveAttribute('aria-busy');
  fireEvent.click(boton);
  expect(click).toHaveBeenCalledOnce();
});

it('cargando bloquea clics, anuncia ocupado, conserva el nombre y se recupera', () => {
  const click = vi.fn();
  const { rerender } = render(<Button cargando onClick={click}>Guardar</Button>);
  const boton = screen.getByRole('button', { name: 'Guardar' });
  expect(boton).toBeDisabled();
  expect(boton).toHaveAttribute('aria-busy', 'true');
  expect(boton.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  fireEvent.click(boton);
  expect(click).not.toHaveBeenCalled();
  rerender(<Button onClick={click}>Guardar</Button>);
  expect(boton).toBeEnabled();
  fireEvent.click(boton);
  expect(click).toHaveBeenCalledOnce();
});

it('al terminar la carga respeta disabled y aria-busy del consumidor', () => {
  const { rerender } = render(<Button cargando disabled>Guardar</Button>);
  rerender(<Button disabled aria-busy="true">Guardar</Button>);
  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
});
