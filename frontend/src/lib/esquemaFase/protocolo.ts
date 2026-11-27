/**
 * Protocolo de ronda sobre el esquema de fase (Fase 2, Sprint 1). Misma regla
 * de estados que la base (estados_descriptores): medido · falto · no_evaluado
 * · marcado. Lo obligatorio que falta avisa y no bloquea.
 */
import type { DescriptoresProtocolo, EstadoDescriptor, FilaPlanilla, NivelProtocolo } from '@/api/protocolo';
import { estaActivo, tieneValor, type EsquemaFase } from './tipos';

export type NivelSeccion = 'obligatoria' | 'opcional' | 'mixta' | 'fuera';

export interface ResumenSeccion {
  id: string;
  etiqueta: string;
  nivel: NivelSeccion;
  /** Campos de la sección que el protocolo incluye (obligatorios u opcionales). */
  claves: string[];
  obligatorios: string[];
}

/** Campos que un protocolo puede incluir: descriptores y muestra, nunca derivados ni desactivados (EF11). */
export function camposProtocolizables<C extends string>(esquema: EsquemaFase<C>) {
  return esquema.campos.filter((campo) => campo.rol !== 'derivado' && estaActivo(campo));
}

/**
 * Campos de los que se leen valores: los mismos que los protocolizables MÁS los desactivados, porque las evaluaciones
 * históricas conservan su valor (p. ej. `rend_t_ha`) y hay que traerlo para mostrarlo.
 */
export function camposLegibles<C extends string>(esquema: EsquemaFase<C>) {
  return esquema.campos.filter((campo) => campo.rol !== 'derivado');
}

/**
 * Claves obligatorias del protocolo; con `esquema`, sin las de campos desactivados ni calculados (un protocolo antiguo puede traerlos
 * y ya no se pueden llenar: p. ej. el % exportable, que desde la fase 4 se calcula con la poscosecha).
 */
function obligatoriosDe<C extends string>(protocolo: DescriptoresProtocolo | null, esquema?: EsquemaFase<C>): string[] {
  const inactivas = new Set((esquema?.campos ?? []).filter((c) => !estaActivo(c) || c.rol === 'derivado').map((c) => c.clave as string));
  return Object.entries(protocolo ?? {}).filter(([clave, nivel]) => nivel === 'obligatorio' && !inactivas.has(clave)).map(([clave]) => clave);
}

export function resumenSecciones<C extends string>(esquema: EsquemaFase<C>, protocolo: DescriptoresProtocolo | null): ResumenSeccion[] {
  const niveles = (protocolo ?? {}) as Record<string, NivelProtocolo | undefined>;
  return esquema.secciones.map((seccion) => {
    const campos = camposProtocolizables(esquema).filter((c) => c.seccion === seccion.id);
    const claves = campos.map((c) => c.clave as string).filter((clave) => niveles[clave]);
    const obligatorios = claves.filter((clave) => niveles[clave] === 'obligatorio');
    const nivel: NivelSeccion = claves.length === 0
      ? 'fuera'
      : obligatorios.length === claves.length ? 'obligatoria'
        : obligatorios.length === 0 ? 'opcional' : 'mixta';
    return { id: seccion.id, etiqueta: seccion.etiqueta, nivel, claves, obligatorios };
  });
}

/** Obligatorios del protocolo sin valor, agrupados por sección (solo secciones con faltantes). */
export function obligatoriosQueFaltan<C extends string>(
  esquema: EsquemaFase<C>,
  protocolo: DescriptoresProtocolo | null,
  valores: Partial<Record<string, unknown>>,
): { seccion: string; etiqueta: string; faltan: string[] }[] {
  return resumenSecciones(esquema, protocolo)
    .map((s) => ({
      seccion: s.id,
      etiqueta: s.etiqueta,
      faltan: s.obligatorios.filter((clave) => !tieneValor(valores[clave])),
    }))
    .filter((s) => s.faltan.length > 0);
}

export function contarObligatorios<C extends string>(protocolo: DescriptoresProtocolo | null, valores: Partial<Record<string, unknown>>, esquema?: EsquemaFase<C>) {
  const obligatorios = obligatoriosDe(protocolo, esquema);
  return { llenos: obligatorios.filter((clave) => tieneValor(valores[clave])).length, total: obligatorios.length };
}

export function estadoDescriptor(
  clave: string,
  valor: unknown,
  protocolo: DescriptoresProtocolo | null,
  marcados: readonly string[] = [],
): EstadoDescriptor {
  if (tieneValor(valor)) return marcados.includes(clave) ? 'marcado' : 'medido';
  // Faltó = obligatorio sin valor; lo opcional sin valor es «no evaluado».
  return (protocolo as Record<string, unknown> | null)?.[clave] === 'obligatorio' ? 'falto' : 'no_evaluado';
}

/** Obligatorios cumplidos según los estados calculados por la base (medido o marcado). */
export function contarObligatoriosDeEstados<C extends string>(
  protocolo: DescriptoresProtocolo | null,
  estados: Partial<Record<string, EstadoDescriptor>> | null,
  esquema?: EsquemaFase<C>,
) {
  const obligatorios = obligatoriosDe(protocolo, esquema);
  const llenos = obligatorios.filter((clave) => estados?.[clave] === 'medido' || estados?.[clave] === 'marcado').length;
  return { llenos, total: obligatorios.length };
}

/** Nota corta de una fila de la planilla: lo marcado primero, después lo que faltó. */
export function notaFila<C extends string>(
  esquema: EsquemaFase<C>,
  protocolo: DescriptoresProtocolo | null,
  fila: Pick<FilaPlanilla, 'estado' | 'estados' | 'protocolo_distinto'>,
): string {
  if (fila.estado === 'sin_ronda') return 'Sin ronda iniciada';
  const estados = fila.estados as Partial<Record<string, EstadoDescriptor>> | null;
  if (!estados) return '';
  const etiqueta = (clave: string) => esquema.campos.find((c) => c.clave === clave)?.etiqueta.toLowerCase() ?? clave;
  const marcados = Object.entries(estados).filter(([, e]) => e === 'marcado').map(([clave]) => clave);
  const partes: string[] = [];
  if (marcados.length > 0) partes.push(`Revisar ${marcados.map(etiqueta).join(', ')}`);
  else {
    const faltan = resumenSecciones(esquema, protocolo)
      .map((s) => ({ etiqueta: s.etiqueta, claves: s.obligatorios.filter((clave) => estados[clave] === 'falto') }))
      .filter((s) => s.claves.length > 0);
    // Uno solo se nombra («Sin precocidad»); varios se cuentan por sección.
    if (faltan.length === 1 && faltan[0].claves.length === 1) partes.push(`Sin ${etiqueta(faltan[0].claves[0])}`);
    else if (faltan.length > 0) partes.push(`Faltan ${faltan.map((s) => `${s.claves.length} de ${s.etiqueta}`).join(' y ')}`);
  }
  if (fila.protocolo_distinto) partes.push('protocolo anterior');
  return partes.join(' · ');
}

export const ESTADO_DESCRIPTOR_LABEL: Record<EstadoDescriptor, string> = {
  medido: 'Medido',
  falto: 'Faltó',
  no_evaluado: 'No evaluado',
  marcado: 'Marcado para revisión',
};

export const NIVEL_SECCION_LABEL: Record<NivelSeccion, string> = {
  obligatoria: 'Obligatoria',
  opcional: 'Opcional',
  mixta: 'Parte obligatoria',
  fuera: 'Fuera del protocolo',
};
