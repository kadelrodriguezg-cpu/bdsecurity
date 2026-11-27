/**
 * Auditoría integral, Corrida 1, G7 (R05, A1-G7-07): el mapa territorial pide
 * una sola página (250 puntos del admin, 100 clusters del operario) y no avisa
 * cuando `total` es mayor que lo recibido.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { TerritorialMap } from './TerritorialMap';

const { esAdminMock, consultarMapaViewport, obtenerMapaAgregado } = vi.hoisted(() => ({
  esAdminMock: { valor: true },
  consultarMapaViewport: vi.fn(),
  obtenerMapaAgregado: vi.fn(),
}));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: esAdminMock.valor }) }));
vi.mock('@/api/visualizacion', () => ({ consultarMapaViewport, obtenerMapaAgregado }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  Popup: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  useMapEvents: () => ({ getBounds: () => ({ getSouthWest: () => ({ lat: 0, lng: 0 }), getNorthEast: () => ({ lat: 1, lng: 1 }) }) }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cliente}><TerritorialMap /></QueryClientProvider>);
}

const punto = (i: number) => ({ emplazamiento_id: `e${i}`, sector_id: 's1', sector_nombre: 'Sector', predio_id: 'p1', predio_nombre: 'Predio', sitio_id: 'x', sitio_nombre: 'Sitio', planta_id: 'c1', codigo_sistema: '02-001', latitud: -35, longitud: -71, precision_metros: null, fuente: 'predio' });

it('el admin pide la página por defecto del viewport y el pie informa el total', async () => {
  esAdminMock.valor = true;
  consultarMapaViewport.mockResolvedValue({ precision: 'x', total: 1000, limite: 250, offset: 0, puntos: Array.from({ length: 250 }, (_, i) => punto(i)) });
  montar();
  await waitFor(() => expect(screen.getByText(/1000 emplazamientos con coordenadas/)).toBeInTheDocument());
  expect(consultarMapaViewport).toHaveBeenCalledWith(expect.not.objectContaining({ limite: expect.anything() }));
});

it.fails('A1-G7-07: si el viewport devuelve 250 de 1000 puntos, la interfaz debería avisar que muestra solo 250', async () => {
  esAdminMock.valor = true;
  consultarMapaViewport.mockResolvedValue({ precision: 'x', total: 1000, limite: 250, offset: 0, puntos: Array.from({ length: 250 }, (_, i) => punto(i)) });
  montar();
  await waitFor(() => expect(screen.getByText(/1000 emplazamientos con coordenadas/)).toBeInTheDocument());
  expect(document.body.textContent).toMatch(/mostrando|primeros|truncad|parcial|ver más|siguiente/i);
});

it.fails('A1-G7-07: si el operario recibe 100 de 105 sectores, la interfaz debería avisar que hay más', async () => {
  esAdminMock.valor = false;
  const cluster = (i: number) => ({ sitio_id: 'x', sitio_nombre: 'Sitio', predio_id: 'p', predio_nombre: 'Predio', sector_id: `s${i}`, sector_nombre: `Sector ${i}`, individuos: 1, individuos_vivos: 1, latitud: null, longitud: null, tiene_coordenada: false, cruces: [] });
  obtenerMapaAgregado.mockResolvedValue({ precision: 'agregada', total: 105, limite: 100, offset: 0, clusters: Array.from({ length: 100 }, (_, i) => cluster(i)) });
  montar();
  await waitFor(() => expect(screen.getByText('Predio · Sector 0')).toBeInTheDocument());
  expect(document.body.textContent).toMatch(/mostrando|primeros|truncad|parcial|ver más|siguiente/i);
});
