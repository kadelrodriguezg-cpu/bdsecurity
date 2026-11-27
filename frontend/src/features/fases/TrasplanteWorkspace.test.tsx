import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/plantas/IndividualizarPanel', () => ({
  IndividualizarPanel: () => <div data-testid="individuos">Panel individuos</div>,
}));
vi.mock('@/features/individuos/EvaluacionAnualWorkspace', () => ({
  EvaluacionAnualWorkspace: ({ individuoFocoId }: { individuoFocoId?: string | null }) => <div data-testid="evaluaciones">Panel evaluaciones {individuoFocoId ?? 'sin foco'}</div>,
}));
vi.mock('./ProcedimientosSeccion', () => ({
  ProcedimientosSeccion: () => <div data-testid="procedimientos">Panel procedimientos</div>,
}));

import { TrasplanteWorkspace } from './TrasplanteWorkspace';

afterEach(cleanup);

describe('TrasplanteWorkspace', () => {
  it('recorrer tabs no monta Evaluaciones hasta activar y enlaza todos los paneles', () => {
    render(<TrasplanteWorkspace plantaId="p1" codigoSistema="02-001" />);
    const individuos = screen.getByRole('tab', { name: 'Individuos' });
    fireEvent.keyDown(individuos, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Evaluaciones' })).toHaveFocus();
    expect(individuos).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('evaluaciones')).not.toBeInTheDocument();
    for (const tab of screen.getAllByRole('tab')) {
      const panel = document.getElementById(tab.getAttribute('aria-controls')!);
      expect(panel).not.toBeNull();
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    }
  });

  it('Individuos y Procedimientos quedan montados (solo ocultos) al cambiar de pestaña', () => {
    render(<TrasplanteWorkspace plantaId="p1" codigoSistema="02-001" />);
    const procedimientos = screen.getByTestId('procedimientos');
    expect(procedimientos.parentElement).toHaveClass('hidden');

    fireEvent.click(screen.getByRole('tab', { name: 'Procedimientos' }));
    expect(procedimientos.parentElement).not.toHaveClass('hidden');
    expect(screen.getByTestId('individuos')).toBeInTheDocument();
  });

  it('Evaluaciones (la lista única) monta/desmonta con la pestaña, no queda oculto por CSS', () => {
    // A propósito distinto de Individuos/Procedimientos: su lista se
    // virtualizó (@tanstack/react-virtual), que mide el contenedor una sola
    // vez al montar — si quedara "siempre montado pero oculto" como los
    // otros dos, esa medición ocurriría con el panel en display:none (0px) y
    // la lista quedaría vacía para siempre al mostrarlo, porque nada dispara
    // una remedición después. Montar/desmontar con la pestaña evita el
    // problema de raíz.
    render(<TrasplanteWorkspace plantaId="p1" codigoSistema="02-001" />);
    expect(screen.queryByTestId('evaluaciones')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Evaluaciones' }));
    expect(screen.getByTestId('evaluaciones')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Individuos' }));
    expect(screen.queryByTestId('evaluaciones')).not.toBeInTheDocument();
  });
});

describe('TrasplanteWorkspace — abierto desde la etiqueta de un individuo (individuoFocoId)', () => {
  it('abre la pestaña Evaluaciones (donde vive la lista de individuos) y le pasa el individuo', () => {
    render(<TrasplanteWorkspace plantaId="p1" codigoSistema="02-001" individuoFocoId="ind-9" />);
    expect(screen.getByRole('tab', { name: 'Evaluaciones' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('evaluaciones')).toHaveTextContent('ind-9');
  });

  it('sin individuoFocoId la pestaña inicial sigue siendo Individuos', () => {
    render(<TrasplanteWorkspace plantaId="p1" codigoSistema="02-001" />);
    expect(screen.getByRole('tab', { name: 'Individuos' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('evaluaciones')).not.toBeInTheDocument();
  });
});
