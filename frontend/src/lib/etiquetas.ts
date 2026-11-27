/**
 * Etiquetas legibles de valores que la base guarda como claves (hallazgo 9 de la guía del administrador).
 * Una sola fuente: ninguna pantalla muestra «fertilizacion» o «admin» tal cual.
 */
import type { Database } from '@/types/database.types';

export type TipoProcedimiento = Database['public']['Enums']['tipo_procedimiento_cultivo'];
export type Rol = 'admin' | 'operario';

const TIPO_PROCEDIMIENTO: Record<TipoProcedimiento, string> = {
  poda: 'Poda',
  fertilizacion: 'Fertilización',
  aplicacion: 'Aplicación',
};

const ROL: Record<Rol, string> = {
  admin: 'Administrador',
  operario: 'Operario',
};

/** Acepta texto porque la API de procedimientos tipa el campo como string; un valor desconocido se muestra tal cual. */
export function etiquetaTipoProcedimiento(tipo: string): string {
  return TIPO_PROCEDIMIENTO[tipo as TipoProcedimiento] ?? tipo;
}

export function etiquetaRol(rol: Rol): string {
  return ROL[rol] ?? rol;
}

/** Fase 5 (G3): motivos de «No evaluada en esta ronda». */
export const MOTIVO_NO_EVALUADA: Record<'no_alcanzo' | 'sin_fruto' | 'otro', string> = {
  no_alcanzo: 'No alcanzó',
  sin_fruto: 'Sin fruto',
  otro: 'Otro',
};

/** «Sin fruto», o el texto escrito si el motivo es «Otro». */
export function etiquetaMotivoNoEvaluada(motivo: string, detalle?: string | null): string {
  if (motivo === 'otro' && detalle?.trim()) return detalle.trim();
  return MOTIVO_NO_EVALUADA[motivo as keyof typeof MOTIVO_NO_EVALUADA] ?? motivo;
}

/**
 * Fase 5, segunda parte (G7, EF25): la edad del individuo junto al puntaje. Edad = número de la temporada de evaluación anual
 * (ronda anual N = año N): el puntaje v3 normaliza el rendimiento según esa edad. Sin ronda, nada.
 */
export function etiquetaAnio(numeroRonda: number | null | undefined): string | null {
  return numeroRonda ? `Año ${numeroRonda}` : null;
}

/** Fase 5 (G19): «empatado con N» (N = cuántos otros comparten el puesto); sin empate, nada. */
export function textoEmpate(otros: number | null | undefined): string | null {
  return otros && otros > 0 ? `empatado con ${otros}` : null;
}
