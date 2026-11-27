/**
 * Formulario de evaluación con protocolo de ronda (Fase 2, Sprint 1) y los
 * arreglos de paso de la revisión C3: A1-059 (null explícito al actualizar) y
 * A1-061 (borrador ajeno).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EvaluacionForm } from './EvaluacionForm';
import type { EvaluacionRow } from '@/api/rondas';

const m = vi.hoisted(() => ({
  crear: vi.fn(async () => ({ id: 'e1' })),
  actualizar: vi.fn(async () => ({ id: 'e1', updated_at: '2026-10-20T12:01:00Z' })),
  borrador: vi.fn(async (): Promise<EvaluacionRow | null> => null),
  vigente: vi.fn(),
  porId: vi.fn(),
  auth: { esAdmin: false, perfil: undefined as { nombre: string } | undefined },
}));

vi.mock('@/api/rondas', () => ({
  crearEvaluacion: m.crear,
  actualizarEvaluacion: m.actualizar,
  buscarBorradorDeRonda: m.borrador,
  obtenerReferenciasEvaluacion: vi.fn(async () => ({})),
}));
vi.mock('@/api/protocolo', () => ({ obtenerProtocoloVigente: m.vigente, obtenerProtocolo: m.porId }));
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    generacionSesion: 0,
    capturarVigenciaSesion: () => () => true,
    user: { id: 'yo' },
    esAdmin: m.auth.esAdmin,
    perfil: m.auth.perfil,
  }),
}));

const protocolo = {
  id: 'p1', version: 1, nombre: 'Ronda 1 anual', created_at: '2026-10-01',
  descriptores: { brotacion: 'obligatorio', floracion: 'obligatorio', calibre_mm: 'opcional', cantidad_frutos: 'opcional', peso_total_g: 'opcional' },
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); // jsdom no lo implementa
  m.vigente.mockResolvedValue(protocolo);
  m.porId.mockResolvedValue(protocolo);
  m.borrador.mockResolvedValue(null);
  m.auth.esAdmin = false;
  m.auth.perfil = undefined;
});
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

function montar() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EvaluacionForm rondaId="r1" plantaId="p1" numeroRonda={1} codigoIndividuo="90-901-P1" />
    </QueryClientProvider>,
  );
}

it('muestra los obligatorios del protocolo y pliega lo que está fuera', async () => {
  montar();
  expect(await screen.findByText(/0 de 2 obligatorios · protocolo «Ronda 1 anual»/)).toBeInTheDocument();
  expect(screen.getByText('Obligatoria · 0 de 2')).toBeInTheDocument();
  expect(screen.getByText(/Producción · fuera del protocolo/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Rendimiento (kg/planta)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Agregar producción' }));
  expect(screen.getByLabelText('Rendimiento (kg/planta)')).toBeInTheDocument();
});

it('lo obligatorio que falta avisa y no impide finalizar', async () => {
  montar();
  await screen.findByText(/0 de 2 obligatorios/);
  const brotacion = screen.getByRole('group', { name: 'Brotación' });
  fireEvent.click(within(brotacion).getByRole('button', { name: '4' }));
  fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
  const aviso = await screen.findByRole('alert');
  expect(aviso).toHaveTextContent('Faltan 1 obligatorios: 1 de Fenología. Puedes finalizar igual');
  expect(m.crear).not.toHaveBeenCalled();
  fireEvent.click(within(aviso).getByRole('button', { name: 'Finalizar igual' }));
  await waitFor(() => expect(m.crear).toHaveBeenCalledWith(expect.objectContaining({ estado: 'completa', brotacion: 4 }), expect.any(String)));
});

const borrador: EvaluacionRow = {
  id: 'b1', ronda_id: 'r1', anio: 2026, fecha: '2026-10-19', estado: 'borrador', created_by: 'otra',
  protocolo_id: 'p1', calibre_mm: 18, brotacion: 3, peso_promedio_g: null, pct_flores: null, pct_frutos: null,
  requiere_revision: false, motivo_cambio: null, updated_at: '2026-10-19T10:00:00Z', created_at: '2026-10-19T10:00:00Z',
};

it('A1-061: un borrador de otra persona no ofrece continuar ni descartar', async () => {
  m.borrador.mockResolvedValue(borrador);
  montar();
  expect(await screen.findByText('Esta ronda tiene un borrador de otra persona')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Continuar borrador/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Descartar/ })).not.toBeInTheDocument();
});

it('A1-059: al continuar un borrador, un campo vaciado se envía como null', async () => {
  m.auth.esAdmin = true; // un admin sí puede continuar el borrador ajeno
  m.borrador.mockResolvedValue(borrador);
  montar();
  fireEvent.click(await screen.findByRole('button', { name: /Continuar borrador/ }));
  const calibre = await screen.findByDisplayValue('18');
  fireEvent.change(calibre, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
  await waitFor(() => expect(m.actualizar).toHaveBeenCalled());
  const [id, cambios] = m.actualizar.mock.calls[0] as unknown as [string, Record<string, unknown>];
  expect(id).toBe('b1');
  expect(cambios.calibre_mm).toBeNull();
  expect(cambios.brotacion).toBe(3);
  expect(m.porId).toHaveBeenCalledWith('p1'); // conserva el protocolo con que se creó
});

it('un borrador anterior a los protocolos se continúa y finaliza sin obligatorios, aunque la ronda ya tenga protocolo', async () => {
  m.borrador.mockResolvedValue({ ...borrador, created_by: 'yo', protocolo_id: null, calibre_mm: null, sin_muestra: false });
  montar();
  fireEvent.click(await screen.findByRole('button', { name: /Continuar borrador/ }));
  await screen.findByText(/descriptores completos/);
  expect(screen.queryByText(/obligatorios/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
  await waitFor(() => expect(m.actualizar).toHaveBeenCalled());
  const [, cambios] = m.actualizar.mock.calls[0] as unknown as [string, Record<string, unknown>];
  expect(cambios).toMatchObject({ estado: 'completa', brotacion: 3 });
  expect(cambios).not.toHaveProperty('protocolo_id');
  expect(screen.queryByText(/Faltan/)).not.toBeInTheDocument(); // sin aviso de obligatorios
  expect(m.porId).not.toHaveBeenCalled();
});

it('a pantalla completa: secciones vacías plegadas con «Empezar», un solo «Antes de finalizar» y «Finalizar y seguir»', async () => {
  const onGuardado = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EvaluacionForm rondaId="r1" plantaId="p1" numeroRonda={1} codigoIndividuo="90-901-P1" variante="pantalla" siguiente="P2" onGuardado={onGuardado} onCerrar={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText(/0 de 2 obligatorios/);
  // Fenología es la sección activa; Fruto (opcional y vacía) queda en su encabezado.
  expect(screen.getByRole('group', { name: 'Brotación' })).toBeInTheDocument();
  const fruto = screen.getByRole('region', { name: 'Fruto / Calidad' });
  expect(within(fruto).queryByText('Calibre')).not.toBeInTheDocument();
  fireEvent.click(within(fruto).getByRole('button', { name: 'Empezar' }));
  expect(within(screen.getByRole('region', { name: 'Fruto / Calidad' })).getByText('Calibre')).toBeInTheDocument();
  expect(screen.getAllByRole('region', { name: 'Antes de finalizar' })).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: /Finalizar y seguir con P2/ }));
  fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Finalizar igual' }));
  await waitFor(() => expect(onGuardado).toHaveBeenCalledWith('completa', { llenos: 0, total: 2 }, 'seguir'));
});

it('Fase 5 (G12): con siguiente hay dos acciones al cerrar; «Finalizar y volver a la planilla» avisa el destino «volver»', async () => {
  const onGuardado = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EvaluacionForm rondaId="r1" plantaId="p1" numeroRonda={1} codigoIndividuo="90-901-P1" variante="pantalla" siguiente="P76" textoVolver="Finalizar y volver a la planilla" onGuardado={onGuardado} onCerrar={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText(/0 de 2 obligatorios/);
  expect(screen.getAllByRole('button', { name: /Finalizar y seguir con P76/ }).length).toBeGreaterThan(0);
  const volver = screen.getAllByRole('button', { name: 'Finalizar y volver a la planilla' });
  expect(volver.length).toBeGreaterThan(0);
  fireEvent.click(volver[0]);
  fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Finalizar igual' }));
  await waitFor(() => expect(onGuardado).toHaveBeenCalledWith('completa', { llenos: 0, total: 2 }, 'volver'));
});

function montarPantalla(onGuardado = vi.fn(), avisoVisitaNueva?: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EvaluacionForm rondaId="r1" plantaId="p1" numeroRonda={1} codigoIndividuo="90-901-P1" variante="pantalla" siguiente="P2" avisoVisitaNueva={avisoVisitaNueva} onGuardado={onGuardado} onCerrar={vi.fn()} />
    </QueryClientProvider>,
  );
  return onGuardado;
}
/** Los controles que solo se ven en celular (clase md:hidden en ellos o en su contenedor). */
const soloCelular = (el: HTMLElement) => el.closest('.md\\:hidden') !== null;

it('U-09: el formulario de una visita nueva muestra arriba el aviso de que la ronda ya tiene una evaluación cerrada', async () => {
  montarPantalla(vi.fn(), 'Esta ronda ya tiene una evaluación cerrada (20-10-2026). Estás agregando una nueva.');
  await screen.findByText(/0 de 2 obligatorios/);
  expect(screen.getByText('Esta ronda ya tiene una evaluación cerrada (20-10-2026). Estás agregando una nueva.')).toHaveAttribute('role', 'status');
});

it('U-09: sin visita nueva no hay aviso', async () => {
  montarPantalla();
  await screen.findByText(/0 de 2 obligatorios/);
  expect(screen.queryByText(/Estás agregando una nueva/)).not.toBeInTheDocument();
});

it('U-05: a 390 px hay «Guardar borrador» en la barra inferior y en el paso Revisar, y guardan un borrador en el servidor', async () => {
  const onGuardado = montarPantalla();
  await screen.findByText(/0 de 2 obligatorios/);
  const celular = screen.getAllByRole('button', { name: 'Guardar borrador' }).filter(soloCelular);
  expect(celular).toHaveLength(2); // barra inferior + paso Revisar
  fireEvent.click(celular[0]);
  await waitFor(() => expect(m.crear).toHaveBeenCalledWith(expect.objectContaining({ estado: 'borrador' }), expect.any(String)));
  await waitFor(() => expect(onGuardado).toHaveBeenCalledWith('borrador', { llenos: 0, total: 2 }));
});

it('U-05: el chip del borrador local dice que vive solo en este teléfono', async () => {
  montarPantalla();
  await screen.findByText(/0 de 2 obligatorios/);
  const brotacion = screen.getByRole('group', { name: 'Brotación' });
  fireEvent.click(within(brotacion).getByRole('button', { name: '4' }));
  expect(await screen.findByText(/Borrador guardado localmente/, undefined, { timeout: 4000 })).toHaveTextContent('solo en este teléfono');
});

it('U-19: al guardar informa los obligatorios cargados para el aviso «P11 guardada · 15/15»', async () => {
  const onGuardado = montarPantalla();
  await screen.findByText(/0 de 2 obligatorios/);
  fireEvent.click(within(screen.getByRole('group', { name: 'Brotación' })).getByRole('button', { name: '4' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Floración' })).getByRole('button', { name: '3' }));
  fireEvent.click(screen.getByRole('button', { name: /Finalizar y seguir con P2/ }));
  await waitFor(() => expect(onGuardado).toHaveBeenCalledWith('completa', { llenos: 2, total: 2 }, 'seguir'));
});

it('U-08: a 390 px un error de campo aparece también en un aviso fijo sobre la barra inferior, con acceso al campo', async () => {
  montarPantalla();
  await screen.findByText(/0 de 2 obligatorios/);
  fireEvent.click(screen.getByRole('button', { name: 'Agregar brotes y varas basales' }));
  fireEvent.click(within(screen.getByRole('region', { name: 'Brotes y varas basales' })).getByRole('button', { name: 'Empezar' }));
  const varas = screen.getByLabelText('Varas basales');
  fireEvent.change(varas, { target: { value: '-3' } });
  expect(varas).toHaveAttribute('aria-invalid', 'true');
  const aviso = screen.getAllByRole('status').find((el) => el.textContent?.includes('Varas basales no puede ser negativo.') && el.className.includes('fixed'));
  expect(aviso).toBeDefined();
  expect(within(aviso as HTMLElement).getByRole('button', { name: 'Ir al campo' })).toBeInTheDocument();
  (varas as HTMLInputElement).blur();
  fireEvent.click(within(aviso as HTMLElement).getByRole('button', { name: 'Ir al campo' }));
  await waitFor(() => expect(varas).toHaveFocus());
});

it('U-20: el evaluador arranca con el nombre corto de la cuenta, es editable y no cuenta como cambio sin guardar', async () => {
  m.auth.perfil = { nombre: 'María Soto' };
  const confirmacion = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const onCerrar = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EvaluacionForm rondaId="r1" plantaId="p1" numeroRonda={1} codigoIndividuo="90-901-P1" variante="pantalla" onCerrar={onCerrar} />
    </QueryClientProvider>,
  );
  const evaluador = await screen.findByLabelText('Evaluador (opcional)');
  expect(evaluador).toHaveValue('M. Soto');
  // Un valor inicial no es un cambio: cancelar no pregunta si se descarta el borrador.
  fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar' })[0]);
  expect(confirmacion).not.toHaveBeenCalled();
  expect(onCerrar).toHaveBeenCalled();
  // Editable, y es lo que se guarda.
  fireEvent.change(evaluador, { target: { value: 'Equipo B' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Guardar borrador' })[0]);
  await waitFor(() => expect(m.crear).toHaveBeenCalledWith(expect.objectContaining({ evaluador: 'Equipo B' }), expect.any(String)));
  confirmacion.mockRestore();
});

it('U-20: sin nombre disponible el evaluador queda vacío y el campo muestra «(cuenta)»', async () => {
  montar();
  const evaluador = await screen.findByLabelText('Evaluador (opcional)');
  expect(evaluador).toHaveValue('');
  expect(evaluador).toHaveAttribute('placeholder', '(cuenta)');
});

it('U-09: en una ronda con evaluación cerrada y un borrador de visita nueva, reabrir ofrece continuar ese borrador (no un formulario vacío que chocaría con el índice único) y el aviso queda arriba', async () => {
  m.borrador.mockResolvedValue({ ...borrador, created_by: 'yo', protocolo_id: null, calibre_mm: null, sin_muestra: false });
  const aviso = 'Esta ronda ya tiene una evaluación cerrada (20-10-2026). Estás agregando una nueva.';
  montarPantalla(vi.fn(), aviso);
  expect(await screen.findByText(/ya tiene un borrador sin terminar/i)).toBeInTheDocument();
  expect(screen.queryByLabelText('Varas basales')).not.toBeInTheDocument(); // el formulario en blanco no está montado
  fireEvent.click(screen.getByRole('button', { name: /continuar borrador/i }));
  expect(await screen.findByText(aviso)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Guardar borrador' })[0]);
  await waitFor(() => expect(m.actualizar).toHaveBeenCalled());
  expect(m.crear).not.toHaveBeenCalled(); // actualiza el borrador existente, no crea una segunda fila
});

// --- Distribución de flores y frutos en la vara (EF12) y rendimiento t/ha desactivado (EF11) -------------

const NIVELES = ['Solo en la punta', 'Hasta la mitad', 'Toda la vara'];

it('la distribución de flores y frutos va en Brotes y varas, justo después de «Color del follaje», con el texto de cada nivel', async () => {
  montar();
  await screen.findByText(/0 de 2 obligatorios/);
  fireEvent.click(screen.getByRole('button', { name: 'Agregar brotes y varas basales' })); // fuera del protocolo: se despliega
  const follaje = screen.getByRole('group', { name: 'Color del follaje' });
  const concentracion = screen.getByRole('group', { name: 'Concentración cosecha' });
  const distribucion = screen.getByRole('group', { name: 'Distribución de flores y frutos en la vara' });
  expect(within(distribucion).getAllByRole('button').map((b) => b.textContent)).toEqual(NIVELES);
  // Es el elemento que sigue a «Color del follaje» dentro de la misma rejilla...
  expect(follaje.nextElementSibling).toBe(distribucion);
  // ...y ya no comparte rejilla con la fenología.
  expect(concentracion.parentElement).not.toBe(distribucion.parentElement);
  expect(concentracion.nextElementSibling).not.toBe(distribucion);
});

it('es opcional: se guarda sin ella, y el nivel elegido viaja como número sin enviar rend_t_ha', async () => {
  montar();
  await screen.findByText(/0 de 2 obligatorios/);
  fireEvent.click(screen.getByRole('button', { name: 'Agregar brotes y varas basales' })); // fuera del protocolo: se despliega
  fireEvent.click(within(screen.getByRole('group', { name: 'Distribución de flores y frutos en la vara' })).getByRole('button', { name: 'Hasta la mitad' }));
  fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
  await waitFor(() => expect(m.crear).toHaveBeenCalled());
  const [campos] = m.crear.mock.calls[0] as unknown as [Record<string, unknown>];
  expect(campos).toMatchObject({ estado: 'borrador', distribucion_flores_frutos: 2 });
  expect(campos).not.toHaveProperty('rend_t_ha');
});

it('si el protocolo la pide obligatoria, cuenta como obligatorio y su falta avisa sin bloquear', async () => {
  m.vigente.mockResolvedValue({ ...protocolo, descriptores: { brotacion: 'obligatorio', distribucion_flores_frutos: 'obligatorio' } });
  montar();
  await screen.findByText(/0 de 2 obligatorios/);
  fireEvent.click(within(screen.getByRole('group', { name: 'Brotación' })).getByRole('button', { name: '4' }));
  expect(screen.getByText(/1 de 2 obligatorios/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /finalizar evaluación/i }));
  const aviso = await screen.findByRole('alert');
  expect(aviso).toHaveTextContent('Faltan 1 obligatorios: 1 de Brotes y varas basales');
  expect(m.crear).not.toHaveBeenCalled();
  fireEvent.click(within(aviso).getByRole('button', { name: 'Seguir completando' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Distribución de flores y frutos en la vara' })).getByRole('button', { name: 'Toda la vara' }));
  expect(screen.getByText(/2 de 2 obligatorios/)).toBeInTheDocument();
});

it('un protocolo antiguo con rend_t_ha obligatorio no cuenta ese campo (ya no se puede llenar)', async () => {
  m.vigente.mockResolvedValue({ ...protocolo, descriptores: { brotacion: 'obligatorio', rend_t_ha: 'obligatorio' } });
  montar();
  expect(await screen.findByText(/0 de 1 obligatorios/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Rendimiento (t/ha)')).not.toBeInTheDocument();
});

it('al continuar un borrador, la distribución vaciada viaja como null y el rend_t_ha histórico no se toca', async () => {
  m.auth.esAdmin = true;
  m.borrador.mockResolvedValue({ ...borrador, distribucion_flores_frutos: 3, rend_t_ha: 12.5 });
  montar();
  fireEvent.click(await screen.findByRole('button', { name: /Continuar borrador/ }));
  const toda = await within(await screen.findByRole('group', { name: 'Distribución de flores y frutos en la vara' })).findByRole('button', { name: 'Toda la vara' });
  expect(toda).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(toda); // volver a tocarla la vacía
  fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
  await waitFor(() => expect(m.actualizar).toHaveBeenCalled());
  const [, cambios] = m.actualizar.mock.calls[0] as unknown as [string, Record<string, unknown>];
  expect(cambios.distribucion_flores_frutos).toBeNull();
  expect(cambios).not.toHaveProperty('rend_t_ha');
});
