import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RondasSeccion } from './RondasSeccion';
const { iniciar, listar } = vi.hoisted(() => ({ iniciar: vi.fn(async () => ({ ronda_id: 'r1', numero_ronda: 1 })), listar: vi.fn(async () => []) }));
vi.mock('@/api/rondas', () => ({ listarRondas: listar, iniciarRonda: iniciar, iniciarRondaMultisitio: iniciar }));
vi.mock('./EvaluacionForm', () => ({ EvaluacionForm: () => null }));
vi.mock('./PcrForm', () => ({ PcrForm: () => null }));
vi.mock('./EvaluacionesLista', () => ({ EvaluacionesLista: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); iniciar.mockClear(); });
function montar() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RondasSeccion individuoId="i1" plantaId="p1" codigoDisplay="P-1" puedeIniciar /></QueryClientProvider>);
}
it('cancelar no consume una ronda y la advertencia explica cupo, ranking y ausencia de anulación', async () => {
  const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
  montar(); const boton = await screen.findByRole('button', { name: 'Iniciar ronda 1' });
  await waitFor(() => expect(boton).toBeEnabled()); fireEvent.click(boton);
  expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('una de las 3 rondas'));
  expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('fuera del ranking'));
  expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('No puede anularse'));
  expect(iniciar).not.toHaveBeenCalled();
});
it('confirmar envía el número que se mostró al usuario', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  montar(); const boton = await screen.findByRole('button', { name: 'Iniciar ronda 1' });
  await waitFor(() => expect(boton).toBeEnabled()); fireEvent.click(boton);
  await waitFor(() => expect(iniciar).toHaveBeenCalledWith('i1', 1));
});
