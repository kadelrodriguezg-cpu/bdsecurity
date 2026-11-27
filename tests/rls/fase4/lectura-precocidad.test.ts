// Fase 4, paso 48 (20261026100000): fecha desde la que existe cada descriptor y etiquetas por nivel de la precocidad.
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

describe('fase 4: vigente_desde y precocidad', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let admin: SupabaseClient;

  beforeAll(async () => {
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    operario = (await crearUsuarioDePrueba(creds, service, { email: 'fase4-precocidad-operario@test.local', rol: 'operario' })).client;
    admin = (await crearUsuarioDePrueba(creds, service, { email: 'fase4-precocidad-admin@test.local', rol: 'admin' })).client;
  }, 60_000);

  it('la precocidad nombra el mes de cosecha en cada nivel, de 1 (muy tardía) a 5 (muy temprana)', async () => {
    const { data, error } = await operario.from('esquema_fase_campo')
      .select('escala_minimo, escala_maximo, etiqueta_minimo, etiqueta_maximo, etiquetas_nivel')
      .eq('fase', 'evaluacion_anual').eq('clave', 'precocidad').single();
    expect(error).toBeNull();
    expect(data).toEqual({
      escala_minimo: 1, escala_maximo: 5,
      etiqueta_minimo: 'Muy tardía (feb o más)', etiqueta_maximo: 'Muy temprana (oct – inicio nov)',
      etiquetas_nivel: ['Muy tardía (feb o más)', 'Tardía (ene)', 'Media (dic)', 'Temprana (nov)', 'Muy temprana (oct – inicio nov)'],
    });
  });

  it('solo la distribución floral (y lo creado después) tiene fecha de inicio; el resto existió siempre', async () => {
    const { data, error } = await operario.from('esquema_fase_campo')
      .select('clave, vigente_desde').eq('fase', 'evaluacion_anual').not('vigente_desde', 'is', null).lt('vigente_desde', '2026-10-26');
    expect(error).toBeNull();
    expect(data).toEqual([{ clave: 'distribucion_flores_frutos', vigente_desde: '2026-10-25' }]);
  });

  it('nadie cambia la fecha ni las etiquetas por API, ni siquiera un admin', async () => {
    const upd = await admin.from('esquema_fase_campo').update({ vigente_desde: '2020-01-01' })
      .eq('fase', 'evaluacion_anual').eq('clave', 'distribucion_flores_frutos').select('clave');
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const { data } = await operario.from('esquema_fase_campo').select('vigente_desde')
      .eq('fase', 'evaluacion_anual').eq('clave', 'distribucion_flores_frutos').single();
    expect(data?.vigente_desde).toBe('2026-10-25');
  });
});
