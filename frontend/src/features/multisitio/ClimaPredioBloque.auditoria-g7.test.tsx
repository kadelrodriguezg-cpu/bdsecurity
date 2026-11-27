/**
 * Auditoría integral, Corrida 1, G7 (R04, A1-G7-02): un predio con coordenadas,
 * sin meses y sin sincronización pendiente (sincronización fallida o descartada)
 * se muestra como «Sincronizando…» para siempre y sin forma de reintentar.
 */
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ClimaPredioBloque } from './ClimaPredioBloque';
import { qk } from '@/lib/queryKeys';

vi.mock('@/api/emplazamientos', () => ({ obtenerClimaPredio: vi.fn(async () => ({ predios: [] })) }));
afterEach(() => cleanup());

function montarConPredio(predio: Record<string, unknown>) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  cliente.setQueryData(qk.territorio.climaCruce('p1'), { predios: [{ predio_id: '1', predio_nombre: 'Predio 1', ...predio }] });
  render(<QueryClientProvider client={cliente}><ClimaPredioBloque plantaId="p1" /></QueryClientProvider>);
}

it('un predio recién geolocalizado (sincronizando = true) muestra el aviso de sincronización', () => {
  montarConPredio({ tiene_coordenada: true, sincronizando: true, meses: [] });
  expect(screen.getByText(/Sincronizando datos climáticos/)).toBeInTheDocument();
});

it.fails('A1-G7-02: un predio con coordenadas, sin pendientes (sincronizando = false) y sin meses NO debería decir «Sincronizando…» ni quedarse sin opción de reintento', () => {
  montarConPredio({ tiene_coordenada: true, sincronizando: false, meses: [] });
  expect(screen.queryByText(/Sincronizando datos climáticos/)).not.toBeInTheDocument();
});
