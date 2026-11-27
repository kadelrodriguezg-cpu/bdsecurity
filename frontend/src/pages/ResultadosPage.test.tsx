/** Resultados v3 (paso 7): tabla única con controles, panel del individuo, cambio, celular y otras vistas. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const m = vi.hoisted(() => ({
  esAdmin: true, escritorio: true, temporadas: vi.fn(async () => [] as unknown[]), ranking: vi.fn(), pesos: vi.fn(), metricas: vi.fn(), comparacion: vi.fn(), valores: vi.fn(), polinizacion: vi.fn(),
}));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: m.esAdmin }) }));
vi.mock('@/lib/useEsEscritorio', () => ({ useEsEscritorio: () => m.escritorio }));
vi.mock('@/features/especies/EspacioEspecie', async () => (await import('@/features/especies/espacioDePrueba')).moduloEspacioDePrueba());
vi.mock('@/api/especies', () => ({ listarEspecies: vi.fn(async () => [{ id: 'esp', nombre: 'Arándano', nombre_cientifico: null }]) }));
vi.mock('@/api/plantas', () => ({ listarPlantas: vi.fn(async () => [{ id: 'c1', codigo_sistema: '02-502', especie_id: 'esp', es_prueba: false }]) }));
vi.mock('@/api/rankingGrupos', async (original) => ({
  ...(await original<typeof import('@/api/rankingGrupos')>()),
  obtenerRankingPorGrupos: m.ranking, obtenerValoresParametros: m.valores, congelarRankingGrupos: vi.fn(),
  listarTemporadasEspecie: () => m.temporadas(),
}));
vi.mock('@/api/resultados', async (original) => ({ ...(await original<typeof import('@/api/resultados')>()), obtenerPesosCategorias: m.pesos, obtenerMetricasVersion: m.metricas }));
vi.mock('@/api/comparacion', async (original) => ({ ...(await original<typeof import('@/api/comparacion')>()), obtenerComparacionRondas: m.comparacion }));
vi.mock('@/api/snapshots', () => ({ listarSnapshotsRanking: vi.fn(async () => ({ items: [] })), obtenerDetalleSnapshot: vi.fn(), obtenerCoberturaSnapshot: vi.fn(), compararSnapshotVivo: vi.fn() }));
vi.mock('@/api/rondas', () => ({ obtenerEvaluacion: vi.fn(async () => ({ evaluador: 'M. Soto' })) }));
vi.mock('@/features/visualizacion/TerritorialMap', () => ({ TerritorialMap: () => null }));
vi.mock('@/api/rankingPolinizacion', () => ({ obtenerRankingPolinizacionVarietal: m.polinizacion }));
const exportar = vi.hoisted(() => ({ descargar: vi.fn() }));
vi.mock('@/features/resultados/exportar', async (original) => ({ ...(await original<typeof import('@/features/resultados/exportar')>()), descargarCsv: exportar.descargar }));

import { ResultadosPage } from './ResultadosPage';
import { MapaTerritorialPage, PolinizacionVariedadPage } from './resultados/OtrasVistasPages';
import { RedireccionRanking } from '@/router/redirecciones';
import { fijarEspacioDePrueba, reiniciarEspacioDePrueba } from '@/features/especies/espacioDePrueba';

const ARANDANO = { id: 'esp', nombre: 'Arándano', nombre_cientifico: null };

const TODAS = ['estres', 'fenologia', 'fruto_calidad', 'produccion'];
const item = (n: number, extra: Record<string, unknown> = {}) => ({
  individuo_id: `i${n}`, codigo_display: `02-502-P${n}`, planta_id: 'c1', codigo_sistema: '02-502', especie_id: 'esp', es_prueba: false,
  evaluacion_id: `e${n}`, fecha_evaluacion: '2026-10-14', numero_ronda: 2, requiere_revision: false, no_comparable: false, tiene_metrica_marcada: false,
  puntaje: 0.7 - n / 100, grupo: TODAS, cobertura: {}, detalle_categorias: { fruto_calidad: 0.77, produccion: 0.71, fenologia: 0.75, estres: 0.45 },
  estado_ranking: 'comparable', tamano_grupo: 3, posicion_grupo: n, ...extra,
});
const RANKING = {
  scoring_version_id: 'v1', scoring_version_nombre: 'v1 provisional', minimo_evaluaciones_grupo: 3, cobertura_advertencia: 0.5,
  poblacion: {}, grupos: [],
  items: [item(1), item(2), item(3), item(4, { estado_ranking: 'excluida_revision', puntaje: null, posicion_grupo: null }), item(5, { estado_ranking: 'sin_evaluacion', puntaje: null, posicion_grupo: null })],
};
const PESOS = [{ categoria: 'fruto_calidad', peso: 0.4 }, { categoria: 'produccion', peso: 0.3 }, { categoria: 'fenologia', peso: 0.2 }, { categoria: 'estres', peso: 0.1 }];

function Ubicacion() { const l = useLocation(); return <output data-testid="url">{l.pathname}{l.search}</output>; }
function montar(url = '/resultados', element = <ResultadosPage />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/resultados" element={<>{element}<Ubicacion /></>} />
          <Route path="/resultados/mapa" element={<MapaTerritorialPage />} />
          <Route path="/resultados/polinizacion" element={<><PolinizacionVariedadPage /><Ubicacion /></>} />
          <Route path="/ranking" element={<RedireccionRanking />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Fase 4: la especie es la del encabezado.
  fijarEspacioDePrueba({ activa: ARANDANO, especies: [ARANDANO], parametro: 'arandano' });
  m.ranking.mockResolvedValue(RANKING);
  m.pesos.mockResolvedValue(PESOS);
  m.metricas.mockResolvedValue([{ metrica: 'brix', categoria: 'fruto_calidad', peso: 1 }]);
  m.valores.mockResolvedValue({ i1: { brix: { valor: 15.1 } }, i2: { brix: { valor: 11 } }, i3: { brix: { valor: 13.5 } } });
  m.comparacion.mockResolvedValue({ umbrales: { leve: 0.05, marcado: 0.15 }, individuos: [{ individuo_id: 'i1', codigo_display: 'x', tipo_ronda: 'anual', numero_anterior: 1, numero_actual: 2, deltas_parametro: [], deltas_categoria: [{ categoria: 'fruto_calidad', valor_anterior: 0.5, valor_actual: 0.77, delta: 0.27, etiqueta: 'mejoro_marcado' }] }] });
  m.polinizacion.mockResolvedValue({ filas: [{ variedad_id: 'v1', variedad_nombre: 'Variedad A', flores_totales: 412, sesiones_polinizacion: 38, cruces_distintos: 9 }], resumen: { flores_reales: 1284 } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); m.esAdmin = true; m.escritorio = true; reiniciarEspacioDePrueba(); });

describe('Resultados — escritorio', () => {
  it('una tabla: frase, categorías ordenadas por peso (sin mostrar el peso), puntaje en puntos y plegado al final', async () => {
    montar();
    // Los pesos llegan en otra lectura: se espera a que la frase los tenga.
    await waitFor(() => expect(screen.getByText(/Comparando/)).toHaveTextContent('Comparando 3 individuos que tienen las 4 categorías evaluadas.'));
    const tabla = screen.getByRole('table');
    const encabezados = within(tabla).getAllByRole('columnheader').map((th) => th.textContent);
    expect(encabezados.slice(3, 7)).toEqual(['Fruto/Calidad', 'Producción', 'Fenología', 'Estrés']);
    expect(within(tabla).queryByText(/peso/i)).not.toBeInTheDocument(); // «peso N» confundía: los pesos van en «Cómo se calcula»
    expect(within(tabla).getAllByRole('row')).toHaveLength(4); // encabezado + 3 del grupo
    expect(within(tabla).getByRole('row', { name: /02-502-P1/ })).toHaveTextContent('1 de 3');
    expect(within(tabla).getByRole('row', { name: /02-502-P1/ })).toHaveTextContent('69,0');
    expect(screen.getByText(/Excluidas por revisión \(1\) · Sin puntaje \(1\) · En otros grupos \(0\)/)).toBeInTheDocument();
    expect(screen.getByText('1 por revisión')).toBeInTheDocument();
    expect(screen.queryByText(/%/, { selector: 'td' })).not.toBeInTheDocument();
  });

  it('una quinta categoría en la versión aparece sola como columna', async () => {
    m.pesos.mockResolvedValue([...PESOS, { categoria: 'brotes_varas', peso: 0.16 }]);
    m.ranking.mockResolvedValue({ ...RANKING, items: [item(1, { grupo: [...TODAS, 'brotes_varas'], detalle_categorias: { ...item(1).detalle_categorias, brotes_varas: 0.58 } })] });
    montar();
    expect(await screen.findByRole('columnheader', { name: /Brotes varas/ })).toBeInTheDocument();
    expect(screen.getByText(/las 5 categorías/)).toBeInTheDocument();
  });

  it('panel lateral: «De dónde salen los N puntos» con valor × peso = puntos y los botones al expediente y la ficha', async () => {
    montar();
    const panel = await screen.findByRole('complementary', { name: 'Individuo elegido' });
    expect(await within(panel).findByText('De dónde salen los 69,0 puntos')).toBeInTheDocument();
    expect(within(panel).getByText('Cómo se calcula este puntaje').closest('details')).not.toHaveAttribute('open'); // plegado por omisión
    expect(within(panel).getByText(/77 × 40%/)).toBeInTheDocument();
    expect(within(panel).getByText('30,8 pts')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Abrir expediente' })).toHaveAttribute('href', '/planta/c1?pestana=individuos&individuo=i1');
    expect(within(panel).getByRole('link', { name: 'Ver ficha' })).toHaveAttribute('href', '/planta/c1');
    fireEvent.click(screen.getByRole('button', { name: '02-502-P2' }));
    expect(screen.getByTestId('url')).toHaveTextContent('individuo=i2');
  });

  it('cambio: con toda la especie el interruptor está apagado y se explica; con un cruce aparece la columna', async () => {
    montar();
    const interruptor = await screen.findByRole('switch');
    expect(interruptor).toBeDisabled();
    expect(screen.getByText(/se calcula por cruce: elige un cruce/)).toBeInTheDocument();
    cleanup();
    montar('/resultados?cruce=c1&cambio=1');
    expect(await screen.findByRole('columnheader', { name: /Cambio vs. Ronda 1/ })).toBeInTheDocument();
    const fila = await screen.findByRole('row', { name: /02-502-P1/ });
    await waitFor(() => expect(fila).toHaveTextContent('+27,0·Mejoró marcado')); // flecha + número + texto, nunca solo color
    expect(m.comparacion).toHaveBeenCalledWith({ plantaId: 'c1' });
  });

  it('+ Columnas: agrega Brix con filtro ≥ y la tabla se filtra; el estado queda en la URL', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Columnas/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Columnas' });
    fireEvent.click(await within(hoja).findByRole('checkbox', { name: 'Brix' }));
    fireEvent.change(within(hoja).getByLabelText('Valor del filtro de Brix'), { target: { value: '13' } });
    fireEvent.click(within(hoja).getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('cols=brix'));
    expect(screen.getByTestId('url')).toHaveTextContent('f=brix%3Age%3A13');
    const tabla = await screen.findByRole('table');
    await waitFor(() => expect(within(tabla).getAllByRole('row')).toHaveLength(3)); // P1 (15,1) y P3 (13,5)
    expect(within(tabla).getByText('15,1')).toBeInTheDocument();
  });

  it('el operario no ve Polinización por variedad entre las otras vistas', async () => {
    m.esAdmin = false;
    montar();
    const vistas = await screen.findByRole('navigation', { name: 'Otras vistas' });
    await waitFor(() => expect(within(vistas).getByRole('link', { name: 'Mapa territorial' })).toHaveAttribute('href', '/resultados/mapa?especie=arandano'));
    expect(within(vistas).queryByText(/Polinización/)).not.toBeInTheDocument();
  });
});

describe('Resultados — celular', () => {
  it('lista simple sin categorías; al tocar se abre la hoja con el mismo panel', async () => {
    m.escritorio = false;
    montar();
    const fila = await screen.findByRole('button', { name: /02-502-P1/ });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(fila).not.toHaveTextContent('77');
    fireEvent.click(fila);
    const hoja = await screen.findByRole('dialog', { name: '02-502-P1' });
    expect(await within(hoja).findByText('De dónde salen los 69,0 puntos')).toBeInTheDocument();
  });
});

describe('Otras vistas y redirecciones', () => {
  it('Polinización por variedad: solo admin, sin columna «#» y con la etiqueta de linaje confidencial', async () => {
    montar('/resultados/polinizacion?especie=esp');
    expect(await screen.findByText('Linaje confidencial · solo admin')).toBeInTheDocument();
    const tabla = await screen.findByRole('table');
    expect(within(tabla).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Variedad parental', 'Flores asociadas', 'Sesiones', 'Cruces distintos']);
    expect(screen.getByText('1.284')).toBeInTheDocument();
  });

  it('el operario que entra a Polinización vuelve a Resultados', async () => {
    m.esAdmin = false;
    montar('/resultados/polinizacion?especie=esp');
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/resultados'));
    expect(m.polinizacion).not.toHaveBeenCalled();
  });

  it('/ranking con sus parámetros viejos lleva al estado equivalente de Resultados', async () => {
    montar('/ranking?tab=comparacion&especie=esp&cruce=c1');
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/resultados?especie=esp&cruce=c1&cambio=1'));
  });
});

describe('Resultados — paso 8', () => {
  const conRondas = (rondas: Array<{ numero: number; individuos: number; con_cerrada: number }>) => (alcance: { numeroRonda?: number }) => Promise.resolve({ ...RANKING, rondas, numero_ronda: alcance.numeroRonda ?? null });

  it('N38: la ronda por defecto es la última temporada cerrada; «la última evaluación de cada individuo» queda como opción y avisa en lenguaje de uso', async () => {
    m.ranking.mockImplementation(conRondas([{ numero: 1, individuos: 229, con_cerrada: 229 }, { numero: 2, individuos: 40, con_cerrada: 40 }]));
    montar();
    const selector = await screen.findByRole('combobox', { name: 'Ronda (temporada)' });
    await waitFor(() => expect(selector).toHaveValue('1'));
    expect(within(selector).getAllByRole('option').map((o) => o.textContent)).toEqual(['Ronda 2 · en curso', 'Ronda 1 · cerrada', 'La última evaluación de cada individuo']);
    await waitFor(() => expect(m.ranking).toHaveBeenCalledWith(expect.objectContaining({ especieId: 'esp', numeroRonda: 1 })));
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('Mostrar cambio vs. ronda anterior')).toBeInTheDocument(); // nunca «Ronda 0»
    expect(screen.getByText('La ronda 1 no tiene una ronda anterior con qué comparar.')).toBeInTheDocument();
    expect(screen.queryByText(/pueden ser de temporadas distintas/)).not.toBeInTheDocument();
    fireEvent.change(selector, { target: { value: 'ultima' } });
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('ronda=ultima'));
    expect(await screen.findByText('Mostrando la última evaluación de cada individuo (pueden ser de temporadas distintas).', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(/mezcla/i)).not.toBeInTheDocument(); // sin jerga interna
  });

  it('N38: sin temporada cerrada se muestra la última de cada individuo y se dice por qué', async () => {
    m.ranking.mockImplementation(conRondas([{ numero: 1, individuos: 3, con_cerrada: 3 }]));
    montar();
    expect(await screen.findByText(/Aún no hay una temporada cerrada en esta especie/)).toBeInTheDocument();
    expect(screen.getByText(/Mostrando la última evaluación de cada individuo \(pueden ser de temporadas distintas\)/)).toBeInTheDocument();
    expect(m.ranking).not.toHaveBeenCalledWith(expect.objectContaining({ numeroRonda: expect.any(Number) }));
  });

  it('el cambio no se inventa: sin la ronda anterior dice «Sin ronda anterior», no «0,0 · Estable»', async () => {
    montar('/resultados?cruce=c1&cambio=1&ronda=ultima');
    const fila = await screen.findByRole('row', { name: /02-502-P2/ });
    await waitFor(() => expect(fila).toHaveTextContent('Sin ronda anterior'));
    expect(fila).not.toHaveTextContent('Estable');
  });

  it('N36: «Exportar» solo para el admin y descarga un CSV con ronda y fecha en el nombre (la versión solo va dentro del archivo)', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Exportar/ }));
    expect(exportar.descargar).toHaveBeenCalledTimes(1);
    const [nombre, contenido] = exportar.descargar.mock.calls[0] as [string, string];
    expect(nombre).toMatch(/^resultados_arandano_ultima_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(contenido).toContain('Versión de puntaje: v1 provisional');
    expect(contenido).toContain('02-502-P1;02-502;2;2026-10-14;0,69;69,0');
    cleanup();
    m.esAdmin = false;
    montar();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Exportar/ })).not.toBeInTheDocument();
  });
});


describe('Resultados — versión de 5 categorías (scoring v2, con la categoría brotes)', () => {
  const CINCO = ['fenologia', 'fruto_calidad', 'produccion', 'brotes', 'estres']; // la base entrega el grupo en orden del enum
  const PESOS5 = [{ categoria: 'fruto_calidad', peso: 0.4 }, { categoria: 'produccion', peso: 0.3 }, { categoria: 'fenologia', peso: 0.15 }, { categoria: 'brotes', peso: 0.1 }, { categoria: 'estres', peso: 0.05 }];
  const detalle5 = { fruto_calidad: 0.77, produccion: 0.71, fenologia: 0.75, brotes: 0.4, estres: 0.45 };

  it('con brotes en los datos: aparece sola como columna, en orden de peso, y la frase dice «las 5 categorías»; los pesos van solo en «Cómo se calcula»', async () => {
    m.pesos.mockResolvedValue(PESOS5);
    m.ranking.mockResolvedValue({ ...RANKING, scoring_version_nombre: 'v2', items: [1, 2, 3].map((n) => item(n, { grupo: CINCO, detalle_categorias: detalle5 })) });
    montar();
    await waitFor(async () => expect(await screen.findByText(/Comparando/)).toHaveTextContent('Comparando 3 individuos que tienen las 5 categorías evaluadas.'));
    const encabezados = within(screen.getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent);
    expect(encabezados.slice(3, 8)).toEqual(['Fruto/Calidad', 'Producción', 'Fenología', 'Brotes y varas', 'Estrés']);
    expect(screen.getByText(/Fruto\/Calidad 40 % · Producción 30 % · Fenología 15 % · Brotes y varas 10 % · Estrés 5 %/)).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByRole('row', { name: /02-502-P1/ })).toHaveTextContent(/77.*71.*75.*40.*45/); // Fruto, Producción, Fenología, Brotes y varas, Estrés
  });

  it('el desglose del panel incluye Brotes y varas con su peso', async () => {
    m.pesos.mockResolvedValue(PESOS5);
    m.ranking.mockResolvedValue({ ...RANKING, items: [1, 2, 3].map((n) => item(n, { grupo: CINCO, detalle_categorias: detalle5 })) });
    montar();
    const panel = await screen.findByRole('complementary', { name: 'Individuo elegido' });
    expect(await within(panel).findByText(/40 × 10%/)).toBeInTheDocument();
  });

  it('con una versión de 5 categorías pero un grupo sin brotes (no se midió): sin esa columna y con los nombres en orden de peso', async () => {
    m.pesos.mockResolvedValue(PESOS5);
    m.ranking.mockResolvedValue(RANKING); // 3 individuos con las 4 categorías de siempre, sin brotes
    montar();
    await waitFor(async () => expect(await screen.findByText(/Comparando/)).toHaveTextContent('Comparando 3 individuos que tienen las categorías Fruto/Calidad, Producción, Fenología, Estrés evaluadas.'));
    const encabezados = within(screen.getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent);
    expect(encabezados.some((t) => t?.startsWith('Brotes'))).toBe(false);
  });

  it('con la versión v1 de 4 categorías, nada cambia: no se pide ni se muestra brotes', async () => {
    montar();
    await waitFor(async () => expect(await screen.findByText(/Comparando/)).toHaveTextContent('tienen las 4 categorías evaluadas.'));
    expect(screen.queryByText(/Brotes/)).not.toBeInTheDocument();
  });
});

describe('Resultados — textos pensados para quien usa la app (admin y operario)', () => {
  const textoPantalla = () => document.body.textContent ?? '';

  it('el admin ve «Cómo se calcula» plegado, con los pesos y sin el nombre de la versión de puntaje', async () => {
    montar();
    await screen.findByRole('table');
    const resumen = await screen.findByText('Cómo se calcula');
    const detalles = resumen.closest('details') as HTMLDetailsElement;
    expect(detalles).not.toHaveAttribute('open'); // cerrado por omisión
    expect(detalles).toHaveTextContent('El puntaje va de 0 a 100. Cada categoría aporta según su peso: Fruto/Calidad 40 % · Producción 30 % · Fenología 20 % · Estrés 10 %.');
    // Ni la línea de siempre arriba de la tabla («Puntaje de 0 a 100 · versión «…»») ni el nombre de la versión.
    expect(textoPantalla()).not.toMatch(/provisional|versión «|v1 provisional/i);
    expect(screen.queryByText(/Puntaje de 0 a 100 ·/)).not.toBeInTheDocument();
  });

  it('el admin ve cómo se reparten los pesos dentro del grupo cuando faltan categorías', async () => {
    m.ranking.mockResolvedValue({ ...RANKING, items: [1, 2, 3].map((n) => item(n, { grupo: ['fenologia', 'fruto_calidad'] })) });
    montar();
    await screen.findByRole('table');
    expect((await screen.findByText('Cómo se calcula')).closest('details')).toHaveTextContent('En este grupo solo cuentan las categorías evaluadas, así que sus pesos se reparten así: Fruto/Calidad 67 % · Fenología 33 %.');
    const encabezados = within(screen.getByRole('table')).getAllByRole('columnheader').map((th) => th.textContent);
    expect(encabezados.slice(3, 5)).toEqual(['Fruto/Calidad', 'Fenología']); // sin «pesa N %» en la tabla
  });

  it('el operario no ve pesos, ni «Cómo se calcula», ni el nombre de la versión, ni el desglose del panel', async () => {
    m.esAdmin = false;
    montar();
    const panel = await screen.findByRole('complementary', { name: 'Individuo elegido' });
    await within(panel).findByRole('link', { name: 'Abrir expediente' });
    await screen.findByRole('columnheader', { name: 'Fruto/Calidad' }); // los pesos ya cargaron: lo que sigue no es una ausencia vacía
    expect(screen.queryByText(/Cómo se calcula/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/De dónde salen/)).not.toBeInTheDocument();
    expect(textoPantalla()).not.toMatch(/provisional|peso|× \d+%|Puntaje de 0 a 100|\d+ %|v1/i);
    expect(within(panel).getByText('69,0')).toBeInTheDocument(); // el puntaje, el puesto y la mediana sí
  });

  it('en el celular: el operario no ve lo interno y el admin lo ve plegado', async () => {
    m.escritorio = false;
    m.esAdmin = false;
    montar();
    await screen.findByRole('button', { name: /02-502-P1/ });
    await waitFor(() => expect(m.pesos).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30)); // deja que los pesos lleguen: si el operario los viera, ya estarían en pantalla
    expect(screen.queryByText(/Cómo se calcula/)).not.toBeInTheDocument();
    expect(textoPantalla()).not.toMatch(/provisional|peso|Puntaje de 0 a 100|v1/i);
    cleanup();
    m.esAdmin = true;
    montar();
    await screen.findByRole('button', { name: /02-502-P1/ });
    const detalles = (await screen.findByText('Cómo se calcula')).closest('details');
    expect(detalles).not.toHaveAttribute('open');
    expect(detalles).toHaveTextContent('Fruto/Calidad 40 %');
  });

  it('Mapa territorial: el subtítulo habla de qué se ve, no de quién lo ve', async () => {
    montar('/resultados/mapa?especie=esp');
    expect(await screen.findByText('Dónde están los cruces y sus individuos, con su ubicación exacta.')).toBeInTheDocument();
    cleanup();
    m.esAdmin = false;
    montar('/resultados/mapa?especie=esp');
    expect(await screen.findByText('Dónde están los cruces y sus individuos, por sitio, predio y sector.')).toBeInTheDocument();
    expect(textoPantalla()).not.toMatch(/operario|admin/i);
  });
});

describe('Resultados dentro de la especie del encabezado (fase 4)', () => {
  it('ya no tiene selector de especie propio: lee la especie activa', async () => {
    montar();
    expect(await screen.findByText(/Comparando/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Especie')).not.toBeInTheDocument();
    expect(m.ranking).toHaveBeenCalledWith(expect.objectContaining({ especieId: 'esp' }));
  });

  it('con «Todas las especies» invita a entrar a una especie y no pide ranking', async () => {
    fijarEspacioDePrueba({ activa: null, parametro: 'todas' });
    montar();
    expect(screen.getByRole('heading', { name: 'Resultados' })).toBeInTheDocument();
    expect(screen.getByText(/Los resultados se leen por especie/)).toBeInTheDocument();
    expect(m.ranking).not.toHaveBeenCalled();
  });
});

describe('Resultados — hallazgo 10', () => {
  it('el admin ve «Congelar el ranking actual» en vivo, sin cambiar antes a «Congelado…»; el operario no', async () => {
    montar();
    expect(await screen.findByRole('button', { name: /Congelar el ranking actual/ })).toBeInTheDocument();
    cleanup();
    m.esAdmin = false;
    montar();
    await screen.findByRole('button', { name: 'En vivo' });
    expect(screen.queryByRole('button', { name: /Congelar el ranking actual/ })).toBeNull();
  });
});

describe('Resultados — hallazgo 2 (G2)', () => {
  it('el selector de temporada dice la temporada de julio a junio de cada ronda', async () => {
    m.temporadas.mockResolvedValue([
      { planta_id: null, tipo_ronda: 'anual', numero_ronda: 1, etiqueta: '2025-2026' },
      { planta_id: null, tipo_ronda: 'anual', numero_ronda: 2, etiqueta: '2026-2027' },
    ]);
    m.ranking.mockImplementation((alcance: { numeroRonda?: number }) => Promise.resolve({ ...RANKING, rondas: [{ numero: 1, individuos: 229, con_cerrada: 229 }, { numero: 2, individuos: 40, con_cerrada: 40 }], numero_ronda: alcance.numeroRonda ?? null }));
    montar();
    const selector = await screen.findByRole('combobox', { name: 'Ronda (temporada)' });
    await waitFor(() => expect(within(selector).getAllByRole('option').map((o) => o.textContent)).toEqual(['Ronda 2 · 2026-2027 · en curso', 'Ronda 1 · 2025-2026 · cerrada', 'La última evaluación de cada individuo']));
  });
});

describe('Resultados — fase 5, segunda parte: edad y tardías (G7, G8)', () => {
  it('«Año N» va junto al puntaje en la tabla y en el panel lateral (edad = temporada de evaluación anual)', async () => {
    montar();
    const tabla = await screen.findByRole('table');
    expect(within(tabla).getByRole('row', { name: /02-502-P1/ })).toHaveTextContent('Año 2');
    const panel = await screen.findByRole('complementary', { name: 'Individuo elegido' });
    expect(within(panel).getByText(/Año 2/)).toBeInTheDocument();
  });

  it('en el celular, «Año N» también va junto al puntaje', async () => {
    m.escritorio = false;
    montar();
    const fila = await screen.findByRole('button', { name: /02-502-P1/ });
    expect(fila).toHaveTextContent('Año 2');
  });

  it('el filtro «Tardías (enero o después)» deja solo precocidad 1 o 2, y queda en la URL', async () => {
    m.valores.mockResolvedValue({ i1: { precocidad: { valor: 2 } }, i2: { precocidad: { valor: 4 } }, i3: { precocidad: { valor: 1 } } });
    montar();
    const boton = await screen.findByRole('button', { name: 'Tardías (enero o después)' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(boton);
    expect(screen.getByTestId('url')).toHaveTextContent('tardias=1');
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3));
    const tabla = screen.getByRole('table');
    expect(within(tabla).getByRole('row', { name: /02-502-P1/ })).toBeInTheDocument();
    expect(within(tabla).getByRole('row', { name: /02-502-P3/ })).toBeInTheDocument();
    expect(within(tabla).queryByRole('row', { name: /02-502-P2/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tardías (enero o después)' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Resultados — fase 5, segunda parte: selector de cruce con buscador (G17)', () => {
  it('se escribe para filtrar; «Toda la especie» primero; elegir cambia la URL', async () => {
    const { listarPlantas } = await import('@/api/plantas');
    vi.mocked(listarPlantas).mockResolvedValue([
      { id: 'c3', codigo_sistema: '02-080', especie_id: 'esp', es_prueba: false },
      { id: 'c1', codigo_sistema: '02-502', especie_id: 'esp', es_prueba: false },
      { id: 'c2', codigo_sistema: '02-007', especie_id: 'esp', es_prueba: false },
    ] as never);
    montar();
    const combo = await screen.findByRole('combobox', { name: 'Cruce' });
    expect(combo).toHaveValue('Toda la especie');
    fireEvent.focus(combo);
    await waitFor(() => expect(within(screen.getByRole('listbox', { name: 'Cruce' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Toda la especie', '02-007', '02-080', '02-502']));
    fireEvent.change(combo, { target: { value: '07' } });
    expect(within(screen.getByRole('listbox', { name: 'Cruce' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['02-007']);
    fireEvent.keyDown(combo, { key: 'Enter' });
    expect(screen.getByTestId('url')).toHaveTextContent('cruce=c2');
  });
});

describe('Resultados — fase 5, segunda parte: paginación numerada (G18)', () => {
  const muchos = Array.from({ length: 60 }, (_, i) => item(i + 1, { tamano_grupo: 60, puntaje: 0.9 - i / 1000 }));

  it('escritorio: «Mostrando 1–50 de 60», números y la página en la URL; cambiar el orden vuelve a la 1', async () => {
    m.ranking.mockResolvedValue({ ...RANKING, items: muchos });
    montar();
    expect(await screen.findByText('Mostrando 1–50 de 60')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Página 2' }));
    expect(screen.getByTestId('url')).toHaveTextContent('pag=2');
    expect(screen.getByText('Mostrando 51–60 de 60')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(11);
    fireEvent.click(screen.getByRole('button', { name: 'Tardías (enero o después)' }));
    await waitFor(() => expect(screen.getByTestId('url')).not.toHaveTextContent('pag='));
  });

  it('celular: «‹ Página 1 de 2 ›»', async () => {
    m.escritorio = false;
    m.ranking.mockResolvedValue({ ...RANKING, items: muchos });
    montar();
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
  });
});

describe('Resultados — fase 5, segunda parte: empates y alcance del puesto (G19, G20)', () => {
  const EMPATE = { ...RANKING, items: [item(1), item(2), item(3, { posicion_grupo: 2, puntaje: 0.68 })] };

  it('los empates se marcan: «2 de 3 · empatado con 1» en la tabla y en el panel', async () => {
    m.ranking.mockResolvedValue(EMPATE);
    montar('/resultados?individuo=i2');
    const tabla = await screen.findByRole('table');
    expect(within(tabla).getByRole('row', { name: /02-502-P2/ })).toHaveTextContent('2 de 3 · empatado con 1');
    expect(within(tabla).getByRole('row', { name: /02-502-P1/ })).not.toHaveTextContent('empatado');
    const panel = await screen.findByRole('complementary', { name: 'Individuo elegido' });
    expect(within(panel).getByText(/empatado con 1/)).toBeInTheDocument();
  });

  it('el puesto dice su alcance: «en Arándano» con toda la especie y «dentro del cruce 02-502» con un cruce', async () => {
    montar('/resultados?individuo=i1');
    const panel = await screen.findByRole('complementary', { name: 'Individuo elegido' });
    expect(within(panel).getByText(/puesto 1 de 3 en Arándano/)).toBeInTheDocument();
    cleanup();
    montar('/resultados?cruce=c1&individuo=i1');
    const panelCruce = await screen.findByRole('complementary', { name: 'Individuo elegido' });
    await waitFor(() => expect(within(panelCruce).getByText(/puesto 1 de 3 dentro del cruce 02-502/)).toBeInTheDocument());
  });
});
