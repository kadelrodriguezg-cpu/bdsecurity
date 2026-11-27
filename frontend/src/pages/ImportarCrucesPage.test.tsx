import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const api = vi.hoisted(() => ({
  previsualizar: vi.fn(),
  confirmar: vi.fn(),
  revertir: vi.fn(),
  descartar: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/importacion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/importacion')>()),
  previsualizarImportacion: api.previsualizar,
  confirmarImportacion: api.confirmar,
  revertirImportacion: api.revertir,
  descartarImportacion: api.descartar,
}));

import { ImportarCrucesPage } from './ImportarCrucesPage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPagina() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><ImportarCrucesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function cargarCsv(contenido: string) {
  const file = new File([contenido], 'cruces.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText(/archivo csv/i), { target: { files: [file] } });
  await screen.findByText(/cruces\.csv: \d+ fila/);
}

const CSV = 'Código;Especie;Madre;Padre\n02-101;Arándano;Duke;Nueva\n02-102;Arándano;Duke;Duke\n';

describe('ImportarCrucesPage', () => {
  it('descarta la previsualización anterior al reemplazar el archivo y conserva el contexto si falla', async () => {
    api.previsualizar.mockResolvedValue({
      lote_id: 'l-descartar', filas_total: 2, filas_con_error: 0, variedades_nuevas: [], filas: [],
    });
    renderPagina();
    await cargarCsv(CSV);
    fireEvent.click(screen.getByRole('button', { name: /previsualizar/i }));
    await screen.findByRole('button', { name: /confirmar e importar 2 cruce/i });
    api.descartar.mockRejectedValueOnce(new Error('No se pudo descartar el lote'));
    await cargarCsv(CSV);
    expect(await screen.findByText('No se pudo descartar el lote')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirmar e importar 2 cruce/i })).toBeInTheDocument();
    expect(api.descartar).toHaveBeenCalledWith('l-descartar');
    await cargarCsv(CSV);
    await waitFor(() => expect(screen.queryByRole('button', { name: /confirmar e importar/i })).not.toBeInTheDocument());
    expect(api.descartar).toHaveBeenCalledTimes(2);
  });

  it('propone las columnas, previsualiza con las filas armadas y muestra los errores sin permitir confirmar', async () => {
    api.previsualizar.mockResolvedValue({
      lote_id: 'l1', filas_total: 2, filas_con_error: 1, variedades_nuevas: [],
      filas: [
        { n: 1, codigo_sistema: '02-101', errores: ['codigo_existente'], variedades_faltantes: [], sugerencias: {} },
        { n: 2, codigo_sistema: '02-102', errores: [], variedades_faltantes: [], sugerencias: {} },
      ],
    });
    renderPagina();
    await cargarCsv(CSV);

    fireEvent.click(screen.getByRole('button', { name: /previsualizar/i }));

    await waitFor(() => expect(api.previsualizar).toHaveBeenCalledWith(
      [
        { codigo_sistema: '02-101', especie: 'Arándano', mama: 'Duke', papa: 'Nueva' },
        { codigo_sistema: '02-102', especie: 'Arándano', mama: 'Duke', papa: 'Duke' },
      ],
      'cruces.csv',
    ));
    expect(await screen.findByText('El código ya existe en el sistema')).toBeInTheDocument();
    expect(screen.getByText(/corrige las filas marcadas/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirmar e importar/i })).not.toBeInTheDocument();
  });

  it('exige aceptar las variedades nuevas, confirma con clave de idempotencia y permite revertir', async () => {
    api.previsualizar.mockResolvedValue({
      lote_id: 'l2', filas_total: 2, filas_con_error: 0, variedades_nuevas: ['Nueva'],
      filas: [
        // Mamá y papá son la misma variedad nueva: la base la informa dos veces.
        { n: 1, codigo_sistema: '02-101', errores: [], variedades_faltantes: ['Nueva', 'Nueva'], sugerencias: {} },
        { n: 2, codigo_sistema: '02-102', errores: [], variedades_faltantes: [], sugerencias: {} },
      ],
    });
    api.confirmar.mockResolvedValue({ lote_id: 'l2', cruces_creados: 2, variedades_creadas: 1, repetido: false });
    api.revertir.mockResolvedValue({ lote_id: 'l2', cruces_archivados: 2 });
    renderPagina();
    await cargarCsv(CSV);
    fireEvent.click(screen.getByRole('button', { name: /previsualizar/i }));

    const confirmarBtn = await screen.findByRole('button', { name: /confirmar e importar 2 cruce/i });
    expect(confirmarBtn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/crear las variedades nuevas: nueva/i));
    expect(confirmarBtn).toBeEnabled();
    fireEvent.click(confirmarBtn);

    await waitFor(() => expect(api.confirmar).toHaveBeenCalledWith('l2', true, expect.stringMatching(/^[0-9a-f-]{36}$/)));
    expect(await screen.findByText(/se importaron 2 cruce\(s\) y 1 variedad/i)).toBeInTheDocument();
    expect(screen.getAllByText('Variedad nueva: Nueva')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /revertir esta importación/i }));
    await waitFor(() => expect(api.revertir).toHaveBeenCalledWith('l2'));
    expect(await screen.findByText(/se archivaron 2 cruce/i)).toBeInTheDocument();
  });

  it('no deja previsualizar sin código ni especie asignados', async () => {
    renderPagina();
    await cargarCsv('A;B\n1;2\n');
    expect(screen.getByRole('button', { name: /previsualizar/i })).toBeDisabled();
    expect(screen.getByText(/falta asignar: código del cruce, especie/i)).toBeInTheDocument();
  });
});
