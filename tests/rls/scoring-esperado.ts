/**
 * Cálculo INDEPENDIENTE del puntaje esperado, para que los tests de scoring
 * verifiquen el motor en vez de copiar su salida.
 *
 * Pesos: versión global activa "provisional (4-3-2-1)" tras Fase 5
 * (20260922182745 + 20260922225105). El test 'expone una versión activa y sus
 * pesos' de rls.test.ts verifica que la base tenga exactamente estos pesos.
 *
 * Fórmula (decisión documentada en 20260719009000 y en el Documento Maestro,
 * sección 2.1):
 *   subpuntaje(categoría) = Σ(normalizado · peso) / Σ(peso), sobre las métricas
 *                           de la categoría con valor;
 *   puntaje               = Σ(subpuntaje · peso_categoría) / Σ(peso_categoría),
 *                           sobre las categorías con subpuntaje; redondeado a 4.
 * Normalización (normalizar_metrica_scoring): (v − mín)/(máx − mín) recortado a
 * [0, 1]; dirección "menor" invierte: (máx − v)/(máx − mín). Los mínimos y
 * máximos se escriben a mano en cada test, junto al valor del fixture.
 */
export type CategoriaScoring = 'fenologia' | 'fruto_calidad' | 'produccion' | 'estres';

export const PESOS_CATEGORIA: Record<CategoriaScoring, number> = {
  fenologia: 0.2,
  fruto_calidad: 0.4,
  produccion: 0.3,
  estres: 0.1,
};

export const METRICAS: Record<string, { categoria: CategoriaScoring; peso: number }> = {
  brotacion: { categoria: 'fenologia', peso: 0.034 },
  floracion: { categoria: 'fenologia', peso: 0.034 },
  cuaja: { categoria: 'fenologia', peso: 0.033 },
  concentracion_cosecha: { categoria: 'fenologia', peso: 0.033 },
  presencia_yemas_florales: { categoria: 'fenologia', peso: 0.033 },
  precocidad: { categoria: 'fenologia', peso: 0.033 },
  firmeza: { categoria: 'fruto_calidad', peso: 4 },
  calibre_mm: { categoria: 'fruto_calidad', peso: 3 },
  brix: { categoria: 'fruto_calidad', peso: 2 },
  bloom: { categoria: 'fruto_calidad', peso: 1 },
  rend_kg_planta: { categoria: 'produccion', peso: 0.06 },
  rend_t_ha: { categoria: 'produccion', peso: 0.06 },
  pct_fruta_exportable: { categoria: 'produccion', peso: 0.06 },
  pct_flores: { categoria: 'produccion', peso: 0.06 },
  pct_frutos: { categoria: 'produccion', peso: 0.06 },
  dano_calor: { categoria: 'estres', peso: 0.02 },
  golpe_sol: { categoria: 'estres', peso: 0.02 },
  caida_fruto: { categoria: 'estres', peso: 0.02 },
  vigor_vegetativo: { categoria: 'estres', peso: 0.02 },
  color_follaje: { categoria: 'estres', peso: 0.02 },
};

/** Subpuntaje por categoría a partir de los normalizados (calculados a mano). */
export function subpuntajesEsperados(normalizados: Record<string, number>): Record<CategoriaScoring, number> {
  const acumulado = { fenologia: [0, 0], fruto_calidad: [0, 0], produccion: [0, 0], estres: [0, 0] } as Record<CategoriaScoring, [number, number]>;
  for (const [metrica, valor] of Object.entries(normalizados)) {
    const config = METRICAS[metrica];
    if (!config) throw new Error(`Métrica sin peso configurado: ${metrica}`);
    acumulado[config.categoria][0] += valor * config.peso;
    acumulado[config.categoria][1] += config.peso;
  }
  return Object.fromEntries(
    (Object.keys(acumulado) as CategoriaScoring[]).map((categoria) => [categoria, acumulado[categoria][0] / acumulado[categoria][1]]),
  ) as Record<CategoriaScoring, number>;
}

/** Puntaje ponderado esperado, redondeado a 4 decimales como el motor. Exige las 20 métricas. */
export function puntajeEsperado(normalizados: Record<string, number>): number {
  const faltantes = Object.keys(METRICAS).filter((metrica) => !(metrica in normalizados));
  if (faltantes.length > 0) throw new Error(`El fixture no cubre las 20 métricas: faltan ${faltantes.join(', ')}`);
  const sub = subpuntajesEsperados(normalizados);
  const total = (Object.keys(PESOS_CATEGORIA) as CategoriaScoring[])
    .reduce((suma, categoria) => suma + sub[categoria] * PESOS_CATEGORIA[categoria], 0);
  return Math.round(total * 10_000) / 10_000;
}
