import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ItemRankingGrupos, RankingPorGrupos } from '@/api/rankingGrupos';
import { RankingGeneral } from './RankingGeneral';

const { obtenerMock } = vi.hoisted(() => ({ obtenerMock: vi.fn<(alcance: unknown) => Promise<RankingPorGrupos>>() }));

vi.mock('@/api/rankingGrupos', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/rankingGrupos')>();
  return { ...original, obtenerRankingPorGrupos: obtenerMock };
});

const TODAS = ['estres', 'fenologia', 'fruto_calidad', 'produccion'] as const;
const completa = { con_valor: 4, total: 4 };

function item(parcial: Partial<ItemRankingGrupos> & Pick<ItemRankingGrupos, 'individuo_id' | 'codigo_display'>): ItemRankingGrupos {
  return {
    planta_id: 'planta-1', codigo_sistema: 'CRUCE-1', especie_id: 'especie-1', es_prueba: false,
    evaluacion_id: 'e', fecha_evaluacion: '2026-10-20', numero_ronda: 1,
    requiere_revision: false, no_comparable: false, tiene_metrica_marcada: false,
    puntaje: 0.7, grupo: [...TODAS],
    cobertura: { estres: completa, fenologia: completa, fruto_calidad: completa, produccion: completa },
    detalle_categorias: { estres: 0.9, fenologia: 0.7, fruto_calidad: 0.8, produccion: 0.6 },
    estado_ranking: 'comparable', tamano_grupo: 5, posicion_grupo: 1,
    ...parcial,
  };
}

function respuesta(items: ItemRankingGrupos[], grupos: RankingPorGrupos['grupos']): RankingPorGrupos {
  const cuenta = (...estados: string[]) => items.filter((i) => estados.includes(i.estado_ranking)).length;
  return {
    scoring_version_id: 'v', scoring_version_nombre: 'Provisional', minimo_evaluaciones_grupo: 5, cobertura_advertencia: 0.5,
    poblacion: {
      total: items.length, comparables: cuenta('comparable', 'pocas_plantas'), con_posicion: items.filter((i) => i.posicion_grupo !== null).length,
      pocas_plantas: cuenta('pocas_plantas'), excluidas_revision: cuenta('excluida_revision'), no_comparables: cuenta('no_comparable'),
      sin_datos: cuenta('sin_datos'), sin_evaluacion: cuenta('sin_evaluacion', 'sin_ronda'), sin_version: cuenta('sin_version'),
    },
    grupos,
    items,
  };
}

function montar(props: Partial<Parameters<typeof RankingGeneral>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><RankingGeneral especieId="especie-1" {...props} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => obtenerMock.mockReset());
afterEach(cleanup);

describe('RankingGeneral — ranking por grupos de categorías (pantalla v2)', () => {
  const grande = () => [1, 2, 3, 4, 5].map((n) => item({ individuo_id: `g${n}`, codigo_display: `X-P${n}`, posicion_grupo: n, puntaje: 1 - n / 10 }));
  const chico = () => item({
    individuo_id: 'c1', codigo_display: 'X-P9', grupo: ['fenologia'], estado_ranking: 'pocas_plantas', tamano_grupo: 1, posicion_grupo: null,
    cobertura: { fenologia: { con_valor: 1, total: 4 } }, detalle_categorias: { fenologia: 0.4 }, puntaje: 0.4,
  });
  const revision = () => item({ individuo_id: 'r1', codigo_display: 'X-P7', estado_ranking: 'excluida_revision', tiene_metrica_marcada: true, puntaje: null, posicion_grupo: null, tamano_grupo: null });
  const sinRonda = () => item({ individuo_id: 's1', codigo_display: 'X-P8', estado_ranking: 'sin_ronda', evaluacion_id: null, fecha_evaluacion: null, puntaje: null, posicion_grupo: null });
  const completo = () => respuesta([...grande(), chico(), revision(), sinRonda()], [
    // El grupo chico llega primero desde la RPC: en pantalla va al final.
    { categorias: ['fenologia'], n: 1, con_posicion: false },
    { categorias: [...TODAS], n: 5, con_posicion: true },
  ]);
  const celda0 = (fila: HTMLElement) => (fila as HTMLTableRowElement).cells[0];

  it('pestañas por grupo con su conteo: primero los grupos con puesto y al final los de pocas plantas', async () => {
    obtenerMock.mockResolvedValue(completo());
    montar({ incluirPruebas: true });
    const pestanas = await screen.findAllByRole('tab');
    expect(pestanas).toHaveLength(2);
    expect(pestanas[0]).toHaveAccessibleName('Fruto/Calidad · Producción · Fenología · Estrés, 5 plantas');
    expect(pestanas[0]).toHaveAttribute('aria-selected', 'true');
    expect(pestanas[1]).toHaveAccessibleName('Fenología, 1 planta, sin puesto');
    expect(obtenerMock).toHaveBeenCalledWith({ plantaId: undefined, especieId: 'especie-1', incluirPruebas: true });
    expect(screen.getByRole('region', { name: /^Grupo Fruto\/Calidad/ })).toBeInTheDocument();
  });

  it('cuenta completa de la población, sin inventar estados', async () => {
    obtenerMock.mockResolvedValue(completo());
    montar();
    const poblacion = await screen.findByRole('list', { name: 'Población del ranking' });
    expect(poblacion).toHaveTextContent('8 vivos en el alcance');
    expect(poblacion).toHaveTextContent('5 con puesto');
    expect(poblacion).toHaveTextContent('1 en grupos con pocas plantas');
    expect(poblacion).toHaveTextContent('1 excluidas por revisión');
    expect(poblacion).toHaveTextContent('1 sin evaluación');
    // Lo que vale cero no ocupa lugar.
    expect(poblacion).not.toHaveTextContent('no comparables');
    // Cada individuo cae en exactamente una categoría: las partes suman el total.
    const partes = within(poblacion).getAllByRole('listitem').slice(1).map((li) => Number(li.querySelector('strong')?.textContent));
    expect(partes.reduce((a, b) => a + b, 0)).toBe(8);
  });

  it('sin jerga interna: no muestra el nombre de la versión de puntaje y llama «sin puntaje disponible» a lo que no tiene versión', async () => {
    const sinVersion = item({ individuo_id: 'v1', codigo_display: 'X-P10', estado_ranking: 'sin_version', puntaje: null, grupo: [], posicion_grupo: null, tamano_grupo: null });
    obtenerMock.mockResolvedValue(respuesta([...grande(), sinVersion], [{ categorias: [...TODAS], n: 5, con_posicion: true }]));
    montar();
    const poblacion = await screen.findByRole('list', { name: 'Población del ranking' });
    expect(poblacion).toHaveTextContent('1 sin puntaje disponible');
    expect(document.body.textContent).not.toMatch(/Provisional|Versión de puntaje|sin versión/i);
    expect(document.body.textContent).toContain('Cada grupo reúne a los individuos que midieron las mismas categorías');
    expect(document.body.textContent).toContain('ninguno de sus descriptores tiene valor');
  });

  it('grupo chico: sin puesto, con el motivo y la cobertura baja en ámbar con su texto', async () => {
    obtenerMock.mockResolvedValue(completo());
    montar();
    fireEvent.click(await screen.findByRole('tab', { name: /^Fenología, 1 planta/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Pocas plantas para comparar: 1 de 5 necesarias');
    const tabla = screen.getByRole('region', { name: /^Grupo Fenología/ });
    const fila = within(tabla).getAllByRole('row')[1] as HTMLTableRowElement;
    expect(celda0(fila)).toHaveTextContent('Sin puesto');
    const baja = within(fila).getByText(/Cobertura baja · 1 de 4/);
    expect(baja.closest('.text-warn')).not.toBeNull();
    // Categorías que el grupo no midió: «—», no un cero ni un valor.
    expect(fila.cells[4]).toHaveTextContent('—'); // Fruto/Calidad
  });

  it('cobertura: «menos de la mitad» se marca en ámbar con texto; la mitad o más no', async () => {
    const baja = item({ individuo_id: 'b', codigo_display: 'X-P2', posicion_grupo: 2, cobertura: { estres: completa, fenologia: completa, fruto_calidad: { con_valor: 1, total: 4 }, produccion: { con_valor: 2, total: 4 } } });
    obtenerMock.mockResolvedValue(respuesta([item({ individuo_id: 'a', codigo_display: 'X-P1', posicion_grupo: 1 }), baja], [{ categorias: [...TODAS], n: 2, con_posicion: true }]));
    montar();
    const tabla = await screen.findByRole('region', { name: /^Grupo Fruto\/Calidad/ });
    const [ok, mal] = within(tabla).getAllByRole('row').slice(1);
    expect(ok.querySelectorAll('.text-warn')).toHaveLength(0);
    // 1 de 4 (25 %) está bajo el 50 %; 2 de 4 (50 %) no.
    expect(mal.querySelectorAll('.text-warn')).toHaveLength(1);
    expect(mal).toHaveTextContent('Cobertura baja · 1 de 4');
    expect(mal).toHaveTextContent('2 de 4');
    // Variante de celular: la tarjeta repite el aviso con el nombre de la categoría.
    const tarjetas = screen.getByRole('list', { name: /^Grupo Fruto\/Calidad/ });
    expect(within(tarjetas).getAllByRole('listitem')[1]).toHaveTextContent('Cobertura baja en Fruto/Calidad');
    expect(within(tarjetas).getAllByRole('listitem')[0]).not.toHaveTextContent('Cobertura baja');
  });

  it('empates se muestran como «2=» y el siguiente puesto salta', async () => {
    const filas = [
      item({ individuo_id: 'a', codigo_display: 'X-P1', posicion_grupo: 1, puntaje: 0.9, tamano_grupo: 4 }),
      item({ individuo_id: 'b', codigo_display: 'X-P2', posicion_grupo: 2, puntaje: 0.8, tamano_grupo: 4 }),
      item({ individuo_id: 'c', codigo_display: 'X-P3', posicion_grupo: 2, puntaje: 0.8, tamano_grupo: 4 }),
      item({ individuo_id: 'd', codigo_display: 'X-P4', posicion_grupo: 4, puntaje: 0.5, tamano_grupo: 4 }),
    ];
    obtenerMock.mockResolvedValue(respuesta(filas, [{ categorias: [...TODAS], n: 4, con_posicion: true }]));
    montar();
    const tabla = await screen.findByRole('region', { name: /^Grupo Fruto\/Calidad/ });
    const celdas = within(tabla).getAllByRole('row').slice(1).map((r) => celda0(r).textContent);
    expect(celdas).toEqual(['1 de 4', '2= (empate) de 4', '2= (empate) de 4', '4 de 4']);
  });

  it('puntaje y subpuntajes en puntos 0–100 con un decimal (N34), aun si llegara un valor fuera de rango', async () => {
    obtenerMock.mockResolvedValue(respuesta(
      [item({ individuo_id: 'a', codigo_display: 'X-P1', posicion_grupo: 1, puntaje: 1.2, detalle_categorias: { estres: -0.1, fenologia: 0.5, fruto_calidad: 0.25, produccion: 1 } })],
      [{ categorias: [...TODAS], n: 1, con_posicion: true }],
    ));
    montar();
    const tabla = await screen.findByRole('region', { name: /^Grupo Fruto\/Calidad/ });
    const fila = within(tabla).getAllByRole('row')[1] as HTMLTableRowElement;
    expect(fila.cells[3]).toHaveTextContent('100,0'); // puntaje
    expect(fila.cells[6]).toHaveTextContent('50,0'); // Fenología (las columnas van por peso de la v2: Fruto, Producción, Fenología, Estrés)
    expect(fila.cells[7]).toHaveTextContent('0,0'); // Estrés
  });

  it('excluidas por revisión: sección propia plegada, con el motivo; fuera de comparación también plegada', async () => {
    obtenerMock.mockResolvedValue(completo());
    montar();
    const excluidas = await screen.findByRole('region', { name: /^Excluidas por revisión/ });
    expect(excluidas.querySelector('details')).not.toHaveAttribute('open');
    expect(excluidas.querySelector('summary')).toHaveTextContent('Excluidas por revisión (1)');
    expect(excluidas).toHaveTextContent('X-P7');
    expect(excluidas).toHaveTextContent('Un valor quedó en el límite de revisión');
    const fuera = screen.getByRole('region', { name: /^Fuera de comparación/ });
    expect(fuera.querySelector('details')).not.toHaveAttribute('open');
    expect(fuera.querySelector('summary')).toHaveTextContent('Sin ronda iniciada: 1');
    // Los excluidos no aparecen en ninguna tabla de grupo.
    expect(within(screen.getByRole('region', { name: /^Grupo Fruto\/Calidad/ })).queryByText('X-P7')).toBeNull();
  });

  it('con alcance de especie la tabla muestra el cruce; con un solo cruce no repite la columna', async () => {
    obtenerMock.mockResolvedValue(respuesta([item({ individuo_id: 'a', codigo_display: 'X-P1', posicion_grupo: 1, codigo_sistema: 'CRUCE-7' })], [{ categorias: [...TODAS], n: 1, con_posicion: true }]));
    const { unmount } = montar();
    const tabla = await screen.findByRole('region', { name: /^Grupo Fruto\/Calidad/ });
    expect(within(tabla).getAllByRole('columnheader').map((c) => c.textContent?.trim())).toContain('Cruce');
    expect(within(tabla).getAllByRole('row')[1]).toHaveTextContent('CRUCE-7');
    unmount();
    montar({ especieId: undefined, plantaId: 'planta-1' });
    const tablaCruce = await screen.findByRole('region', { name: /^Grupo Fruto\/Calidad/ });
    expect(within(tablaCruce).getAllByRole('columnheader').map((c) => c.textContent?.trim())).not.toContain('Cruce');
  });

  it('celular: tarjetas por individuo con puesto, puntaje y categorías abreviadas, y orden por selector', async () => {
    obtenerMock.mockResolvedValue(completo());
    montar();
    const tarjetas = await screen.findByRole('list', { name: /^Grupo Fruto\/Calidad/ });
    const primera = within(tarjetas).getAllByRole('listitem')[0];
    expect(primera).toHaveTextContent('1 de 5');
    expect(primera).toHaveTextContent('X-P1');
    expect(primera).toHaveTextContent('90,0'); // puntaje 1 - 1/10
    expect(primera).toHaveTextContent('Fen.');
    expect(primera).toHaveTextContent('Prod.');
    fireEvent.change(screen.getByLabelText('Ordenar por'), { target: { value: 'global:asc' } });
    const ordenadas = within(screen.getByRole('list', { name: /^Grupo Fruto\/Calidad/ })).getAllByRole('listitem');
    expect(ordenadas[0]).toHaveTextContent('X-P5');
    // El puesto mostrado sigue siendo el del grupo.
    expect(ordenadas[0]).toHaveTextContent('5 de 5');
  });

  it('ordenar por una columna no cambia el puesto mostrado, que es el del grupo', async () => {
    obtenerMock.mockResolvedValue(respuesta(
      [item({ individuo_id: 'a', codigo_display: 'X-P1', posicion_grupo: 1, puntaje: 0.9 }), item({ individuo_id: 'b', codigo_display: 'X-P2', posicion_grupo: 2, puntaje: 0.8 })],
      [{ categorias: [...TODAS], n: 2, con_posicion: true }],
    ));
    montar();
    const grupo = await screen.findByRole('region', { name: /^Grupo Fruto\/Calidad/ });
    fireEvent.click(within(grupo).getByRole('button', { name: 'Puntaje' }));
    const filas = within(grupo).getAllByRole('row').slice(1) as HTMLTableRowElement[];
    expect(filas[0]).toHaveTextContent('X-P2');
    expect(filas[0].cells[0]).toHaveTextContent('2 de');
  });

  it('pagina de a 50 por grupo con paginación numerada (G18)', async () => {
    const muchas = Array.from({ length: 60 }, (_, i) => item({ individuo_id: `m${i}`, codigo_display: `X-P${i + 1}`, posicion_grupo: i + 1, puntaje: 0.9 - i / 100, tamano_grupo: 60 }));
    obtenerMock.mockResolvedValue(respuesta(muchas, [{ categorias: [...TODAS], n: 60, con_posicion: true }]));
    montar();
    const tabla = await screen.findByRole('region', { name: /^Grupo Fruto\/Calidad/ });
    expect(within(tabla).getAllByRole('row')).toHaveLength(51); // encabezado + 50
    expect(screen.getByText('Mostrando 1–50 de 60')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Página 2' }));
    expect(within(screen.getByRole('region', { name: /^Grupo Fruto\/Calidad/ })).getAllByRole('row')).toHaveLength(11);
    expect(screen.getByText('Mostrando 51–60 de 60')).toBeInTheDocument();
  });

  it('sin ningún grupo con evaluaciones no inventa pestañas y conserva la cuenta de la población', async () => {
    obtenerMock.mockResolvedValue(respuesta([sinRonda()], []));
    montar();
    expect(await screen.findByText('Todavía ningún grupo tiene evaluaciones para comparar.')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('list', { name: 'Población del ranking' })).toHaveTextContent('1 sin evaluación');
  });
});

describe('RankingGeneral — cinco categorías (scoring v2, con Brotes y varas)', () => {
  const CINCO = ['fenologia', 'fruto_calidad', 'produccion', 'brotes', 'estres'] as const; // orden del enum de la base
  const conBrotes = (n: number) => item({
    individuo_id: `v${n}`, codigo_display: `X-P${n}`, posicion_grupo: n, tamano_grupo: 5, puntaje: 0.9 - n / 10,
    grupo: [...CINCO],
    cobertura: { fenologia: completa, fruto_calidad: completa, produccion: completa, brotes: { con_valor: 2, total: 4 }, estres: completa },
    detalle_categorias: { fenologia: 0.7, fruto_calidad: 0.8, produccion: 0.6, brotes: 0.4, estres: 0.9 },
  });

  it('con datos de brotes: una columna más, en orden de peso (Fruto, Producción, Fenología, Brotes, Estrés), y el grupo con el mismo orden', async () => {
    obtenerMock.mockResolvedValue(respuesta([1, 2, 3, 4, 5].map(conBrotes), [{ categorias: [...CINCO], n: 5, con_posicion: true }]));
    montar();
    const pestana = await screen.findByRole('tab');
    expect(pestana).toHaveAccessibleName('Fruto/Calidad · Producción · Fenología · Brotes y varas · Estrés, 5 plantas');
    const tabla = screen.getByRole('region', { name: /^Grupo Fruto\/Calidad/ });
    const encabezados = within(tabla).getAllByRole('columnheader').map((c) => c.textContent?.trim());
    expect(encabezados.slice(-5)).toEqual(['Fruto/Calidad', 'Producción', 'Fenología', 'Brotes y varas', 'Estrés']);
    const fila = within(tabla).getAllByRole('row')[1] as HTMLTableRowElement;
    expect(fila.cells[4]).toHaveTextContent('80,0'); // Fruto/Calidad
    expect(fila.cells[7]).toHaveTextContent('40,0'); // Brotes y varas
    expect(fila.cells[7]).toHaveTextContent('2 de 4');
  });

  it('en celular la tarjeta abrevia Brotes y varas como «Brot.» y reparte cinco categorías', async () => {
    obtenerMock.mockResolvedValue(respuesta([conBrotes(1)], [{ categorias: [...CINCO], n: 1, con_posicion: true }]));
    montar();
    const tarjeta = within(await screen.findByRole('list', { name: /^Grupo Fruto\/Calidad/ })).getAllByRole('listitem')[0];
    expect(tarjeta).toHaveTextContent('Brot.');
    expect(tarjeta.querySelector('dl')?.className).toContain('grid-cols-5');
  });

  it('con datos de 4 categorías (versión v1 todavía activa) no aparece la columna de Brotes, aunque la base mande brotes en nulo', async () => {
    const v1 = item({ individuo_id: 'a', codigo_display: 'X-P1', posicion_grupo: 1, detalle_categorias: { estres: 0.9, fenologia: 0.7, fruto_calidad: 0.8, produccion: 0.6, brotes: null } });
    obtenerMock.mockResolvedValue(respuesta([v1], [{ categorias: [...TODAS], n: 1, con_posicion: true }]));
    montar();
    const tabla = await screen.findByRole('region', { name: /^Grupo Fruto\/Calidad/ });
    const encabezados = within(tabla).getAllByRole('columnheader').map((c) => c.textContent?.trim());
    expect(encabezados.slice(-4)).toEqual(['Fruto/Calidad', 'Producción', 'Fenología', 'Estrés']);
    expect(encabezados).not.toContain('Brotes y varas');
    const tarjeta = within(screen.getByRole('list', { name: /^Grupo Fruto\/Calidad/ })).getAllByRole('listitem')[0];
    expect(tarjeta).not.toHaveTextContent('Brot.');
    expect(tarjeta.querySelector('dl')?.className).toContain('grid-cols-4');
  });

  it('un grupo que no midió brotes no lleva esa columna aunque otro grupo de la misma pantalla sí', async () => {
    const sin = item({ individuo_id: 's', codigo_display: 'X-P9', posicion_grupo: 2, tamano_grupo: 5, grupo: ['fenologia', 'fruto_calidad', 'produccion', 'estres'], detalle_categorias: { fenologia: 0.7, fruto_calidad: 0.8, produccion: 0.6, brotes: null, estres: 0.9 } });
    obtenerMock.mockResolvedValue(respuesta([conBrotes(1), sin], [{ categorias: [...CINCO], n: 1, con_posicion: false }, { categorias: [...TODAS], n: 1, con_posicion: false }]));
    montar();
    await screen.findAllByRole('tab');
    const columnas = (tabla: HTMLElement) => within(tabla).getAllByRole('columnheader').map((c) => c.textContent?.trim());
    expect(columnas(screen.getByRole('region', { name: /^Grupo Fruto\/Calidad · Producción · Fenología · Brotes y varas · Estrés/ }))).toContain('Brotes y varas');
    fireEvent.click(screen.getByRole('tab', { name: /^Fruto\/Calidad · Producción · Fenología · Estrés,/ }));
    expect(columnas(screen.getByRole('region', { name: /^Grupo Fruto\/Calidad · Producción · Fenología · Estrés/ }))).not.toContain('Brotes y varas');
  });
});
