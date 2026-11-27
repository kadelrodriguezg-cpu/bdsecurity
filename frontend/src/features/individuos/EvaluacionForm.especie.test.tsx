/** Fase 4: el formulario muestra solo los descriptores que usa la especie del cruce, con sus etiquetas propias. */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EvaluacionForm } from './EvaluacionForm';

const m = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('@/api/rondas', () => ({
  crearEvaluacion: vi.fn(), actualizarEvaluacion: vi.fn(),
  buscarBorradorDeRonda: vi.fn(async () => null),
  obtenerReferenciasEvaluacion: vi.fn(async () => ({})),
}));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/api/descriptoresEspecie', () => ({
  especieDeCruce: vi.fn(async () => 'esp-frutilla'),
  listarConfigDescriptores: m.config,
}));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ generacionSesion: 0, capturarVigenciaSesion: () => () => true, user: { id: 'u1' }, esAdmin: false, perfil: { nombre: 'María Soto' } }) }));

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

const montar = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <EvaluacionForm rondaId="r1" plantaId="p1" />
  </QueryClientProvider>,
);

it('sin configuración, la especie usa todos los descriptores (29, con la cicatriz)', async () => {
  m.config.mockResolvedValue([]);
  montar();
  expect(await screen.findByRole('group', { name: 'Firmeza' })).toBeInTheDocument();
  expect(screen.getAllByText(/de 29 descriptores/).length).toBeGreaterThan(0);
});

it('un descriptor que la especie no usa no se pide ni cuenta; las etiquetas propias reemplazan a las del esquema', async () => {
  m.config.mockResolvedValue([
    { fase: 'evaluacion_anual', clave: 'bloom', especie_id: 'esp-frutilla', activo: false, etiquetas_nivel: null },
    { fase: 'evaluacion_anual', clave: 'color', especie_id: 'esp-frutilla', activo: true, etiquetas_nivel: ['Blanco', 'Rosado', 'Rojo claro', 'Rojo', 'Rojo oscuro'] },
  ]);
  montar();
  expect(await screen.findByRole('group', { name: 'Firmeza' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Bloom' })).not.toBeInTheDocument());
  expect(screen.getAllByText(/de 28 descriptores/).length).toBeGreaterThan(0);
  expect(screen.getByText('1 = Blanco')).toBeInTheDocument();
  expect(screen.getByText('5 = Rojo oscuro')).toBeInTheDocument();
});

it('una sección sin ningún descriptor que la especie use no aparece', async () => {
  m.config.mockResolvedValue(['dano_calor', 'golpe_sol', 'caida_fruto'].map((clave) => ({ fase: 'evaluacion_anual', clave, especie_id: 'esp-frutilla', activo: false, etiquetas_nivel: null })));
  montar();
  expect(await screen.findByRole('group', { name: 'Firmeza' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Daño por calor' })).not.toBeInTheDocument());
  expect(screen.queryByText('Estrés climático')).not.toBeInTheDocument();
});

it('poscosecha: tres lecturas, el texto de «buen estado» y el exportable calculado (sin dato hasta los 45 días)', async () => {
  m.config.mockResolvedValue([]);
  montar();
  const lectura45 = await screen.findByRole('spinbutton', { name: /A los 45 días/ });
  expect(screen.getByRole('spinbutton', { name: /A los 15 días/ })).toBeInTheDocument();
  expect(screen.getByText('Buen estado: fruto sin pudrición, sin deshidratación visible, firme al tacto y que conserva el bloom.')).toBeInTheDocument();
  const calculado = screen.getByText('% exportable: calculado').nextSibling as HTMLElement;
  expect(calculado).toHaveTextContent('Sin dato');
  fireEvent.change(screen.getByRole('spinbutton', { name: /A los 15 días/ }), { target: { value: '90' } });
  expect(calculado).toHaveTextContent('Sin dato');
  fireEvent.change(lectura45, { target: { value: '72.5' } });
  expect(calculado).toHaveTextContent('72,50 %');
  fireEvent.change(screen.getByRole('spinbutton', { name: /A los 30 días/ }), { target: { value: '0' } });
  expect(calculado).toHaveTextContent('0,00 %');
});

it('Fase 5 (G9): la cicatriz se pide en Fruto/Calidad, después del Brix, con su escala 1–5 provisional', async () => {
  m.config.mockResolvedValue([]);
  montar();
  const cicatriz = await screen.findByRole('group', { name: 'Cicatriz' });
  expect(cicatriz).toBeInTheDocument();
  expect(screen.getByText('1 = Grande, húmeda o desgarrada')).toBeInTheDocument();
  expect(screen.getByText('5 = Pequeña y seca')).toBeInTheDocument();
  const brix = screen.getByRole('spinbutton', { name: /Brix/ });
  expect(brix.compareDocumentPosition(cicatriz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
