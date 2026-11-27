import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilaPlanilla, PlanillaRonda } from '@/api/protocolo';
import { ejecutarEnLote } from './lote';
import { IniciarRondaLote, motivoFallo } from './IniciarRondaLote';

const m = vi.hoisted(() => ({ planilla: vi.fn(), iniciar: vi.fn() }));
vi.mock('@/api/protocolo', () => ({ obtenerPlanillaRonda: m.planilla }));
vi.mock('@/api/rondas', () => ({ iniciarRonda: m.iniciar }));

const fila = (n: number, estado: FilaPlanilla['estado']): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `02-001-P${n}`, numero: n, ronda_id: estado === 'sin_ronda' ? null : `r${n}`, estado,
  evaluacion_id: null, evaluacion_updated_at: null, fecha: null, evaluador: null, es_mia: false,
  protocolo_id: null, protocolo_distinto: false, estados: null, conteo: null,
});
const planillaCon = (filas: FilaPlanilla[]): PlanillaRonda => ({
  planta_id: 'p', tipo_ronda: 'anual', numero_ronda: 1, protocolo: null,
  avance: { vivos: filas.length, sin_ronda: filas.filter((f) => f.estado === 'sin_ronda').length, sin_iniciar: 0, borrador: 0, completa: 0 },
  individuos: filas,
});

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('ejecutarEnLote', () => {
  it('nunca pasa de 5 a la vez, no corta por errores e informa el avance', async () => {
    let enCurso = 0;
    let maximo = 0;
    const avance: number[] = [];
    const r = await ejecutarEnLote(Array.from({ length: 23 }, (_, i) => i), async (i) => {
      enCurso += 1; maximo = Math.max(maximo, enCurso);
      await new Promise((res) => setTimeout(res, 1));
      enCurso -= 1;
      if (i % 7 === 3) throw new Error(`falla ${i}`);
    }, { concurrencia: 5, onAvance: (t) => avance.push(t) });
    expect(maximo).toBeLessThanOrEqual(5);
    expect(r.hechos).toHaveLength(20);
    expect(r.fallidos.map((f) => f.item).sort((a, b) => a - b)).toEqual([3, 10, 17]);
    expect(avance.at(-1)).toBe(23);
  });
});

describe('IniciarRondaLote', () => {
  // 3 con ronda, 6 sin ronda; P5 falla la primera vez.
  const filas = [fila(1, 'sin_iniciar'), fila(2, 'borrador'), fila(3, 'completa'), ...[4, 5, 6, 7, 8, 9].map((n) => fila(n, 'sin_ronda'))];
  beforeEach(() => {
    m.planilla.mockResolvedValue(planillaCon(filas));
    m.iniciar.mockImplementation(async (id: string) => {
      if (id === 'i5' && !m.iniciar.mock.calls.slice(0, -1).some(([x]) => x === 'i5')) throw Object.assign(new Error('No se pudo conectar.'), { code: undefined });
      return { ronda_id: `nueva-${id}`, numero_ronda: 1 };
    });
  });

  function montar(onDefinirProtocolo = vi.fn()) {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IniciarRondaLote plantaId="p" planilla={planillaCon(filas)} onDefinirProtocolo={onDefinirProtocolo} />
      </QueryClientProvider>,
    );
    return onDefinirProtocolo;
  }

  it('confirma cuántos son, sugiere el protocolo, resume y reintenta solo las fallidas', async () => {
    const onDefinir = montar();
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar ronda 1 para los 6 individuos vivos sin ronda' }));
    const confirmar = await screen.findByRole('region', { name: 'Confirmar inicio de ronda' });
    expect(confirmar).toHaveTextContent('Se iniciará la ronda 1 para 6 individuos vivos');
    expect(confirmar).toHaveTextContent('Los 3 que ya la tienen no se tocan');
    expect(confirmar).toHaveTextContent('todavía no tiene protocolo');
    expect(within(confirmar).getByRole('button', { name: 'Definir protocolo primero' })).toBeInTheDocument();

    fireEvent.click(within(confirmar).getByRole('button', { name: 'Iniciar ronda 1 para 6' }));
    const resumen = await screen.findByRole('region', { name: 'Resultado del inicio de ronda' });
    expect(resumen).toHaveTextContent('5 iniciadas');
    expect(resumen).toHaveTextContent('3 ya la tenían');
    expect(resumen).toHaveTextContent('1 fallidas');
    expect(resumen).toHaveTextContent('P5: No se pudo conectar.');
    // Solo se llamó por los 6 sin ronda, nunca por los que ya la tenían.
    expect(m.iniciar.mock.calls.map(([id]) => id).sort()).toEqual(['i4', 'i5', 'i6', 'i7', 'i8', 'i9']);
    expect(m.iniciar.mock.calls.every(([, numero]) => numero === 1)).toBe(true);

    // Reintentar: la planilla fresca dice que P5 sigue sin ronda; solo se reintenta P5.
    m.planilla.mockResolvedValue(planillaCon(filas.map((f) => (f.estado === 'sin_ronda' && f.individuo_id !== 'i5' ? { ...f, estado: 'sin_iniciar' as const } : f))));
    fireEvent.click(within(resumen).getByRole('button', { name: /Reintentar fallidas/ }));
    fireEvent.click(within(await screen.findByRole('region', { name: 'Confirmar inicio de ronda' })).getByRole('button', { name: 'Iniciar ronda 1 para 1' }));
    const resumen2 = await screen.findByRole('region', { name: 'Resultado del inicio de ronda' });
    await waitFor(() => expect(resumen2).toHaveTextContent('1 iniciadas'));
    expect(resumen2).toHaveTextContent('0 fallidas');
    expect(m.iniciar).toHaveBeenCalledTimes(7);
    expect(onDefinir).not.toHaveBeenCalled();
  });

  it('repetirlo cuando otro ya inició algunas: solo toca a los que siguen sin ronda', async () => {
    montar();
    // Entre que se dibujó el botón y el clic, otra persona inició P4..P7.
    m.planilla.mockResolvedValue(planillaCon(filas.map((f) => (['i4', 'i5', 'i6', 'i7'].includes(f.individuo_id) ? { ...f, estado: 'sin_iniciar' as const } : f))));
    fireEvent.click(screen.getByRole('button', { name: /Iniciar ronda 1 para los 6/ }));
    const confirmar = await screen.findByRole('region', { name: 'Confirmar inicio de ronda' });
    expect(confirmar).toHaveTextContent('para 2 individuos vivos');
    expect(confirmar).toHaveTextContent('Los 7 que ya la tienen no se tocan');
    fireEvent.click(within(confirmar).getByRole('button', { name: 'Iniciar ronda 1 para 2' }));
    await screen.findByRole('region', { name: 'Resultado del inicio de ronda' });
    expect(m.iniciar.mock.calls.map(([id]) => id).sort()).toEqual(['i8', 'i9']);
  });

  it('«Definir protocolo primero» cierra la confirmación y abre el editor', async () => {
    const onDefinir = montar();
    fireEvent.click(screen.getByRole('button', { name: /Iniciar ronda 1 para los 6/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Definir protocolo primero' }));
    expect(onDefinir).toHaveBeenCalledTimes(1);
    expect(m.iniciar).not.toHaveBeenCalled();
  });
});

describe('IniciarRondaLote con la ronda anterior sin cerrar', () => {
  const MENSAJE = 'La ronda 1 todavía no tiene una evaluación completa. Ciérrala antes de iniciar la siguiente.';
  const filas = [fila(1, 'completa'), ...[2, 3, 4].map((n) => fila(n, 'sin_ronda'))];

  it('los individuos cuya ronda anterior sigue abierta salen como omitidos con el mensaje de la base, no como fallidos ni iniciados', async () => {
    m.planilla.mockResolvedValue({ ...planillaCon(filas), numero_ronda: 2 });
    m.iniciar.mockImplementation(async (id: string) => {
      if (id === 'i3') throw Object.assign(new Error(MENSAJE), { code: '55000' });
      if (id === 'i4') throw Object.assign(new Error('No se pudo conectar.'), { code: undefined });
      return { ronda_id: `nueva-${id}`, numero_ronda: 2 };
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IniciarRondaLote plantaId="p" planilla={{ ...planillaCon(filas), numero_ronda: 2 }} onDefinirProtocolo={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Iniciar ronda 2 para los 3/ }));
    fireEvent.click(within(await screen.findByRole('region', { name: 'Confirmar inicio de ronda' })).getByRole('button', { name: 'Iniciar ronda 2 para 3' }));
    const resumen = await screen.findByRole('region', { name: 'Resultado del inicio de ronda' });
    expect(resumen).toHaveTextContent('1 iniciadas');
    expect(resumen).toHaveTextContent('1 omitidas');
    expect(resumen).toHaveTextContent('1 fallidas');
    expect(within(within(resumen).getByRole('list', { name: 'Omitidas' })).getByRole('listitem')).toHaveTextContent(`P3: ${MENSAJE}`);
    expect(resumen).toHaveTextContent('P4: No se pudo conectar.');
    // Reintentar solo vuelve a intentar la fallida de verdad (P4), no la omitida (P3).
    fireEvent.click(within(resumen).getByRole('button', { name: /Reintentar fallidas/ }));
    expect(await screen.findByRole('region', { name: 'Confirmar inicio de ronda' })).toHaveTextContent('para 1 individuos vivos');
  });

  it('motivoFallo muestra el mensaje de la base para la ronda anterior sin cerrar y conserva el genérico para «las rondas cambiaron»', () => {
    expect(motivoFallo(Object.assign(new Error(MENSAJE), { code: '55000' }))).toBe(MENSAJE);
    expect(motivoFallo(Object.assign(new Error('Las rondas cambiaron. Recarga el listado antes de iniciar otra.'), { code: '55000' }))).toMatch(/no coinciden/);
  });
});
