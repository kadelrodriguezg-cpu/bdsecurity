/**
 * Paso 4 (virtualización del Explorador de individuos, @tanstack/react-virtual):
 * confirma que con un cruce grande (110 individuos) el recuadro no monta las
 * 110 filas de golpe, que la búsqueda por código sigue filtrando igual sobre
 * la lista virtualizada. (Desde el Sprint 1.2 la evaluación se hace a pantalla
 * completa y vuelve al mismo individuo: ya no hay «continuar con el siguiente
 * pendiente» en el workspace.)
 *
 * jsdom no mide layout real: sin los mocks de ResizeObserver/
 * getBoundingClientRect de abajo, el contenedor de scroll queda en 0px de
 * alto y el virtualizador no renderiza ninguna fila.
 */
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const mockListarIndividuos = vi.fn();
const mockObtenerRanking = vi.fn();

vi.mock('@/api/individuos', async () => {
  const actual = await vi.importActual<typeof import('@/api/individuos')>('@/api/individuos');
  return { ...actual, listarIndividuosDePlanta: (...args: unknown[]) => mockListarIndividuos(...args) };
});
vi.mock('@/api/rankingGrupos', async () => {
  const actual = await vi.importActual<typeof import('@/api/rankingGrupos')>('@/api/rankingGrupos');
  return { ...actual, obtenerRankingPorGrupos: (...args: unknown[]) => mockObtenerRanking(...args) };
});
vi.mock('./RankingTabla', () => ({ RankingTabla: () => null }));
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ esAdmin: false }),
}));
vi.mock('./ExpedienteIndividuo', () => ({
  // Sustituye el expediente real: basta con saber qué individuo está abierto
  // y con un campo editable para probar que no se pierde al refrescar.
  ExpedienteIndividuo: ({ individuo }: { individuo: { id: string } }) => (
    <><output aria-label="Individuo abierto">{individuo.id}</output><input aria-label="Edición abierta" /></>
  ),
}));

import { EvaluacionAnualWorkspace } from './EvaluacionAnualWorkspace';
import { qk } from '@/lib/queryKeys';
import type { Individuo } from '@/api/individuos';

beforeAll(() => {
  // @tanstack/react-virtual mide el contenedor de scroll con
  // `element.offsetHeight`/`offsetWidth` (no getBoundingClientRect) y, si
  // hay ResizeObserver, con `entry.borderBoxSize[0]` — jsdom no hace layout
  // real y deja ambos en 0, así que sin esto el virtualizador ve un
  // viewport de 0px y no renderiza ninguna fila.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 768 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
  // jsdom no implementa Element.scrollTo — el scrollToFn por defecto del
  // virtualizador lo llama para mover el contenedor (`el.scrollTo({top})`),
  // así que sin este polyfill scrollToIndex queda en un no-op silencioso.
  HTMLElement.prototype.scrollTo = function scrollTo(this: HTMLElement, opts?: ScrollToOptions | number) {
    if (typeof opts === 'object' && opts !== null && 'top' in opts && typeof opts.top === 'number') {
      this.scrollTop = opts.top;
    }
  };
  class ResizeObserverMock {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      this.cb(
        [{ target, borderBoxSize: [{ blockSize: 768, inlineSize: 800 }] } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  mockListarIndividuos.mockReset();
  mockObtenerRanking.mockReset();
});

function individuo(n: number): Individuo {
  return {
    id: `ind-${n}`,
    planta_id: 'p1',
    codigo_display: `VISUAL-TEST-P${n}`,
    clon_de_id: null,
    estado_vital: 'vivo',
    fecha_baja: null,
    created_at: '2026-07-01T00:00:00Z',
  };
}

const INDIVIDUOS_110 = Array.from({ length: 110 }, (_, i) => individuo(i + 1));

/**
 * Volumen real del caso que motivó la descarga en tanda: 378 individuos sin
 * etiquetar en un solo cruce, con individuos de baja mezclados en la lista
 * (no están agrupados al final, aparecen intercalados como en producción).
 */
const INDIVIDUOS_378 = Array.from({ length: 378 }, (_, i) => {
  const n = i + 1;
  const base = individuo(n);
  if (n % 50 === 0) return { ...base, estado_vital: 'descartado' as const, fecha_baja: '2026-08-01' };
  if (n % 75 === 0) return { ...base, estado_vital: 'muerto' as const, fecha_baja: '2026-08-05' };
  return base;
});
const VIVOS_378 = INDIVIDUOS_378.filter((i) => i.estado_vital === 'vivo').length;

function montar(individuoFocoId: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><EvaluacionAnualWorkspace plantaId="p1" codigoSistema="VISUAL-TEST" individuoFocoId={individuoFocoId} pestana="individuos" onIrAIndividuos={() => {}} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EvaluacionAnualWorkspace — virtualización del Explorador (Paso 4)', () => {
  it('carga inicial no afirma que no hay individuos y fallo del ranking no inventa pendientes', async () => {
    let resolver!: (items: Individuo[]) => void;
    mockListarIndividuos.mockReturnValue(new Promise<Individuo[]>((resolve) => { resolver = resolve; }));
    mockObtenerRanking.mockRejectedValue(new Error('detalle interno privado'));
    montar();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando individuos');
    expect(screen.queryByText(/todavía no tiene individuos/)).not.toBeInTheDocument();
    await act(async () => resolver(INDIVIDUOS_110.slice(0, 3)));
    await screen.findByRole('button', { name: 'Reintentar ranking' });
    expect(screen.getByText(/Pendientes de evaluación sin confirmar/)).toBeInTheDocument();
    expect(screen.queryByText('detalle interno privado')).not.toBeInTheDocument();
  });

  it('fallar actualización conserva el mismo input editado y permite reintentar solo individuos', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(qk.individuos.lista('p1'), INDIVIDUOS_110.slice(0, 3));
    client.setQueryData(qk.ranking.grupos({ plantaId: 'p1', especieId: undefined, incluirPruebas: false }), { items: [] });
    mockListarIndividuos.mockRejectedValue(new Error('secreto'));
    render(<QueryClientProvider client={client}><MemoryRouter><EvaluacionAnualWorkspace plantaId="p1" codigoSistema="TEST" pestana="individuos" onIrAIndividuos={() => {}} /></MemoryRouter></QueryClientProvider>);
    const input = await screen.findByLabelText('Edición abierta');
    fireEvent.change(input, { target: { value: 'Edición sin guardar' } });
    await act(async () => { await client.invalidateQueries({ queryKey: qk.individuos.lista('p1') }); });
    await screen.findByRole('button', { name: 'Reintentar individuos' });
    expect(screen.getByLabelText('Edición abierta')).toBe(input);
    expect(input).toHaveValue('Edición sin guardar');
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110.slice(0, 3));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar individuos' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reintentar individuos' })).not.toBeInTheDocument());
    expect(mockObtenerRanking).not.toHaveBeenCalled();
  });

  it('reduce altura con tres filas y al filtrar una, y anuncia el filtro activo', async () => {
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110.slice(0, 3));
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar();
    const fila = await screen.findByText('P1');
    const scroll = fila.closest('ul')!.parentElement!;
    expect(scroll.style.height).toBe('144px');
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar individuo por código' }), { target: { value: 'P2' } });
    expect((await screen.findByText('P2')).closest('ul')!.parentElement!.style.height).toBe('48px');
    const filtro = screen.getByRole('button', { name: 'Solo vivos' });
    expect(filtro).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(filtro);
    expect(filtro).toHaveAttribute('aria-pressed', 'true');
  });

  it('con 110 individuos, el recuadro no monta las 110 filas a la vez (solo la ventana visible + overscan)', async () => {
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110);
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar();

    await screen.findByText('Explorador de individuos');
    const filas = await screen.findAllByText(/^P\d+$/);
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.length).toBeLessThan(110);
  });

  it('S2-4: puntaje y «pendientes» salen del ranking por grupos; una evaluación excluida por revisión no es pendiente', async () => {
    const fila = (n: number, parcial: Record<string, unknown>) => ({
      individuo_id: `ind-${n}`, codigo_display: `VISUAL-TEST-P${n}`, grupo: ['fenologia'], posicion_grupo: null, tamano_grupo: null, puntaje: null, estado_ranking: 'sin_ronda', ...parcial,
    });
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110.slice(0, 4));
    mockObtenerRanking.mockResolvedValue({ items: [
      fila(1, { estado_ranking: 'comparable', puntaje: 0.8567, posicion_grupo: 1, tamano_grupo: 5 }),
      fila(2, { estado_ranking: 'excluida_revision' }),
      fila(3, { estado_ranking: 'pocas_plantas', puntaje: 0.41 }),
      fila(4, { estado_ranking: 'sin_ronda' }),
    ] });
    montar();
    await screen.findByText('P1');
    // Solo P4 (sin evaluación completa) está pendiente; P2 está evaluada aunque no tenga puntaje.
    expect(await screen.findByText(/1 pendiente de evaluación/)).toBeInTheDocument();
    expect(screen.getByText('85,7')).toBeInTheDocument();
    expect(screen.getByText('41,0')).toBeInTheDocument();
    expect(mockObtenerRanking).toHaveBeenCalledWith({ plantaId: 'p1', especieId: undefined, incluirPruebas: false });
  });

  it('la búsqueda por código sigue filtrando igual sobre la lista virtualizada', async () => {
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110);
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar();

    const buscador = await screen.findByPlaceholderText('Buscar código…');
    fireEvent.change(buscador, { target: { value: 'P37' } });

    expect(await screen.findByText('P37')).toBeInTheDocument();
    expect(screen.queryByText('P100')).not.toBeInTheDocument();
    expect(screen.queryByText('P1')).not.toBeInTheDocument();
  });

  it('Fase 5 (G14): el número exacto va primero, también si el número está en el código del cruce', async () => {
    // En el cruce 02-001, «2» está en el código del cruce: coinciden todas, y antes la primera era la P1.
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110.map((i) => ({ ...i, codigo_display: i.codigo_display.replace('VISUAL-TEST', '02-001') })));
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar();
    fireEvent.change(await screen.findByPlaceholderText('Buscar código…'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getAllByText(/^P\d+$/).slice(0, 3).map((e) => e.textContent)).toEqual(['P2', 'P12', 'P20']));
  });

});

/**
 * Descarga de etiquetas en tanda desde el Explorador (mismo flujo que ya
 * existe en IndividuosSeccion, sobre el componente virtualizado).
 *
 * Lo que hace distinto a este componente: la lista está virtualizada, así que
 * en cualquier momento hay ~16 filas montadas de 378. Los tests de acá existen
 * sobre todo para probar que la selección NO depende de qué filas estén
 * renderizadas — opera sobre los datos del cruce, no sobre el DOM.
 */
describe('EvaluacionAnualWorkspace — selección', () => {
  function montarConSeleccion(individuos = INDIVIDUOS_378) {
    mockListarIndividuos.mockResolvedValue(individuos);
    mockObtenerRanking.mockResolvedValue({ items: [] });
    return montar();
  }

  const entrarEnSeleccion = async () => {
    await screen.findByText('Explorador de individuos');
    fireEvent.click(screen.getByRole('button', { name: /^seleccionar$/i }));
  };

  it('activar el modo pone una casilla en cada fila montada, no en las 378', async () => {
    montarConSeleccion();
    await screen.findByText('Explorador de individuos');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^seleccionar$/i }));
    const casillas = screen.getAllByRole('checkbox');
    expect(casillas.length).toBeGreaterThan(0);
    expect(casillas.length).toBeLessThan(378); // sigue virtualizado con el modo activo
  });

  it('"Seleccionar todos los vivos" abarca el cruce completo, no solo las filas renderizadas', async () => {
    montarConSeleccion();
    await entrarEnSeleccion();

    // El universo elegible se calcula sobre los datos, no sobre el DOM: hay
    // ~16 filas montadas y aun así cuenta los 368 vivos de los 378.
    expect(screen.getByText(`Marca los individuos (${VIVOS_378} vivos disponibles)`)).toBeInTheDocument();
    expect(VIVOS_378).toBeLessThan(378); // el fixture sí trae individuos de baja

    fireEvent.click(screen.getByRole('button', { name: /seleccionar todos los vivos/i }));
    expect(screen.getByText(`${VIVOS_378} seleccionados`)).toBeInTheDocument();
  });

  it('un individuo de baja no es seleccionable aunque el filtro lo traiga a la vista', async () => {
    montarConSeleccion();
    await entrarEnSeleccion();
    fireEvent.click(screen.getByRole('button', { name: /seleccionar todos los vivos/i }));

    // P50 está descartado y vive fuera de la ventana virtualizada inicial:
    // se lo trae con el buscador para poder inspeccionar su casilla.
    fireEvent.change(screen.getByPlaceholderText('Buscar código…'), { target: { value: 'P50' } });
    const casillaBaja = await screen.findByRole('checkbox', { name: 'Seleccionar VISUAL-TEST-P50' });
    expect(casillaBaja).toBeDisabled();
    expect(casillaBaja).not.toBeChecked(); // "seleccionar todos" no lo alcanzó

    fireEvent.click(casillaBaja);
    expect(casillaBaja).not.toBeChecked();
    expect(screen.getByText(`${VIVOS_378} seleccionados`)).toBeInTheDocument(); // el conteo no se movió
  });

  it('la selección sobrevive al filtro de búsqueda (no se pierde lo que se desmonta)', async () => {
    montarConSeleccion();
    await entrarEnSeleccion();

    const buscador = screen.getByPlaceholderText('Buscar código…');
    fireEvent.change(buscador, { target: { value: 'P37' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar VISUAL-TEST-P37' }));
    expect(screen.getByText('1 seleccionado')).toBeInTheDocument();

    // P37 sale de la vista: su fila se desmonta, pero sigue seleccionado.
    fireEvent.change(buscador, { target: { value: 'P200' } });
    expect(screen.queryByRole('checkbox', { name: 'Seleccionar VISUAL-TEST-P37' })).not.toBeInTheDocument();
    expect(screen.getByText('1 seleccionado')).toBeInTheDocument();

    fireEvent.change(buscador, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^etiquetas$/i }));
    expect(await screen.findByText('Descargar etiquetas (1)')).toBeInTheDocument();
  });

  /**
   * El botón "seleccionar todos" respeta el filtro vigente. El caso que motivó
   * el cambio: buscar un código puntual esperando aislar unas pocas filas y que
   * el botón terminara marcando los 368 del cruce.
   */
  describe('alcance de "seleccionar todos" con filtro activo', () => {
    // "P5" hace match por substring de codigo_display: P5 y P50-P59 (P150 no,
    // porque su "P" va seguida de un 1). De esos, P50 está descartado.
    const CODIGOS_P5 = INDIVIDUOS_378.filter((i) => i.codigo_display.toLowerCase().includes('p5'));
    const VIVOS_P5 = CODIGOS_P5.filter((i) => i.estado_vital === 'vivo').length;

    it('con filtro activo selecciona solo los vivos que el filtro deja a la vista', async () => {
      montarConSeleccion();
      await entrarEnSeleccion();
      fireEvent.change(screen.getByPlaceholderText('Buscar código…'), { target: { value: 'P5' } });

      // El fixture tiene que hacer de este caso algo distinto del universo
      // completo, si no el test no probaría nada.
      expect(VIVOS_P5).toBeGreaterThan(0);
      expect(VIVOS_P5).toBeLessThan(VIVOS_378);
      expect(CODIGOS_P5.length).toBeGreaterThan(VIVOS_P5); // hay al menos un no vivo en el filtro

      // El botón dice exactamente a cuántos alcanza, y la barra explica el recorte.
      expect(await screen.findByText(new RegExp(`^El filtro deja ${VIVOS_P5} de ${VIVOS_378} vivos a la vista\.`))).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: `Seleccionar los ${VIVOS_P5} vivos a la vista` }));

      expect(screen.getByText(`${VIVOS_P5} seleccionados`)).toBeInTheDocument();
      expect(screen.queryByText(`${VIVOS_378} seleccionados`)).not.toBeInTheDocument();
    });

    it('borrar el filtro no pierde ni expande lo ya seleccionado', async () => {
      montarConSeleccion();
      await entrarEnSeleccion();
      fireEvent.change(screen.getByPlaceholderText('Buscar código…'), { target: { value: 'P5' } });
      fireEvent.click(await screen.findByRole('button', { name: `Seleccionar los ${VIVOS_P5} vivos a la vista` }));

      fireEvent.change(screen.getByPlaceholderText('Buscar código…'), { target: { value: '' } });
      expect(screen.getByText(`${VIVOS_P5} seleccionados`)).toBeInTheDocument();
      expect(screen.queryByText(/El filtro deja/)).not.toBeInTheDocument();
      // Y el botón vuelve a ofrecer el cruce completo, sin haberlo aplicado solo.
      expect(screen.getByRole('button', { name: /^seleccionar todos los vivos$/i })).toBeEnabled();
    });

    it('acumula entre búsquedas: una segunda selección no borra la primera', async () => {
      montarConSeleccion();
      await entrarEnSeleccion();
      const buscador = screen.getByPlaceholderText('Buscar código…');

      fireEvent.change(buscador, { target: { value: 'P5' } });
      fireEvent.click(await screen.findByRole('button', { name: `Seleccionar los ${VIVOS_P5} vivos a la vista` }));

      // P377 y P378 quedan fuera del filtro anterior.
      fireEvent.change(buscador, { target: { value: 'P37' } });
      const botonP37 = await screen.findByRole('button', { name: /Seleccionar los \d+ vivos a la vista/ });
      const vivosP37 = Number(/\d+/.exec(botonP37.textContent ?? '')?.[0]);
      fireEvent.click(botonP37);

      fireEvent.change(buscador, { target: { value: '' } });
      expect(screen.getByText(`${VIVOS_P5 + vivosP37} seleccionados`)).toBeInTheDocument();
    });

    it('sin filtro sigue seleccionando el cruce completo (sin regresión)', async () => {
      montarConSeleccion();
      await entrarEnSeleccion();
      expect(screen.queryByText(/El filtro deja/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^seleccionar todos los vivos$/i }));
      expect(screen.getByText(`${VIVOS_378} seleccionados`)).toBeInTheDocument();
    });
  });

  it('salir del modo selección limpia lo marcado y saca las casillas', async () => {
    montarConSeleccion();
    await entrarEnSeleccion();
    fireEvent.click(screen.getByRole('button', { name: /seleccionar todos los vivos/i }));

    fireEvent.click(screen.getByRole('button', { name: /^salir$/i }));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^seleccionar$/i }));
    expect(screen.getByText(`Marca los individuos (${VIVOS_378} vivos disponibles)`)).toBeInTheDocument();
  });
});

/**
 * Abierto desde la etiqueta de un individuo (`?individuo=`): el Explorador
 * selecciona ese individuo y desplaza la lista hasta su fila. Es equivalente a
 * tocar la fila: no ejecuta ninguna acción de escritura.
 */
describe('EvaluacionAnualWorkspace — abierto desde la etiqueta de un individuo (individuoFocoId)', () => {
  it('sin individuoFocoId selecciona el primero, como siempre', async () => {
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110);
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar();
    expect(await screen.findByLabelText('Individuo abierto')).toHaveTextContent('ind-1');
  });

  it('con individuoFocoId selecciona ese individuo (no el primero) y desplaza la lista hasta su fila', async () => {
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110);
    mockObtenerRanking.mockResolvedValue({ items: [] });
    const scrollToSpy = vi.spyOn(HTMLElement.prototype, 'scrollTo');
    montar('ind-60');
    expect(await screen.findByLabelText('Individuo abierto')).toHaveTextContent('ind-60');
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalled());
  });

  it('un individuo dado de baja también se selecciona (la lectura nunca se bloquea)', async () => {
    const lista = INDIVIDUOS_110.map((i) => (i.id === 'ind-7' ? { ...i, estado_vital: 'muerto' as const, fecha_baja: '2026-08-05' } : i));
    mockListarIndividuos.mockResolvedValue(lista);
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar('ind-7');
    expect(await screen.findByLabelText('Individuo abierto')).toHaveTextContent('ind-7');
  });

  it('un id que no es de este cruce se ignora y queda el primero', async () => {
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110);
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar('00000000-0000-0000-0000-000000000000');
    expect(await screen.findByLabelText('Individuo abierto')).toHaveTextContent('ind-1');
  });

  it('no pisa la selección posterior del usuario: elegir otra fila la respeta', async () => {
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110);
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar('ind-3');
    expect(await screen.findByLabelText('Individuo abierto')).toHaveTextContent('ind-3');
    fireEvent.click(await screen.findByText('P2'));
    expect(await screen.findByLabelText('Individuo abierto')).toHaveTextContent('ind-2');
  });
});

describe('EvaluacionAnualWorkspace — v3 paso 3: expediente como panel lateral (escritorio) u hoja (celular)', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });
  const comoCelular = () => {
    window.matchMedia = ((consulta: string) => ({
      matches: !consulta.includes('min-width: 768px'), media: consulta, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  };

  it('en escritorio el expediente está al lado de la lista, sin hoja', async () => {
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110.slice(0, 3));
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar();
    expect(await screen.findByLabelText('Individuo abierto')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('en el celular la lista queda visible y el expediente se abre en una hoja al tocar una fila', async () => {
    comoCelular();
    mockListarIndividuos.mockResolvedValue(INDIVIDUOS_110.slice(0, 3));
    mockObtenerRanking.mockResolvedValue({ items: [] });
    montar();
    const fila = await screen.findByText('P2');
    expect(screen.queryByLabelText('Individuo abierto')).not.toBeInTheDocument();
    fireEvent.click(fila.closest('button')!);
    const hoja = await screen.findByRole('dialog', { name: 'VISUAL-TEST-P2' });
    expect(within(hoja).getByLabelText('Individuo abierto')).toHaveTextContent('ind-2');
    expect(screen.getByText('P1')).toBeInTheDocument(); // la lista sigue ahí, debajo de la hoja
  });
});
