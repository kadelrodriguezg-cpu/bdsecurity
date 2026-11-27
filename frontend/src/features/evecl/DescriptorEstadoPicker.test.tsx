import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DescriptorEstadoPicker } from './DescriptorEstadoPicker';

afterEach(cleanup);

describe('DescriptorEstadoPicker', () => {
  it('respeta las notas UPOV literales y el target táctil mínimo', () => {
    const alCambiar = vi.fn();
    render(
      <DescriptorEstadoPicker
        nombre="Vigor"
        estados={[
          { nota: 3, label: 'Débil', orden: 1 },
          { nota: 5, label: 'Medio', orden: 2 },
          { nota: 7, label: 'Fuerte', orden: 3 },
        ]}
        valor={5}
        alCambiar={alCambiar}
      />,
    );

    const medio = screen.getByRole('button', { name: /medio\s*upov 5/i });
    expect(medio).toHaveClass('min-h-tap', 'min-w-tap');
    expect(medio).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('UPOV 4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /fuerte\s*upov 7/i }));
    expect(alCambiar).toHaveBeenCalledWith(7);
    fireEvent.click(medio);
    expect(alCambiar).toHaveBeenLastCalledWith(null);
  });

  it('muestra el campo de fecha opcional solo cuando eje=fenologia', () => {
    const alCambiarFecha = vi.fn();
    const { rerender } = render(
      <DescriptorEstadoPicker
        nombre="Vigor"
        estados={[{ nota: 5, label: 'Medio', orden: 1 }]}
        valor={5}
        alCambiar={vi.fn()}
        eje="adaptabilidad"
      />,
    );
    expect(screen.queryByLabelText(/fecha observada/i)).not.toBeInTheDocument();

    rerender(
      <DescriptorEstadoPicker
        nombre="Vigor"
        estados={[{ nota: 5, label: 'Medio', orden: 1 }]}
        valor={5}
        alCambiar={vi.fn()}
        eje="fenologia"
        fechaObservada={null}
        alCambiarFecha={alCambiarFecha}
      />,
    );
    const campoFecha = screen.getByLabelText(/fecha observada/i);
    expect(campoFecha).toBeInTheDocument();
    fireEvent.change(campoFecha, { target: { value: '2026-08-12' } });
    expect(alCambiarFecha).toHaveBeenCalledWith('2026-08-12');
  });

  it('calcula el máximo de fecha en Chile en cada render', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-07-17T03:59:00.000Z'));
      const { rerender } = render(
        <DescriptorEstadoPicker nombre="Brotación" estados={[]} valor={null} alCambiar={vi.fn()} eje="fenologia" />,
      );
      expect(screen.getByLabelText(/fecha observada/i)).toHaveAttribute('max', '2026-07-16');

      vi.setSystemTime(new Date('2026-07-17T04:01:00.000Z'));
      rerender(<DescriptorEstadoPicker nombre="Brotación" estados={[]} valor={null} alCambiar={vi.fn()} eje="fenologia" />);
      expect(screen.getByLabelText(/fecha observada/i)).toHaveAttribute('max', '2026-07-17');
    } finally {
      vi.useRealTimers();
    }
  });
});
