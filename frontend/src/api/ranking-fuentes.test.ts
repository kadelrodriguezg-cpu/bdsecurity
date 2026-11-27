/**
 * Fase 2, S2-3: «no puede haber dos rankings que digan cosas distintas».
 * Ninguna pantalla del frontend lee el ranking operativo anterior (el que
 * exige las 20 métricas y tiene tope de 100 filas); todas las posiciones y
 * puntajes de ranking salen de obtener_ranking_por_grupos.
 */
import { describe, expect, it } from 'vitest';

const fuentes = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.*', '!/src/types/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('fuentes de ranking del frontend', () => {
  it('hay fuentes que revisar', () => {
    expect(Object.keys(fuentes).length).toBeGreaterThan(50);
  });

  it.each(['obtener_ranking_operativo', 'obtener_ranking_global_filtrado'])('ninguna pantalla ni cliente llama a %s', (rpc) => {
    const usan = Object.entries(fuentes)
      .filter(([, texto]) => texto.includes(`'${rpc}'`) || texto.includes(`"${rpc}"`))
      .map(([ruta]) => ruta);
    expect(usan).toEqual([]);
  });

  it('el aviso «solo los primeros 100» ya no existe', () => {
    const usan = Object.entries(fuentes).filter(([, texto]) => /AvisoLimiteRanking|solo los primeros/.test(texto)).map(([ruta]) => ruta);
    expect(usan).toEqual([]);
  });

  it('Resultados (v3) y el ranking del cruce usan el ranking por grupos', () => {
    for (const ruta of ['/src/pages/ResultadosPage.tsx', '/src/features/individuos/RankingTabla.tsx']) {
      expect(fuentes[ruta], ruta).toMatch(/obtenerRankingPorGrupos|RankingGeneral/);
    }
  });
});
