/**
 * Auditoría integral, Corrida 1, grupo G1 — flujos C01/C08 (SelectorVariedad:
 * el combobox con que se elige mamá/papá). Cada `it.fails` demuestra un
 * hallazgo abierto (ID A1-G1-NN): se escribe con lo que DEBERÍA pasar.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    { id: 'var-bch1', especie_id: ESPECIE_ID, nombre: 'BCH 1', activo: true },
  ]);
});

afterEach(cleanup);

describe('SelectorVariedad: el texto que se ve y el id que se guarda pueden divergir', () => {
  it('con un padre controlado conserva la edición al invalidar y resuelve al salir con Tab', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cambios = vi.fn();
    function Controlado() {
      const [valor, setValor] = useState<string | null>('var-duke');
      return <SelectorVariedad id="mama" label="Mamá" especieId={ESPECIE_ID} valorId={valor}
        onCambiar={(nuevo) => { cambios(nuevo); setValor(nuevo); }} />;
    }
    render(<QueryClientProvider client={client}><Controlado /></QueryClientProvider>);
    const campo = screen.getByLabelText('Mamá');
    await waitFor(() => expect(campo).toHaveValue('Duke'));
    fireEvent.change(campo, { target: { value: 'BCH' } });
    expect(cambios).toHaveBeenLastCalledWith(null);
    expect(campo).toHaveValue('BCH');
    fireEvent.change(campo, { target: { value: 'BCH 1' } });
    fireEvent.blur(campo);
    expect(cambios).toHaveBeenLastCalledWith('var-bch1');
    expect(campo).toHaveValue('BCH 1');
  });

  // A1-G1-17: si el texto coincide con una variedad existente, el combobox NO
  // ofrece «Crear» y espera un clic en la lista; quien escribe «duke» y sigue
  // con el formulario ve «duke» en el campo pero mamaId queda en null y el
  // cruce se crea sin mamá. Es una causa verosímil de los 4 cruces de
  // producción creados el 21-10 con mama_id nulo (invariante L04).
  it('escribir el nombre exacto de una variedad y salir del campo la selecciona (A1-G1-17)', async () => {
    const { onCambiar } = montar();
    const campo = screen.getByLabelText('Mamá');
    fireEvent.focus(campo);
    await screen.findByText('BCH 1');
    fireEvent.change(campo, { target: { value: 'duke' } });
    fireEvent.mouseDown(document.body); // clic fuera: se cierra la lista sin elegir
    expect(campo).toHaveValue('duke');
    expect(onCambiar).toHaveBeenCalledWith('var-duke');
  });

  // A1-G1-17: con una variedad ya elegida, editar el texto no invalida la
  // selección (solo se limpia si el campo queda vacío): el campo dice «Duke
  // Ruiz» y se guarda el id de «Duke».
  it('editar el texto de una variedad ya elegida invalida la selección (A1-G1-17)', async () => {
    const { onCambiar } = montar({ valorId: 'var-duke' });
    const campo = screen.getByLabelText('Mamá');
    await waitFor(() => expect(campo).toHaveValue('Duke'));
    fireEvent.change(campo, { target: { value: 'Duke Ruiz' } });
    fireEvent.mouseDown(document.body);
    expect(onCambiar).toHaveBeenCalledWith(null);
  });

  // A1-G1-17 (ficha existente): el catálogo que se pide es solo de variedades
  // ACTIVAS; si la mamá guardada se desactivó, el campo aparece vacío aunque
  // el cruce tenga mamá, y quien guarda el formulario sin tocarlo la conserva
  // sin saberlo (o la pisa si escribe algo).
  it('si la variedad guardada ya no está en el catálogo activo, el campo no queda en blanco (A1-G1-17)', async () => {
    mocks.listarVariedades.mockImplementation(async (_especie: string, soloActivas: boolean) => soloActivas ? [] : [{ id: 'var-desactivada', especie_id: ESPECIE_ID, nombre: 'Duke retirada', activo: false }]);
    const { onCambiar } = montar({ valorId: 'var-desactivada' });
    const campo = screen.getByLabelText('Mamá');
    await screen.findByLabelText('Mamá');
    await waitFor(() => expect(mocks.listarVariedades).toHaveBeenCalled());
    await waitFor(() => expect(campo).toHaveValue('Duke retirada'));
    expect(mocks.listarVariedades).toHaveBeenCalledWith(ESPECIE_ID, false);
    expect(onCambiar).not.toHaveBeenCalled();
  });
});

describe('SelectorVariedad: cambio de especie', () => {
  it('una creación pendiente no asigna a la nueva especie el progenitor de la anterior', async () => {
    let terminar!: (valor: { id: string; especie_id: string; nombre: string; activo: boolean }) => void;
    mocks.crearVariedad.mockImplementation(() => new Promise((resolve) => { terminar = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onCambiar = vi.fn();
    const arbol = (especie: string) => <QueryClientProvider client={client}>
      <SelectorVariedad id="mama" label="Mamá" especieId={especie} valorId={null} onCambiar={onCambiar} />
    </QueryClientProvider>;
    const { rerender } = render(arbol(ESPECIE_ID));
    fireEvent.change(screen.getByLabelText('Mamá'), { target: { value: 'Nueva' } });
    fireEvent.click(await screen.findByRole('button', { name: /crear "Nueva"/i }));
    await waitFor(() => expect(mocks.crearVariedad).toHaveBeenCalled());
    rerender(arbol('especie-2'));
    await act(async () => terminar({ id: 'var-nueva', especie_id: ESPECIE_ID, nombre: 'Nueva', activo: true }));
    await waitFor(() => expect(screen.queryByText('Creando…')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Mamá')).toHaveValue('');
    expect(onCambiar).not.toHaveBeenCalledWith('var-nueva');
  });

  // A1-G1-04 (lado de la interfaz): NuevaPlantaPage guarda mamaId/papaId en un
  // estado aparte de la especie. Al cambiar la especie el campo se vacía (la
  // variedad ya no está en la lista), pero el selector no avisa con
  // onCambiar(null): el cruce de la especie nueva se crea con la mamá de la
  // especie anterior.
  it('al cambiar de especie se descarta la variedad elegida de la especie anterior (A1-G1-04)', async () => {
    mocks.listarVariedades.mockImplementation(async (especieId: string) =>
      especieId === ESPECIE_ID
        ? [{ id: 'var-duke', especie_id: ESPECIE_ID, nombre: 'Duke', activo: true }]
        : [{ id: 'var-heritage', especie_id: 'especie-2', nombre: 'Heritage', activo: true }],
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const onCambiar = vi.fn();
    const arbol = (especieId: string) => (
      <QueryClientProvider client={client}>
        <SelectorVariedad id="mama" label="Mamá" especieId={especieId} valorId="var-duke" onCambiar={onCambiar} />
      </QueryClientProvider>
    );
    const { rerender } = render(arbol(ESPECIE_ID));
    await waitFor(() => expect(screen.getByLabelText('Mamá')).toHaveValue('Duke'));
    rerender(arbol('especie-2'));
    await waitFor(() => expect(screen.getByLabelText('Mamá')).toHaveValue(''));
    // El campo ya está vacío: lo correcto es que el padre se entere.
    expect(onCambiar).toHaveBeenCalledWith(null);
  });
});

describe('SelectorVariedad: casi-duplicados', () => {
  it('resuelve una parecida activa al salir y muestra su nombre real', async () => {
    const { onCambiar } = montar();
    const campo = screen.getByLabelText('Mamá');
    fireEvent.focus(campo);
    await screen.findByText('BCH 1');
    fireEvent.change(campo, { target: { value: 'BCH-1' } });
    fireEvent.blur(campo);
    expect(campo).toHaveValue('BCH 1');
    expect(onCambiar).toHaveBeenLastCalledWith('var-bch1');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('avisa texto sin selección al salir, permite null y quita el aviso al borrar', async () => {
    const { onCambiar } = montar();
    const campo = screen.getByLabelText('Mamá');
    fireEvent.change(campo, { target: { value: 'Sin coincidencia' } });
    fireEvent.blur(campo);
    expect(screen.getByRole('status')).toHaveTextContent('el cruce se guarda sin Mamá');
    expect(onCambiar).not.toHaveBeenCalledWith(expect.any(String));
    fireEvent.change(campo, { target: { value: '' } });
    fireEvent.blur(campo);
    expect(onCambiar).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('no autoasigna la parecida inactiva y avisa que no hay selección', async () => {
    mocks.listarVariedades.mockResolvedValue([{ id: 'inactiva', nombre: 'BCH 1', activo: false, especie_id: ESPECIE_ID }]);
    const { onCambiar } = montar();
    const campo = screen.getByLabelText('Mamá');
    fireEvent.change(campo, { target: { value: 'BCH-1' } });
    await screen.findByText('Ya existe «BCH 1» (inactiva).');
    fireEvent.mouseDown(document.body);
    expect(onCambiar).not.toHaveBeenCalledWith('inactiva');
    expect(screen.getByRole('status')).toHaveTextContent('el cruce se guarda sin Mamá');
  });

  // A1-G1-01 (lado de la interfaz): la comparación es lower() exacto, así que
  // «BCH-1» no coincide con «BCH 1» y se ofrece crearla como variedad nueva.
  it('no ofrece crear «BCH-1» como variedad nueva cuando existe «BCH 1» (A1-G1-01)', async () => {
    const { onCambiar } = montar();
    const campo = screen.getByLabelText('Mamá');
    fireEvent.focus(campo);
    await screen.findByText('BCH 1');
    fireEvent.change(campo, { target: { value: 'BCH-1' } });
    expect(screen.queryByText(/crear "bch-1" como nueva variedad/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'BCH 1' }));
    expect(onCambiar).toHaveBeenLastCalledWith('var-bch1');
  });
});
