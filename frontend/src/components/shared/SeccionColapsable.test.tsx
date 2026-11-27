import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SeccionColapsable } from './SeccionColapsable';

afterEach(cleanup);

it('respeta defaultAbierto y conserva el desmontaje de controles al cerrar', () => {
  render(<SeccionColapsable titulo="Datos" defaultAbierto><input aria-label="Campo" /></SeccionColapsable>);
  expect(screen.getByRole('textbox')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button'));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('textbox')).toBeInTheDocument();
});

it('comienza cerrado con resumen y no reinicia el estado por un rerender', () => {
  const { rerender } = render(<SeccionColapsable titulo="Datos" resumen="Resumen" defaultAbierto={false}>Contenido</SeccionColapsable>);
  expect(screen.getByText('Resumen')).toBeInTheDocument();
  expect(screen.queryByText('Contenido')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button'));
  rerender(<SeccionColapsable titulo="Datos" resumen="Resumen" defaultAbierto={false}>Contenido</SeccionColapsable>);
  expect(screen.getByText('Contenido')).toBeInTheDocument();
  expect(screen.queryByText('Resumen')).not.toBeInTheDocument();
});
