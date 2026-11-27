// Sprint 1.1 — iniciar la ronda en lote desde la planilla es seguro de repetir.
// Usa el mismo ejecutor que la app (frontend/src/features/evaluaciones/lote.ts,
// máximo 5 a la vez) contra la RPC real iniciar_ronda_esperada.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ejecutarEnLote } from '@/features/evaluaciones/lote';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';
import { limpiarPrueba } from '../limpieza-pruebas';

describe('iniciar la ronda en lote (Sprint 1.1)', () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let admin2: SupabaseClient;
  let adminId: string;
  let admin2Id: string;
  const plantaIds: string[] = [];
  const sufijo = Date.now();

  async function cruceConIndividuos(n: number, conRonda: number): Promise<string[]> {
    const { data: esp } = await service.from('especies').select('id').limit(1).single();
    const { data: planta, error } = await service.from('plantas')
      .insert({ codigo_sistema: `LOTE-${sufijo}-${n}`, especie_id: esp!.id, estado: 'evaluacion_anual', es_prueba: true }).select('id').single();
    if (error || !planta) throw error ?? new Error('No se creó la planta');
    plantaIds.push(planta.id as string);
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const { data, error: e } = await service.from('individuos')
        .insert({ planta_id: planta.id, codigo_display: 'GENERADO-POR-TRIGGER', fecha_individualizacion: '2027-01-05', created_by: adminId })
        .select('id').single();
      if (e || !data) throw e ?? new Error('No se creó el individuo');
      ids.push(data.id as string);
    }
    for (const id of ids.slice(0, conRonda)) {
      const { error: e } = await service.from('ronda_evaluacion_anual')
        .insert({ individuo_id: id, numero_ronda: 1, anio: 2027, fecha_inicio: '2027-01-01', created_by: adminId });
      if (e) throw e;
    }
    return ids;
  }

  const iniciar = (cliente: SupabaseClient) => async (individuoId: string) => {
    const { data, error } = await cliente.rpc('iniciar_ronda_esperada', { p_individuo_id: individuoId, p_tipo: 'anual', p_numero_esperado: 1 });
    if (error) throw error;
    return data;
  };

  async function rondasPorIndividuo(ids: string[]) {
    const { data } = await service.from('ronda_evaluacion_anual').select('individuo_id, id').in('individuo_id', ids).eq('tipo_ronda', 'anual').eq('numero_ronda', 1);
    const cuenta = new Map<string, number>();
    for (const r of data ?? []) cuenta.set(r.individuo_id as string, (cuenta.get(r.individuo_id as string) ?? 0) + 1);
    return { total: data?.length ?? 0, cuenta, ids: new Set((data ?? []).map((r) => r.id as string)) };
  }

  beforeAll(async () => {
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const a = await crearUsuarioDePrueba(creds, service, { email: `lote-admin-${sufijo}@test.local`, rol: 'admin' });
    admin = a.client;
    adminId = a.userId;
    const a2 = await crearUsuarioDePrueba(creds, service, { email: `lote-admin2-${sufijo}@test.local`, rol: 'admin' });
    admin2 = a2.client;
    admin2Id = a2.userId;
  }, 60_000);

  afterAll(async () => {
    await limpiarPrueba(service, { plantaIds, usuarioIds: [adminId, admin2Id] }, 'iniciar-ronda-lote');
  }, 60_000);

  it('repetir el lote completo (doble clic, sin recargar) no crea una segunda ronda a nadie', async () => {
    const ids = await cruceConIndividuos(30, 5);
    const avance: number[] = [];
    const primera = await ejecutarEnLote(ids, iniciar(admin), { concurrencia: 5, onAvance: (t) => avance.push(t) });
    expect(primera.fallidos).toEqual([]);
    expect(avance.at(-1)).toBe(30);
    const tras1 = await rondasPorIndividuo(ids);
    expect(tras1.total).toBe(30);
    // Segunda vez, con los 30 (incluidos los que ya la tenían): la RPC devuelve la existente.
    const segunda = await ejecutarEnLote(ids, iniciar(admin), { concurrencia: 5 });
    expect(segunda.fallidos).toEqual([]);
    const tras2 = await rondasPorIndividuo(ids);
    expect(tras2.total).toBe(30);
    expect(Math.max(...tras2.cuenta.values())).toBe(1);
    expect(tras2.ids).toEqual(tras1.ids); // las mismas rondas, ninguna nueva
  }, 120_000);

  it('dos lotes a la vez (dos administradores) dejan una sola ronda por individuo', async () => {
    const ids = await cruceConIndividuos(25, 0);
    const [a, b] = await Promise.all([
      ejecutarEnLote(ids, iniciar(admin), { concurrencia: 5 }),
      ejecutarEnLote([...ids].reverse(), iniciar(admin2), { concurrencia: 5 }),
    ]);
    expect([...a.fallidos, ...b.fallidos]).toEqual([]);
    const tras = await rondasPorIndividuo(ids);
    expect(tras.total).toBe(25);
    expect(Math.max(...tras.cuenta.values())).toBe(1);
  }, 120_000);

  it('un número esperado que ya no corresponde falla con 55000 y no crea nada', async () => {
    const ids = await cruceConIndividuos(3, 0);
    const resultado = await ejecutarEnLote(ids, async (id) => {
      const { error } = await admin.rpc('iniciar_ronda_esperada', { p_individuo_id: id, p_tipo: 'anual', p_numero_esperado: 2 });
      if (error) throw error;
    }, { concurrencia: 5 });
    expect(resultado.fallidos).toHaveLength(3);
    expect(resultado.fallidos.every((f) => (f.error as { code?: string }).code === '55000')).toBe(true);
    expect((await rondasPorIndividuo(ids)).total).toBe(0);
  }, 60_000);
});
