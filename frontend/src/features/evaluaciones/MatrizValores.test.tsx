/**
 * «Ver valores»: la distribución de flores y frutos se escribe con el texto del nivel, y el rend_t_ha desactivado (EF11) solo
 * es una columna cuando alguna evaluación de la ronda ya trae un valor (el dato histórico se conserva).
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DescriptoresProtocolo, FilaPlanilla } from '@/api/protocolo';
import { ESQUEMA_EVALUACION_ANUAL } from '@/lib/esquemaFase/evaluacionAnual';
import { MatrizValores, textoCelda } from './MatrizValores';

const mocks = vi.hoisted(() => ({ valores: vi.fn() }));
vi.mock('@/api/valoresRonda', () => ({ listarValoresDeRonda: mocks.valores }));

const fila = (n: number, estados: FilaPlanilla['estados']): FilaPlanilla => ({
  individuo_id: `i${n}`, codigo_display: `90-901-P${n}`, numero: n, ronda_id: `r${n}`, estado: 'completa',
  evaluacion_id: `e${n}`, evaluacion_updated_at: '2026-10-20T12:00:00Z', fecha: '2026-10-20', evaluador: 'Equipo',
  es_mia: true, protocolo_id: 'p1', protocolo_distinto: false, estados, conteo: { medido: 1, falto: 0, no_evaluado: 0, marcado: 0 },
});

function montar(descriptores: DescriptoresProtocolo | null, estados: FilaPlanilla['estados'] = { brotacion: 'medido' }) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MatrizValores
        plantaId="p" numero={2} tipo="anual" filas={[fila(1, estados)]} descriptores={descriptores}
        esquema={ESQUEMA_EVALUACION_ANUAL} onAbrir={vi.fn()} onVer={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const encabezados = () => screen.getAllByRole('columnheader').map((th) => th.textContent ?? '');

beforeEach(() => { mocks.valores.mockResolvedValue(new Map([['e1', { brotacion: 4, distribucion_flores_frutos: 2 }]])); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('textoCelda', () => {
  const campo = (clave: string) => ESQUEMA_EVALUACION_ANUAL.campos.find((c) => c.clave === clave)!;
  it('escribe el nivel de la distribución y deja las demás escalas como número', () => {
    expect(textoCelda(campo('distribucion_flores_frutos'), 1)).toBe('Solo en la punta');
    expect(textoCelda(campo('distribucion_flores_frutos'), 2)).toBe('Hasta la mitad');
    expect(textoCelda(campo('distribucion_flores_frutos'), 3)).toBe('Toda la vara');
    expect(textoCelda(campo('distribucion_flores_frutos'), null)).toBe('—');
    expect(textoCelda(campo('brotacion'), 4)).toBe('4');
  });
});

describe('MatrizValores', () => {
  it('muestra la distribución como columna con el texto del nivel en la celda', async () => {
    montar({ brotacion: 'obligatorio', distribucion_flores_frutos: 'opcional' }, { brotacion: 'medido', distribucion_flores_frutos: 'medido' });
    const celda = await screen.findByText('Hasta la mitad');
    expect(celda.tagName).toBe('TD');
    expect(encabezados().some((t) => t.includes('Distrib.'))).toBe(true);
    expect(within(screen.getByRole('table')).getAllByRole('row').at(-1)).toHaveTextContent('4');
  });

  it('sin protocolo, la distribución es columna solo si alguna evaluación la llenó', async () => {
    montar(null, { brotacion: 'medido', distribucion_flores_frutos: 'medido' });
    await screen.findByText('Hasta la mitad');
    cleanup();
    mocks.valores.mockResolvedValue(new Map([['e1', { brotacion: 4 }]]));
    montar(null);
    await screen.findByRole('table');
    expect(encabezados().some((t) => t.includes('Distrib.'))).toBe(false);
  });

  it('rend_t_ha desactivado: no hay columna si ninguna evaluación de la ronda trae valor', async () => {
    montar({ brotacion: 'obligatorio' });
    await screen.findByRole('table');
    expect(encabezados().some((t) => t.includes('t/ha'))).toBe(false);
  });

  it('rend_t_ha desactivado: con un valor histórico la columna se conserva y se muestra', async () => {
    mocks.valores.mockResolvedValue(new Map([['e1', { brotacion: 4, rend_t_ha: 12.5 }]]));
    montar(null, { brotacion: 'medido', rend_t_ha: 'medido' });
    expect(await screen.findByText('12,5')).toBeInTheDocument();
    expect(encabezados().some((t) => t.includes('t/ha'))).toBe(true);
  });

  it('un protocolo antiguo con rend_t_ha no crea esa columna si nadie tiene valor', async () => {
    montar({ brotacion: 'obligatorio', rend_t_ha: 'opcional' } as DescriptoresProtocolo);
    await screen.findByRole('table');
    expect(encabezados().some((t) => t.includes('t/ha'))).toBe(false);
  });
});
