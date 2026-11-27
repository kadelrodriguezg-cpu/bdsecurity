import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaluacionPasadaPage } from './EvaluacionPasadaPage';

const m = vi.hoisted(() => ({ evaluacion: vi.fn(), estados: vi.fn(), ranking: vi.fn(), esAdmin: false, correcciones: vi.fn(), corregir: vi.fn(), pedir: vi.fn(), pedidos: vi.fn(), usuario: 'u-autor' }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: m.esAdmin, user: { id: m.usuario } }) }));
vi.mock('@/api/correcciones', () => ({ obtenerCorrecciones: m.correcciones, corregirEvaluacion: m.corregir, pedirCorreccion: m.pedir, pedidosDeEvaluacion: m.pedidos }));
vi.mock('@/api/rondas', () => ({ obtenerEvaluacion: m.evaluacion }));
vi.mock('@/api/protocolo', () => ({ obtenerEstadosEvaluacion: m.estados }));
vi.mock('@/api/rankingGrupos', async (original) => ({ ...(await original<typeof import('@/api/rankingGrupos')>()), obtenerRankingPorGrupos: m.ranking }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));

const protocolo = { id: 'p1', version: 1, nombre: 'Ronda 1 anual', created_at: '2026-10-01T00:00:00Z', descriptores: { brotacion: 'obligatorio', floracion: 'obligatorio', calibre_mm: 'opcional' } };

beforeEach(() => {
  m.correcciones.mockResolvedValue([]);
  m.pedidos.mockResolvedValue([]);
  m.pedir.mockResolvedValue('pc1');
  m.evaluacion.mockResolvedValue({
    id: 'e1', estado: 'completa', fecha: '2026-10-20', anio: 2026, evaluador: 'Equipo', observaciones: null, updated_at: '2026-10-20T12:00:00Z', ronda_id: 'r1',
    requiere_revision: false, no_comparable: false, sin_muestra: false, brotacion: 4, calibre_mm: 45,
    ronda: { numero_ronda: 1, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  m.estados.mockResolvedValue({ evaluacion_id: 'e1', protocolo, estados: { brotacion: 'medido', floracion: 'falto', calibre_mm: 'marcado' } });
  m.ranking.mockResolvedValue({
    minimo_evaluaciones_grupo: 5, cobertura_advertencia: 0.5,
    items: [{ individuo_id: 'i1', especie_id: 'esp', evaluacion_id: 'e1', estado_ranking: 'excluida_revision', grupo: ['fenologia'], puntaje: null, posicion_grupo: null, tamano_grupo: null, numero_ronda: 1 }],
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); m.esAdmin = false; m.usuario = 'u-autor'; });

const montarLectura = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/planta/p/evaluacion/e1']}>
      <Routes><Route path="/planta/:id/evaluacion/:evaluacionId" element={<EvaluacionPasadaPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);

it('muestra la evaluación con faltantes, marcados, el ranking actual y el protocolo', async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/planta/p/evaluacion/e1']}>
        <Routes><Route path="/planta/:id/evaluacion/:evaluacionId" element={<EvaluacionPasadaPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: '90-901-P10' })).toBeInTheDocument();
  const conjunto = screen.getByRole('region', { name: 'Conjunto evaluado' });
  expect(await within(conjunto).findByText('2 de 3 descriptores del protocolo')).toBeInTheDocument();
  expect(conjunto).toHaveTextContent('Faltó Floración, que era obligatorio en esta ronda');
  const fenologia = screen.getByRole('region', { name: 'Fenología' });
  expect(within(fenologia).getByText('Falta · era obligatorio')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Fruto / Calidad' })).getByText('Revisar')).toBeInTheDocument();
  expect(await screen.findByText('Excluida por revisión.')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Protocolo de esta ronda' })).toHaveTextContent('Obligatorio: Fenología.');
  expect(m.ranking).toHaveBeenCalledWith({ plantaId: 'p' });
});

it('ofrece comparar con la ronda anterior (o elegir) desde la evaluación', async () => {
  const montar = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/planta/p/evaluacion/e1']}>
        <Routes><Route path="/planta/:id/evaluacion/:evaluacionId" element={<EvaluacionPasadaPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Ronda 1: no hay anterior, solo «Comparar rondas» para elegir.
  montar();
  const enlace = await screen.findByRole('link', { name: 'Comparar rondas' });
  expect(enlace).toHaveAttribute('href', '/planta/p/comparar/i1');
  expect(screen.queryByRole('link', { name: 'Comparar con la ronda anterior' })).not.toBeInTheDocument();
  cleanup();

  // Ronda 2: la comparación con la 1 ya elegida y, aparte, elegir otra.
  m.evaluacion.mockResolvedValue({
    id: 'e2', estado: 'completa', fecha: '2026-10-20', anio: 2026, evaluador: 'Equipo', observaciones: null,
    requiere_revision: false, no_comparable: false, sin_muestra: false,
    ronda: { numero_ronda: 2, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  montar();
  expect(await screen.findByRole('link', { name: 'Comparar con la ronda anterior' })).toHaveAttribute('href', '/planta/p/comparar/i1?rondas=1,2');
  expect(screen.getByRole('link', { name: 'Elegir otra ronda' })).toHaveAttribute('href', '/planta/p/comparar/i1');
});

it('U-09: la lectura de una evaluación cerrada ofrece «Nueva evaluación en esta ronda» hacia el formulario de esa ronda', async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/planta/p/evaluacion/e1']}>
        <Routes><Route path="/planta/:id/evaluacion/:evaluacionId" element={<EvaluacionPasadaPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const enlace = await screen.findByRole('link', { name: 'Nueva evaluación en esta ronda' });
  expect(enlace).toHaveAttribute('href', '/planta/p/evaluar/i1?ronda=1&volver=%2Fplanta%2Fp%2Fevaluacion%2Fe1');
});

it('U-09: un borrador (aún no cerrada) no ofrece «Nueva evaluación en esta ronda»', async () => {
  m.evaluacion.mockResolvedValue({
    id: 'e2', estado: 'borrador', fecha: '2026-10-20', anio: 2026, evaluador: 'Equipo', observaciones: null,
    requiere_revision: false, no_comparable: false, sin_muestra: false,
    ronda: { numero_ronda: 1, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/planta/p/evaluacion/e2']}>
        <Routes><Route path="/planta/:id/evaluacion/:evaluacionId" element={<EvaluacionPasadaPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: '90-901-P10' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Nueva evaluación en esta ronda' })).not.toBeInTheDocument();
});

it('A8: el operario no ve «Corregir»', async () => {
  montarLectura();
  await screen.findByRole('heading', { name: '90-901-P10' });
  expect(screen.queryByRole('button', { name: 'Corregir' })).not.toBeInTheDocument();
});

it('A8: el admin corrige con motivo obligatorio y solo se envía lo que cambió', async () => {
  m.esAdmin = true;
  m.corregir.mockResolvedValue({});
  montarLectura();
  fireEvent.click(await screen.findByRole('button', { name: 'Corregir' }));
  const hoja = await screen.findByRole('dialog', { name: 'Corregir evaluación' });
  const guardar = within(hoja).getByRole('button', { name: 'Guardar corrección' });
  expect(guardar).toBeDisabled();
  fireEvent.change(within(hoja).getByLabelText(/Calibre/), { target: { value: '15,5' } });
  expect(guardar).toBeDisabled(); // falta el motivo
  fireEvent.change(within(hoja).getByLabelText(/Motivo de la corrección/), { target: { value: 'Calibre mal tipeado' } });
  expect(guardar).toBeEnabled();
  fireEvent.click(guardar);
  await waitFor(() => expect(m.corregir).toHaveBeenCalledWith('e1', { calibre_mm: 15.5 }, 'Calibre mal tipeado', '2026-10-20T12:00:00Z'));
});

it('A8: una evaluación corregida muestra quién, cuándo y por qué', async () => {
  m.evaluacion.mockResolvedValue({
    id: 'e1', estado: 'corregida', fecha: '2026-10-20', anio: 2026, evaluador: 'Equipo', observaciones: null, updated_at: '2026-10-21T12:00:00Z', ronda_id: 'r1',
    requiere_revision: false, no_comparable: false, sin_muestra: false, brotacion: 4, motivo_cambio: 'Brix mal tipeado',
    ronda: { numero_ronda: 1, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  m.correcciones.mockResolvedValue([
    { evaluacion_id: 'e1', fecha: '2026-10-21T15:04:00Z', corregido_por: 'Ana Rojas', motivo: 'Brix mal tipeado', campos: ['brix'] },
    { evaluacion_id: 'otra', fecha: '2026-10-21T15:00:00Z', corregido_por: 'Ana Rojas', motivo: 'Otra evaluación', campos: [] },
  ]);
  montarLectura();
  const region = await screen.findByRole('region', { name: 'Correcciones' });
  expect(region).toHaveTextContent('Corregida por Ana Rojas el 21-10-2026, 12:04 · Motivo: Brix mal tipeado');
  expect(region).not.toHaveTextContent('Otra evaluación');
  expect(m.correcciones).toHaveBeenCalledWith('i1');
});

it('la distribución de flores y frutos se lee con el texto del nivel y el rend_t_ha histórico se sigue mostrando', async () => {
  m.evaluacion.mockResolvedValue({
    id: 'e1', estado: 'completa', fecha: '2026-10-20', anio: 2026, evaluador: 'Equipo', observaciones: null, updated_at: '2026-10-20T12:00:00Z', ronda_id: 'r1',
    requiere_revision: false, no_comparable: false, sin_muestra: false, brotacion: 4, distribucion_flores_frutos: 2, rend_kg_planta: 3, rend_t_ha: 11.5,
    ronda: { numero_ronda: 1, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  m.estados.mockResolvedValue({ evaluacion_id: 'e1', protocolo, estados: { brotacion: 'medido', distribucion_flores_frutos: 'medido', rend_kg_planta: 'medido', rend_t_ha: 'medido' } });
  montarLectura();
  const brotes = await screen.findByRole('region', { name: 'Brotes y varas basales' });
  expect(within(screen.getByRole('region', { name: 'Fenología' })).queryByText('Distribución de flores y frutos en la vara')).not.toBeInTheDocument();
  const mosaico = within(brotes).getByText('Distribución de flores y frutos en la vara').parentElement!;
  expect(mosaico).toHaveTextContent('Hasta la mitad');
  expect(mosaico).toHaveTextContent('1 Solo en la punta, 2 Hasta la mitad, 3 Toda la vara');
  const produccion = screen.getByRole('region', { name: 'Producción' });
  expect(within(produccion).getByText('Rendimiento por hectárea').parentElement).toHaveTextContent('11,5');
  expect(within(produccion).getByText('Rendimiento por hectárea').parentElement).toHaveTextContent('t/ha');
});

it('una evaluación sin rend_t_ha no lo menciona (ya no se pide)', async () => {
  montarLectura();
  await screen.findByRole('heading', { name: '90-901-P10' });
  expect(screen.queryByText(/Rendimiento por hectárea/i)).not.toBeInTheDocument();
});

it('EF11/EF12: al corregir, la distribución se elige con el texto del nivel y rend_t_ha solo se ofrece si la evaluación ya lo trae', async () => {
  m.esAdmin = true;
  m.corregir.mockResolvedValue({});
  montarLectura();
  fireEvent.click(await screen.findByRole('button', { name: 'Corregir' }));
  let hoja = await screen.findByRole('dialog', { name: 'Corregir evaluación' });
  const distribucion = within(hoja).getByLabelText('Distribución de flores y frutos en la vara');
  expect(within(distribucion).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sin valor', '1 · Solo en la punta', '2 · Hasta la mitad', '3 · Toda la vara']);
  expect(within(hoja).queryByLabelText(/Rendimiento por hectárea/)).not.toBeInTheDocument();
  fireEvent.change(distribucion, { target: { value: '3' } });
  fireEvent.change(within(hoja).getByLabelText(/Motivo de la corrección/), { target: { value: 'Faltaba anotar la distribución' } });
  fireEvent.click(within(hoja).getByRole('button', { name: 'Guardar corrección' }));
  await waitFor(() => expect(m.corregir).toHaveBeenCalledWith('e1', { distribucion_flores_frutos: 3 }, 'Faltaba anotar la distribución', '2026-10-20T12:00:00Z'));
  cleanup();

  // Una evaluación histórica con rend_t_ha: se puede corregir.
  m.evaluacion.mockResolvedValue({
    id: 'e1', estado: 'completa', fecha: '2026-10-20', anio: 2026, evaluador: 'Equipo', observaciones: null, updated_at: '2026-10-20T12:00:00Z', ronda_id: 'r1',
    requiere_revision: false, no_comparable: false, sin_muestra: false, brotacion: 4, rend_t_ha: 11,
    ronda: { numero_ronda: 1, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  montarLectura();
  fireEvent.click(await screen.findByRole('button', { name: 'Corregir' }));
  hoja = await screen.findByRole('dialog', { name: 'Corregir evaluación' });
  expect(within(hoja).getByLabelText(/Rendimiento por hectárea/)).toHaveValue('11');
});

it('nombra cada descriptor no evaluado como tarjeta «No evaluado» y no cuenta los que no existían en la fecha (el «8 de 9»)', async () => {
  m.evaluacion.mockResolvedValueOnce({
    id: 'e1', estado: 'completa', fecha: '2026-10-20', anio: 2026, evaluador: 'Equipo', observaciones: null, updated_at: '2026-10-20T12:00:00Z', ronda_id: 'r1',
    requiere_revision: false, no_comparable: false, sin_muestra: false, brotacion: 4, n_varas_basales: 6,
    ronda: { numero_ronda: 1, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  montarLectura();
  const brotes = await screen.findByRole('region', { name: 'Brotes y varas basales' });
  // 8 descriptores existían el 20-10-2026; la distribución floral nació el 25-10-2026.
  expect(within(brotes).getByText('1 de 8')).toBeInTheDocument();
  expect(within(brotes).getAllByText('No evaluado')).toHaveLength(7);
  expect(within(brotes).getByText('Altura del brote').nextSibling).toHaveTextContent('No evaluado');
  expect(within(brotes).getByText('Distribución de flores y frutos en la vara').nextSibling).toHaveTextContent('No existía en esa fecha');
});

it('en una evaluación posterior, la distribución floral cuenta y, sin valor, es «No evaluado»', async () => {
  m.evaluacion.mockResolvedValueOnce({
    id: 'e1', estado: 'completa', fecha: '2026-11-10', anio: 2026, evaluador: 'Equipo', observaciones: null, updated_at: '2026-11-10T12:00:00Z', ronda_id: 'r1',
    requiere_revision: false, no_comparable: false, sin_muestra: false, brotacion: 4, n_varas_basales: 6,
    ronda: { numero_ronda: 1, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  montarLectura();
  const brotes = await screen.findByRole('region', { name: 'Brotes y varas basales' });
  expect(within(brotes).getByText('1 de 9')).toBeInTheDocument();
  expect(within(brotes).getByText('Distribución de flores y frutos en la vara').nextSibling).toHaveTextContent('No evaluado');
  expect(within(brotes).queryByText('No existía en esa fecha')).not.toBeInTheDocument();
});

it('los calculados no inflan el «N de M» de su sección (antes salía «3 de 2» en la muestra)', async () => {
  m.evaluacion.mockResolvedValueOnce({
    id: 'e1', estado: 'completa', fecha: '2026-11-10', anio: 2026, evaluador: 'Equipo', observaciones: null, updated_at: '2026-11-10T12:00:00Z', ronda_id: 'r1',
    requiere_revision: false, no_comparable: false, sin_muestra: false, brotacion: 4, cantidad_frutos: 10, peso_total_g: 30, peso_promedio_g: 3,
    ronda: { numero_ronda: 1, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  montarLectura();
  const muestra = await screen.findByRole('region', { name: 'Muestra de frutos' });
  expect(within(muestra).getByText('2 de 2')).toBeInTheDocument();
});

it('hallazgo 2 (G2): la cabecera dice la temporada de la ronda (iniciada el 01-06-2026: 2025-2026), no el año calendario', async () => {
  const base = await m.evaluacion();
  m.evaluacion.mockResolvedValue({ ...base, ronda: { ...base.ronda, fecha_inicio: '2026-06-01', created_at: '2026-06-01T12:00:00Z' } });
  montarLectura();
  expect(await screen.findByText('Ronda 1 · anual · Temporada 2025-2026')).toBeInTheDocument();
});

describe('Fase 5 (G15): pedir corrección', () => {
  const base = () => ({
    id: 'e1', estado: 'completa', fecha: '2026-10-20', anio: 2026, evaluador: 'Equipo', observaciones: null, updated_at: '2026-10-20T12:00:00Z', ronda_id: 'r1',
    requiere_revision: false, no_comparable: false, sin_muestra: false, brotacion: 4, calibre_mm: 45,
    ronda: { numero_ronda: 1, tipo_ronda: 'anual', anio: 2026, individuo: { id: 'i1', codigo_display: '90-901-P10', planta_id: 'p' } },
  });
  const deAutor = () => m.evaluacion.mockResolvedValue({ ...base(), created_by: 'u-autor' });

  it('el autor de una evaluación cerrada pide una corrección con nota obligatoria; queda en el historial', async () => {
    deAutor();
    montarLectura();
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir corrección' }));
    const hoja = await screen.findByRole('dialog');
    const enviar = within(hoja).getByRole('button', { name: 'Enviar pedido' });
    expect(enviar).toBeDisabled();
    fireEvent.change(within(hoja).getByLabelText('¿Qué hay que corregir?'), { target: { value: 'El calibre es 18, no 45' } });
    m.pedidos.mockResolvedValue([{ id: 'pc1', nota: 'El calibre es 18, no 45', pedido_por: 'María Soto', pedido_en: '2026-10-26T15:00:00Z', estado: 'abierto', resuelto_en: null, resuelto_por: null }]);
    fireEvent.click(enviar);
    await waitFor(() => expect(m.pedir).toHaveBeenCalledWith('e1', 'El calibre es 18, no 45'));
    const historial = await screen.findByRole('region', { name: 'Correcciones pedidas' });
    expect(within(historial).getByText(/María Soto/)).toBeInTheDocument();
    expect(within(historial).getByText(/El calibre es 18, no 45/)).toBeInTheDocument();
    expect(within(historial).getByText(/Pendiente/)).toBeInTheDocument();
    // Con un pedido abierto, el botón ya no se ofrece de nuevo: se dice que está pedida.
    expect(screen.queryByRole('button', { name: 'Pedir corrección' })).not.toBeInTheDocument();
    expect(screen.getByText('Corrección pedida')).toBeInTheDocument();
  });

  it('un pedido resuelto dice quién y cuándo, y se puede pedir otro', async () => {
    deAutor();
    m.pedidos.mockResolvedValue([{ id: 'pc1', nota: 'Revisar floración', pedido_por: 'María Soto', pedido_en: '2026-10-20T15:00:00Z', estado: 'resuelto', resuelto_en: '2026-10-21T10:00:00Z', resuelto_por: 'Efraín' }]);
    montarLectura();
    const historial = await screen.findByRole('region', { name: 'Correcciones pedidas' });
    expect(within(historial).getByText(/Resuelta por Efraín/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir corrección' })).toBeInTheDocument();
  });

  it('quien no es el autor no ve el botón; el admin corrige directamente', async () => {
    m.evaluacion.mockResolvedValue({ ...base(), created_by: 'otra-persona' });
    montarLectura();
    expect(await screen.findByText('90-901-P10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir corrección' })).not.toBeInTheDocument();
    cleanup();
    m.esAdmin = true;
    m.usuario = 'u-autor';
    deAutor();
    montarLectura();
    expect(await screen.findByRole('button', { name: 'Corregir' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir corrección' })).not.toBeInTheDocument();
  });

  it('un borrador no se puede pedir corregir', async () => {
    m.evaluacion.mockResolvedValue({ ...base(), created_by: 'u-autor', estado: 'borrador' });
    montarLectura();
    expect(await screen.findByText('90-901-P10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir corrección' })).not.toBeInTheDocument();
  });
});
