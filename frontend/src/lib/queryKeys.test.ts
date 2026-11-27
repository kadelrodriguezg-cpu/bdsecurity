import { describe, expect, it } from 'vitest';
import { qk } from './queryKeys';

function esPrefijo(prefijo: readonly unknown[], clave: readonly unknown[]) {
  return prefijo.every((parte, indice) => Object.is(parte, clave[indice]));
}

describe('queryKeys — invalidaciones amplias', () => {
  it.each([
    [qk.plantas.all, qk.plantas.lista({ pagina: 1 })],
    [qk.plantas.all, qk.plantas.conteo],
    [qk.ranking.all, qk.ranking.planta('p1', 0, 'puntaje_desc')],
    [qk.ranking.all, qk.ranking.global({ especieId: 'e1' })],
    [qk.ranking.polinizacionVarietal(), qk.ranking.polinizacionVarietal('e1', 'mama')],
    [qk.comparacion.all, qk.comparacion.individuo('i1')],
    [qk.snapshots.all, qk.snapshots.detalle('s1')],
    [qk.dashboard.all, qk.dashboard.cientifico('e1')],
    [qk.resumenFinal.all, qk.resumenFinal.planta('p1')],
    [qk.territorio.mapaAgregadoAll, qk.territorio.mapaAgregado({ especieId: 'e1' })],
    [qk.territorio.mapaCruceAll, qk.territorio.mapaCruce('p1')],
    [qk.territorio.viewportAll, qk.territorio.viewport({ zoom: 10 })],
    [qk.visualizacion.seriesAll, qk.visualizacion.series({ especieId: 'e1' })],
    [qk.evecl.ensayos, qk.evecl.ensayo(12)],
    [qk.evecl.fichasEnsayo(12), qk.evecl.fichas(12, 'Legacy')],
    [qk.evecl.comparaciones, qk.evecl.comparacion({ modo: 'entre_grupos' })],
    [qk.evecl.fotos, qk.evecl.foto('evecl/1/2/3.jpg')],
  ])('la clave de invalidación %j alcanza %j', (prefijo, clave) => {
    expect(esPrefijo(prefijo, clave)).toBe(true);
  });
});
