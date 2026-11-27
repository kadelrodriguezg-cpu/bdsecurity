import type { EvaluacionRow } from '@/api/rondas';
import { tieneValor, type CampoFase, type EscalaCampo, type EsquemaFase } from './tipos';

/** Columnas de `evaluaciones` que forman parte del esquema de Evaluación anual. */
export type ClaveEvaluacionAnual = Extract<keyof EvaluacionRow,
  | 'brotacion' | 'presencia_yemas_florales' | 'floracion' | 'fecha_inicio_floracion' | 'precocidad'
  | 'cuaja' | 'concentracion_cosecha'
  | 'n_varas_basales' | 'n_varas_con_flor' | 'n_flores_varas_basales' | 'n_frutos_varas_basales'
  | 'altura_brote_mm' | 'diametro_brote_mm' | 'vigor_vegetativo' | 'color_follaje' | 'distribucion_flores_frutos'
  | 'calibre_mm' | 'firmeza' | 'color' | 'bloom' | 'brix' | 'cicatriz'
  | 'cantidad_frutos' | 'peso_total_g' | 'peso_promedio_g'
  | 'pct_flores' | 'pct_frutos' | 'rend_kg_planta' | 'rend_t_ha'
  | 'pct_buen_estado_15d' | 'pct_buen_estado_30d' | 'pct_buen_estado_45d' | 'pct_fruta_exportable'
  | 'dano_calor' | 'golpe_sol' | 'caida_fruto'>;

const escala = (etiquetaMinimo: string, etiquetaMaximo: string, minimo = 1): EscalaCampo => ({
  minimo,
  maximo: 5,
  etiquetaMinimo,
  etiquetaMaximo,
});

/** Escala de 3 niveles con un texto por nivel (migración 20261025110000, EF12). */
const escala3 = (...etiquetasNivel: [string, string, string]): EscalaCampo => ({
  minimo: 1,
  maximo: 3,
  etiquetaMinimo: etiquetasNivel[0],
  etiquetaMaximo: etiquetasNivel[2],
  etiquetasNivel,
});

/** Precocidad con el mes de cosecha en cada nivel (Efraín; migración 20261026100000). Mayor sigue siendo mejor. */
const ESCALA_PRECOCIDAD: EscalaCampo = {
  minimo: 1,
  maximo: 5,
  etiquetaMinimo: 'Muy tardía (feb o más)',
  etiquetaMaximo: 'Muy temprana (oct – inicio nov)',
  etiquetasNivel: ['Muy tardía (feb o más)', 'Tardía (ene)', 'Media (dic)', 'Temprana (nov)', 'Muy temprana (oct – inicio nov)'],
};

type Campo = CampoFase<ClaveEvaluacionAnual>;

/**
 * Copia de respaldo sin conexión del esquema de la base (esquema_fase_campo,
 * migraciones 20261023090000, 20261025110000 y 20261026190000): tests/rls/fase2/esquema-fase.test.ts
 * exige que sean idénticas, también en `etiquetas_nivel`, `activo` y el orden. La categoría del motor de cada descriptor no va acá: es de
 * la versión de scoring (scoring_metrica.categoria).
 */
const CAMPOS: readonly Campo[] = [
  // Fenología
  { clave: 'brotacion', etiqueta: 'Brotación', seccion: 'fenologia', rol: 'descriptor', tipo: 'escala', escala: escala('nula', 'muy vigorosa') },
  { clave: 'presencia_yemas_florales', etiqueta: 'Presencia de yemas florales', seccion: 'fenologia', rol: 'descriptor', tipo: 'escala', escala: escala('ausentes', 'muy abundantes', 0) },
  { clave: 'floracion', etiqueta: 'Floración', seccion: 'fenologia', rol: 'descriptor', tipo: 'escala', escala: escala('nula', 'abundante') },
  { clave: 'fecha_inicio_floracion', etiqueta: 'Inicio de floración', seccion: 'fenologia', rol: 'descriptor', tipo: 'fecha' },
  { clave: 'precocidad', etiqueta: 'Precocidad', seccion: 'fenologia', rol: 'descriptor', tipo: 'escala', escala: ESCALA_PRECOCIDAD },
  { clave: 'cuaja', etiqueta: 'Cuaja', seccion: 'fenologia', rol: 'descriptor', tipo: 'escala', escala: escala('mala', 'excelente') },
  { clave: 'concentracion_cosecha', etiqueta: 'Concentración cosecha', seccion: 'fenologia', rol: 'descriptor', tipo: 'escala', escala: escala('muy dispersa', 'muy concentrada') },
  // Brotes y varas basales
  { clave: 'n_varas_basales', etiqueta: 'Varas basales', seccion: 'brotes', rol: 'descriptor', tipo: 'entero' },
  { clave: 'n_varas_con_flor', etiqueta: 'Varas basales con flor', seccion: 'brotes', rol: 'descriptor', tipo: 'entero' },
  { clave: 'n_flores_varas_basales', etiqueta: 'Flores en varas basales', seccion: 'brotes', rol: 'descriptor', tipo: 'entero' },
  { clave: 'n_frutos_varas_basales', etiqueta: 'Frutos en varas basales', seccion: 'brotes', rol: 'descriptor', tipo: 'entero' },
  { clave: 'altura_brote_mm', etiqueta: 'Altura del brote', seccion: 'brotes', rol: 'descriptor', tipo: 'numero', unidad: 'mm' },
  { clave: 'diametro_brote_mm', etiqueta: 'Diámetro del brote', seccion: 'brotes', rol: 'descriptor', tipo: 'numero', unidad: 'mm' },
  { clave: 'vigor_vegetativo', etiqueta: 'Vigor vegetativo', seccion: 'brotes', rol: 'descriptor', tipo: 'escala', escala: escala('muy bajo', 'muy alto') },
  { clave: 'color_follaje', etiqueta: 'Color del follaje', seccion: 'brotes', rol: 'descriptor', tipo: 'escala', escala: escala('muy pálido', 'muy intenso') },
  { clave: 'distribucion_flores_frutos', etiqueta: 'Distribución de flores y frutos en la vara', seccion: 'brotes', rol: 'descriptor', tipo: 'escala', escala: escala3('Solo en la punta', 'Hasta la mitad', 'Toda la vara'), vigenteDesde: '2026-10-25' },
  // Fruto / Calidad
  { clave: 'calibre_mm', etiqueta: 'Calibre', seccion: 'fruto', rol: 'descriptor', tipo: 'numero', unidad: 'mm', exigeMuestra: true },
  { clave: 'firmeza', etiqueta: 'Firmeza', seccion: 'fruto', rol: 'descriptor', tipo: 'escala', escala: escala('muy blando', 'muy firme'), exigeMuestra: true },
  { clave: 'color', etiqueta: 'Color', seccion: 'fruto', rol: 'descriptor', tipo: 'escala', escala: escala('pálido', 'azul intenso'), exigeMuestra: true },
  { clave: 'bloom', etiqueta: 'Bloom', seccion: 'fruto', rol: 'descriptor', tipo: 'escala', escala: escala('ausente', 'máximo'), exigeMuestra: true },
  { clave: 'brix', etiqueta: 'Brix', seccion: 'fruto', rol: 'descriptor', tipo: 'numero', unidad: '°Bx', exigeMuestra: true },
  // Fase 5 (G9): escala provisional hasta la de Efraín; peso 0 (no entra al puntaje).
  { clave: 'cicatriz', etiqueta: 'Cicatriz', seccion: 'fruto', rol: 'descriptor', tipo: 'escala', escala: escala('Grande, húmeda o desgarrada', 'Pequeña y seca'), exigeMuestra: true, vigenteDesde: '2026-10-26' },
  // Muestra de frutos
  { clave: 'cantidad_frutos', etiqueta: 'Cantidad de frutos', seccion: 'muestra', rol: 'muestra', tipo: 'entero', exigeMuestra: true },
  { clave: 'peso_total_g', etiqueta: 'Peso total', seccion: 'muestra', rol: 'muestra', tipo: 'numero', unidad: 'g', exigeMuestra: true },
  { clave: 'peso_promedio_g', etiqueta: 'Peso promedio', seccion: 'muestra', rol: 'derivado', tipo: 'numero', unidad: 'g' },
  // Producción
  { clave: 'pct_flores', etiqueta: 'Cobertura floral', seccion: 'produccion', rol: 'derivado', tipo: 'numero', unidad: '%' },
  { clave: 'pct_frutos', etiqueta: 'Cuaja en varas basales', seccion: 'produccion', rol: 'derivado', tipo: 'numero', unidad: '%' },
  { clave: 'rend_kg_planta', etiqueta: 'Rendimiento por planta', seccion: 'produccion', rol: 'descriptor', tipo: 'numero', unidad: 'kg/planta' },
  { clave: 'rend_t_ha', etiqueta: 'Rendimiento por hectárea', seccion: 'produccion', rol: 'descriptor', tipo: 'numero', unidad: 't/ha', activo: false },
  // Poscosecha (migración 20261026130000): tres lecturas quincenales y el exportable calculado con ellas.
  { clave: 'pct_buen_estado_15d', etiqueta: 'Buen estado a los 15 días', seccion: 'produccion', rol: 'descriptor', tipo: 'numero', unidad: '%', vigenteDesde: '2026-10-26' },
  { clave: 'pct_buen_estado_30d', etiqueta: 'Buen estado a los 30 días', seccion: 'produccion', rol: 'descriptor', tipo: 'numero', unidad: '%', vigenteDesde: '2026-10-26' },
  { clave: 'pct_buen_estado_45d', etiqueta: 'Buen estado a los 45 días', seccion: 'produccion', rol: 'descriptor', tipo: 'numero', unidad: '%', vigenteDesde: '2026-10-26' },
  { clave: 'pct_fruta_exportable', etiqueta: 'Fruta exportable', seccion: 'produccion', rol: 'derivado', tipo: 'numero', unidad: '%' },
  // Estrés climático
  { clave: 'dano_calor', etiqueta: 'Daño por calor', seccion: 'estres', rol: 'descriptor', tipo: 'escala', escala: escala('ninguno', 'severo') },
  { clave: 'golpe_sol', etiqueta: 'Golpe de sol', seccion: 'estres', rol: 'descriptor', tipo: 'escala', escala: escala('ninguno', 'severo') },
  { clave: 'caida_fruto', etiqueta: 'Caída de fruto', seccion: 'estres', rol: 'descriptor', tipo: 'escala', escala: escala('ninguna', 'severa') },
];

export const ESQUEMA_EVALUACION_ANUAL: EsquemaFase<ClaveEvaluacionAnual> = {
  fase: 'evaluacion_anual',
  secciones: [
    { id: 'fenologia', etiqueta: 'Fenología' },
    { id: 'brotes', etiqueta: 'Brotes y varas basales' },
    { id: 'fruto', etiqueta: 'Fruto / Calidad' },
    { id: 'muestra', etiqueta: 'Muestra de frutos' },
    { id: 'produccion', etiqueta: 'Producción' },
    { id: 'estres', etiqueta: 'Estrés climático' },
  ],
  campos: CAMPOS,
};

/** Claves de los descriptores ACTIVOS (27 desde la cicatriz), en el orden del formulario. `rend_t_ha` está desactivado (EF11) y no cuenta. */
export const CLAVES_DESCRIPTORES_ANUAL: readonly ClaveEvaluacionAnual[] = CAMPOS
  .filter((campo) => campo.rol === 'descriptor' && campo.activo !== false)
  .map((campo) => campo.clave);

/** Qué es un fruto «en buen estado» en la poscosecha (texto de ayuda del formulario). */
export const AYUDA_BUEN_ESTADO = 'Buen estado: fruto sin pudrición, sin deshidratación visible, firme al tacto y que conserva el bloom.';

const numeroDe = (valor: unknown): number | null => {
  if (!tieneValor(valor)) return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
};

/**
 * % de fruta exportable calculado con la poscosecha (decisión 5; la base hace lo mismo en `unificar_evaluacion_ronda`):
 * el valor a los 45 días; 0 si una lectura anterior (15 o 30 días) dio 0 %; `null` («sin dato», no 0) si falta la de 45 días.
 * Sin ninguna lectura se devuelve el valor escrito a mano antes, si lo hay (evaluaciones históricas).
 */
export function exportableCalculado(valores: Partial<Record<string, unknown>>): number | null {
  const d15 = numeroDe(valores.pct_buen_estado_15d);
  const d30 = numeroDe(valores.pct_buen_estado_30d);
  const d45 = numeroDe(valores.pct_buen_estado_45d);
  if (d15 === null && d30 === null && d45 === null) return numeroDe(valores.pct_fruta_exportable);
  if (d15 === 0 || d30 === 0) return 0;
  return d45;
}

/** Campos cuyo valor hace obligatoria la muestra de frutos para finalizar. */
export const CLAVES_EXIGEN_MUESTRA: readonly ClaveEvaluacionAnual[] = CAMPOS
  .filter((campo) => campo.exigeMuestra)
  .map((campo) => campo.clave);

/**
 * Regla de frutos (Fase 2, Sprint 0): cantidad y peso de la muestra se exigen
 * para finalizar solo si se cargó algún descriptor de fruta o de muestra, y
 * nunca si se marcó «Sin muestra de frutos». La base aplica la misma regla en
 * validar_evaluacion_integridad.
 */
export function exigeMuestraDeFrutos(valores: Partial<Record<ClaveEvaluacionAnual, unknown>> & { sin_muestra?: boolean | null }): boolean {
  if (valores.sin_muestra) return false;
  return CLAVES_EXIGEN_MUESTRA.some((clave) => tieneValor(valores[clave]));
}
