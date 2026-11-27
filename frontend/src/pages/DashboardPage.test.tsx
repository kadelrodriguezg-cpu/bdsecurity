/** Inicio v3 (paso 5): qué ve cada rol y la opción global de cruces de prueba. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const mocks = vi.hoisted(() => ({ esAdmin: false, panel: vi.fn(), recientes: vi.fn(), pedidas: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ esAdmin: mocks.esAdmin, perfil: { nombre: 'María Soto' } }) }));
vi.mock('@/api/plantas', () => ({
  conteoPorEstado: vi.fn(async () => ({ sin_empezar: 4, polinizacion: 2, evaluacion_anual: 3, proceso_finalizado: 1 })),
  listarPlantasPagina: mocks.recientes,
}));
vi.mock('@/api/dashboard', () => ({ obtenerDashboardCientifico: mocks.panel }));
vi.mock('@/api/correcciones', () => ({ listarCorreccionesPedidas: mocks.pedidas }));
vi.mock('@/features/especies/EspacioEspecie', async () => (await import('@/features/especies/espacioDePrueba')).moduloEspacioDePrueba());

import { DashboardPage } from './DashboardPage';
import { guardarIncluirPruebas } from '@/lib/preferencias';
import { fijarEspacioDePrueba, reiniciarEspacioDePrueba } from '@/features/especies/espacioDePrueba';

const PANEL = {
  resumen: { cruces_activos: 5, individuos_vivos: 379, evaluaciones_ultimos_30_dias: 12, procedimientos_pendientes: 1, cruces_con_pendientes: 2 },
  cambios_recientes: [{ planta_id: 'c1', codigo_sistema: '02-502', especie_nombre: 'Arándano', estado: 'evaluacion_anual', fecha: new Date().toISOString(), tipo: 'evaluacion' }],
  pendientes: [{ planta_id: 'c1', codigo_sistema: '02-502', estado: 'evaluacion_anual', individuos_pendientes: 230 }],
  destacados: [], generado_at: '', especie_id: null, scoring_version_id: null, scoring_version_nombre: null,
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  mocks.pedidas.mockResolvedValue([]);
  mocks.panel.mockResolvedValue(PANEL);
  mocks.recientes.mockResolvedValue({ items: [{ id: 'c1', codigo_sistema: '02-502', especie_nombre: 'Arándano', estado: 'evaluacion_anual' }], total: 1 });
});
afterEach(() => { cleanup(); mocks.esAdmin = false; guardarIncluirPruebas(false); vi.clearAllMocks(); });

describe('Inicio', () => {
  it('operario: accesos, Continuar trabajo y Actividad pendiente («sin evaluación cerrada»); sin Resumen ni Cambios recientes', async () => {
    montar();
    expect(screen.getByRole('link', { name: /Escanear QR/ })).toHaveAttribute('href', '/escanear');
    expect(screen.getByRole('link', { name: /Buscar un cruce/ })).toHaveAttribute('href', '/plantas');
    expect(await screen.findByRole('region', { name: 'Continuar trabajo' })).toBeInTheDocument();
    const pendiente = await screen.findByRole('region', { name: 'Actividad pendiente' });
    expect(await within(pendiente).findByText('230 sin evaluación cerrada')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Resumen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cambios recientes' })).not.toBeInTheDocument();
  });

  it('«N activos» cuenta lo mismo que la lista (sin Sin empezar ni Fin)', async () => {
    montar();
    expect(await screen.findByRole('link', { name: '5 activos' })).toHaveAttribute('href', '/plantas');
  });

  it('admin: además el Resumen en 4 cifras y los Cambios recientes con «hoy HH:MM»', async () => {
    mocks.esAdmin = true;
    montar();
    const resumen = await screen.findByRole('region', { name: 'Resumen' });
    expect(await within(resumen).findByText('379')).toBeInTheDocument();
    expect(within(resumen).queryByText('Procedimientos pendientes')).not.toBeInTheDocument();
    const cambios = screen.getByRole('region', { name: 'Cambios recientes' });
    expect(await within(cambios).findByText(/^hoy \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('admin: un solo enlace a Resultados (ya no «Ver análisis» hacia el Panel científico)', async () => {
    mocks.esAdmin = true;
    montar();
    await screen.findByRole('region', { name: 'Resumen' });
    expect(screen.queryByText('Ver análisis')).not.toBeInTheDocument();
    const enlaces = screen.getAllByRole('link', { name: 'Ver resultados' });
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]).toHaveAttribute('href', '/resultados');
  });

  it('por defecto pide sin cruces de prueba; con la opción de admin encendida los pide y lo avisa', async () => {
    montar();
    await screen.findByRole('region', { name: 'Continuar trabajo' });
    expect(mocks.panel).toHaveBeenCalledWith('esp-arandano', 5, false);
    expect(mocks.recientes).toHaveBeenCalledWith(expect.objectContaining({ incluirPruebas: false }), { limite: 5 });
    cleanup();
    mocks.esAdmin = true;
    guardarIncluirPruebas(true);
    montar();
    expect(await screen.findByText(/Se incluyen los cruces de prueba/)).toBeInTheDocument();
    expect(mocks.panel).toHaveBeenLastCalledWith('esp-arandano', 5, true);
  });

  it('un operario con la opción guardada en el equipo igual no pide cruces de prueba', async () => {
    guardarIncluirPruebas(true);
    montar();
    await screen.findByRole('region', { name: 'Continuar trabajo' });
    expect(mocks.panel).toHaveBeenCalledWith('esp-arandano', 5, false);
    expect(screen.queryByText(/Se incluyen los cruces de prueba/)).not.toBeInTheDocument();
  });
});

describe('Inicio dentro de la especie del encabezado (fase 4)', () => {
  afterEach(() => reiniciarEspacioDePrueba());

  it('cuenta y lista solo la especie activa', async () => {
    montar();
    await screen.findByRole('region', { name: 'Continuar trabajo' });
    expect(mocks.recientes).toHaveBeenCalledWith(expect.objectContaining({ especieId: 'esp-arandano' }), { limite: 5 });
    expect(mocks.panel).toHaveBeenCalledWith('esp-arandano', 5, false);
  });

  it('con «Todas las especies» muestra el panorama y no pide cruces de ninguna especie', async () => {
    fijarEspacioDePrueba({ activa: null, parametro: 'todas' });
    montar();
    expect(screen.getByRole('heading', { name: 'Todas las especies' })).toBeInTheDocument();
    const tarjeta = screen.getByRole('article', { name: 'Arándano' });
    expect(within(tarjeta).getByText('Sin evaluación cerrada').nextSibling).toHaveTextContent('230');
    expect(within(tarjeta).getByRole('button', { name: /Entrar a Arándano/ })).toBeInTheDocument();
    expect(mocks.recientes).not.toHaveBeenCalled();
    expect(mocks.panel).not.toHaveBeenCalled();
  });
});

describe('Inicio: correcciones pedidas (fase 5, G15)', () => {
  const PEDIDO = { id: 'pc1', evaluacion_id: 'e9', planta_id: 'c1', especie_id: 'esp-arandano', codigo_sistema: '02-502', individuo_id: 'i9', codigo_display: '02-502-P9', numero_ronda: 1, tipo_ronda: 'anual', nota: 'El calibre es 18, no 81', pedido_por: 'María Soto', pedido_en: new Date().toISOString() };

  it('el admin ve «Correcciones pedidas» con el enlace a cada evaluación', async () => {
    mocks.esAdmin = true;
    mocks.pedidas.mockResolvedValue([PEDIDO]);
    montar();
    const bloque = await screen.findByRole('region', { name: 'Correcciones pedidas' });
    const enlace = await within(bloque).findByRole('link', { name: /02-502-P9/ });
    expect(enlace).toHaveAttribute('href', '/planta/c1/evaluacion/e9');
    expect(within(bloque).getByText(/El calibre es 18, no 81/)).toBeInTheDocument();
    expect(within(bloque).getByText(/María Soto/)).toBeInTheDocument();
  });

  it('sin pedidos, el bloque lo dice; el operario no lo ve ni lo pide', async () => {
    mocks.esAdmin = true;
    montar();
    expect(await screen.findByText('No hay correcciones pedidas.')).toBeInTheDocument();
    cleanup();
    mocks.esAdmin = false;
    montar();
    await screen.findByRole('region', { name: 'Continuar trabajo' });
    expect(screen.queryByRole('region', { name: 'Correcciones pedidas' })).not.toBeInTheDocument();
    expect(mocks.pedidas).toHaveBeenCalledTimes(1);
  });
});
