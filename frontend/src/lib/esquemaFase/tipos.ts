/**
 * Esquema de fase: única definición de los descriptores que se registran en
 * una fase (secciones, etiqueta, tipo, unidad y escala). Nace en el Sprint 0
 * de la Fase 2 para Evaluación anual y está pensado para crecer en el
 * Sprint 1 hacia polinización y cosecha, y hacia el protocolo de ronda.
 * Ver docs/plan_fase2.md.
 */

/** Categorías del motor de puntaje (enum categoria_scoring de la base). */
export type CategoriaMotor = 'fenologia' | 'fruto_calidad' | 'produccion' | 'brotes' | 'estres';

export const CATEGORIA_MOTOR_LABEL: Record<CategoriaMotor, string> = {
  fruto_calidad: 'Fruto y calidad',
  produccion: 'Producción',
  fenologia: 'Fenología',
  brotes: 'Brotes y varas',
  estres: 'Estrés',
};

/**
 * Rol del campo dentro de la fase:
 * - `descriptor`: lo observa el evaluador y cuenta para la completitud.
 * - `muestra`: dato de la muestra de frutos (cantidad, peso); no es un descriptor.
 * - `derivado`: lo calcula la base (columna generada); solo se muestra.
 */
export type RolCampo = 'descriptor' | 'muestra' | 'derivado';

export type TipoCampo = 'escala' | 'numero' | 'entero' | 'fecha';

export interface EscalaCampo {
  minimo: number;
  maximo: number;
  etiquetaMinimo: string;
  etiquetaMaximo: string;
  /**
   * Texto de cada nivel, de menor a mayor (opcional; viene de `esquema_fase_campo.etiquetas_nivel`). Si existe, el
   * formulario muestra y las lecturas escriben ese texto en vez del número. Largo = maximo - minimo + 1.
   */
  etiquetasNivel?: readonly string[];
}

export interface CampoFase<Clave extends string = string> {
  clave: Clave;
  etiqueta: string;
  seccion: string;
  rol: RolCampo;
  tipo: TipoCampo;
  unidad?: string;
  escala?: EscalaCampo;
  /** Si tiene valor, la evaluación exige muestra de frutos para finalizar (regla de frutos). */
  exigeMuestra?: boolean;
  /**
   * `false` = campo desactivado (EF11, p. ej. `rend_t_ha`): no se ofrece en formularios ni en protocolos nuevos, pero las
   * evaluaciones que ya traen un valor lo siguen mostrando. Ausente = activo.
   */
  activo?: boolean;
  /**
   * Fecha (AAAA-MM-DD) desde la que existe el descriptor (`esquema_fase_campo.vigente_desde`). Una evaluación con fecha
   * anterior no pudo medirlo: no cuenta en su «N de M» y se lee como «No existía en esa fecha». Ausente = existió siempre.
   */
  vigenteDesde?: string;
}

export interface SeccionFase {
  id: string;
  etiqueta: string;
  descripcion?: string;
}

export interface EsquemaFase<Clave extends string = string> {
  fase: string;
  secciones: readonly SeccionFase[];
  campos: readonly CampoFase<Clave>[];
}

export function tieneValor(valor: unknown): boolean {
  return valor !== undefined && valor !== null && valor !== '';
}

export function camposDeSeccion<Clave extends string>(esquema: EsquemaFase<Clave>, seccionId: string): CampoFase<Clave>[] {
  return esquema.campos.filter((campo) => campo.seccion === seccionId);
}

/** El campo está activo (se ofrece en formularios y protocolos). Un campo sin la marca es activo. */
export const estaActivo = (campo: Pick<CampoFase, 'activo'>): boolean => campo.activo !== false;

/** Descriptores ACTIVOS: los que cuentan para la completitud. Los desactivados (p. ej. `rend_t_ha`) no suman ni restan. */
export function descriptoresDe<Clave extends string>(esquema: EsquemaFase<Clave>): CampoFase<Clave>[] {
  return esquema.campos.filter((campo) => campo.rol === 'descriptor' && estaActivo(campo));
}

/** El descriptor todavía no existía en la fecha de la evaluación (y la evaluación no trae valor). */
export function noExistiaEn(
  campo: Pick<CampoFase, 'clave' | 'vigenteDesde'>,
  fecha: string | null | undefined,
  valores: Partial<Record<string, unknown>>,
): boolean {
  return !!campo.vigenteDesde && !!fecha && fecha.slice(0, 10) < campo.vigenteDesde && !tieneValor(valores[campo.clave]);
}

/**
 * Esquema tal como se lee una evaluación concreta: un campo desactivado solo aparece si esa evaluación ya trae un valor
 * (los datos históricos se conservan y se siguen mostrando; en una evaluación nueva no hay nada que mostrar). Con la
 * fecha de la evaluación, tampoco aparecen los descriptores creados después de esa fecha (no se pudieron medir).
 */
export function esquemaVisibleDe<Clave extends string>(
  esquema: EsquemaFase<Clave>,
  valores: Partial<Record<string, unknown>>,
  fecha?: string | null,
): EsquemaFase<Clave> {
  const visible = (campo: CampoFase<Clave>) => (estaActivo(campo) || tieneValor(valores[campo.clave])) && !noExistiaEn(campo, fecha, valores);
  if (esquema.campos.every(visible)) return esquema;
  return { ...esquema, campos: esquema.campos.filter(visible) };
}

/** Descriptores que no existían en la fecha de la evaluación: se nombran aparte y no cuentan en el «N de M». */
export function noExistianDe<Clave extends string>(
  esquema: EsquemaFase<Clave>,
  valores: Partial<Record<string, unknown>>,
  fecha: string | null | undefined,
): CampoFase<Clave>[] {
  return esquema.campos.filter((campo) => campo.rol !== 'derivado' && estaActivo(campo) && noExistiaEn(campo, fecha, valores));
}

/** Texto del nivel de una escala con etiquetas por nivel («Hasta la mitad»), o null si el campo no las tiene o el valor no es un nivel. */
export function etiquetaDeNivel(campo: CampoFase, valor: unknown): string | null {
  const niveles = campo.escala?.etiquetasNivel;
  if (!niveles || !campo.escala || !tieneValor(valor)) return null;
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isInteger(numero)) return null;
  return niveles[numero - campo.escala.minimo] ?? null;
}

/** Cuántos descriptores (no muestra ni derivados) tienen valor. */
export function contarDescriptoresConValor<Clave extends string>(
  esquema: EsquemaFase<Clave>,
  valores: Partial<Record<Clave, unknown>>,
): number {
  return descriptoresDe(esquema).filter((campo) => tieneValor(valores[campo.clave])).length;
}

const formatoNumero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });

/** Texto de un valor guardado según el tipo del campo. */
export function formatearValorCampo(campo: CampoFase, valor: unknown): string {
  if (!tieneValor(valor)) return '—';
  if (campo.tipo === 'fecha') return formatearFechaCivil(String(valor));
  const nivel = etiquetaDeNivel(campo, valor);
  if (nivel) return nivel;
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(numero)) return String(valor);
  if (campo.tipo === 'escala' && campo.escala) return `${formatoNumero.format(numero)} de ${campo.escala.maximo}`;
  const texto = formatoNumero.format(numero);
  if (!campo.unidad) return texto;
  return campo.unidad === '%' ? `${texto} %` : `${texto} ${campo.unidad}`;
}import { formatearFechaCivil } from '@/lib/fechas';

