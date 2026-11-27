import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marcarCambiosSinGuardar, reiniciarCambiosSinGuardar } from '@/lib/cambiosSinGuardar';
import { ActualizacionApp } from './ActualizacionApp';
import { AvisoVersionNueva } from './AvisoVersionNueva';

afterEach(() => { cleanup(); vi.useRealTimers(); reiniciarCambiosSinGuardar(); });

describe('AvisoVersionNueva', () => {
  it('es una región de estado accesible con el texto y un botón «Actualizar»', () => {
    render(<AvisoVersionNueva onActualizar={() => undefined} />);
    const aviso = screen.getByRole('status');
    expect(aviso).toHaveAttribute('aria-live', 'polite');
    expect(aviso).toHaveTextContent('Hay una versión nueva');
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled();
  });

  it('el clic en «Actualizar» llama a la acción una vez', () => {
    const alActualizar = vi.fn();
    render(<AvisoVersionNueva onActualizar={alActualizar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(alActualizar).toHaveBeenCalledTimes(1);
  });
});

describe('ActualizacionApp (conexión del aviso con la comprobación)', () => {
  beforeEach(() => {
    reiniciarCambiosSinGuardar();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
  });

  const montar = (extra: Partial<Parameters<typeof ActualizacionApp>[0]> = {}) => {
    const recargar = vi.fn();
    const almacen = new Map<string, string>();
    render(
      <ActualizacionApp
        habilitado
        idCargado="aaaa1111"
        obtenerIdPublicado={async () => 'bbbb2222'}
        prepararRecarga={async () => undefined}
        recargar={recargar}
        almacenamiento={{ getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => { almacen.set(k, v); } }}
        {...extra}
      />,
    );
    return recargar;
  };

  it('sin cambios sin guardar recarga sola y no muestra el aviso', async () => {
    const recargar = montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(recargar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('con cambios sin guardar muestra el aviso, no recarga, y el botón recarga al hacer clic', async () => {
    marcarCambiosSinGuardar('evaluacion', true);
    const recargar = montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('status')).toHaveTextContent('Hay una versión nueva');
    expect(recargar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(recargar).toHaveBeenCalledTimes(1);
  });
});
