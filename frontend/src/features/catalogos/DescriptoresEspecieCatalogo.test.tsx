/** Fase 4: «Configurar descriptores». Interruptor por especie, aviso si hay evaluaciones cargadas y etiquetas propias. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { DescriptoresEspecieCatalogo } from './DescriptoresEspecieCatalogo';

const m = vi.hoisted(() => ({ listar: vi.fn(), guardar: vi.fn(), contar: vi.fn() }));
vi.mock('@/api/especies', () => ({
  listarEspecies: vi.fn(async () => [
    { id: 'esp-a', nombre: 'Arándano', nombre_cientifico: null },
    { id: 'esp-f', nombre: 'Frutilla', nombre_cientifico: null },
  ]),
}));
vi.mock('@/api/descriptoresEspecie', () => ({ listarConfigDescriptores: m.listar, guardarConfigDescriptor: m.guardar, contarValoresDescriptor: m.contar }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));

beforeEach(() => {
  m.listar.mockResolvedValue([{ fase: 'evaluacion_anual', clave: 'bloom', especie_id: 'esp-f', activo: false, etiquetas_nivel: null }]);
  m.guardar.mockResolvedValue(undefined);
  m.contar.mockResolvedValue(0);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const montar = (url = '/catalogos?tipo=descriptores') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}><DescriptoresEspecieCatalogo /></MemoryRouter>
  </QueryClientProvider>,
);

it('una tabla por categoría con un interruptor por especie; refleja lo que cada especie usa', async () => {
  montar();
  const fruto = await screen.findByRole('region', { name: 'Fruto / Calidad' });
  expect(within(fruto).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Descriptor', 'Arándano', 'Frutilla']);
  expect(within(fruto).getByRole('switch', { name: 'Arándano usa Bloom' })).toBeChecked();
  expect(within(fruto).getByRole('switch', { name: 'Frutilla usa Bloom' })).not.toBeChecked();
  // Solo descriptores activos del esquema: ni la muestra ni los calculados ni rend_t_ha.
  expect(screen.queryByRole('switch', { name: /usa Cantidad de frutos/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('switch', { name: /usa Rendimiento por hectárea/ })).not.toBeInTheDocument();
});

it('sin evaluaciones cargadas, el cambio se guarda directo', async () => {
  montar();
  fireEvent.click(await screen.findByRole('switch', { name: 'Arándano usa Firmeza' }));
  await waitFor(() => expect(m.guardar).toHaveBeenCalledWith({ especieId: 'esp-a', clave: 'firmeza', activo: false, etiquetasNivel: null }));
  expect(m.contar).toHaveBeenCalledWith('esp-a', 'firmeza');
});

it('con evaluaciones cargadas, advierte antes de guardar y no borra nada', async () => {
  m.contar.mockResolvedValue(149);
  montar();
  fireEvent.click(await screen.findByRole('switch', { name: 'Arándano usa Firmeza' }));
  const aviso = await screen.findByRole('dialog', { name: '¿Dejar de usar Firmeza en Arándano?' });
  expect(aviso).toHaveTextContent('Arándano tiene 149 evaluaciones cerradas con firmeza.');
  expect(aviso).toHaveTextContent('Los valores no se borran');
  expect(m.guardar).not.toHaveBeenCalled();
  fireEvent.click(within(aviso).getByRole('button', { name: 'Dejar de usarlo' }));
  await waitFor(() => expect(m.guardar).toHaveBeenCalledWith({ especieId: 'esp-a', clave: 'firmeza', activo: false, etiquetasNivel: null }));
});

it('edita las etiquetas por nivel de una especie', async () => {
  montar();
  fireEvent.click(await screen.findByRole('button', { name: 'Etiquetas de Color en Frutilla' }));
  const hoja = await screen.findByRole('dialog', { name: 'Etiquetas de Color' });
  expect(within(hoja).getAllByRole('textbox')).toHaveLength(5);
  const textos = ['Blanco', 'Rosado', 'Rojo claro', 'Rojo', 'Rojo oscuro'];
  within(hoja).getAllByRole('textbox').forEach((campo, i) => fireEvent.change(campo, { target: { value: textos[i] } }));
  fireEvent.click(within(hoja).getByRole('button', { name: 'Guardar etiquetas' }));
  await waitFor(() => expect(m.guardar).toHaveBeenCalledWith({ especieId: 'esp-f', clave: 'color', activo: true, etiquetasNivel: textos }));
});

it('desde la tarjeta de una especie, su columna queda resaltada', async () => {
  montar('/catalogos?tipo=descriptores&especie=esp-f');
  const fruto = await screen.findByRole('region', { name: 'Fruto / Calidad' });
  expect(within(fruto).getByRole('columnheader', { name: 'Frutilla' })).toHaveClass('bg-brand-l');
});
