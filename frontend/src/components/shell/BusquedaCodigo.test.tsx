import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const mocks = vi.hoisted(() => ({
  buscarIdPorCodigoSistema: vi.fn(),
  resolverIndividuo: vi.fn(),
  resolverIndividuoPorCodigo: vi.fn(),
}));
vi.mock('@/api/plantas', () => ({ buscarIdPorCodigoSistema: mocks.buscarIdPorCodigoSistema }));
vi.mock('@/api/individuos', () => ({
  resolverIndividuo: mocks.resolverIndividuo,
  resolverIndividuoPorCodigo: mocks.resolverIndividuoPorCodigo,
}));
vi.mock('@/components/shared/QRScanner', () => ({
  QRScanner: ({ onResultado, onNoReconocido }: {
    onResultado: (r: { tipo: 'id' | 'individuo' | 'codigo_sistema'; valor: string }) => void;
    onNoReconocido: (c: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onResultado({ tipo: 'id', valor: 'cruce-leido' })}>Leer QR de cruce</button>
      <button type="button" onClick={() => onResultado({ tipo: 'individuo', valor: 'indiv-leido' })}>Leer QR de individuo</button>
      <button type="button" onClick={() => onNoReconocido('basura')}>Leer QR ajeno</button>
    </div>
  ),
}));

import { BusquedaCodigo } from './BusquedaCodigo';

function Destino() {
  const { pathname, search, state } = useLocation();
  return <p data-testid="destino">{pathname}{search} volverA={(state as { volverA?: string } | null)?.volverA ?? '-'}</p>;
}

function montar(ruta = '/ranking?especie=1') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <BusquedaCodigo />
      <Routes><Route path="*" element={<Destino />} /></Routes>
    </MemoryRouter>,
  );
}

const campo = () => screen.getByRole('textbox', { name: /buscar por código/i });
function buscar(texto: string) {
  fireEvent.change(campo(), { target: { value: texto } });
  fireEvent.submit(screen.getByRole('search'));
}

beforeEach(() => {
  mocks.buscarIdPorCodigoSistema.mockReset();
  mocks.resolverIndividuo.mockReset();
  mocks.resolverIndividuoPorCodigo.mockReset();
});
afterEach(cleanup);

describe('búsqueda por código del encabezado', () => {
  it('un código de cruce abre su ficha y la ficha vuelve a la pantalla de origen', async () => {
    mocks.buscarIdPorCodigoSistema.mockResolvedValue('id-cruce');
    montar();
    buscar('02-502');
    await waitFor(() => expect(screen.getByTestId('destino')).toHaveTextContent('/planta/id-cruce volverA=/ranking?especie=1'));
    expect(mocks.buscarIdPorCodigoSistema).toHaveBeenCalledWith('02-502');
    expect(mocks.resolverIndividuoPorCodigo).not.toHaveBeenCalled();
  });

  it('un código de individuo (02-502-P1) abre la ficha posicionada en ese individuo', async () => {
    mocks.resolverIndividuoPorCodigo.mockResolvedValue({ id: 'ind-9', planta_id: 'cruce-3' });
    montar('/');
    buscar('02-502-P1');
    await waitFor(() => expect(screen.getByTestId('destino')).toHaveTextContent('/planta/cruce-3?individuo=ind-9'));
    expect(mocks.resolverIndividuoPorCodigo).toHaveBeenCalledWith('02-502-P1');
    expect(mocks.buscarIdPorCodigoSistema).not.toHaveBeenCalled();
  });

  it('el código se limpia de espacios y acepta minúsculas del individuo', async () => {
    mocks.resolverIndividuoPorCodigo.mockResolvedValue({ id: 'ind-9', planta_id: 'cruce-3' });
    montar('/');
    buscar('  02-502-p1 ');
    await waitFor(() => expect(mocks.resolverIndividuoPorCodigo).toHaveBeenCalledWith('02-502-p1'));
  });

  it('si no existe, avisa bajo el campo y no navega', async () => {
    mocks.buscarIdPorCodigoSistema.mockResolvedValue(null);
    montar('/plantas');
    buscar('99-999');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró ningún cruce con ese código.');
    expect(screen.getByTestId('destino')).toHaveTextContent('/plantas');
    expect(campo()).toHaveAttribute('aria-invalid', 'true');
  });

  it('si no existe el individuo, avisa', async () => {
    mocks.resolverIndividuoPorCodigo.mockResolvedValue(null);
    montar();
    buscar('02-502-P99');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró ningún individuo con ese código.');
  });

  it('un fallo de red se informa sin perder lo escrito', async () => {
    mocks.buscarIdPorCodigoSistema.mockRejectedValue(new Error('red'));
    montar();
    buscar('02-502');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo buscar el cruce.');
    expect(campo()).toHaveValue('02-502');
  });

  it('enviar vacío pide escribir un código y no consulta nada', () => {
    montar();
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe un código');
    expect(mocks.buscarIdPorCodigoSistema).not.toHaveBeenCalled();
  });

  it('el aviso desaparece al volver a escribir', async () => {
    mocks.buscarIdPorCodigoSistema.mockResolvedValue(null);
    montar();
    buscar('99-999');
    await screen.findByRole('alert');
    fireEvent.change(campo(), { target: { value: '02-5' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('escáner dentro de la búsqueda', () => {
  it('el botón abre el escáner en una hoja, sin salir de la pantalla', async () => {
    montar('/plantas');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Escanear código QR' }));
    expect(await screen.findByRole('dialog', { name: 'Escanear código QR' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Leer QR de cruce' })).toBeInTheDocument();
    expect(screen.getByTestId('destino')).toHaveTextContent('/plantas');
  });

  it('un QR de cruce abre su ficha y cierra la hoja', async () => {
    montar('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Escanear código QR' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leer QR de cruce' }));
    await waitFor(() => expect(screen.getByTestId('destino')).toHaveTextContent('/planta/cruce-leido volverA=/dashboard'));
    expect(mocks.buscarIdPorCodigoSistema).not.toHaveBeenCalled();
  });

  it('un QR de individuo se resuelve a su cruce', async () => {
    mocks.resolverIndividuo.mockResolvedValue({ id: 'indiv-leido', planta_id: 'cruce-7' });
    montar('/');
    fireEvent.click(screen.getByRole('button', { name: 'Escanear código QR' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leer QR de individuo' }));
    await waitFor(() => expect(screen.getByTestId('destino')).toHaveTextContent('/planta/cruce-7?individuo=indiv-leido'));
  });

  it('un QR que no es del sistema avisa dentro de la hoja', async () => {
    montar('/');
    fireEvent.click(screen.getByRole('button', { name: 'Escanear código QR' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leer QR ajeno' }));
    expect(await screen.findByText(/no corresponde a un cruce ni a un individuo/i)).toBeInTheDocument();
  });
});
