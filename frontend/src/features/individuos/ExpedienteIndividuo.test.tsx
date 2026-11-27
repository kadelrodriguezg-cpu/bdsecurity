import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpedienteIndividuo } from './ExpedienteIndividuo';
import { qk } from '@/lib/queryKeys';
const mocks = vi.hoisted(() => ({ rondas: vi.fn(), evaluaciones: vi.fn(), pcr: vi.fn(), motivos: vi.fn(), borrador: vi.fn(), correcciones: vi.fn(), reactivar: vi.fn(), reactivaciones: vi.fn() }));
vi.mock('@/api/correcciones', () => ({ obtenerCorrecciones: mocks.correcciones }));
vi.mock('@/api/rondas', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/rondas')>(), listarRondas: mocks.rondas, listarEvaluacionesDeRonda: mocks.evaluaciones, listarPcrDeRonda: mocks.pcr, buscarBorradorDeRonda: mocks.borrador }));
vi.mock('@/api/individuos', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/individuos')>(), listarBajaMotivos: mocks.motivos, reactivarIndividuo: mocks.reactivar, listarReactivaciones: mocks.reactivaciones }));
vi.mock('./PcrForm', () => ({ PcrForm: () => <input aria-label="PCR abierto" /> }));
vi.mock('./AccionesFaseIndividuo', () => ({ AccionesFaseIndividuo: ({ estadoCruce }: { estadoCruce: string }) => <p>acciones de la fase {estadoCruce}</p> }));
const individuo = { id: 'i1', planta_id: 'p1', codigo_display: 'TEST-P1', clon_de_id: null, estado_vital: 'vivo' as const, fecha_baja: null, created_at: '2026-10-01' };
const ronda = { id: 'r1', individuo_id: 'i1', numero_ronda: 1, anio: 2026, tipo: 'anual', created_at: '2026-10-01' };
const evaluacion = (estado: string) => ({ id: 'e1', ronda_id: 'r1', estado, fecha: '2026-10-10', evaluador: 'Persona de prueba', created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-10T10:00:00Z' });
function Ruta() {
  const { pathname, search } = useLocation();
  return <p data-testid="ruta">{pathname + search}</p>;
}
function montar(client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), props: Partial<React.ComponentProps<typeof ExpedienteIndividuo>> = {}) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/planta/p1']}>
        <Routes>
          <Route path="/planta/:id" element={<ExpedienteIndividuo individuo={individuo} plantaId="p1" codigoSistema="TEST" ranking={undefined} {...props} />} />
          <Route path="*" element={<Ruta />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => { mocks.rondas.mockResolvedValue([ronda]); mocks.evaluaciones.mockResolvedValue([]); mocks.pcr.mockResolvedValue([]); mocks.motivos.mockResolvedValue([]); mocks.borrador.mockResolvedValue(null); mocks.reactivaciones.mockResolvedValue([]); mocks.reactivar.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('rondas diferidas no se presentan como cero ni habilitan iniciar ronda 1', async () => {
  let resolver!: (data: unknown[]) => void;
  mocks.rondas.mockReturnValue(new Promise((resolve) => { resolver = resolve; }));
  montar();
  expect(screen.getByRole('status')).toHaveTextContent('Cargando información');
  expect(screen.queryByRole('button', { name: 'Iniciar ronda 1' })).not.toBeInTheDocument();
  expect(screen.queryByText('sin PCR')).not.toBeInTheDocument();
  expect(screen.queryByText('0 de 3')).not.toBeInTheDocument();
  await act(async () => resolver([]));
  expect(await screen.findByRole('button', { name: 'Iniciar ronda 1' })).toBeEnabled();
  expect(mocks.motivos).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('errores de evaluaciones y PCR no se presentan como ausencia y retry no recarga rondas', async () => {
  mocks.evaluaciones.mockRejectedValue(new Error('ERROR INTERNO SQL'));
  mocks.pcr.mockRejectedValue(new Error('ERROR INTERNO SQL'));
  montar();
  await screen.findByRole('button', { name: 'Reintentar evaluaciones de ronda 1' });
  fireEvent.click(screen.getByRole('tab', { name: /Evaluaciones/ }));
  expect(await screen.findByText('Evaluaciones sin confirmar.')).toBeInTheDocument();
  expect(screen.queryByText('Esta ronda todavía no tiene evaluaciones cargadas.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /PCR/ }));
  expect(screen.getByText('PCR sin confirmar.')).toBeInTheDocument();
  mocks.pcr.mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar PCR de ronda 1' }));
  expect(await screen.findByText('Esta ronda todavía no tiene PCR cargado.')).toBeInTheDocument();
  expect(mocks.rondas).toHaveBeenCalledTimes(1);
  expect(mocks.evaluaciones).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('ERROR INTERNO SQL')).not.toBeInTheDocument();
  // Sin confirmar si la ronda 1 está cerrada, la 2 no se ofrece habilitada.
  expect(screen.getByRole('button', { name: 'Iniciar ronda 2' })).toBeDisabled();
});
it('error de refresco conserva el Sheet de PCR y su campo editado', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  montar(client);
  fireEvent.click(await screen.findByRole('button', { name: 'Adjuntar PCR' }));
  const input = screen.getByLabelText('PCR abierto');
  fireEvent.change(input, { target: { value: 'Edición en curso' } });
  mocks.rondas.mockRejectedValue(new Error('privado'));
  await act(async () => { await client.invalidateQueries({ queryKey: qk.rondas.individuo('i1') }); });
  await screen.findByRole('button', { name: 'Reintentar rondas' });
  expect(screen.getByLabelText('PCR abierto')).toBe(input);
  expect(input).toHaveValue('Edición en curso');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('«Nueva evaluación» abre la evaluación a pantalla completa de la ronda del individuo y vuelve a su expediente', async () => {
  montar();
  fireEvent.click(await screen.findByRole('button', { name: 'Nueva evaluación' }));
  const volver = encodeURIComponent('/planta/p1?pestana=individuos&individuo=i1');
  expect(screen.getByTestId('ruta')).toHaveTextContent(`/planta/p1/evaluar/i1?ronda=1&volver=${volver}`);
});
it('con un borrador: aviso neutro «Borrador en curso · Continuar» (no rojo) y el botón principal lo continúa', async () => {
  mocks.borrador.mockResolvedValue(evaluacion('borrador'));
  montar();
  expect(await screen.findByText('Borrador en curso')).toBeInTheDocument();
  expect(screen.queryByText(/Sin evaluaciones registradas/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuar borrador' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(screen.getByTestId('ruta')).toHaveTextContent('/planta/p1/evaluar/i1?ronda=1');
});
it('sin evaluaciones ni borrador: el aviso es informativo, no un error', async () => {
  montar();
  expect(await screen.findByText(/Sin evaluaciones registradas/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('«Iniciar ronda 2» queda deshabilitado con el motivo mientras la ronda 1 no esté cerrada', async () => {
  mocks.borrador.mockResolvedValue(evaluacion('borrador'));
  montar();
  expect(await screen.findByText('Termina la ronda 1 antes de iniciar la 2.')).toBeInTheDocument();
  const boton = screen.getByRole('button', { name: 'Iniciar ronda 2' });
  expect(boton).toBeDisabled();
  expect(boton).toHaveAccessibleDescription('Termina la ronda 1 antes de iniciar la 2.');
});
it('«Iniciar ronda 2» se habilita con la ronda 1 cerrada (evaluación completa)', async () => {
  mocks.evaluaciones.mockResolvedValue([evaluacion('completa')]);
  montar();
  expect(await screen.findByRole('button', { name: 'Iniciar ronda 2' })).toBeEnabled();
  expect(screen.queryByText(/Termina la ronda 1/)).not.toBeInTheDocument();
});
it('S2-4: el puntaje y el puesto son los del ranking por grupos; sin puntaje por revisión no inventa un puesto', async () => {
  const fila = { individuo_id: 'i1', puntaje: 0.8567, posicion_grupo: 2, tamano_grupo: 12, grupo: ['fenologia', 'fruto_calidad'], estado_ranking: 'comparable' } as never;
  const { unmount } = montar(undefined, { ranking: fila, empatadoCon: 2 });
  expect(await screen.findByText('85,7')).toBeInTheDocument();
  // G19 y G20: el puesto dice su alcance (dentro del cruce) y con cuántos empata.
  expect(screen.getByText('Puesto 2 de 12 dentro del cruce TEST · empatado con 2 (Fruto · Fenología)')).toBeInTheDocument();
  unmount();
  montar(undefined, { ranking: { ...(fila as object), puntaje: null, posicion_grupo: null, tamano_grupo: null, estado_ranking: 'excluida_revision' } as never });
  expect(await screen.findByText('Excluida por revisión')).toBeInTheDocument();
  expect(screen.queryByText(/Puesto/)).not.toBeInTheDocument();
});

it('v3 paso 4: dentro de la hoja del celular no repite el código ni el botón «‹» (la hoja ya tiene título y X)', async () => {
  const volver = vi.fn();
  montar(undefined, { onVolver: volver, enHoja: true });
  await screen.findByText('Vivo');
  expect(screen.queryByText(individuo.codigo_display)).not.toBeInTheDocument();
  expect(document.querySelector('button.md\:hidden')).toBeNull();
});

it('fuera de la hoja sigue mostrando el código', async () => {
  montar(undefined, { onVolver: vi.fn() });
  expect(await screen.findByText(individuo.codigo_display)).toBeInTheDocument();
});

it('v3 paso 4: fuera de Evaluación anual no ofrece iniciar rondas ni nueva evaluación anual', async () => {
  montar(undefined, { estadoCruce: 'crecimiento' });
  // «Adjuntar PCR» aparece cuando ya cargaron las rondas: recién ahí se puede afirmar lo que falta.
  await screen.findByRole('button', { name: 'Adjuntar PCR' });
  expect(screen.queryByRole('button', { name: /Iniciar ronda/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nueva evaluación' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Imprimir etiqueta/ })).toBeInTheDocument();
});

it('v3 paso 4: en Proceso finalizado ya no se clona (igual que la lista vieja)', async () => {
  montar(undefined, { estadoCruce: 'proceso_finalizado' });
  await screen.findByText('Vivo');
  expect(screen.queryByRole('button', { name: /Clonar/ })).not.toBeInTheDocument();
});

it('v3 paso 4 (control): en Evaluación anual, con las rondas cargadas, sí ofrece la nueva evaluación', async () => {
  montar();
  await screen.findByRole('button', { name: 'Adjuntar PCR' });
  expect(screen.getByRole('button', { name: 'Nueva evaluación' })).toBeInTheDocument();
});
it('A8: en la pestaña Evaluaciones, una evaluación corregida muestra quién, cuándo y por qué (y no consulta si no hay corregidas)', async () => {
  mocks.evaluaciones.mockResolvedValue([{ ...evaluacion('completa'), brotacion: 3 }]);
  const { unmount } = montar();
  fireEvent.click(await screen.findByRole('tab', { name: /Evaluaciones/ }));
  await screen.findByText('Ver evaluación');
  expect(mocks.correcciones).not.toHaveBeenCalled();
  unmount();
  mocks.evaluaciones.mockResolvedValue([{ ...evaluacion('corregida'), brotacion: 3, motivo_cambio: 'Brotación revisada' }]);
  mocks.correcciones.mockResolvedValue([{ evaluacion_id: 'e1', fecha: '2026-10-21T15:04:00Z', corregido_por: 'Ana Rojas', motivo: 'Brotación revisada', campos: ['brotacion'] }]);
  montar();
  fireEvent.click(await screen.findByRole('tab', { name: /Evaluaciones/ }));
  expect(await screen.findByText('Corregida por Ana Rojas el 21-10-2026, 12:04 · Motivo: Brotación revisada')).toBeInTheDocument();
  expect(mocks.correcciones).toHaveBeenCalledWith('i1');
});

it('scoring v2: el grupo de cinco categorías se escribe por peso (Fruto · Producción · Fenología · Brotes · Estrés), aunque la base lo entregue en orden del enum', async () => {
  const fila = { individuo_id: 'i1', puntaje: 0.6, posicion_grupo: 1, tamano_grupo: 8, grupo: ['fenologia', 'fruto_calidad', 'produccion', 'brotes', 'estres'], estado_ranking: 'comparable' } as never;
  montar(undefined, { ranking: fila });
  expect(await screen.findByText('Puesto 1 de 8 dentro del cruce TEST (Fruto · Producción · Fenología · Brotes · Estrés)')).toBeInTheDocument();
});

describe('hallazgo 3 (G3): «No evaluada en esta ronda» en el expediente', () => {
  it('una ronda marcada se lee «No evaluada · Sin fruto», habilita la ronda siguiente y no ofrece evaluarla', async () => {
    mocks.rondas.mockResolvedValue([{ ...ronda, no_evaluada_motivo: 'sin_fruto', no_evaluada_detalle: null }]);
    montar(undefined, { esAdmin: true });
    expect(await screen.findByRole('button', { name: /Iniciar ronda 2/ })).toBeEnabled();
    expect(screen.getAllByText(/No evaluada · Sin fruto/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Nueva evaluación' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quitar «No evaluada»' })).toBeInTheDocument();
  });

  it('el admin puede marcar la ronda actual sin evaluar; el operario no', async () => {
    montar(undefined, { esAdmin: true });
    fireEvent.click(await screen.findByRole('button', { name: 'No evaluada en la ronda 1…' }));
    expect(await screen.findByRole('dialog', { name: /No evaluada en la ronda 1/ })).toBeInTheDocument();
    cleanup();
    montar(undefined, { esAdmin: false });
    await screen.findByRole('button', { name: 'Nueva evaluación' });
    expect(screen.queryByRole('button', { name: 'No evaluada en la ronda 1…' })).toBeNull();
  });
});

describe('hallazgo 6 (G4): reactivar una planta dada de baja', () => {
  const deBaja = { ...individuo, estado_vital: 'descartado' as const, fecha_baja: '2026-10-20' };

  it('el admin la reactiva con motivo; sin motivo no se puede confirmar', async () => {
    montar(undefined, { esAdmin: true, individuo: deBaja });
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar planta' }));
    const hoja = await screen.findByRole('dialog', { name: 'Reactivar TEST-P1' });
    const confirmar = within(hoja).getByRole('button', { name: 'Reactivar' });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(hoja).getByLabelText('Motivo (obligatorio)'), { target: { value: 'Baja registrada por error' } });
    fireEvent.click(confirmar);
    await waitFor(() => expect(mocks.reactivar).toHaveBeenCalledWith('i1', 'Baja registrada por error'));
  });

  it('el operario no ve «Reactivar planta»', async () => {
    montar(undefined, { esAdmin: false, individuo: deBaja });
    await screen.findByText('Individuo descartado', { exact: false });
    expect(screen.queryByRole('button', { name: 'Reactivar planta' })).toBeNull();
  });

  it('una planta reactivada muestra la reactivación en su historial', async () => {
    mocks.reactivaciones.mockResolvedValue([{ id: 'x1', estado_anterior: 'descartado', fecha_baja_anterior: '2026-10-20', motivo: 'Baja registrada por error', created_at: '2026-10-26T15:00:00Z' }]);
    montar(undefined, { esAdmin: false });
    expect((await screen.findByText(/Reactivada el 26-10-2026/)).closest('li')).toHaveTextContent('Baja registrada por error');
  });
});
it('Fase 5 (G7): «Año N» va junto al puntaje (edad = temporada de evaluación anual de la fila del ranking)', async () => {
  const fila = { individuo_id: 'i1', puntaje: 0.8567, posicion_grupo: 2, tamano_grupo: 12, grupo: ['fenologia'], estado_ranking: 'comparable', numero_ronda: 3 } as never;
  montar(undefined, { ranking: fila });
  const puntaje = await screen.findByText('85,7');
  expect(puntaje.closest('dd')).toHaveTextContent('85,7 · Año 3');
});
