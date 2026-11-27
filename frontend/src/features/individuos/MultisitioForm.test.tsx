import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listarSectoresOperativos, registrarTraslado } = vi.hoisted(() => ({
  listarSectoresOperativos: vi.fn(async () => [{
    id: 'sector-1',
    nombre: 'Sector principal',
    predio_nombre: 'Predio Norte',
  }]),
  registrarTraslado: vi.fn(async () => undefined),
}));

vi.mock('@/api/emplazamientos', () => ({
  listarSectoresOperativos,
  registrarTraslado,
}));

import { MultisitioForm } from './MultisitioForm';
import { hoyChileISO } from '@/lib/fechas';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('MultisitioForm — sincronización territorial', () => {
  it('asocia el destino inválido sin cancelar la validación nativa y limpia al seleccionar', async () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><MultisitioForm individuoId="ind-1" plantaId="planta-1" /></QueryClientProvider>);
    const destino = await screen.findByLabelText('Predio de destino');
    const form = destino.closest('form')!;
    expect(form.noValidate).toBe(false);
    expect(destino).toBeRequired();
    expect(screen.getByLabelText(/^Fecha de traslado/)).toBeRequired();
    expect(destino).not.toHaveAttribute('aria-invalid');
    // jsdom no reproduce la burbuja ni el foco del navegador; sí el evento cancelable.
    const evento = new Event('invalid', { cancelable: true });
    fireEvent(destino, evento);
    expect(evento.defaultPrevented).toBe(false);
    expect(registrarTraslado).not.toHaveBeenCalled();
    expect(destino).toHaveAttribute('aria-invalid', 'true');
    expect(destino).toHaveAccessibleDescription('Selecciona un sector de destino.');
    fireEvent.change(destino, { target: { value: 'sector-1' } });
    expect(destino).not.toHaveAttribute('aria-invalid');
    expect(destino).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('Selecciona un sector de destino.')).not.toBeInTheDocument();
  });

  it('el envío programático sin destino enfoca el selector y no muta', async () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><MultisitioForm individuoId="ind-1" plantaId="planta-1" /></QueryClientProvider>);
    const destino = await screen.findByLabelText('Predio de destino');
    fireEvent.submit(destino.closest('form')!);
    expect(registrarTraslado).not.toHaveBeenCalled();
    expect(destino).toHaveFocus();
    expect(destino).toHaveAttribute('aria-invalid', 'true');
    expect(destino).toHaveAccessibleDescription('Selecciona un sector de destino.');
  });
  it('hidrata la fecha del borrador local y permite descartarla', async () => {
    localStorage.setItem('borrador:usuario:usuario-prueba:multisitio:ind-1', JSON.stringify({
      valor: { fecha: '2026-06-12' },
      guardadoEn: new Date('2026-06-12T15:00:00.000Z').getTime(),
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MultisitioForm individuoId="ind-1" plantaId="planta-1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Se recuperó la fecha de un borrador sin guardar/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Fecha de traslado/)).toHaveValue('2026-06-12');

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(screen.queryByText(/Se recuperó la fecha de un borrador sin guardar/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Fecha de traslado/)).toHaveValue(hoyChileISO());
    expect(localStorage.getItem('borrador:usuario:usuario-prueba:multisitio:ind-1')).toBeNull();
  });

  it('actualiza ficha, mapa agregado y viewport después de registrar el traslado', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <MultisitioForm individuoId="ind-1" plantaId="planta-1" />
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByLabelText('Predio de destino'), { target: { value: 'sector-1' } });
    fireEvent.click(screen.getByRole('button', { name: /registrar traslado/i }));

    await waitFor(() => expect(registrarTraslado).toHaveBeenCalledTimes(1));
    expect(registrarTraslado).toHaveBeenCalledWith({ individuoId: 'ind-1', sectorId: 'sector-1', fechaInicio: hoyChileISO() });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['territorio', 'mapa-cruce', 'planta-1'] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['territorio', 'mapa-agregado'] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['territorio', 'viewport'] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['individuos', 'planta-1', 'resumen'] });
  });
});

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ generacionSesion: 0, capturarVigenciaSesion: () => () => true, user: { id: 'usuario-prueba' } }) }));
