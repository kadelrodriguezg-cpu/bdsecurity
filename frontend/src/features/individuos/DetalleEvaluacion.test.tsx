import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { EvaluacionRow } from '@/api/rondas';
import { DetalleEvaluacion, resumenDescriptores } from './DetalleEvaluacion';

const mocks = vi.hoisted(() => ({ estados: vi.fn() }));
vi.mock('@/api/esquemaFase', () => ({ obtenerEsquemaFase: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/api/protocolo', () => ({ obtenerEstadosEvaluacion: mocks.estados }));
beforeEach(() => { mocks.estados.mockReturnValue(new Promise(() => {})); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const conQuery = (ui: ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

const base: EvaluacionRow = {
  id: 'e1', ronda_id: 'r1', anio: 2026, fecha: '2026-10-20', estado: 'completa',
  peso_promedio_g: null, pct_flores: null, pct_frutos: null, requiere_revision: false,
  motivo_cambio: null, updated_at: '2026-10-20T12:00:00Z', created_at: '2026-10-20T12:00:00Z',
};

it('muestra todo lo guardado, incluidos brotes, yemas, inicio de floración y precocidad', () => {
  render(conQuery(<DetalleEvaluacion evaluacion={{
    ...base,
    evaluador: 'Efraín',
    brotacion: 4, presencia_yemas_florales: 0, fecha_inicio_floracion: '2026-09-15', precocidad: 3,
    n_varas_basales: 6, n_varas_con_flor: 3, pct_flores: 50, altura_brote_mm: 120, color_follaje: 5,
    observaciones: 'Planta sana',
  }} />));
  const fenologia = within(screen.getByRole('region', { name: 'Fenología' }));
  expect(fenologia.getByText('Presencia de yemas florales').nextSibling).toHaveTextContent('0 de 5');
  expect(fenologia.getByText('Inicio de floración').nextSibling).toHaveTextContent('15-09-2026');
  // Precocidad con el mes de cosecha de cada nivel (Efraín): se lee el texto, no el número.
  expect(fenologia.getByText('Precocidad').nextSibling).toHaveTextContent('Media (dic)');
  const brotes = within(screen.getByRole('region', { name: 'Brotes y varas basales' }));
  expect(brotes.getByText('Varas basales').nextSibling).toHaveTextContent('6');
  expect(brotes.getByText('Altura del brote').nextSibling).toHaveTextContent('120 mm');
  expect(brotes.getByText('Color del follaje').nextSibling).toHaveTextContent('5 de 5');
  const produccion = within(screen.getByRole('region', { name: 'Producción' }));
  expect(produccion.getByText(/Cobertura floral/).nextSibling).toHaveTextContent('50 %');
  expect(screen.getByText('Planta sana')).toBeInTheDocument();
  expect(screen.getByText('Efraín')).toBeInTheDocument();
});

it('la fecha efectiva se lee dd-mm-aaaa, nunca ISO crudo (N23)', () => {
  render(conQuery(<DetalleEvaluacion evaluacion={base} />));
  const dd = screen.getByText('Fecha efectiva').nextSibling;
  expect(dd).toHaveTextContent('20-10-2026');
  expect(dd).not.toHaveTextContent('2026-10-20');
});

it('sin protocolo, lo que no tiene valor se nombra como «no evaluado»', () => {
  render(conQuery(<DetalleEvaluacion evaluacion={{ ...base, brotacion: 2 }} />));
  expect(within(screen.getByRole('region', { name: 'Fruto / Calidad' })).getByText(/^No evaluado: calibre, firmeza, color, bloom, brix\.$/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Fenología' })).getByText(/^No evaluado: presencia de yemas florales/)).toBeInTheDocument();
});

it('con protocolo: faltó (obligatorio), marcado para revisión y nivel de cada sección', async () => {
  mocks.estados.mockResolvedValue({
    evaluacion_id: 'e1',
    protocolo: { id: 'p1', version: 2, nombre: 'Ronda 1 anual', descriptores: { brotacion: 'obligatorio', floracion: 'obligatorio', calibre_mm: 'opcional' }, created_at: '2026-10-01' },
    estados: { brotacion: 'medido', floracion: 'falto', calibre_mm: 'marcado' },
  });
  render(conQuery(<DetalleEvaluacion evaluacion={{ ...base, brotacion: 4, calibre_mm: 41 }} />));
  expect(await screen.findByText('Ronda 1 anual · versión 2')).toBeInTheDocument();
  const fenologia = within(screen.getByRole('region', { name: 'Fenología' }));
  expect(fenologia.getByText('Floración').nextSibling).toHaveTextContent('Falta · era obligatorio');
  expect(fenologia.getByText('Obligatoria')).toBeInTheDocument();
  const fruto = within(screen.getByRole('region', { name: 'Fruto / Calidad' }));
  expect(fruto.getByText('Calibre').nextSibling).toHaveTextContent('41 mm');
  expect(fruto.getByText('Revisar')).toBeInTheDocument();
  expect(screen.getByText('Floración: Faltó')).toBeInTheDocument(); // huella accesible
});

// Desde el 25-10-2026 existe la distribución floral: una evaluación posterior cuenta 26 descriptores; una anterior, 25.
const posterior: EvaluacionRow = { ...base, fecha: '2026-11-10' };

it('resume la cobertura sobre los 29 descriptores (con la cicatriz)', () => {
  expect(resumenDescriptores({ ...posterior, brotacion: 2, calibre_mm: 12, cantidad_frutos: 10 })).toBe('2 de 29 descriptores');
});

it('una evaluación anterior a la distribución floral y a la poscosecha no las cuenta: «N de 24»', () => {
  expect(resumenDescriptores({ ...base, brotacion: 2 })).toBe('1 de 24 descriptores');
});

it('una evaluación anterior a la distribución floral no la nombra entre lo no evaluado', () => {
  render(conQuery(<DetalleEvaluacion evaluacion={{ ...base, brotacion: 3 }} />));
  expect(within(screen.getByRole('region', { name: 'Brotes y varas basales' })).queryByText(/distribución de flores y frutos/)).not.toBeInTheDocument();
});

it('la distribución de flores y frutos se lee con el texto de su nivel, no con el número', () => {
  render(conQuery(<DetalleEvaluacion evaluacion={{ ...base, brotacion: 3, distribucion_flores_frutos: 2 }} />));
  const brotes = within(screen.getByRole('region', { name: 'Brotes y varas basales' }));
  expect(brotes.getByText('Distribución de flores y frutos en la vara').nextSibling).toHaveTextContent('Hasta la mitad');
  expect(brotes.getByText('Distribución de flores y frutos en la vara').nextSibling).not.toHaveTextContent('de 5');
  expect(brotes.queryByText(/^No evaluado:.*distribución de flores y frutos/)).not.toBeInTheDocument();
  // ya no aparece en Fenología
  expect(within(screen.getByRole('region', { name: 'Fenología' })).queryByText('Distribución de flores y frutos en la vara')).not.toBeInTheDocument();
});

it('sin distribución, se nombra entre lo no evaluado de Brotes y varas (no de Fenología)', () => {
  render(conQuery(<DetalleEvaluacion evaluacion={{ ...posterior, brotacion: 3 }} />));
  expect(within(screen.getByRole('region', { name: 'Brotes y varas basales' })).getByText(/^No evaluado:.*distribución de flores y frutos en la vara/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Fenología' })).queryByText(/distribución de flores y frutos/)).not.toBeInTheDocument();
});

it('el rendimiento por hectárea de una evaluación histórica se sigue mostrando, con su unidad', () => {
  render(conQuery(<DetalleEvaluacion evaluacion={{ ...base, rend_kg_planta: 2, rend_t_ha: 12.5 }} />));
  const produccion = within(screen.getByRole('region', { name: 'Producción' }));
  expect(produccion.getByText('Rendimiento por hectárea').nextSibling).toHaveTextContent('12,5 t/ha');
  expect(produccion.getByText('Rendimiento por planta').nextSibling).toHaveTextContent('2 kg/planta');
});

it('si la evaluación no trae rend_t_ha, no aparece ni como «no evaluado» ni en la huella', () => {
  render(conQuery(<DetalleEvaluacion evaluacion={{ ...base, rend_kg_planta: 2 }} />));
  expect(screen.queryByText('Rendimiento por hectárea')).not.toBeInTheDocument();
  expect(screen.queryByText(/rendimiento por hectárea/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Rendimiento por hectárea: /)).not.toBeInTheDocument();
});

it('con un rend_t_ha histórico y estados de la base, la huella lo cuenta como medido', async () => {
  mocks.estados.mockResolvedValue({
    evaluacion_id: 'e1',
    protocolo: { id: 'p1', version: 1, nombre: 'Ronda 1', descriptores: { brotacion: 'obligatorio' }, created_at: '2026-10-01' },
    estados: { brotacion: 'medido', rend_t_ha: 'medido' },
  });
  render(conQuery(<DetalleEvaluacion evaluacion={{ ...base, brotacion: 4, rend_t_ha: 9 }} />));
  expect(await screen.findByText('Ronda 1 · versión 1')).toBeInTheDocument();
  expect(screen.getByText('Rendimiento por hectárea: Medido')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Producción' })).getByText('Rendimiento por hectárea').nextSibling).toHaveTextContent('9 t/ha');
});

it('el resumen cuenta la distribución como descriptor y deja fuera el rend_t_ha desactivado', () => {
  expect(resumenDescriptores({ ...posterior, distribucion_flores_frutos: 1 })).toBe('1 de 29 descriptores');
  expect(resumenDescriptores({ ...posterior, rend_t_ha: 9 })).toBe('0 de 29 descriptores');
  // Una evaluación anterior que igual trae la distribución (dato cargado a mano) sí la cuenta.
  expect(resumenDescriptores({ ...base, distribucion_flores_frutos: 1 })).toBe('1 de 25 descriptores');
});
