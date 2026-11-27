import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
const mocks = vi.hoisted(() => ({ buscar: vi.fn(), resolver: vi.fn(), porCodigo: vi.fn(), resultado: null as null | ((r: { tipo: 'id' | 'individuo' | 'codigo_sistema'; valor: string }) => void) }));
vi.mock('@/api/plantas', () => ({ buscarIdPorCodigoSistema: mocks.buscar }));
vi.mock('@/api/individuos', () => ({ resolverIndividuo: mocks.resolver, resolverIndividuoPorCodigo: mocks.porCodigo }));
vi.mock('@/components/shared/QRScanner', () => ({ QRScanner: ({ onResultado }: { onResultado: typeof mocks.resultado }) => { mocks.resultado = onResultado; return <div>Cámara sin permiso</div>; } }));
import { EscanearQRPage } from './EscanearQRPage';
afterEach(cleanup);
beforeEach(() => { mocks.buscar.mockReset(); mocks.resolver.mockReset(); mocks.porCodigo.mockReset(); mocks.resultado = null; });
function Destino() { const l = useLocation(); return <output>{l.pathname}{l.search}|{(l.state as { volverA?: string })?.volverA}</output>; }
function montar() { render(<MemoryRouter initialEntries={['/escanear']}><Routes><Route path="/escanear" element={<EscanearQRPage />} /><Route path="/planta/:id" element={<Destino />} /></Routes></MemoryRouter>); }
function buscar() { fireEvent.change(screen.getByLabelText('Escribir el código de la etiqueta'), { target: { value: ' 02-001 ' } }); fireEvent.click(screen.getByRole('button', { name: 'Buscar' })); }
describe('EscanearQRPage — alternativa a cámara', () => {
  it('resuelve código manual con cámara indisponible y conserva contexto', async () => {
    mocks.buscar.mockResolvedValue('uuid-local'); montar(); buscar();
    expect(await screen.findByRole('status')).toHaveTextContent('/planta/uuid-local|/escanear');
    expect(mocks.buscar).toHaveBeenCalledWith('02-001');
  });
  it('anuncia no encontrado y no navega', async () => {
    mocks.buscar.mockResolvedValue(null); montar(); buscar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró');
  });
  it('no muestra errores crudos y permite reintentar', async () => {
    mocks.buscar.mockRejectedValueOnce(new Error('linaje privado')); montar(); buscar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo buscar');
    expect(screen.queryByText(/linaje privado/)).not.toBeInTheDocument();
    mocks.buscar.mockResolvedValue('uuid-local'); buscar();
    expect(await screen.findByRole('status')).toHaveTextContent('/planta/uuid-local');
  });
  it('bloquea submit y lecturas QR duplicadas durante una búsqueda', async () => {
    let completar!: (id: string | null) => void;
    mocks.buscar.mockImplementation(() => new Promise((resolve) => { completar = resolve; }));
    montar(); buscar();
    expect(screen.getByRole('button', { name: 'Buscando…' })).toBeDisabled();
    mocks.resultado?.({ tipo: 'codigo_sistema', valor: 'otro' });
    expect(mocks.buscar).toHaveBeenCalledTimes(1);
    completar(null);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar' })).toBeEnabled());
  });
  it('rechaza búsqueda vacía y QR UUID navega sin consultar código', async () => {
    montar(); fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresa el código');
    fireEvent.click(screen.getByText('Cámara sin permiso'));
    mocks.resultado?.({ tipo: 'id', valor: 'uuid-local' });
    expect(await screen.findByRole('status')).toHaveTextContent('/planta/uuid-local');
    expect(mocks.buscar).not.toHaveBeenCalled();
  });
  it('QR de individuo: resuelve su cruce y abre la ficha posicionada en esa fila, sin consultar por código', async () => {
    mocks.resolver.mockResolvedValue({ id: 'ind-1', planta_id: 'cruce-1', codigo_display: '02-001-P7', estado_vital: 'vivo' });
    montar();
    mocks.resultado?.({ tipo: 'individuo', valor: 'ind-1' });
    expect(await screen.findByRole('status')).toHaveTextContent('/planta/cruce-1?individuo=ind-1|/escanear');
    expect(mocks.resolver).toHaveBeenCalledWith('ind-1');
    expect(mocks.buscar).not.toHaveBeenCalled();
  });
  it('QR de individuo dado de baja: se abre igual (la lectura nunca se bloquea)', async () => {
    mocks.resolver.mockResolvedValue({ id: 'ind-2', planta_id: 'cruce-1', codigo_display: '02-001-P8', estado_vital: 'muerto' });
    montar();
    mocks.resultado?.({ tipo: 'individuo', valor: 'ind-2' });
    expect(await screen.findByRole('status')).toHaveTextContent('/planta/cruce-1?individuo=ind-2');
  });
  it('QR de individuo inexistente: avisa y no navega', async () => {
    mocks.resolver.mockResolvedValue(null);
    montar();
    mocks.resultado?.({ tipo: 'individuo', valor: 'no-existe' });
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró ningún individuo');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('QR de individuo con falla de red: mensaje genérico, sin datos crudos, y permite reintentar', async () => {
    mocks.resolver.mockRejectedValueOnce(new Error('detalle interno'));
    montar();
    mocks.resultado?.({ tipo: 'individuo', valor: 'ind-1' });
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo buscar');
    expect(screen.queryByText(/detalle interno/)).not.toBeInTheDocument();
    mocks.resolver.mockResolvedValue({ id: 'ind-1', planta_id: 'cruce-1', codigo_display: 'x', estado_vital: 'vivo' });
    mocks.resultado?.({ tipo: 'individuo', valor: 'ind-1' });
    expect(await screen.findByRole('status')).toHaveTextContent('/planta/cruce-1?individuo=ind-1');
  });
  it('QR de cruce (UUID pelado o URL de /planta/) sigue navegando directo al cruce, sin resolver individuo', async () => {
    montar();
    mocks.resultado?.({ tipo: 'id', valor: 'uuid-cruce' });
    expect(await screen.findByRole('status')).toHaveTextContent('/planta/uuid-cruce|/escanear');
    expect(mocks.resolver).not.toHaveBeenCalled();
  });
  it('U-11: el código impreso de un individuo («02-502-P1») se resuelve y abre su ficha, igual que su QR', async () => {
    mocks.porCodigo.mockResolvedValue({ id: 'ind-9', planta_id: 'cruce-9', codigo_display: '02-502-P1', estado_vital: 'vivo' });
    montar();
    fireEvent.change(screen.getByLabelText('Escribir el código de la etiqueta'), { target: { value: ' 02-502-P1 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('status')).toHaveTextContent('/planta/cruce-9?individuo=ind-9|/escanear');
    expect(mocks.porCodigo).toHaveBeenCalledWith('02-502-P1');
    expect(mocks.buscar).not.toHaveBeenCalled();
    expect(mocks.resolver).not.toHaveBeenCalled();
  });
  it('U-11: un código de individuo que no existe avisa de individuo, no de cruce', async () => {
    mocks.porCodigo.mockResolvedValue(null);
    montar();
    fireEvent.change(screen.getByLabelText('Escribir el código de la etiqueta'), { target: { value: '02-502-P999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró ningún individuo');
  });
  it('U-11: título «Escanear etiqueta», con la cámara antes que la entrada manual', () => {
    montar();
    expect(screen.getByRole('heading', { name: 'Escanear etiqueta' })).toBeInTheDocument();
    const camara = screen.getByText('Cámara sin permiso');
    const manual = screen.getByLabelText('Escribir el código de la etiqueta');
    expect(camara.compareDocumentPosition(manual) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
