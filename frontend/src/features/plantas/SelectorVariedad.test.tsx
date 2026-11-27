import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listarVariedades: vi.fn(),
  crearVariedad: vi.fn(),
}));

vi.mock('@/api/variedades', () => ({
  listarVariedades: mocks.listarVariedades,
  crearVariedad: mocks.crearVariedad,
}));

import { SelectorVariedad } from './SelectorVariedad';

const ESPECIE_ID = 'especie-1';

function montar(props: Partial<React.ComponentProps<typeof SelectorVariedad>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onCambiar = vi.fn();
  const vista = render(
    <QueryClientProvider client={client}>
      <SelectorVariedad id="mama" label="Mamá" especieId={ESPECIE_ID} valorId={null} onCambiar={onCambiar} {...props} />
    </QueryClientProvider>,
  );
  return { ...vista, onCambiar };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listarVariedades.mockResolvedValue([
    { id: 'var-duke', especie_id: ESPECIE_ID, nombre: 'Duke', activo: true },
    { id: 'var-legacy', especie_id: ESPECIE_ID, nombre: 'Legacy', activo: true },
  ]);
});

afterEach(cleanup);

describe('SelectorVariedad (Bloque 3, Parte 3C)', () => {
  it('filtra la lista mientras se escribe y elegir una opción llama a onCambiar con su id', async () => {
    const { onCambiar } = montar();
    const campo = screen.getByLabelText('Mamá');
    fireEvent.focus(campo);
    await screen.findByText('Legacy');

    fireEvent.change(campo, { target: { value: 'duk' } });
    await waitFor(() => expect(screen.queryByText('Legacy')).not.toBeInTheDocument());
    const opcion = screen.getByRole('button', { name: 'Duke' });

    fireEvent.click(opcion);
    expect(onCambiar).toHaveBeenCalledWith('var-duke');
    expect(campo).toHaveValue('Duke');
  });

  it('ofrece "Crear ... como nueva variedad" solo cuando el texto no matchea ninguna existente', async () => {
    montar();
    const campo = screen.getByLabelText('Mamá');
    fireEvent.focus(campo);
    await screen.findByText('Legacy'); // espera a que cargue el catálogo antes de tipear
    fireEvent.change(campo, { target: { value: 'Duke' } });
    expect(screen.queryByText(/crear "duke" como nueva variedad/i)).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: 'Variedad Nueva' } });
    expect(await screen.findByText(/crear "variedad nueva" como nueva variedad/i)).toBeInTheDocument();
  });

  it('crear inline llama a crearVariedad y selecciona la variedad recién creada', async () => {
    mocks.crearVariedad.mockResolvedValue({ id: 'var-nueva', especie_id: ESPECIE_ID, nombre: 'Variedad Nueva', activo: true });
    const { onCambiar } = montar();
    const campo = screen.getByLabelText('Mamá');
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: 'Variedad Nueva' } });

    fireEvent.click(await screen.findByText(/crear "variedad nueva" como nueva variedad/i));

    await waitFor(() => expect(mocks.crearVariedad).toHaveBeenCalledWith(ESPECIE_ID, 'Variedad Nueva'));
    await waitFor(() => expect(onCambiar).toHaveBeenCalledWith('var-nueva'));
    expect(campo).toHaveValue('Variedad Nueva');
  });

  it('sin especie elegida, el campo queda deshabilitado', () => {
    montar({ especieId: null });
    expect(screen.getByLabelText('Mamá')).toBeDisabled();
  });
});
