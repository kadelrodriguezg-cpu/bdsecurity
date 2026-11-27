/**
 * Colores para el código que no puede usar clases de Tailwind: capas de
 * Leaflet, atributos SVG y HTML de marcadores. Es el ÚNICO lugar de `src/`
 * (fuera de EVECL) donde se escriben colores a mano. Los valores repiten los
 * tokens de `index.css` (identidad v2, DESIGN.md) y `colores.test.ts` falla si
 * se desalinean o si reaparece un color suelto en otro archivo.
 *
 * Significado (DESIGN.md): índigo = acción, selección y avance; verde = completo;
 * ámbar = «aquí falta un dato»; rojo = revisar o error; grises = lo informativo.
 */
export const COLORES = {
  /** `--brand`: marcadores de mapa, selección y acción. */
  acento: '#4338ca',
  /** `--brand-d`. */
  acentoHover: '#3730a3',
  /** `--ok`: completo. */
  ok: '#047857',
  /** `--warn`: solo «falta un dato». */
  falta: '#92400e',
  /** `--danger`: revisar o error. */
  revisar: '#991b1b',
  /** `--ink`. */
  tinta: '#111827',
  /** `--ink-2`. */
  tinta2: '#374151',
  /** `--ink-4`: texto de metadato sobre blanco. */
  tinta4: '#6b7280',
  /** `--line`. */
  borde: '#e5e7eb',
  /** `--surface`. */
  superficie: '#ffffff',
} as const;

/**
 * Paleta de series de gráficos (`--chart-1` a `--chart-4` de `index.css`). Los
 * datos de clima y de ranking no tienen un significado semántico en el sistema
 * (no son «falta», «revisar» ni «completo»): solo necesitan distinguirse entre
 * sí, y la leyenda siempre los nombra. Por eso tienen su propia paleta, aparte
 * de los semánticos, y se anota aquí como la única excepción documentada.
 */
export const PALETA_SERIES = {
  indigo: '#4338ca',
  verdeAzulado: '#287c83',
  ocre: '#a16824',
  violeta: '#8760a6',
  verde: '#477644',
} as const;

/** Orden de las series cuando se pintan por posición (ranking por parámetro). */
export const SERIES_EN_ORDEN = [
  PALETA_SERIES.verdeAzulado,
  PALETA_SERIES.indigo,
  PALETA_SERIES.ocre,
  PALETA_SERIES.violeta,
] as const;

/** Clima mensual: cada magnitud conserva su color en los tres gráficos. */
export const COLORES_CLIMA = {
  tempMax: PALETA_SERIES.ocre,
  tempMin: PALETA_SERIES.verdeAzulado,
  sol: PALETA_SERIES.verde,
  helada: PALETA_SERIES.violeta,
} as const;

/**
 * Colores de especie (fase 4, [Provisional]): el punto del selector del encabezado y la franja de cada tarjeta del
 * panorama. Identifican la especie, no un estado; el nombre siempre los acompaña. Segunda excepción documentada, como
 * `PALETA_SERIES`.
 */
export const COLORES_ESPECIE: Readonly<Record<string, string>> = {
  arandano: '#3b5bdb',
  frutilla: '#e03131',
  frambuesa: '#c2255c',
  mora: '#5f3dc4',
};

/** Para una especie nueva sin color propio: se elige uno fijo según su id. */
export const COLORES_ESPECIE_RESPALDO = ['#2b8a3e', '#e8590c', '#1098ad', '#5c940d', '#862e9c', '#495057'] as const;
