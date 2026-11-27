import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CLASE_ESTADO_ENCABEZADO, EncabezadoEvaluacion } from './EncabezadoEvaluacion';

afterEach(cleanup);

const montar = () => render(
  <EncabezadoEvaluacion
    izquierda={<a href="/planilla">Planilla</a>}
    codigo="02-904-P5"
    subtitulo="Ronda 1 · anual 2026 · evaluador: María Soto Contreras (S2-6)"
    contador={<p>0 de 8 obligatorios</p>}
    estado={<span role="status" className={CLASE_ESTADO_ENCABEZADO}>Borrador guardado localmente</span>}
    derecha={<button type="button">Escanear QR</button>}
  />,
);

it('muestra el código, el contador de obligatorios, el subtítulo completo y el estado del borrador', () => {
  montar();
  expect(screen.getByText('02-904-P5')).toBeInTheDocument();
  expect(screen.getByText('0 de 8 obligatorios')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Borrador guardado localmente');
  expect(screen.getByRole('link', { name: 'Planilla' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Escanear QR' })).toBeInTheDocument();
});

it('en celular el subtítulo se recorta con puntos suspensivos pero conserva su texto completo (title) y el contador no se parte', () => {
  montar();
  const subtitulo = screen.getByText(/Ronda 1 · anual 2026/);
  expect(subtitulo).toHaveAttribute('title', 'Ronda 1 · anual 2026 · evaluador: María Soto Contreras (S2-6)');
  expect(subtitulo.className).toContain('max-md:truncate');
  expect(screen.getByText('0 de 8 obligatorios').parentElement?.className).toContain('max-md:whitespace-nowrap');
});

it('sin contador ni estado no deja huecos en la cuadrícula', () => {
  render(<EncabezadoEvaluacion izquierda={<a href="/">Volver</a>} codigo="02-951-P45" subtitulo="Evaluación reducida · Crecimiento" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('Evaluación reducida · Crecimiento')).toBeInTheDocument();
});
