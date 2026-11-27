import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilaPlanilla, PlanillaRonda as Planilla } from '@/api/protocolo';
import { PlanillaRonda } from './PlanillaRonda';

const mocks = vi.hoisted(() => ({ planilla: vi.fn(), iniciar: vi.fn() }));
vi.mock('@/api/protocolo', () => ({ obtenerPlanillaRonda: mocks.planilla }));
vi.mock('@/api/rondas', () => ({ iniciarRonda: mocks.iniciar }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));

const fila = (n: number, extra: Partial<FilaPlanilla>): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `90-901-P${n}`, numero: n, ronda_id: `r${n}`, estado: 'completa',
  evaluacion_id: `e${n}`, evaluacion_updated_at: '2026-10-20T12:00:00Z', fecha: '2026-10-20', evaluador: 'Equipo',
  es_mia: true, protocolo_id: 'p1', protocolo_distinto: false,
  estados: { brotacion: 'medido', floracion: 'medido' }, conteo: { medido: 2, falto: 0, no_evaluado: 26, marcado: 0 },
  ...extra,
});

const planilla: Planilla = {
  planta_id: 'p', tipo_ronda: 'anual', numero_ronda: 1,
  protocolo: { id: 'p1', version: 1, nombre: 'Ronda 1', descriptores: { brotacion: 'obligatorio', floracion: 'obligatorio', calibre_mm: 'opcional' }, created_at: '2026-10-01' },
  avance: { vivos: 4, sin_ronda: 0, sin_iniciar: 1, borrador: 1, completa: 2 },
  individuos: [
    fila(1, {}),
    fila(2, { estado: 'borrador', es_mia: false, estados: { brotacion: 'medido', floracion: 'falto' }, conteo: { medido: 1, falto: 1, no_evaluado: 26, marcado: 0 } }),
    fila(3, { estado: 'sin_iniciar', evaluacion_id: null, evaluacion_updated_at: null, estados: null, conteo: null, evaluador: null }),
    fila(4, { estados: { brotacion: 'medido', floracion: 'medido', calibre_mm: 'marcado' }, conteo: { medido: 2, falto: 0, no_evaluado: 25, marcado: 1 } }),
  ],
};

beforeEach(() => { mocks.planilla.mockResolvedValue(planilla); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function montar(esAdmin = false) {
  const props = { onAbrir: vi.fn(), onEvaluar: vi.fn(), onDefinirProtocolo: vi.fn() };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><PlanillaRonda plantaId="p" esAdmin={esAdmin} {...props} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return props;
}

it('muestra el avance por evaluación cerrada y los filtros con su cuenta', async () => {
  montar();
  expect(await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '2 de 4 cerradas')).toBeInTheDocument();
  const filtros = within(screen.getByRole('group', { name: 'Filtrar individuos' }));
  expect(filtros.getByRole('button', { name: /Sin empezar 1/ })).toHaveAttribute('aria-pressed', 'false');
  expect(filtros.getByRole('button', { name: /Revisar 1/ })).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === 'P' && /2 obligatorios \(Fenología\)\. .*: opcional\./.test(el.textContent ?? ''))).toBeInTheDocument();
});

it('«Evaluar siguiente» va al primer pendiente por número de planta', async () => {
  const props = montar();
  fireEvent.click(await screen.findByRole('button', { name: 'Evaluar siguiente · P3' }));
  expect(props.onEvaluar).toHaveBeenCalledWith('i3', expect.objectContaining({ filtro: expect.any(String) }));
});

it('filtra por «Revisar» y nombra lo marcado', async () => {
  montar();
  fireEvent.click(await screen.findByRole('button', { name: /Revisar 1/ }));
  const tabla = screen.getByRole('table');
  expect(within(tabla).getAllByRole('row')).toHaveLength(2); // encabezado + P4
  expect(within(tabla).getByText('Revisar calibre')).toBeInTheDocument();
});

it('un borrador ajeno no ofrece continuar salvo a un admin (A1-061)', async () => {
  montar(false);
  const tabla = await screen.findByRole('table');
  const filaP2 = within(tabla).getByText('P2').closest('tr')!;
  expect(within(filaP2).getByText('De otra persona')).toBeInTheDocument();
  expect(within(filaP2).getByText('Sin floración')).toBeInTheDocument();
  cleanup();
  montar(true);
  const tablaAdmin = await screen.findByRole('table');
  expect(within(within(tablaAdmin).getByText('P2').closest('tr')!).getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
});

it('el admin puede definir el protocolo; el operario no ve el botón', async () => {
  const props = montar(true);
  fireEvent.click(await screen.findByRole('button', { name: /Cambiar protocolo/ }));
  expect(props.onDefinirProtocolo).toHaveBeenCalledWith(planilla);
  cleanup();
  montar(false);
  await screen.findByRole('progressbar', { name: 'Avance de la ronda' });
  expect(screen.queryByRole('button', { name: /protocolo/ })).not.toBeInTheDocument();
});

it('en celular arranca en «Sin empezar» y la fila entera abre la evaluación', async () => {
  const original = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  try {
    const props = montar();
    const filtros = within(await screen.findByRole('group', { name: 'Filtrar individuos' }));
    expect(filtros.getByRole('button', { name: /Sin empezar 1/ })).toHaveAttribute('aria-pressed', 'true');
    const lista = screen.getAllByRole('list').find((l) => l.tagName === 'UL' && within(l).queryByText('siguiente'))!;
    fireEvent.click(within(lista).getByRole('button', { name: /P3/ }));
    expect(props.onEvaluar).toHaveBeenCalledWith('i3', expect.objectContaining({ filtro: expect.any(String) }));
  } finally {
    window.matchMedia = original;
  }
});

it('Sprint 1.1: pagina de a 50 sobre todo el cruce, «Sin ronda» con su acción y el código abre el individuo', async () => {
  const muchas = Array.from({ length: 120 }, (_, i) => fila(i + 1, i < 100
    ? { estado: 'sin_ronda', ronda_id: null, evaluacion_id: null, estados: null, conteo: null, evaluador: null, fecha: null, evaluacion_updated_at: null }
    : { estado: 'sin_iniciar', evaluacion_id: null, estados: null, conteo: null, evaluador: null, fecha: null, evaluacion_updated_at: null }));
  mocks.planilla.mockResolvedValue({ ...planilla, avance: { vivos: 120, sin_ronda: 100, sin_iniciar: 20, borrador: 0, completa: 0 }, individuos: muchas });
  mocks.iniciar.mockResolvedValue({ ronda_id: 'nueva', numero_ronda: 1 });
  const props = montar();
  const filtros = within(await screen.findByRole('group', { name: 'Filtrar individuos' }));
  expect(filtros.getByRole('button', { name: /Sin ronda 100/ })).toBeInTheDocument();
  expect(filtros.getByRole('button', { name: /Sin empezar 20/ })).toBeInTheDocument();
  const tabla = screen.getByRole('table');
  expect(within(tabla).getAllByRole('row')).toHaveLength(51); // encabezado + 50
  expect(screen.getByText('Mostrando 1–50 de 120')).toBeInTheDocument();
  // G18: paginación numerada en lugar de «Mostrar más».
  fireEvent.click(screen.getByRole('button', { name: 'Página 2' }));
  expect(within(tabla).getAllByRole('row')).toHaveLength(51);
  expect(screen.getByText('Mostrando 51–100 de 120')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Página 1' }));
  // Fila sin ronda: «Iniciar ronda 1», con la RPC de siempre.
  const p1 = within(tabla).getByRole('button', { name: 'P1' }).closest('tr')!;
  fireEvent.click(within(p1).getByRole('button', { name: 'Iniciar ronda 1' }));
  await waitFor(() => expect(mocks.iniciar).toHaveBeenCalledWith('i1', 1));
  // Tocar el código abre el individuo.
  fireEvent.click(within(tabla).getByRole('button', { name: 'P2' }));
  expect(props.onAbrir).toHaveBeenCalledWith('i2');
});

it('Sprint 1.1: el lote solo lo ve un admin', async () => {
  const sinRonda = [fila(1, { estado: 'sin_ronda', ronda_id: null, evaluacion_id: null, estados: null, conteo: null })];
  mocks.planilla.mockResolvedValue({ ...planilla, individuos: sinRonda, avance: { vivos: 1, sin_ronda: 1, sin_iniciar: 0, borrador: 0, completa: 0 } });
  montar(false);
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: /para los 1 individuos vivos sin ronda/ })).not.toBeInTheDocument();
  cleanup();
  montar(true);
  expect(await screen.findByRole('button', { name: 'Iniciar ronda 1 para los 1 individuos vivos sin ronda' })).toBeInTheDocument();
});

const conFaltantes: Planilla = {
  ...planilla,
  avance: { vivos: 3, sin_ronda: 0, sin_iniciar: 0, borrador: 0, completa: 3 },
  individuos: [
    fila(1, {}),
    fila(5, { estados: { brotacion: 'medido', floracion: 'falto' }, conteo: { medido: 1, falto: 1, no_evaluado: 26, marcado: 0 } }),
    fila(6, { estados: { brotacion: 'falto', floracion: 'falto' }, conteo: { medido: 0, falto: 2, no_evaluado: 26, marcado: 0 } }),
  ],
};

it('U-06: «Completa» solo con todos los obligatorios; con faltantes es «Cerrada · faltan N» en ámbar', async () => {
  mocks.planilla.mockResolvedValue(conFaltantes);
  montar();
  const tabla = await screen.findByRole('table');
  const chipDe = (corto: string) => within(within(tabla).getByText(corto).closest('tr')!);
  expect(chipDe('P1').getByText('Completa')).toBeInTheDocument();
  const unoFalta = chipDe('P5').getByText('Cerrada · falta 1');
  expect(unoFalta).toHaveClass('text-warn');
  expect(chipDe('P5').queryByText('Completa')).not.toBeInTheDocument();
  expect(chipDe('P6').getByText('Cerrada · faltan 2')).toBeInTheDocument();
});

it('U-06: la píldora «Con faltantes N» filtra las cerradas con obligatorios sin medir y solo aparece si las hay', async () => {
  mocks.planilla.mockResolvedValue(conFaltantes);
  montar();
  fireEvent.click(await screen.findByRole('button', { name: /Con faltantes 2/ }));
  const tabla = screen.getByRole('table');
  expect(within(tabla).getAllByRole('row')).toHaveLength(3); // encabezado + P5 + P6
  expect(within(tabla).queryByText('P1')).not.toBeInTheDocument();
  cleanup();
  mocks.planilla.mockResolvedValue(planilla);
  montar();
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: /Con faltantes/ })).not.toBeInTheDocument();
});

it('U-06: en la fila táctil del celular, «1/2» va en ámbar si faltan obligatorios y en gris si está completa', async () => {
  mocks.planilla.mockResolvedValue(conFaltantes);
  montar();
  await screen.findByRole('table');
  const lista = screen.getAllByRole('list').find((ul) => ul.className.includes('md:hidden'))!;
  const filaMovil = (corto: string) => within(within(lista).getByText(corto).closest('li')!);
  expect(filaMovil('P5').getByText('1/2')).toHaveClass('text-warn');
  expect(filaMovil('P1').getByText('2/2')).toHaveClass('text-ink-3');
});

it('U-10: los filtros y el encabezado de columnas quedan pegados al desplazar, y «Volver arriba» aparece al bajar', async () => {
  montar();
  const tabla = await screen.findByRole('table');
  expect(within(screen.getByRole('group', { name: 'Filtrar individuos' }).parentElement as HTMLElement).getByRole('button', { name: /Todos/ })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Filtrar individuos' }).parentElement).toHaveClass('sticky');
  expect(tabla.querySelector('thead')).toHaveClass('sticky');
  expect(screen.queryByRole('button', { name: 'Volver arriba' })).not.toBeInTheDocument();
  const { act } = await import('@testing-library/react');
  act(() => {
    Object.defineProperty(window, 'scrollY', { value: 1500, configurable: true });
    window.dispatchEvent(new Event('scroll'));
  });
  expect(screen.getByRole('button', { name: 'Volver arriba' })).toBeInTheDocument();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

it('U-20: el evaluador vacío de una evaluación propia muestra mi nombre; de otra persona, «—»; sin evaluación, «—»', async () => {
  mocks.planilla.mockResolvedValue({
    ...planilla,
    individuos: [
      fila(1, { evaluador: null, es_mia: true }),
      fila(2, { evaluador: null, es_mia: false }),
      fila(3, { estado: 'sin_iniciar', evaluacion_id: null, evaluacion_updated_at: null, evaluador: null, es_mia: false, estados: null, conteo: null }),
      fila(4, { evaluador: 'Equipo', es_mia: true }),
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><PlanillaRonda plantaId="p" esAdmin={false} miNombre="M. Soto" onAbrir={vi.fn()} onEvaluar={vi.fn()} /></MemoryRouter>
    </QueryClientProvider>,
  );
  const tabla = await screen.findByRole('table');
  const celdaEvaluador = (corto: string) => within(within(tabla).getByText(corto).closest('tr')!).getAllByRole('cell')[4];
  expect(celdaEvaluador('P1')).toHaveTextContent('M. Soto');
  expect(celdaEvaluador('P2')).toHaveTextContent('—');
  expect(celdaEvaluador('P2')).not.toHaveTextContent('(cuenta)');
  expect(celdaEvaluador('P3')).toHaveTextContent('—');
  expect(celdaEvaluador('P4')).toHaveTextContent('Equipo');
});

// U-09: una ronda con evaluación cerrada y un borrador de visita nueva encima.
const conVisitaNueva: Planilla = {
  ...planilla,
  avance: { vivos: 4, sin_ronda: 0, sin_iniciar: 0, borrador: 1, completa: 3, con_borrador: 2 },
  individuos: [
    fila(1, { hay_borrador: true, borrador_mio: true }), // cerrada + visita nueva mía
    fila(2, { estado: 'borrador', es_mia: false, hay_borrador: true, borrador_mio: false, estados: { brotacion: 'medido', floracion: 'falto' }, conteo: { medido: 1, falto: 1, no_evaluado: 26, marcado: 0 } }),
    fila(3, { hay_borrador: true, borrador_mio: false }), // cerrada + visita nueva de otra persona
    fila(4, {}), // cerrada sin borrador
  ],
};

it('U-09: la fila cerrada con borrador de visita nueva lleva el marcador «Visita nueva en borrador» y conserva su chip «Completa»', async () => {
  mocks.planilla.mockResolvedValue(conVisitaNueva);
  montar();
  const tabla = await screen.findByRole('table');
  const filaDe = (corto: string) => within(within(tabla).getByText(corto).closest('tr')!);
  expect(filaDe('P1').getByText('Visita nueva en borrador')).toBeInTheDocument();
  expect(filaDe('P1').getByText('Completa')).toBeInTheDocument(); // el chip principal no cambia
  expect(filaDe('P3').getByText('Visita nueva en borrador · de otra persona')).toBeInTheDocument();
  expect(filaDe('P4').queryByText(/Visita nueva/)).not.toBeInTheDocument();
  // Una fila que solo es borrador no lleva el marcador: ya es «Borrador».
  expect(filaDe('P2').queryByText(/Visita nueva/)).not.toBeInTheDocument();
});

it('U-09: la píldora «Borradores N» y su filtro incluyen las filas con visita nueva; la barra de avance no cambia', async () => {
  mocks.planilla.mockResolvedValue(conVisitaNueva);
  montar();
  await screen.findByRole('table');
  // 1 borrador (P2) + 2 cerradas con visita nueva (P1, P3) = 3.
  fireEvent.click(screen.getByRole('button', { name: /Borradores 3/ }));
  const tabla = screen.getByRole('table');
  expect(within(tabla).getAllByRole('row')).toHaveLength(4); // encabezado + P1 + P2 + P3
  expect(within(tabla).queryByText('P4')).not.toBeInTheDocument();
  // La barra y su leyenda siguen contando lo de siempre (no duplican): 3 cerradas, 1 borrador.
  expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '3 de 4 cerradas')).toBeInTheDocument();
  const detalle = within(screen.getByRole('list', { name: 'Detalle del avance' }));
  expect(detalle.getByText('3 cerradas')).toBeInTheDocument();
  expect(detalle.getByText('1 borrador')).toBeInTheDocument();
});

it('U-09: sin las claves nuevas (base sin la migración) no hay marcador y la píldora cuenta como antes', async () => {
  montar(); // la planilla base no trae hay_borrador
  await screen.findByRole('table');
  expect(screen.queryByText(/Visita nueva/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Borradores 1/ })).toBeInTheDocument();
});

it('U-09: «Evaluar siguiente» considera el borrador de visita nueva propio cuando no quedan pendientes, y no el ajeno', async () => {
  mocks.planilla.mockResolvedValue({ ...conVisitaNueva, individuos: conVisitaNueva.individuos.filter((f) => f.individuo_id !== 'i2') });
  const props = montar();
  fireEvent.click(await screen.findByRole('button', { name: 'Evaluar siguiente · P1' }));
  expect(props.onEvaluar).toHaveBeenCalledWith('i1', expect.objectContaining({ filtro: expect.any(String) }));
  cleanup();
  mocks.planilla.mockResolvedValue({ ...conVisitaNueva, individuos: conVisitaNueva.individuos.filter((f) => f.individuo_id === 'i3' || f.individuo_id === 'i4') });
  montar();
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: /Evaluar siguiente/ })).not.toBeInTheDocument(); // solo hay un borrador ajeno
});

it('U-09: «Continuar visita» aparece solo cuando el borrador es mío: ni otro operario ni un admin que no es el autor', async () => {
  mocks.planilla.mockResolvedValue(conVisitaNueva);
  const props = montar();
  const tabla = await screen.findByRole('table');
  const filaDe = (corto: string) => within(within(tabla).getByText(corto).closest('tr')!);
  fireEvent.click(filaDe('P1').getByRole('button', { name: 'Continuar visita' }));
  expect(props.onEvaluar).toHaveBeenCalledWith('i1', expect.objectContaining({ filtro: expect.any(String) }));
  expect(filaDe('P3').queryByRole('button', { name: 'Continuar visita' })).not.toBeInTheDocument();
  expect(filaDe('P3').getByText('Visita nueva en borrador · de otra persona')).toBeInTheDocument(); // solo el marcador informativo
  cleanup();
  montar(true); // un admin que no es el autor del borrador de P3 tampoco recibe la acción
  const tablaAdmin = await screen.findByRole('table');
  expect(within(within(tablaAdmin).getByText('P3').closest('tr')!).queryByRole('button', { name: 'Continuar visita' })).not.toBeInTheDocument();
});

function Ubicacion() {
  return <p data-testid="ruta">{useLocation().pathname}</p>;
}

it('U-09 (celular): tocar una fila cerrada con visita nueva abre su lectura; «Continuar visita» es un control aparte y visible solo si el borrador es mío', async () => {
  mocks.planilla.mockResolvedValue(conVisitaNueva);
  const props = { onAbrir: vi.fn(), onEvaluar: vi.fn(), onDefinirProtocolo: vi.fn() };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><PlanillaRonda plantaId="p" esAdmin={false} {...props} /><Ubicacion /></MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('table');
  const lista = screen.getAllByRole('list').find((ul) => ul.className.includes('md:hidden'))!;
  const filaMovil = (corto: string) => within(within(lista).getByText(corto).closest('li')!);
  // El marcador va junto al chip y el chip principal no cambia.
  expect(filaMovil('P1').getByText('Visita nueva en borrador')).toBeInTheDocument();
  expect(filaMovil('P1').getByText('Completa')).toBeInTheDocument();
  // (i) El toque abre la lectura de la evaluación cerrada, no el formulario.
  fireEvent.click(within(lista).getByText('P1').closest('button')!);
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p/evaluacion/e1');
  expect(props.onEvaluar).not.toHaveBeenCalled();
  // (ii) «Continuar visita» es un botón propio dentro de la fila (no anidado en el botón de la fila) y continúa el borrador.
  const continuar = filaMovil('P1').getByRole('button', { name: 'Continuar visita' });
  expect(continuar.closest('button')).toBe(continuar);
  expect(continuar.parentElement?.closest('button')).toBeNull();
  fireEvent.click(continuar);
  expect(props.onEvaluar).toHaveBeenCalledWith('i1', expect.objectContaining({ filtro: expect.any(String) }));
  // (iii) Borrador de otra persona: solo el marcador informativo, sin acción.
  expect(filaMovil('P3').getByText('Visita nueva en borrador · de otra persona')).toBeInTheDocument();
  expect(filaMovil('P3').queryByRole('button', { name: 'Continuar visita' })).not.toBeInTheDocument();
  // Una fila sin visita nueva no trae el control.
  expect(filaMovil('P4').queryByRole('button', { name: 'Continuar visita' })).not.toBeInTheDocument();
});

it('hallazgo 8 (E16): la píldora y el chip de quien no empezó dicen «Sin empezar», no «Pendientes»', async () => {
  montar();
  const filtros = within(await screen.findByRole('group', { name: 'Filtrar individuos' }));
  expect(filtros.getByRole('button', { name: /Sin empezar 1/ })).toBeInTheDocument();
  expect(filtros.queryByRole('button', { name: /Pendientes/ })).toBeNull();
  expect(screen.queryAllByText('Pendiente')).toHaveLength(0);
});
