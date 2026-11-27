import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { qk } from '@/lib/queryKeys';
import { PlantasListaPage } from './PlantasListaPage';
import { guardarIncluirPruebas } from '@/lib/preferencias';
import { fijarEspacioDePrueba, panoramaDePrueba, reiniciarEspacioDePrueba } from '@/features/especies/espacioDePrueba';

type Respuesta = { items: Array<Record<string, unknown>>; total: number; limite: number; offset: number; orden: string };
const VACIA: Respuesta = { items: [], total: 0, limite: 25, offset: 0, orden: 'actividad_desc' };
const { listarCrucesAnaliticos } = vi.hoisted(() => ({
  listarCrucesAnaliticos: vi.fn<(...args: unknown[]) => Promise<Respuesta>>(async () => ({ items: [], total: 0, limite: 25, offset: 0, orden: 'actividad_desc' })),
}));
vi.mock('@/api/plantas', () => ({ listarCrucesAnaliticos }));
const temporadas = vi.hoisted(() => vi.fn(async () => [] as Array<Record<string, unknown>>));
vi.mock('@/api/rankingGrupos', () => ({ listarTemporadasEspecie: temporadas }));
vi.mock('@/api/nombres', () => ({ nombresDeUsuarios: vi.fn(async () => new Map([['u-ana', 'Ana Rojas']])) }));
vi.mock('@/features/especies/EspacioEspecie', async () => (await import('@/features/especies/espacioDePrueba')).moduloEspacioDePrueba());
const auth = vi.hoisted(() => ({ esAdmin: false }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: auth.esAdmin }) }));

afterEach(() => {
  cleanup();
  listarCrucesAnaliticos.mockReset();
  listarCrucesAnaliticos.mockResolvedValue(VACIA);
  temporadas.mockReset();
  temporadas.mockResolvedValue([]);
  auth.esAdmin = false;
  guardarIncluirPruebas(false);
  reiniciarEspacioDePrueba();
});

function Ubicacion() {
  const location = useLocation();
  return <output data-testid="ubicacion">{location.pathname}{location.search}</output>;
}

function montar(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><PlantasListaPage /><Ubicacion /></MemoryRouter></QueryClientProvider>), client };
}

const parametros = () => new URLSearchParams(screen.getByTestId('ubicacion').textContent!.split('?')[1]);

const CRUCE_EN_RONDA = {
  id: 'c1', codigo_sistema: '02-502', especie_nombre: 'Arándano', estado: 'evaluacion_anual', individuos_vivos: 379,
  ultima_actividad: new Date().toISOString(), ultima_actividad_por: 'u-ana', es_prueba: false,
  ronda_actual: { tipo: 'anual', numero: 1, anio: 2026, cerradas: 149, vivos: 379 }, sin_evaluacion_cerrada: 230,
};
const CRUCE_AL_DIA = {
  id: 'c2', codigo_sistema: '02-307', especie_nombre: 'Arándano', estado: 'crecimiento', individuos_vivos: 24,
  ultima_actividad: '2026-10-20T15:00:00Z', ultima_actividad_por: null, es_prueba: false, ronda_actual: null, sin_evaluacion_cerrada: 0,
};

describe('Cruces de una especie (fase 4)', () => {
  it('título con la especie y el resumen en una línea; «Nuevo cruce» solo para el admin', async () => {
    montar('/plantas?especie=arandano');
    expect(screen.getByRole('heading', { name: 'Cruces de Arándano' })).toBeInTheDocument();
    expect(screen.getByText(/5 cruces activos · 379 individuos vivos ·/)).toHaveTextContent('230 sin evaluación cerrada');
    expect(screen.queryByRole('link', { name: /Nuevo cruce/ })).not.toBeInTheDocument();
    cleanup();
    auth.esAdmin = true;
    montar('/plantas?especie=arandano');
    expect(screen.getByRole('link', { name: /Nuevo cruce/ })).toHaveAttribute('href', '/nueva-planta');
    expect(screen.queryByRole('link', { name: /Especie/ })).not.toBeInTheDocument();
  });

  it('la franja tiene las 10 fases en orden; tocar una filtra y tocarla de nuevo quita el filtro', async () => {
    montar('/plantas?especie=arandano');
    const franja = screen.getByRole('navigation', { name: 'Cruces por fase' });
    const fases = within(franja).getAllByRole('button');
    expect(fases).toHaveLength(10);
    expect(fases[0]).toHaveAccessibleName('Sin empezar: 1 cruce');
    expect(fases[7]).toHaveAccessibleName('Evaluación anual: 5 cruces, 1 con pendientes');
    expect(fases[1]).toHaveClass('opacity-50'); // Polinización en 0: atenuada
    fireEvent.click(fases[7]);
    expect(parametros().get('etapa')).toBe('evaluacion_anual');
    await waitFor(() => expect(listarCrucesAnaliticos).toHaveBeenLastCalledWith(expect.objectContaining({ estado: 'evaluacion_anual', especieId: 'esp-arandano' })));
    expect(within(franja).getAllByRole('button')[7]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(franja).getAllByRole('button')[7]);
    expect(parametros().has('etapa')).toBe(false);
  });

  it('chip de la fase activa con ✕ y chip «Solo con pendientes»', async () => {
    montar('/plantas?especie=arandano&etapa=evaluacion_anual');
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar el filtro de fase Evaluación anual' })[0]);
    expect(parametros().has('etapa')).toBe(false);
    const pendientes = screen.getAllByRole('button', { name: /Solo con pendientes/ })[0];
    expect(pendientes).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(pendientes);
    expect(parametros().get('pendientes')).toBe('1');
    await waitFor(() => expect(listarCrucesAnaliticos).toHaveBeenLastCalledWith(expect.objectContaining({ soloPendientes: true })));
  });

  it('tabla: fase con su avance, ronda actual con cerradas, pendientes en ámbar o «Al día», y quién hizo lo último', async () => {
    listarCrucesAnaliticos.mockResolvedValue({ ...VACIA, items: [CRUCE_EN_RONDA, CRUCE_AL_DIA], total: 2 });
    temporadas.mockResolvedValue([{ planta_id: 'c1', tipo_ronda: 'anual', numero_ronda: 1, etiqueta: '2025-2026' }]);
    montar('/plantas?especie=arandano');
    const tabla = await screen.findByRole('table');
    expect(within(tabla).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Código', 'Fase', 'Vivos', 'Ronda actual', 'Pendientes', 'Última actividad', 'Abrir']);
    const [, enRonda, alDia] = within(tabla).getAllByRole('row');
    expect(within(enRonda).getByRole('img', { name: 'Paso 8 de 10' })).toBeInTheDocument();
    // Hallazgo 2 (G2): la ronda se lee con su temporada de julio a junio, no con el año calendario guardado.
    expect(await within(enRonda).findByText('Ronda 1 · 2025-2026')).toBeInTheDocument();
    expect(enRonda).toHaveTextContent('149 de 379 cerradas');
    expect(within(enRonda).getByText('230 sin evaluación cerrada')).toHaveClass('text-warn');
    expect(await within(enRonda).findByText('Ana Rojas')).toBeInTheDocument();
    expect(within(enRonda).getByText(/^hoy \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(alDia).toHaveTextContent('Sin ronda abierta');
    expect(within(alDia).getByText('Al día')).toHaveClass('text-ok');
    expect(within(alDia).getByText('20-10-2026')).toBeInTheDocument();
    expect(screen.getByText('2 de 6 cruces')).toBeInTheDocument();
  });

  it('el pie dice cuántos de cuántos y el filtro activo', async () => {
    listarCrucesAnaliticos.mockResolvedValue({ ...VACIA, items: [CRUCE_EN_RONDA], total: 1 });
    montar('/plantas?especie=arandano&etapa=evaluacion_anual&pendientes=1');
    expect(await screen.findByText('1 de 6 cruces · Evaluación anual · solo con pendientes')).toBeInTheDocument();
  });

  it('con «Todas las especies» muestra el panorama y no pide cruces', async () => {
    fijarEspacioDePrueba({ activa: null, parametro: 'todas', panorama: [panoramaDePrueba()] });
    montar('/plantas?especie=todas');
    expect(screen.getByRole('heading', { name: 'Cruces' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Arándano' })).toBeInTheDocument();
    expect(listarCrucesAnaliticos).not.toHaveBeenCalled();
  });
});

describe('Cruces: lo que ya cubría la lista (v3)', () => {
  it('fallo inicial no afirma vacío y retry conserva la URL', async () => {
    listarCrucesAnaliticos.mockRejectedValueOnce(new Error('privado'));
    montar('/plantas?vista=tarjetas&especie=arandano&pagina=2');
    await screen.findByRole('button', { name: 'Reintentar cruces' });
    expect(screen.queryByText(/No hay cruces que coincidan/)).not.toBeInTheDocument();
    expect(screen.queryByText('privado')).not.toBeInTheDocument();
    const url = screen.getByTestId('ubicacion').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar cruces' }));
    await screen.findByText(/Todavía no hay cruces de Arándano/);
    expect(screen.getByTestId('ubicacion').textContent).toBe(url);
  });

  it('fallo de actualización conserva las tarjetas previas y su enlace', async () => {
    listarCrucesAnaliticos.mockResolvedValueOnce({ ...VACIA, items: [{ ...CRUCE_AL_DIA, codigo_sistema: 'CACHE-1' }], total: 1 });
    const { client } = montar('/plantas?vista=tarjetas');
    const lista = screen.getByRole('list', { name: 'Lista de cruces' });
    const enlace = await within(lista).findByRole('link');
    listarCrucesAnaliticos.mockRejectedValueOnce(new Error('interno'));
    await act(async () => { await client.invalidateQueries({ queryKey: qk.plantas.all }); });
    await screen.findByRole('button', { name: 'Reintentar cruces' });
    expect(within(lista).getByRole('link')).toBe(enlace);
    expect(enlace).toHaveTextContent('CACHE-1');
  });

  it('sin interruptor Lista/Tarjetas: un enlace viejo con vista=tarjetas abre igual y conserva la página', async () => {
    montar('/plantas?especie=arandano&pagina=3&vista=tarjetas');
    // G18: de a 50 por página: la página 3 empieza en el 101.
    await waitFor(() => expect(listarCrucesAnaliticos).toHaveBeenCalledWith(expect.objectContaining({ especieId: 'esp-arandano', offset: 100 })));
    expect(screen.queryByRole('button', { name: 'Tarjetas' })).not.toBeInTheDocument();
  });

  it('celular: botón «Filtros» cuenta fase y pendientes; la hoja tiene Fase, «Solo con pendientes» y Ordenar por, y quita los filtros sin salir de la especie', async () => {
    montar('/plantas?especie=arandano&etapa=cosecha&pendientes=1&buscar=02-');
    fireEvent.click(screen.getByRole('button', { name: 'Filtros (2 activos)' }));
    const hoja = await screen.findByRole('dialog', { name: 'Filtros' });
    expect(within(hoja).queryByLabelText('Especie')).not.toBeInTheDocument();
    expect(within(hoja).getByLabelText('Fase')).toHaveValue('cosecha');
    expect(within(hoja).getByLabelText('Ordenar por')).toHaveValue('actividad_desc');
    expect(within(hoja).getByRole('button', { name: /Solo con pendientes/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(hoja).getByRole('button', { name: 'Quitar filtros' }));
    expect(parametros().get('especie')).toBe('arandano');
    expect(parametros().has('etapa')).toBe(false);
    expect(parametros().has('pendientes')).toBe(false);
    expect(parametros().get('buscar')).toBe('02-'); // el buscador queda a la vista y no es un filtro de la hoja
  });

  it('marca «Prueba» por fila solo cuando el admin incluye las pruebas', async () => {
    auth.esAdmin = true;
    guardarIncluirPruebas(true);
    listarCrucesAnaliticos.mockResolvedValue({ ...VACIA, items: [{ ...CRUCE_AL_DIA, id: 'p', codigo_sistema: 'PRB-1', es_prueba: true }, CRUCE_EN_RONDA], total: 2 });
    montar('/plantas');
    const lista = screen.getByRole('list', { name: 'Lista de cruces' });
    await within(lista).findByText('PRB-1');
    expect(within(lista).getAllByText('Prueba')).toHaveLength(1);
    expect(listarCrucesAnaliticos).toHaveBeenCalledWith(expect.objectContaining({ incluirPruebas: true }));
  });

  it('U-24: sin «Scoring» ni «Sin elegibles»; un enlace con orden=scoring_desc vuelve al orden por actividad', async () => {
    listarCrucesAnaliticos.mockResolvedValue({ ...VACIA, items: [{ ...CRUCE_AL_DIA, mejor_puntaje: 0.72, individuos_elegibles: 2 }], total: 1 });
    montar('/plantas?orden=scoring_desc');
    await within(screen.getByRole('list', { name: 'Lista de cruces' })).findByText('02-307');
    expect(screen.queryByText(/elegibles/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Scoring/)).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Mejor scoring' })).not.toBeInTheDocument();
    expect(listarCrucesAnaliticos).toHaveBeenCalledWith(expect.objectContaining({ orden: 'actividad_desc' }));
    expect(screen.getAllByLabelText('Ordenar por')[0]).toHaveValue('actividad_desc');
  });

  it('desde el vacío con filtros, «Quitar filtros» los saca todos y conserva la especie', async () => {
    montar('/plantas?especie=arandano&etapa=polinizacion');
    expect(await screen.findByText(/no hay cruces que coincidan/i)).toBeInTheDocument();
    expect(listarCrucesAnaliticos).toHaveBeenCalledWith(expect.objectContaining({ estado: 'polinizacion', orden: 'actividad_desc', limite: 50, offset: 0, incluirPruebas: false }));
    fireEvent.click(screen.getByRole('button', { name: /quitar filtros/i }));
    expect(screen.getByTestId('ubicacion')).toHaveTextContent(/^\/plantas\?especie=arandano$/);
  });
});

describe('Cruces — hallazgo 2 (G2)', () => {
  it('sin etiqueta de temporada la ronda se lee sin año («Ronda 1»), nunca con el año calendario', async () => {
    listarCrucesAnaliticos.mockResolvedValue({ ...VACIA, items: [CRUCE_EN_RONDA], total: 1 });
    montar('/plantas?especie=arandano');
    const tabla = await screen.findByRole('table');
    expect(await within(tabla).findByText('Ronda 1')).toBeInTheDocument();
    expect(within(tabla).queryByText(/Ronda 1 · 2026/)).toBeNull();
  });
});

describe('Cruces — fase 5, segunda parte: paginación numerada (G18)', () => {
  it('«Mostrando 51–100 de 378», números con puntos suspensivos, 50 o 100 por página y la página en la URL', async () => {
    listarCrucesAnaliticos.mockResolvedValue({ ...VACIA, items: [], total: 378, limite: 50, offset: 50 });
    montar('/plantas?especie=arandano&pagina=2');
    expect(await screen.findByText('Mostrando 51–100 de 378')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Página 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Página 8' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Página 3' }));
    expect(parametros().get('pagina')).toBe('3');
    // La página nueva se pide al servidor: el pie vuelve cuando llega la respuesta.
    fireEvent.change(await screen.findByRole('combobox', { name: 'Filas por página' }), { target: { value: '100' } });
    expect(parametros().get('filas')).toBe('100');
    expect(parametros().has('pagina')).toBe(false);
    await waitFor(() => expect(listarCrucesAnaliticos).toHaveBeenCalledWith(expect.objectContaining({ limite: 100, offset: 0 })));
  });
});
