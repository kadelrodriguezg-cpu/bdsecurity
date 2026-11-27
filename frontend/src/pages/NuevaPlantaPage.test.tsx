/**
 * Bloque 3 de la auditoría de UX: borrador local persistente (3A), código de
 * cruce sugerido al elegir especie (3B) y linaje estructurado vía el
 * combobox de variedades (3C). El comportamiento propio del combobox
 * (buscar/elegir/crear inline) tiene su propio test en SelectorVariedad —
 * acá solo se prueba la integración: elegir una variedad manda su id, no
 * texto, a crearPlanta.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listarEspecies: vi.fn(),
  listarPlantas: vi.fn(),
  crearPlanta: vi.fn(),
  listarVariedades: vi.fn(),
  crearVariedad: vi.fn(),
}));

vi.mock('@/api/especies', () => ({ listarEspecies: mocks.listarEspecies }));
vi.mock('@/api/plantas', async () => {
  const actual = await vi.importActual<typeof import('@/api/plantas')>('@/api/plantas');
  return { ...actual, listarPlantas: mocks.listarPlantas, crearPlanta: mocks.crearPlanta };
});
vi.mock('@/api/variedades', () => ({
  listarVariedades: mocks.listarVariedades,
  crearVariedad: mocks.crearVariedad,
}));

import { NuevaPlantaPage } from './NuevaPlantaPage';

const ESPECIE_ARANDANO = 'especie-arandano';

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><NuevaPlantaPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.listarEspecies.mockResolvedValue([{ id: ESPECIE_ARANDANO, nombre: 'Arándano', nombre_cientifico: null }]);
  mocks.listarPlantas.mockResolvedValue([]);
  mocks.listarVariedades.mockResolvedValue([]);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('NuevaPlantaPage — borrador local (3A)', () => {
  it('A1-021: conserva UUID antes del envío y lo recupera tras perder respuesta y recargar sin persistir linaje', async () => {
    const clave = 'borrador:usuario:usuario-prueba:nueva-planta';
    mocks.crearPlanta.mockImplementationOnce(async (input) => {
      expect(JSON.parse(localStorage.getItem(clave)!).valor.intentoId).toBe(input.intentoId);
      throw new Error('Respuesta perdida');
    });
    const primera = montar();
    await screen.findByText('Arándano');
    fireEvent.change(screen.getByLabelText(/^especie/i), { target: { value: ESPECIE_ARANDANO } });
    fireEvent.change(screen.getByLabelText(/código de sistema/i), { target: { value: '02-099' } });
    fireEvent.change(screen.getByLabelText(/cruzamiento/i), { target: { value: 'SENSIBLE-NO-GUARDAR' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cruce/i }));
    await screen.findByText('Respuesta perdida');
    const intento = mocks.crearPlanta.mock.calls[0][0].intentoId;
    expect(localStorage.getItem(clave)).not.toContain('SENSIBLE');
    primera.unmount();
    mocks.crearPlanta.mockResolvedValueOnce({ id: intento, codigo_sistema: '02-099' });
    montar();
    expect(await screen.findByText(/El linaje no se conserva/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/código de sistema/i), { target: { value: '02-100' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cruce/i }));
    await waitFor(() => expect(mocks.crearPlanta).toHaveBeenCalledTimes(2));
    expect(mocks.crearPlanta.mock.calls[1][0]).toMatchObject({ intentoId: intento, codigo_sistema: '02-100', cruzamiento: undefined });
  });
  it('avisa una falla real de almacenamiento sin perder la edición ni afirmar que se guardó', async () => {
    montar();
    await screen.findByText('Arándano');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError'); });
    fireEvent.change(screen.getByLabelText(/código de sistema/i), { target: { value: '02-099' } });
    const aviso = await screen.findByRole('alert', {}, { timeout: 2300 });
    expect(aviso).toHaveTextContent(/No se pudo guardar el borrador local/);
    expect(screen.getByLabelText(/código de sistema/i)).toHaveValue('02-099');
    expect(screen.queryByText('Borrador guardado localmente')).not.toBeInTheDocument();
  });

  it('A1-021: si no puede conservar el intento, no envía la creación', async () => {
    montar(); await screen.findByText('Arándano');
    fireEvent.change(screen.getByLabelText(/^especie/i), { target: { value: ESPECIE_ARANDANO } });
    fireEvent.change(screen.getByLabelText(/código de sistema/i), { target: { value: '02-099' } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError'); });
    fireEvent.click(screen.getByRole('button', { name: /crear cruce/i }));
    expect(await screen.findByText(/No se envió la creación/)).toBeInTheDocument();
    expect(mocks.crearPlanta).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/código de sistema/i)).toHaveValue('02-099');
  });

  it('una lectura bloqueada muestra aviso y conserva el formulario editable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Security', 'SecurityError'); });
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo recuperar el borrador local/);
    expect(screen.getByLabelText(/código de sistema/i)).toHaveValue('');
  });

  it('recupera datos operativos pero nunca persiste el linaje', async () => {
    const primera = montar();
    await screen.findByText('Arándano');

    fireEvent.change(screen.getByLabelText(/código de sistema/i), { target: { value: '02-099' } });
    fireEvent.change(screen.getByLabelText(/cruzamiento/i), { target: { value: '01-003 × 01-007' } });

    await waitFor(() => expect(localStorage.getItem('borrador:usuario:usuario-prueba:nueva-planta')).toBeTruthy(), { timeout: 2000 });
    const borradorGuardado = JSON.parse(localStorage.getItem('borrador:usuario:usuario-prueba:nueva-planta')!);
    expect(borradorGuardado.valor).not.toHaveProperty('cruzamiento');
    expect(borradorGuardado.valor).not.toHaveProperty('mamaId');
    expect(borradorGuardado.valor).not.toHaveProperty('papaId');
    primera.unmount();

    montar();
    await screen.findByText(/se recuperó un borrador/i);
    expect(screen.getByLabelText(/código de sistema/i)).toHaveValue('02-099');
    expect(screen.getByLabelText(/cruzamiento/i)).toHaveValue('');
  });

  it('"Descartar" limpia el borrador y el campo', async () => {
    localStorage.setItem(
      'borrador:usuario:usuario-prueba:nueva-planta',
      JSON.stringify({ valor: { codigo_sistema: '02-099', especie_id: '', estado: 'sin_empezar' }, guardadoEn: Date.now() }),
    );
    montar();
    await screen.findByText(/se recuperó un borrador/i);
    fireEvent.click(screen.getByRole('button', { name: /descartar/i }));
    expect(screen.getByLabelText(/código de sistema/i)).toHaveValue('');
    expect(localStorage.getItem('borrador:usuario:usuario-prueba:nueva-planta')).toBeNull();
  });
});

describe('NuevaPlantaPage — código sugerido (3B)', () => {
  it('sugiere el siguiente correlativo al elegir una especie con cruces existentes', async () => {
    mocks.listarPlantas.mockResolvedValue([
      { id: 'p1', codigo_sistema: '02-001', especie_id: ESPECIE_ARANDANO, especie_nombre: 'Arándano', estado: 'trasplante', updated_at: '', fecha_cambio_estado: '' },
      { id: 'p2', codigo_sistema: '02-002', especie_id: ESPECIE_ARANDANO, especie_nombre: 'Arándano', estado: 'trasplante', updated_at: '', fecha_cambio_estado: '' },
    ]);
    montar();
    await screen.findByText('Arándano');

    fireEvent.change(screen.getByLabelText(/^especie/i), { target: { value: ESPECIE_ARANDANO } });

    await waitFor(() => expect(screen.getByLabelText(/código de sistema/i)).toHaveValue('02-003'));
    expect(screen.getByText(/sugerido a partir del último código/i)).toBeInTheDocument();
  });

  it('no pisa un código ya editado a mano si el usuario cambia de especie', async () => {
    mocks.listarPlantas.mockResolvedValue([
      { id: 'p1', codigo_sistema: '02-001', especie_id: ESPECIE_ARANDANO, especie_nombre: 'Arándano', estado: 'trasplante', updated_at: '', fecha_cambio_estado: '' },
    ]);
    mocks.listarEspecies.mockResolvedValue([
      { id: ESPECIE_ARANDANO, nombre: 'Arándano', nombre_cientifico: null },
      { id: 'especie-mora', nombre: 'Mora', nombre_cientifico: null },
    ]);
    montar();
    await screen.findByText('Arándano');

    fireEvent.change(screen.getByLabelText(/^especie/i), { target: { value: ESPECIE_ARANDANO } });
    await waitFor(() => expect(screen.getByLabelText(/código de sistema/i)).toHaveValue('02-002'));

    fireEvent.change(screen.getByLabelText(/código de sistema/i), { target: { value: 'MI-CODIGO-A-MANO' } });
    fireEvent.change(screen.getByLabelText(/^especie/i), { target: { value: 'especie-mora' } });

    await waitFor(() => expect(mocks.listarPlantas).toHaveBeenCalled());
    expect(screen.getByLabelText(/código de sistema/i)).toHaveValue('MI-CODIGO-A-MANO');
  });
});

describe('NuevaPlantaPage — linaje estructurado vía combobox (3C)', () => {
  it('cambiar especie limpia ambos progenitores y permite guardar sin ellos', async () => {
    mocks.listarEspecies.mockResolvedValue([
      { id: ESPECIE_ARANDANO, nombre: 'Arándano' }, { id: 'especie-mora', nombre: 'Mora' },
    ]);
    mocks.listarVariedades.mockImplementation(async (especie: string) => especie === ESPECIE_ARANDANO
      ? [{ id: 'var-duke', especie_id: especie, nombre: 'Duke', activo: true }] : []);
    mocks.crearPlanta.mockResolvedValue({ id: 'planta-1' });
    montar();
    await screen.findByText('Arándano');
    fireEvent.change(screen.getByLabelText(/^especie/i), { target: { value: ESPECIE_ARANDANO } });
    fireEvent.change(screen.getByLabelText(/código de sistema/i), { target: { value: 'NUEVO' } });
    for (const label of ['Mamá', 'Papá']) {
      fireEvent.focus(screen.getByLabelText(label));
      fireEvent.click(await screen.findByRole('button', { name: 'Duke' }));
      expect(screen.getByLabelText(label)).toHaveValue('Duke');
    }
    fireEvent.change(screen.getByLabelText(/cruzamiento/i), { target: { value: 'anterior' } });
    fireEvent.change(screen.getByLabelText(/^especie/i), { target: { value: 'especie-mora' } });
    expect(screen.getByLabelText('Mamá')).toHaveValue('');
    expect(screen.getByLabelText('Papá')).toHaveValue('');
    expect(screen.getByLabelText(/cruzamiento/i)).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /crear cruce/i }));
    await waitFor(() => expect(mocks.crearPlanta).toHaveBeenCalledWith(expect.objectContaining({
      especie_id: 'especie-mora', mamaId: undefined, papaId: undefined, cruzamiento: undefined,
    })));
  });

  it('borrar el progenitor elegido permite guardar el cruce sin mamá', async () => {
    mocks.listarVariedades.mockResolvedValue([{ id: 'var-duke', especie_id: ESPECIE_ARANDANO, nombre: 'Duke', activo: true }]);
    mocks.crearPlanta.mockResolvedValue({ id: 'planta-1' });
    montar();
    await screen.findByText('Arándano');
    fireEvent.change(screen.getByLabelText(/^especie/i), { target: { value: ESPECIE_ARANDANO } });
    fireEvent.change(screen.getByLabelText(/código de sistema/i), { target: { value: 'NUEVO' } });
    const mama = screen.getByLabelText('Mamá');
    fireEvent.focus(mama);
    fireEvent.click(await screen.findByRole('button', { name: 'Duke' }));
    fireEvent.change(mama, { target: { value: '' } });
    fireEvent.blur(mama);
    expect(mama).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /crear cruce/i }));
    await waitFor(() => expect(mocks.crearPlanta).toHaveBeenCalledWith(expect.objectContaining({ mamaId: undefined })));
  });

  it('elegir una variedad existente para Mamá manda su id (no texto libre) a crearPlanta', async () => {
    mocks.listarVariedades.mockResolvedValue([{ id: 'var-duke', especie_id: ESPECIE_ARANDANO, nombre: 'Duke', activo: true }]);
    mocks.crearPlanta.mockResolvedValue({ id: 'planta-1', codigo_sistema: '02-050' });

    montar();
    await screen.findByText('Arándano');

    fireEvent.change(screen.getByLabelText(/^especie/i), { target: { value: ESPECIE_ARANDANO } });
    fireEvent.change(screen.getByLabelText(/código de sistema/i), { target: { value: '02-050' } });

    const campoMama = screen.getByLabelText('Mamá');
    fireEvent.focus(campoMama);
    fireEvent.change(campoMama, { target: { value: 'Duk' } });

    const opcionDuke = await screen.findByRole('button', { name: 'Duke' });
    fireEvent.click(opcionDuke);
    expect(campoMama).toHaveValue('Duke');

    fireEvent.click(screen.getByRole('button', { name: /crear cruce/i }));

    await waitFor(() => expect(mocks.crearPlanta).toHaveBeenCalledWith(
      expect.objectContaining({ mamaId: 'var-duke', codigo_sistema: '02-050' }),
    ));
  });
});

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ generacionSesion: 0, capturarVigenciaSesion: () => () => true, user: { id: 'usuario-prueba' } }) }));
