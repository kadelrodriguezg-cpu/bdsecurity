/**
 * Sugerencia del siguiente codigo_sistema para una especie, a partir de los
 * códigos ya existentes (Bloque 3, Parte 3B de la auditoría de UX). No hay
 * columna que ate un prefijo a una especie — es una convención sostenida a
 * mano ("02-001" para Arándano) — así que el prefijo se infiere del propio
 * historial: el que más códigos existentes comparte. Sin códigos previos
 * para la especie (primer cruce), no hay de dónde inferir: devuelve null y
 * el campo queda libre, como hoy.
 */
export function sugerirSiguienteCodigo(codigosExistentes: string[]): string | null {
  const PATRON = /^(.*?)(\d+)$/;

  const conteoPorPrefijo = new Map<string, number>();
  const maxPorPrefijo = new Map<string, { valor: number; ancho: number }>();

  for (const codigo of codigosExistentes) {
    const m = codigo.match(PATRON);
    if (!m) continue;
    const [, prefijo, digitos] = m;
    conteoPorPrefijo.set(prefijo, (conteoPorPrefijo.get(prefijo) ?? 0) + 1);
    const valor = Number(digitos);
    const actual = maxPorPrefijo.get(prefijo);
    if (!actual || valor > actual.valor) maxPorPrefijo.set(prefijo, { valor, ancho: digitos.length });
  }

  if (conteoPorPrefijo.size === 0) return null;

  const [prefijoDominante] = [...conteoPorPrefijo.entries()].sort((a, b) => b[1] - a[1])[0];
  const { valor, ancho } = maxPorPrefijo.get(prefijoDominante)!;
  return `${prefijoDominante}${String(valor + 1).padStart(ancho, '0')}`;
}
