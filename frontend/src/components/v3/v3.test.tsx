import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChipEstado, chipDeEstado } from './ChipEstado';
import { EncabezadoPagina, EstadoCargando, EstadoError, EstadoVacio } from './estados';

afterEach(cleanup);

describe('ChipEstado (contrato §5)', () => {
  it('elige el chip y el texto del vocabulario actual', () => {
    expect(chipDeEstado({ estado: 'cerrada' })).toEqual({ chip: 'completa' });
    expect(chipDeEstado({ estado: 'cerrada', faltan: 1 })).toEqual({ chip: 'cerrada', texto: 'Cerrada · falta 1' });
    expect(chipDeEstado({ estado: 'cerrada', faltan: 3 })).toEqual({ chip: 'cerrada', texto: 'Cerrada · faltan 3' });
    expect(chipDeEstado({ estado: 'cerrada', aRevisar: true, faltan: 2 })).toEqual({ chip: 'revisar' }); // lo marcado gana
    expect(chipDeEstado({ estado: 'borrador' })).toEqual({ chip: 'borrador' });
    expect(chipDeEstado({ estado: 'sin_evaluacion' })).toEqual({ chip: 'pendiente' });
    expect(chipDeEstado({ estado: 'sin_ronda' })).toEqual({ chip: 'sin_ronda' });
  });

  it('faltan y revisar solo cuentan para una evaluación cerrada', () => {
    expect(chipDeEstado({ estado: 'borrador', faltan: 4, aRevisar: true })).toEqual({ chip: 'borrador' });
    expect(chipDeEstado({ estado: 'sin_evaluacion', faltan: 4 })).toEqual({ chip: 'pendiente' });
  });

  it('muestra el texto del estado (no solo el color)', () => {
    const { rerender } = render(<ChipEstado estado="cerrada" />);
    expect(screen.getByText('Completa')).toBeInTheDocument();
    rerender(<ChipEstado estado="cerrada" faltan={2} />);
    expect(screen.getByText('Cerrada · faltan 2')).toBeInTheDocument();
    rerender(<ChipEstado estado="sin_evaluacion" />);
    expect(screen.getByText('Sin empezar')).toBeInTheDocument(); // E16 (hallazgo 8)
    rerender(<ChipEstado estado="sin_ronda" />);
    expect(screen.getByText('Sin ronda')).toBeInTheDocument();
  });
});

describe('Cargando (contrato §5)', () => {
  it('siempre es un status ocupado con su texto', () => {
    render(<EstadoCargando />);
    const estado = screen.getByRole('status');
    expect(estado).toHaveAttribute('aria-busy', 'true');
    expect(estado).toHaveTextContent('Cargando…');
  });

  it('el esqueleto dice lo mismo a un lector de pantalla y esconde las barras', () => {
    const { container } = render(<EstadoCargando forma="esqueleto" etiqueta="Cargando la planilla…" lineas={4} />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando la planilla…');
    const barras = container.querySelectorAll('[aria-hidden="true"] > div');
    expect(barras).toHaveLength(4);
  });

  it('al menos una línea de esqueleto aunque se pida cero', () => {
    const { container } = render(<EstadoCargando forma="esqueleto" lineas={0} />);
    expect(container.querySelectorAll('[aria-hidden="true"] > div')).toHaveLength(1);
  });
});

describe('Vacío (contrato §5)', () => {
  it('dice qué pasa, qué hacer y lleva ícono; el ícono no se lee', () => {
    const { container } = render(<EstadoVacio titulo="Todavía no hay evaluaciones" descripcion="Inicia la ronda para empezar." accion={<button type="button">Iniciar ronda</button>} />);
    expect(screen.getByText('Todavía no hay evaluaciones')).toBeInTheDocument();
    expect(screen.getByText('Inicia la ronda para empezar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar ronda' })).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.firstElementChild).toHaveClass('border-dashed');
  });

  it('funciona solo con el título', () => {
    render(<EstadoVacio titulo="Sin resultados" />);
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });
});

describe('Error (contrato §5)', () => {
  it('es una alerta con mensaje y «Reintentar» que llama a lo que se le pasa', () => {
    const reintentar = vi.fn();
    render(<EstadoError mensaje="Revisa tu conexión." onReintentar={reintentar} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar');
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa tu conexión.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reintentar).toHaveBeenCalledOnce();
  });

  it('sin nada que reintentar no hay botón', () => {
    render(<EstadoError titulo="No tienes permiso" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Encabezado de página (contrato §5)', () => {
  it('un h1 con subtítulo y acciones', () => {
    render(<EncabezadoPagina titulo="Cruces" subtitulo="Comparación operativa" acciones={<button type="button">Nuevo cruce</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Cruces' })).toBeInTheDocument();
    expect(screen.getByText('Comparación operativa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo cruce' })).toBeInTheDocument();
  });

  it('cargando: el título ya se ve, el subtítulo es una barra gris y el encabezado queda ocupado', () => {
    const { container } = render(<EncabezadoPagina titulo="Ranking" subtitulo="no se ve" estado="cargando" />);
    expect(screen.getByRole('heading', { name: 'Ranking' })).toBeInTheDocument();
    expect(screen.queryByText('no se ve')).not.toBeInTheDocument();
    expect(container.querySelector('header')).toHaveAttribute('aria-busy', 'true');
  });

  it('error: reemplaza el subtítulo por el mensaje y no ofrece acciones', () => {
    render(<EncabezadoPagina titulo="Ranking" subtitulo="no se ve" acciones={<button type="button">Exportar</button>} estado="error" mensajeError="No hay conexión." />);
    expect(screen.getByRole('alert')).toHaveTextContent('No hay conexión.');
    expect(screen.queryByText('no se ve')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument();
  });

  it('sin subtítulo ni acciones es solo el título', () => {
    render(<EncabezadoPagina titulo="Perfil" />);
    expect(screen.getByRole('heading', { name: 'Perfil' })).toBeInTheDocument();
  });
});
