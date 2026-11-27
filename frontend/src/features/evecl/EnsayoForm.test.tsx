import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnsayoForm } from './EnsayoForm';

vi.mock('@/features/catalogos/predios/PredioLocationPicker', () => ({
  PredioLocationPicker: ({ alCambiar }: { alCambiar: (valor: { latitud: number; longitud: number }) => void }) => (
    <button type="button" onClick={() => alCambiar({ latitud: -35.4, longitud: -71.6 })}>Coordenadas sintéticas</button>
  ),
}));

afterEach(cleanup);

describe('EnsayoForm — error asociado de parcela', () => {
  it('enfoca el campo requerido, enlaza el error y retira la asociación al corregir sin guardar inválidos', async () => {
    const alGuardar = vi.fn();
    render(<EnsayoForm guardando={false} alGuardar={alGuardar} alCancelar={vi.fn()} />);
    const codigo = screen.getByLabelText('Código de parcela *');
    expect(codigo).not.toHaveAttribute('aria-invalid');
    expect(codigo).not.toHaveAttribute('aria-describedby');
    fireEvent.change(codigo, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear ensayo' }));
    await waitFor(() => expect(codigo).toHaveFocus());
    expect(screen.getByText('Ingresa el código de parcela.')).toBeInTheDocument();
    expect(alGuardar).not.toHaveBeenCalled();
    expect(codigo).toHaveAttribute('aria-invalid', 'true');
    expect(codigo).toHaveAccessibleDescription('Ingresa el código de parcela.');
    fireEvent.change(codigo, { target: { value: 'Parcela sintética' } });
    await waitFor(() => expect(codigo).not.toHaveAttribute('aria-invalid'));
    expect(codigo).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('Ingresa el código de parcela.')).not.toBeInTheDocument();
    expect(alGuardar).not.toHaveBeenCalled();
  });

  it('conserva normalización, coordenadas y callback del envío válido', async () => {
    const alGuardar = vi.fn();
    const alCancelar = vi.fn();
    render(<EnsayoForm guardando={false} alGuardar={alGuardar} alCancelar={alCancelar} />);
    fireEvent.change(screen.getByLabelText('Código de parcela *'), { target: { value: '  Parcela sintética  ' } });
    fireEvent.change(screen.getByLabelText('Productor'), { target: { value: '  Productor sintético  ' } });
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Coordenadas sintéticas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear ensayo' }));
    await waitFor(() => expect(alGuardar).toHaveBeenCalledTimes(1));
    expect(alGuardar).toHaveBeenCalledWith({
      id: undefined, codigo_parcela: 'Parcela sintética', nombre_productor: 'Productor sintético',
      empresa: null, encargado_predio: null, localidad: null, direccion: null,
      latitud: -35.4, longitud: -71.6, area_evaluada: null, notas: null,
    });
    expect(alCancelar).not.toHaveBeenCalled();
  });
});
