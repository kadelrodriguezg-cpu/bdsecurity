/**
 * Catálogos de sistema: contenedor, insumo, predio. Lectura abierta a
 * cualquier autenticado (los necesitan los dropdowns de los formularios de
 * fase); alta/edición solo admin (RLS + UI gateada por AdminRoute).
 *
 * No hay borrado físico: desactivar (activo=false) es la única baja posible,
 * para no romper FKs de registros históricos que ya referencian el catálogo.
 */
import { supabase, traducirError } from './client';
import type { Database } from '@/types/database.types';

export type TipoInsumo = Database['public']['Enums']['tipo_insumo'];

export const TIPO_INSUMO_LABEL: Record<TipoInsumo, string> = {
  fungicida: 'Fungicida',
  insecticida: 'Insecticida',
  escarificante: 'Escarificante',
  otro: 'Otro',
};

export interface Contenedor {
  id: string;
  nombre: string;
  capacidad_litros: number | null;
  activo: boolean;
}

export interface Insumo {
  id: string;
  nombre: string;
  tipo: TipoInsumo;
  activo: boolean;
}

export interface Predio {
  id: string;
  nombre: string;
  activo: boolean;
  latitud: number | null;
  longitud: number | null;
  region: Database['public']['Enums']['region_chile'] | null;
}

export interface Sustrato {
  id: string;
  nombre: string;
  activo: boolean;
}

async function listar<T>(tabla: 'contenedor' | 'insumo' | 'predio' | 'sustrato', soloActivos: boolean): Promise<T[]> {
  let query = supabase.from(tabla).select('*').order('nombre');
  if (soloActivos) query = query.eq('activo', true);
  const { data, error } = await query;
  if (error) throw traducirError(error);
  return data as T[];
}

export const listarContenedores = (soloActivos = true) => listar<Contenedor>('contenedor', soloActivos);
export const listarInsumos = (soloActivos = true) => listar<Insumo>('insumo', soloActivos);
export const listarPredios = (soloActivos = true) => listar<Predio>('predio', soloActivos);
export const listarSustratos = (soloActivos = true) => listar<Sustrato>('sustrato', soloActivos);

export async function crearContenedor(input: { nombre: string; capacidad_litros?: number | null }): Promise<Contenedor> {
  const { data, error } = await supabase.from('contenedor').insert(input).select().single();
  if (error) throw traducirError(error);
  return data as Contenedor;
}

export async function actualizarContenedor(id: string, cambios: Partial<Pick<Contenedor, 'nombre' | 'capacidad_litros' | 'activo'>>): Promise<void> {
  const { error } = await supabase.from('contenedor').update(cambios).eq('id', id);
  if (error) throw traducirError(error);
}

export async function crearInsumo(input: { nombre: string; tipo: TipoInsumo }): Promise<Insumo> {
  const { data, error } = await supabase.from('insumo').insert(input).select().single();
  if (error) throw traducirError(error);
  return data as Insumo;
}

export async function actualizarInsumo(id: string, cambios: Partial<Pick<Insumo, 'nombre' | 'tipo' | 'activo'>>): Promise<void> {
  const { error } = await supabase.from('insumo').update(cambios).eq('id', id);
  if (error) throw traducirError(error);
}

export type CoordenadasPredio = { latitud: number; longitud: number };

export async function crearPredio(input: { nombre: string; region?: Predio['region'] } & Partial<CoordenadasPredio>): Promise<Predio> {
  const { data, error } = await supabase.from('predio').insert(input).select().single();
  if (error) throw traducirError(error);
  return data as Predio;
}

export async function actualizarPredio(id: string, cambios: Partial<Pick<Predio, 'nombre' | 'activo' | 'latitud' | 'longitud' | 'region'>>): Promise<void> {
  const { error } = await supabase.from('predio').update(cambios).eq('id', id);
  if (error) throw traducirError(error);
}

export async function crearSustrato(input: { nombre: string }): Promise<Sustrato> {
  const { data, error } = await supabase.from('sustrato').insert(input).select().single();
  if (error) throw traducirError(error);
  return data as Sustrato;
}

export async function actualizarSustrato(id: string, cambios: Partial<Pick<Sustrato, 'nombre' | 'activo'>>): Promise<void> {
  const { error } = await supabase.from('sustrato').update(cambios).eq('id', id);
  if (error) throw traducirError(error);
}
