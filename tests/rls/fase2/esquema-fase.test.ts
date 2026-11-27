// Fase 2, Sprint 1 — esquema de fase como única fuente de descriptores
// (20261023090000_fase2_esquema_fase.sql, más 20261025110000 que agrega etiquetas_nivel, activo y la
// distribución de flores y frutos). La copia TS del frontend (lib/esquemaFase/evaluacionAnual.ts) es
// respaldo sin conexión: debe ser idéntica a la base, incluidos el ORDEN, las etiquetas por nivel y la
// marca de campo desactivado.
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';
import { ESQUEMA_EVALUACION_ANUAL } from '@/lib/esquemaFase/evaluacionAnual';

describe('esquema de fase (Fase 2)', () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let operario: SupabaseClient;
  let admin: SupabaseClient;

  beforeAll(async () => {
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    operario = (await crearUsuarioDePrueba(creds, service, { email: 'esquema-fase-operario@test.local', rol: 'operario' })).client;
    admin = (await crearUsuarioDePrueba(creds, service, { email: 'esquema-fase-admin@test.local', rol: 'admin' })).client;
  }, 60_000);

  it('la base y la copia TS del frontend declaran exactamente lo mismo', async () => {
    const { data: secciones, error: e1 } = await operario.from('esquema_fase_seccion')
      .select('id, etiqueta, orden').eq('fase', 'evaluacion_anual').order('orden');
    const { data: campos, error: e2 } = await operario.from('esquema_fase_campo')
      .select('*').eq('fase', 'evaluacion_anual').order('orden');
    expect(e1).toBeNull();
    expect(e2).toBeNull();
    expect(secciones!.map((s) => ({ id: s.id, etiqueta: s.etiqueta })))
      .toEqual(ESQUEMA_EVALUACION_ANUAL.secciones.map((s) => ({ id: s.id, etiqueta: s.etiqueta })));
    const desdeTs = ESQUEMA_EVALUACION_ANUAL.campos.map((c) => ({
      clave: c.clave, seccion: c.seccion, etiqueta: c.etiqueta, rol: c.rol, tipo: c.tipo,
      unidad: c.unidad ?? null,
      escala_minimo: c.escala?.minimo ?? null, escala_maximo: c.escala?.maximo ?? null,
      etiqueta_minimo: c.escala?.etiquetaMinimo ?? null, etiqueta_maximo: c.escala?.etiquetaMaximo ?? null,
      exige_muestra: Boolean(c.exigeMuestra),
      etiquetas_nivel: c.escala?.etiquetasNivel ? [...c.escala.etiquetasNivel] : null,
      activo: c.activo !== false,
      vigente_desde: c.vigenteDesde ?? null,
    }));
    const desdeBase = campos!.map((c) => ({
      clave: c.clave, seccion: c.seccion, etiqueta: c.etiqueta, rol: c.rol, tipo: c.tipo, unidad: c.unidad,
      escala_minimo: c.escala_minimo, escala_maximo: c.escala_maximo,
      etiqueta_minimo: c.etiqueta_minimo, etiqueta_maximo: c.etiqueta_maximo, exige_muestra: c.exige_muestra,
      etiquetas_nivel: c.etiquetas_nivel, activo: c.activo, vigente_desde: c.vigente_desde,
    }));
    expect(desdeBase).toEqual(desdeTs);
  });

  it('el orden de los campos es el de la copia TS: la distribución va en Brotes y varas, justo después de «Color del follaje», y rend_t_ha está desactivado', async () => {
    const { data: campos, error } = await operario.from('esquema_fase_campo')
      .select('clave, orden, activo, etiquetas_nivel').eq('fase', 'evaluacion_anual').order('orden');
    expect(error).toBeNull();
    expect(campos!.map((c) => c.clave)).toEqual(ESQUEMA_EVALUACION_ANUAL.campos.map((c) => c.clave));
    const ordenes = campos!.map((c) => c.orden);
    expect(ordenes).toEqual([...ordenes].sort((a, b) => a - b));
    expect(new Set(ordenes).size).toBe(ordenes.length);
    const claves = campos!.map((c) => c.clave);
    expect(claves[claves.indexOf('color_follaje') + 1]).toBe('distribucion_flores_frutos');
    const por = Object.fromEntries(campos!.map((c) => [c.clave, c]));
    expect(por.distribucion_flores_frutos.etiquetas_nivel).toEqual(['Solo en la punta', 'Hasta la mitad', 'Toda la vara']);
    expect(por.rend_t_ha.activo).toBe(false);
    expect(campos!.filter((c) => !c.activo).map((c) => c.clave)).toEqual(['rend_t_ha']);
  });

  it('anon no lee el esquema', async () => {
    const { data, error } = await anon.from('esquema_fase_campo').select('clave');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it('nadie lo modifica por API, ni siquiera un admin', async () => {
    const ins = await admin.from('esquema_fase_campo').insert({
      fase: 'evaluacion_anual', clave: 'inventado', seccion: 'fenologia', etiqueta: 'X', orden: 99, rol: 'descriptor', tipo: 'numero',
    });
    expect(ins.error).not.toBeNull();
    const upd = await admin.from('esquema_fase_campo').update({ etiqueta: 'Cambiada' }).eq('clave', 'brotacion').select('clave');
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const { data } = await operario.from('esquema_fase_campo').select('etiqueta').eq('fase', 'evaluacion_anual').eq('clave', 'brotacion').single();
    expect(data?.etiqueta).toBe('Brotación');
  });

  it('la función interna de la regla de frutos no se expone por RPC', async () => {
    const { error } = await operario.rpc('evaluacion_exige_muestra', { p_evaluacion: {} });
    expect(error).not.toBeNull();
  });
});
