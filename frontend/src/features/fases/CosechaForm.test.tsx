import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { actualizarCosechaMock, sesion } = vi.hoisted(() => ({
  actualizarCosechaMock: vi.fn(async () => undefined),
  sesion: { generacion: 0 },
}));

vi.mock('@/api/fases', () => ({
  obtenerDatosFase: vi.fn(async () => ({ fecha_cosecha: null, n_semillas: null })),
  actualizarCosecha: actualizarCosechaMock,
  listarCosechaFrutos: vi.fn(async () => []),
  agregarCosechaFruto: vi.fn(),
  quitarCosechaFruto: vi.fn(),
}));
vi.mock('@/components/shared/AdjuntarArchivoFase', () => ({
  AdjuntarArchivoFase: () => null,
}));

import { CosechaForm } from './CosechaForm';

afterEach(() => {
  cleanup();
  localStorage.clear();
  actualizarCosechaMock.mockClear();
});

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CosechaForm plantaId="planta-1" codigoSistema="02-001" />
    </QueryClientProvider>,
  );
}

describe('CosechaForm', () => {
  it('hidrata el borrador local y permite descartarlo para volver al estado inicial', async () => {
    const clave = 'borrador:usuario:usuario-prueba:cosecha:planta-1';
    const borrador = JSON.stringify({
      valor: { fecha: '2026-06-10', nSemillas: 37 },
      guardadoEn: new Date('2026-06-10T15:00:00.000Z').getTime(),
    });
    localStorage.setItem(clave, borrador);
    const primeraSesion = montar();

    expect(await screen.findByText(/Hay un borrador local sin guardar/i)).toHaveTextContent('fecha: 10-06-2026, semillas: 37');
    fireEvent.click(screen.getByRole('button', { name: 'Usar este borrador' }));
    expect(screen.getByLabelText('Fecha de cosecha (opcional)')).toHaveValue('2026-06-10');
    expect(screen.getByLabelText(/semillas \(total\)/i)).toHaveValue(37);

    primeraSesion.unmount();
    localStorage.setItem(clave, borrador);
    montar();
    await screen.findByText(/Hay un borrador local sin guardar/i);
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(screen.queryByText(/Hay un borrador local sin guardar/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Fecha de cosecha (opcional)')).toHaveValue('');
    expect(screen.getByLabelText(/semillas \(total\)/i)).toHaveValue(null);
    expect(localStorage.getItem(clave)).toBeNull();
  });

  it('exige el total de semillas cosechadas antes de guardar', async () => {
    montar();
    const guardar = await screen.findByRole('button', { name: /guardar cosecha/i });
    fireEvent.submit(guardar.closest('form')!);
    expect(await screen.findByText(/Ingresa el total de semillas cosechadas/i)).toBeInTheDocument();
    expect(actualizarCosechaMock).not.toHaveBeenCalled();
  });

  it('guarda cuando el total de semillas está informado', async () => {
    montar();
    const semillas = await screen.findByLabelText(/semillas \(total\)/i);
    fireEvent.change(semillas, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cosecha/i }));

    await waitFor(() => expect(actualizarCosechaMock).toHaveBeenCalledWith(
      'planta-1',
      expect.objectContaining({ n_semillas: 12, codigoSistema: '02-001' }),
    ));
  });
});

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ generacionSesion: sesion.generacion, capturarVigenciaSesion: () => { const g = sesion.generacion; return () => sesion.generacion === g; }, user: { id: 'usuario-prueba' } }) }));

it.each([false, true])('respuesta tardía de cosecha no cambia entidad nueva (otra sesión=%s)', async (otraSesion) => {
  let resolver!: () => void;
  actualizarCosechaMock.mockReturnValueOnce(new Promise<undefined>((r) => { resolver = () => r(undefined); }));
  const qc = new QueryClient({defaultOptions:{queries:{retry:false}}});
  const vista = (id: string) => <QueryClientProvider client={qc}><CosechaForm plantaId={id} codigoSistema="02"/></QueryClientProvider>;
  const {rerender} = render(vista('A'));
  fireEvent.change(screen.getByLabelText('N° semillas (total) *'), {target:{value:'7'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar cosecha'}));
  await waitFor(()=>expect(actualizarCosechaMock).toHaveBeenCalled());
  if (otraSesion) sesion.generacion += 1;
  rerender(vista('B'));
  expect(screen.getByLabelText('N° semillas (total) *')).toHaveValue(null);
  fireEvent.change(screen.getByLabelText('N° semillas (total) *'), {target:{value:'9'}});
  const invalidar = vi.spyOn(qc, 'invalidateQueries');
  await act(async () => resolver());
  expect(screen.getByLabelText('N° semillas (total) *')).toHaveValue(9);
  expect(screen.queryByText(/Cosecha guardada/)).not.toBeInTheDocument();
  if (otraSesion) expect(invalidar).not.toHaveBeenCalled();
  else expect(invalidar).toHaveBeenCalledTimes(3);
});
