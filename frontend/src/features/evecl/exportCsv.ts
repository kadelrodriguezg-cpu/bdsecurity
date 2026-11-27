import type { EveclComparacion } from '@/api/evecl';

export interface EveclGrupoExportable {
  key: string;
  label: string;
}

function escaparCsv(valor: unknown): string {
  const texto = valor == null ? '' : String(valor);
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

export function gruposExportables(comparacion: EveclComparacion): EveclGrupoExportable[] {
  const grupos = new Map<string, string>();
  const resultados = [
    ...comparacion.ranking_calidad,
    ...comparacion.ranking_productividad,
    ...comparacion.perfil_fenologia,
    ...comparacion.perfil_adaptabilidad,
  ];
  for (const item of resultados) grupos.set(item.grupo_key, item.grupo_label);
  return [...grupos].map(([key, label]) => ({ key, label }));
}

export function crearCsvComparacion(comparacion: EveclComparacion, grupoKeys?: ReadonlySet<string>): string {
  const incluir = (grupoKey: string) => !grupoKeys || grupoKeys.has(grupoKey);
  const filas: unknown[][] = [];

  for (const [eje, items] of [
    ['calidad', comparacion.ranking_calidad],
    ['productividad', comparacion.ranking_productividad],
  ] as const) {
    for (const item of items) {
      if (!incluir(item.grupo_key)) continue;
      filas.push([
        comparacion.modo, comparacion.conjunto ?? '', eje, 'ranking', item.grupo_key, item.grupo_label,
        '', item.puntaje, '', '', '', item.n_con_dato, item.n_total,
      ]);
    }
  }

  for (const [eje, items] of [
    ['fenologia', comparacion.perfil_fenologia],
    ['adaptabilidad', comparacion.perfil_adaptabilidad],
  ] as const) {
    for (const item of items) {
      if (!incluir(item.grupo_key)) continue;
      filas.push([
        comparacion.modo, comparacion.conjunto ?? '', eje, 'perfil', item.grupo_key, item.grupo_label,
        item.descriptor, '', item.nota_moda, item.label_moda, item.divergente ? 'sí' : 'no', item.n_con_dato, item.n_total,
      ]);
    }
  }

  const encabezado = [
    'modo', 'conjunto', 'eje', 'tipo_resultado', 'grupo_key', 'grupo_label', 'descriptor',
    'puntaje', 'nota_moda', 'label_moda', 'divergente', 'n_con_dato', 'n_total',
  ];
  return [encabezado, ...filas].map((fila) => fila.map(escaparCsv).join(',')).join('\r\n');
}

export function descargarCsvComparacion(contenido: string, nombre: string): void {
  const blob = new Blob([`\uFEFF${contenido}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(url);
}
