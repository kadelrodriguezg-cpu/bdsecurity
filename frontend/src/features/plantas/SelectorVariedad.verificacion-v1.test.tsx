/**
 * Verificación independiente (Fase 2, Corrida 1) de A1-G1-17. Describe el comportamiento ACTUAL
 * de SelectorVariedad, actualizada para exigir la corrección A1-005.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listarVariedades: vi.fn(), crearVariedad: vi.fn() }));
vi.mock('@/api/variedades', () => ({ listarVariedades: mocks.listarVariedades, crearVariedad: mocks.crearVariedad }));

import { SelectorVariedad } from './SelectorVariedad';

const ESPECIE = 'esp-1';

function montar(valorId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCambiar = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <SelectorVariedad id="papa" label="Papá" especieId={ESPECIE} valorId={valorId} onCambiar={onCambiar} />
    </QueryClientProvider>,
  );
  return { onCambiar, campo: screen.getByLabelText('Papá') as HTMLInputElement };
}

beforeEach(() => {
  mocks.listarVariedades.mockReset();
  mocks.listarVariedades.mockResolvedValue([
    { id: 'v-duke', especie_id: ESPECIE, nombre: 'Duke', activo: true },
    { id: 'v-bch1', especie_id: ESPECIE, nombre: 'BCH 1', activo: true },
  ]);
});
afterEach(cleanup);

describe('A1-G1-17 (estado actual verificado)', () => {
  it('escribir «duke» y salir del campo emite el id de Duke', async () => {
    const { onCambiar, campo } = montar();
    fireEvent.focus(campo);
    await screen.findByText('BCH 1');
    fireEvent.change(campo, { target: { value: 'duke' } });
    expect(screen.queryByText(/Crear "duke"/)).toBeNull(); // coincidencia exacta (sin distinguir mayúsculas): no ofrece crear
    fireEvent.mouseDown(document.body);
    fireEvent.blur(campo);
    expect(campo.value).toBe('duke');
    expect(onCambiar).toHaveBeenLastCalledWith('v-duke');
  });

  it('con «Duke» ya elegido, editar el texto a «Duke Ruiz» invalida el id', async () => {
    const { onCambiar, campo } = montar('v-duke');
    await screen.findByDisplayValue('Duke');
    fireEvent.change(campo, { target: { value: 'Duke Ruiz' } });
    fireEvent.mouseDown(document.body);
    expect(campo.value).toBe('Duke Ruiz');
    expect(onCambiar).toHaveBeenLastCalledWith(null);
  });

  it('la variedad inactiva asignada se muestra y conserva con su id', async () => {
    mocks.listarVariedades.mockImplementation(async (_especie: string, soloActivas: boolean) => soloActivas ? [] : [
      { id: 'v-inactiva', especie_id: ESPECIE, nombre: 'Retirada', activo: false },
    ]);
    const { campo, onCambiar } = montar('v-inactiva');
    await screen.findByDisplayValue('Retirada');
    fireEvent.blur(campo);
    expect(campo.value).toBe('Retirada');
    expect(onCambiar).toHaveBeenLastCalledWith('v-inactiva');
  });

  it('vaciar el campo emite null', async () => {
    const { onCambiar, campo } = montar('v-duke');
    await screen.findByDisplayValue('Duke');
    fireEvent.change(campo, { target: { value: '' } });
    expect(onCambiar).toHaveBeenCalledWith(null);
  });
});
