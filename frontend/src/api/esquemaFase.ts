/**
 * Esquema de fase leído de la base (esquema_fase_seccion / esquema_fase_campo),
 * la única fuente de descriptores desde la Fase 2. La copia TS
 * (lib/esquemaFase/evaluacionAnual.ts) queda como respaldo sin conexión; una
 * prueba RLS exige que sean idénticas.
 */
import { supabase, traducirError } from './client';
import type { CampoFase, EsquemaFase, RolCampo, TipoCampo } from '@/lib/esquemaFase/tipos';

export async function obtenerEsquemaFase(fase: string): Promise<EsquemaFase> {
  const [secciones, campos] = await Promise.all([
    supabase.from('esquema_fase_seccion').select('id, etiqueta, orden').eq('fase', fase).order('orden'),
    supabase.from('esquema_fase_campo').select('*').eq('fase', fase).order('orden'),
  ]);
  if (secciones.error) throw traducirError(secciones.error);
  if (campos.error) throw traducirError(campos.error);
  return {
    fase,
    secciones: secciones.data.map((s) => ({ id: s.id, etiqueta: s.etiqueta })),
    campos: campos.data.map((c): CampoFase => ({
      clave: c.clave,
      etiqueta: c.etiqueta,
      seccion: c.seccion,
      rol: c.rol as RolCampo,
      tipo: c.tipo as TipoCampo,
      ...(c.unidad ? { unidad: c.unidad } : {}),
      ...(c.tipo === 'escala' && c.escala_minimo !== null && c.escala_maximo !== null
        ? { escala: { minimo: c.escala_minimo, maximo: c.escala_maximo, etiquetaMinimo: c.etiqueta_minimo ?? '', etiquetaMaximo: c.etiqueta_maximo ?? '', ...(c.etiquetas_nivel ? { etiquetasNivel: c.etiquetas_nivel } : {}) } }
        : {}),
      ...(c.exige_muestra ? { exigeMuestra: true } : {}),
      // `=== false`: contra una base sin la migración 20261025110000 la columna no llega y todo campo sigue activo.
      ...(c.activo === false ? { activo: false } : {}),
      // Contra una base sin la migración 20261026100000 la columna no llega: el descriptor existió siempre.
      ...(c.vigente_desde ? { vigenteDesde: c.vigente_desde } : {}),
    })),
  };
}
