import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorApi, traducirError } from '@/api/client';
const mocks = vi.hoisted(() => ({ ficha: vi.fn(), individuos: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/api/plantas', () => ({ obtenerFicha: mocks.ficha }));
vi.mock('@/api/especies', () => ({ listarEspecies: vi.fn(async () => []) }));
vi.mock('@/api/individuos', () => ({ listarIndividuosDePlanta: mocks.individuos, esEtiquetable: () => true, ESTADO_VITAL_LABEL: {} }));
vi.mock('@/api/scoring', () => ({ listarScoringDePlanta: vi.fn(async () => []) }));
vi.mock('@/features/individuos/RankingTabla', () => ({ RankingTabla: () => null }));
vi.mock('@/features/evaluaciones/PlanillaRonda', () => ({ PlanillaRonda: () => null }));
vi.mock('@/features/crecimiento/PlanillaCrecimiento', () => ({ PlanillaCrecimiento: () => <div data-testid="planilla-crecimiento" /> }));
vi.mock('@/features/auth/AuthContext', async (importOriginal) => ({ ...await importOriginal<typeof import('@/features/auth/AuthContext')>(), useAuth: () => ({ esAdmin: false }) }));
vi.mock('@/features/individuos/ExpedienteIndividuo', () => ({ ExpedienteIndividuo: () => null }));
vi.mock('@/features/qr/DescargaEtiquetasEnTanda', () => ({ DescargaEtiquetasEnTanda: () => null }));
vi.mock('@/features/plantas/BarraFases', () => ({ BarraFases: () => null }));
vi.mock('@/features/plantas/AvanzarEstado', () => ({ AvanzarEstado: () => null }));
vi.mock('@/features/plantas/LinajePanel', () => ({ LinajePanel: () => null }));
vi.mock('@/features/eventos/EventosLista', () => ({ EventosLista: () => null }));
vi.mock('@/features/fases/FaseFormulario', () => ({ FaseFormulario: () => null }));
vi.mock('@/features/fases/TrasplanteWorkspace', () => ({ TrasplanteWorkspace: () => null }));
vi.mock('@/features/fases/ResumenFinal', () => ({ ResumenFinal: () => null }));
// v3 paso 4: fuera de Evaluación anual, la pestaña Individuos usa la MISMA lista (el workspace con `estadoCruce`).
// En esas fases se reemplaza por una marca; en Evaluación anual se usa el workspace real (otras pruebas lo ejercitan).
vi.mock('@/features/individuos/EvaluacionAnualWorkspace', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/individuos/EvaluacionAnualWorkspace')>();
  return {
    ...real,
    EvaluacionAnualWorkspace: (props: React.ComponentProps<typeof real.EvaluacionAnualWorkspace>) => (
      props.estadoCruce && props.estadoCruce !== 'evaluacion_anual'
        ? <div data-testid="zona-individuos" data-fase={props.estadoCruce}>{props.individuoFocoId ?? 'sin foco'}</div>
        : <real.EvaluacionAnualWorkspace {...props} />
    ),
  };
});

import { PlantaFichaPage } from './PlantaFichaPage';
const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ficha = { id: UUID, especie_id: 'especie-local', codigo_sistema: '02-001', estado: 'sin_empezar' };
afterEach(cleanup);
beforeEach(() => { mocks.ficha.mockReset().mockResolvedValue(ficha); mocks.individuos.mockReset().mockResolvedValue([]); });
function Ubicacion() { const l = useLocation(); return <output data-testid="destino">{l.pathname}{l.search}{l.hash}</output>; }
function montar(id = UUID, volverA: unknown = '/plantas?etapa=sin_empezar#lista', busqueda = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: `/planta/${id}`, search: busqueda, state: { volverA } }]}><Routes>
    <Route path="/planta/:id" element={<PlantaFichaPage />} /><Route path="*" element={<Ubicacion />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
describe('PlantaFichaPage — errores sin filtrar datos', () => {
  it('expone retry de individuos desde el workspace anual tras fallo inicial; el vacío solo se afirma tras una lectura exitosa', async () => {
    mocks.ficha.mockResolvedValue({ ...ficha, estado: 'evaluacion_anual' });
    mocks.individuos.mockRejectedValue(new Error('detalle sensible'));
    montar();
    const retry = await screen.findByRole('button', { name: 'Reintentar individuos' });
    expect(screen.queryByText(/todavía no tiene individuos/)).not.toBeInTheDocument();
    mocks.individuos.mockResolvedValue([]);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reintentar individuos' })).not.toBeInTheDocument());
    // Sprint 1.1: en pestañas la planilla no desaparece; dice que no hay individuos.
    expect(await screen.findByText(/todavía no tiene individuos/)).toBeInTheDocument();
    expect(screen.queryByText('Explorador de individuos')).not.toBeInTheDocument();
    expect(screen.getByText('02-001')).toBeInTheDocument();
  });
  it('con cero individuos confirmados la pestaña de entrada lo dice (y nada más del workspace)', async () => {
    mocks.ficha.mockResolvedValue({ ...ficha, estado: 'evaluacion_anual' });
    montar();
    await screen.findByText('02-001');
    await waitFor(() => expect(mocks.individuos).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Cargando individuos…')).not.toBeInTheDocument());
    expect(screen.queryByText('Explorador de individuos')).not.toBeInTheDocument();
    expect(await screen.findByText(/todavía no tiene individuos/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Planilla de ronda' })).toHaveAttribute('aria-selected', 'true');
  });

  it('no consulta ficha con UUID inválido', () => {
    montar('invalido');
    expect(screen.getByRole('heading', { name: 'Código no válido' })).toBeInTheDocument();
    expect(mocks.ficha).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });
  it.each([
    ['no_encontrado', 'Cruce no encontrado', false],
    ['sin_permiso', 'No tienes permiso para ver este cruce', false],
    ['sin_sesion', 'Vuelve a iniciar sesión', false],
    ['red', 'No se pudo conectar', true],
    ['desconocido', 'No se pudo cargar el cruce', true],
  ] as const)('clasifica %s con mensaje seguro', async (tipo, titulo, retry) => {
    mocks.ficha.mockRejectedValue(new ErrorApi('linaje privado del servidor', tipo));
    montar();
    expect(await screen.findByRole('heading', { name: titulo })).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('linaje privado');
    expect(!!screen.queryByRole('button', { name: 'Reintentar' })).toBe(retry);
    expect(document.querySelector('a button')).toBeNull();
  });
  it('un Error desconocido no se convierte en no encontrado y puede recuperarse', async () => {
    mocks.ficha.mockRejectedValueOnce(new Error('detalle sensible')).mockResolvedValue(ficha);
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('02-001')).toBeInTheDocument();
    expect(mocks.ficha).toHaveBeenCalledTimes(2);
  });
  it('una respuesta nula no permanece cargando para siempre', async () => {
    mocks.ficha.mockResolvedValue(null); montar();
    expect(await screen.findByRole('heading', { name: 'No se pudo cargar el cruce' })).toBeInTheDocument();
  });
  it('permite reintentar HTTP 503 sin código sin anunciar un cruce inexistente', async () => {
    mocks.ficha.mockRejectedValueOnce(traducirError({ code: '', message: 'Service Unavailable' })).mockResolvedValue(ficha);
    montar();
    expect(await screen.findByRole('heading', { name: 'No se pudo cargar el cruce' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('02-001')).toBeInTheDocument();
  });
  it('ofrece reautenticación con destino de la ficha preservado', async () => {
    mocks.ficha.mockRejectedValue(new ErrorApi('raw', 'sin_sesion')); montar();
    const link = await screen.findByRole('link', { name: 'Iniciar sesión' });
    const href = new URL(link.getAttribute('href')!, 'https://app.local');
    expect(href.pathname).toBe('/login');
    expect(href.searchParams.get('next')).toBe(`/planta/${UUID}`);
  });
  it('la ficha sana vuelve a filtros y ancla de la vista anterior', async () => {
    montar();
    fireEvent.click(await screen.findByRole('link', { name: 'Volver a la lista o vista anterior' }));
    expect(screen.getByTestId('destino')).toHaveTextContent('/plantas?etapa=sin_empezar#lista');
  });
  it('descarta contexto de retorno externo', async () => {
    montar(UUID, '//externo.cl');
    expect(await screen.findByRole('link', { name: 'Volver a la lista o vista anterior' })).toHaveAttribute('href', '/plantas');
  });
  it('descarta un retorno a la misma ficha', async () => {
    montar(UUID, `/planta/${UUID}`);
    expect(await screen.findByRole('link', { name: 'Volver a la lista o vista anterior' })).toHaveAttribute('href', '/plantas');
  });
});

describe('PlantaFichaPage — abierta desde la etiqueta de un individuo (?individuo=)', () => {
  const IND = '11111111-2222-3333-4444-555555555555';
  const estadoConZonaC = { ...ficha, estado: 'cosecha' };

  it('pasa el individuo pedido a la zona de individuos', async () => {
    mocks.ficha.mockResolvedValue(estadoConZonaC);
    mocks.individuos.mockResolvedValue([{ id: IND, planta_id: UUID, codigo_display: '02-001-P7', estado_vital: 'vivo' }]);
    montar(UUID, '/escanear', `?individuo=${IND}`);
    expect(await screen.findByTestId('zona-individuos')).toHaveTextContent(IND);
    expect(screen.queryByText(/No se encontró ese individuo/)).not.toBeInTheDocument();
  });

  it('normaliza el UUID a minúsculas', async () => {
    mocks.ficha.mockResolvedValue(estadoConZonaC);
    mocks.individuos.mockResolvedValue([{ id: IND, planta_id: UUID, codigo_display: '02-001-P7', estado_vital: 'vivo' }]);
    montar(UUID, '/escanear', `?individuo=${IND.toUpperCase()}`);
    expect(await screen.findByTestId('zona-individuos')).toHaveTextContent(IND);
  });

  it('avisa (sin bloquear la ficha) si el individuo no es de este cruce', async () => {
    mocks.ficha.mockResolvedValue(estadoConZonaC);
    mocks.individuos.mockResolvedValue([{ id: 'otro', planta_id: UUID, codigo_display: '02-001-P1', estado_vital: 'vivo' }]);
    montar(UUID, '/escanear', `?individuo=${IND}`);
    expect(await screen.findByText(/No se encontró ese individuo en este cruce/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Se muestra la ficha completa');
    expect(screen.getByText('02-001')).toBeInTheDocument();
  });

  it('ignora en silencio un parámetro que no es un UUID válido', async () => {
    mocks.ficha.mockResolvedValue(estadoConZonaC);
    mocks.individuos.mockResolvedValue([{ id: IND, planta_id: UUID, codigo_display: '02-001-P7', estado_vital: 'vivo' }]);
    montar(UUID, '/escanear', '?individuo=P7');
    // Sin un individuo válido se entra por la pestaña de la fase; Individuos sigue disponible.
    fireEvent.click(await screen.findByRole('tab', { name: 'Individuos' }));
    expect(await screen.findByTestId('zona-individuos')).toHaveTextContent('sin foco');
    expect(screen.queryByText(/No se encontró ese individuo/)).not.toBeInTheDocument();
  });

  it('sin parámetro todo queda como siempre', async () => {
    mocks.ficha.mockResolvedValue(estadoConZonaC);
    mocks.individuos.mockResolvedValue([{ id: IND, planta_id: UUID, codigo_display: '02-001-P7', estado_vital: 'vivo' }]);
    montar();
    expect(await screen.findByRole('tab', { name: 'Cosecha', selected: true })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('tab', { name: 'Individuos' }));
    expect(await screen.findByTestId('zona-individuos')).toHaveTextContent('sin foco');
    expect(screen.queryByText(/No se encontró ese individuo/)).not.toBeInTheDocument();
  });
});

describe('PlantaFichaPage — ficha en pestañas (Sprint 1.1)', () => {
  const IND = '11111111-2222-3333-4444-555555555555';
  const nombres = () => screen.getAllByRole('tab').map((t) => t.textContent);

  it('Evaluación anual: cinco pestañas, entra por Planilla y la Bitácora se monta al visitarla', async () => {
    mocks.ficha.mockResolvedValue({ ...ficha, estado: 'evaluacion_anual' });
    mocks.individuos.mockResolvedValue([{ id: IND, planta_id: UUID, codigo_display: '02-001-P7', estado_vital: 'vivo' }]);
    montar();
    await screen.findByRole('tablist', { name: 'Secciones de la ficha' });
    expect(nombres()).toEqual(['Planilla de ronda', 'Ranking', 'Individuos', 'Procedimientos', 'Bitácora']);
    expect(screen.getByRole('tab', { name: 'Planilla de ronda' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('heading', { name: 'Historial' })).not.toBeInTheDocument(); // nada apilado debajo
    fireEvent.click(screen.getByRole('tab', { name: 'Bitácora' }));
    expect(await screen.findByRole('heading', { name: 'Historial' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Bitácora' })).toHaveAttribute('aria-selected', 'true');
  });

  it('?pestana= abre esa pestaña; una inválida cae en la de entrada', async () => {
    mocks.ficha.mockResolvedValue({ ...ficha, estado: 'evaluacion_anual' });
    montar(UUID, '/plantas', '?pestana=bitacora');
    expect(await screen.findByRole('tab', { name: 'Bitácora' })).toHaveAttribute('aria-selected', 'true');
    cleanup();
    montar(UUID, '/plantas', '?pestana=inventada');
    expect(await screen.findByRole('tab', { name: 'Planilla de ronda' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Multisitio: entra por su planilla de ronda; abierta desde la etiqueta de un individuo, por Individuos', async () => {
    mocks.ficha.mockResolvedValue({ ...ficha, estado: 'traslado_destino' });
    mocks.individuos.mockResolvedValue([{ id: IND, planta_id: UUID, codigo_display: '02-001-P7', estado_vital: 'vivo' }]);
    montar();
    await screen.findByRole('tablist', { name: 'Secciones de la ficha' });
    expect(nombres()).toEqual(['Planilla de ronda', 'Multisitio', 'Individuos', 'Bitácora']);
    expect(screen.getByRole('tab', { name: 'Planilla de ronda' })).toHaveAttribute('aria-selected', 'true');
    cleanup();
    montar(UUID, '/escanear', `?individuo=${IND}`);
    expect(await screen.findByRole('tab', { name: 'Individuos' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('zona-individuos')).toHaveTextContent(IND);
  });

  it('Crecimiento (S2-6): entra por su planilla de avance; abierta desde la etiqueta de un individuo, por Individuos', async () => {
    mocks.ficha.mockResolvedValue({ ...ficha, estado: 'crecimiento' });
    mocks.individuos.mockResolvedValue([{ id: IND, planta_id: UUID, codigo_display: '02-001-P7', estado_vital: 'vivo' }]);
    montar();
    await screen.findByRole('tablist', { name: 'Secciones de la ficha' });
    expect(nombres()).toEqual(['Planilla de evaluación', 'Individuos', 'Procedimientos', 'Bitácora']);
    expect(screen.getByRole('tab', { name: 'Planilla de evaluación' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('planilla-crecimiento')).toBeInTheDocument();
    cleanup();
    montar(UUID, '/escanear', `?individuo=${IND}`);
    expect(await screen.findByRole('tab', { name: 'Individuos' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('zona-individuos')).toHaveTextContent(IND);
  });

  it('v3 paso 3: las fases sin rondas usan la misma ficha, con la pestaña de la fase y la Bitácora (Individuos solo si ya hay)', async () => {
    mocks.ficha.mockResolvedValue({ ...ficha, estado: 'cosecha' });
    mocks.individuos.mockResolvedValue([]);
    montar();
    expect(await screen.findByRole('tablist', { name: 'Secciones de la ficha' })).toBeInTheDocument();
    await waitFor(() => expect(nombres()).toEqual(['Cosecha', 'Bitácora']));
    expect(screen.getByRole('tab', { name: 'Cosecha' })).toHaveAttribute('aria-selected', 'true');
  });

  it('v3 paso 3: Trasplante entra por su espacio de trabajo (ahí nacen los individuos)', async () => {
    mocks.ficha.mockResolvedValue({ ...ficha, estado: 'trasplante' });
    mocks.individuos.mockResolvedValue([{ id: IND, planta_id: UUID, codigo_display: '02-001-P7', estado_vital: 'vivo' }]);
    montar();
    await waitFor(() => expect(nombres()).toEqual(['Trasplante', 'Bitácora']));
  });

  it('v3 paso 3: la gestión del cruce ya no está en la ficha', async () => {
    mocks.ficha.mockResolvedValue({ ...ficha, estado: 'evaluacion_anual' });
    mocks.individuos.mockResolvedValue([]);
    montar();
    await screen.findByText('02-001');
    expect(screen.queryByRole('button', { name: /gestión del cruce/i })).not.toBeInTheDocument();
  });
});
