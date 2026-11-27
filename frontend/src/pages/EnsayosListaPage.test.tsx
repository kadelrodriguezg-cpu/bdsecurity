import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { EnsayosListaPage } from './EnsayosListaPage';

const mocks = vi.hoisted(() => ({ listar: vi.fn(), guardar: vi.fn() }));
vi.mock('@/api/evecl', () => ({ listarEnsayosEvecl: mocks.listar, guardarEnsayoEvecl: mocks.guardar }));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><EnsayosListaPage /></MemoryRouter></QueryClientProvider>);
}

describe('EnsayosListaPage con el contrato v3', () => {
  it('usa el encabezado del contrato: un h1, subtítulo y una sola acción sólida', async () => {
    mocks.listar.mockResolvedValue([]);
    montar();
    expect(screen.getByRole('heading', { level: 1, name: 'Evaluación varietal externa' })).toBeInTheDocument();
    expect(screen.getByText('Ensayos de variedades foráneas en predios y condiciones locales.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuevo ensayo/ })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('muestra el estado de carga con role=status mientras llegan los ensayos', () => {
    mocks.listar.mockReturnValue(new Promise(() => {}));
    montar();
    const estado = screen.getByRole('status');
    expect(estado).toHaveAttribute('aria-busy', 'true');
    expect(estado).toHaveTextContent('Cargando ensayos…');
  });

  it('sin ensayos muestra el estado vacío del contrato', async () => {
    mocks.listar.mockResolvedValue([]);
    montar();
    expect(await screen.findByText('Todavía no hay ensayos EVECL')).toBeInTheDocument();
    expect(screen.getByText(/Crea el primero con «Nuevo ensayo»/)).toBeInTheDocument();
  });

  it('un fallo se muestra como alerta en palabras del equipo, con Reintentar y sin el texto técnico', async () => {
    mocks.listar.mockRejectedValue(new Error('private SQL'));
    montar();
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No se pudieron cargar los ensayos');
    expect(screen.queryByText(/private SQL/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
