/**
 * Verificación independiente de A1-G1-02 y A1-G3-01 (mismo hallazgo): un admin
 * borra con DELETE directo (PostgREST) un cruce REAL, saltándose la regla
 * «los cruces reales solo se archivan» de borrar_cruzamiento y sin dejar una
 * fila de borrado en audit_log.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, especieArandano, usuario, type Contexto } from './v1-helpers';

let ctx: Contexto;
let especie: string;
let admin: Awaited<ReturnType<typeof usuario>>;
let operario: Awaited<ReturnType<typeof usuario>>;
let varA: string;
let varB: string;
const plantas: string[] = [];

beforeAll(async () => {
  ctx = contexto();
  especie = await especieArandano(ctx);
  admin = await usuario(ctx, 'g102', 'admin');
  operario = await usuario(ctx, 'g102', 'operario');
  const { data, error } = await ctx.service
    .from('variedades')
    .insert([
      { especie_id: especie, nombre: `AUD-V1 Madre ${ctx.R}`, created_by: admin.id },
      { especie_id: especie, nombre: `AUD-V1 Padre ${ctx.R}`, created_by: admin.id },
    ])
    .select('id, nombre');
  if (error) throw error;
  varA = data!.find((v) => v.nombre.includes('Madre'))!.id;
  varB = data!.find((v) => v.nombre.includes('Padre'))!.id;
}, 60_000);

afterAll(async () => {
  if (plantas.length) await ctx.service.from('plantas').delete().in('id', plantas); // por si una aserción falló antes del DELETE
  await ctx.service.from('variedades').delete().in('id', [varA, varB]);
});

describe('A1-G1-02 / A1-G3-01 DELETE directo de un cruce real', () => {
  it('la puerta oficial (borrar_cruzamiento hard) SÍ rechaza un cruce real; el operario no puede DELETE directo', async () => {
    const { data: c, error } = await admin.client
      .from('plantas')
      .insert({ codigo_sistema: `AUD-V1-${ctx.R}-A`, especie_id: especie, es_prueba: false, mama_id: varA, papa_id: varB, cruzamiento: 'AUD-V1 X' })
      .select('id')
      .single();
    expect(error).toBeNull();
    plantas.push(c!.id);

    const puerta = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: c!.id, p_tipo: 'hard' });
    expect(puerta.error?.code).toBe('42501');
    expect(puerta.error?.message).toContain('solo se archivan');

    const op = await operario.client.from('plantas').delete().eq('id', c!.id).select('id');
    expect(op.data ?? []).toHaveLength(0); // RLS: 0 filas
    const { count } = await ctx.service.from('plantas').select('id', { count: 'exact', head: true }).eq('id', c!.id);
    expect(count).toBe(1);
  });

  it('(estado corregido A1-003) el DELETE del admin se rechaza y conserva cruce real, bitácora y auditoría', async () => {
    const { data: c } = await admin.client
      .from('plantas')
      .insert({ codigo_sistema: `AUD-V1-${ctx.R}-B`, especie_id: especie, es_prueba: false, mama_id: varA, papa_id: varB, cruzamiento: 'AUD-V1 Y' })
      .select('id')
      .single();
    plantas.push(c!.id);
    const ev = await ctx.service.from('registros_evento').insert({ planta_id: c!.id, tipo_evento: 'otro', notas: 'AUD-V1 bitácora' }).select('id').single();
    expect(ev.error).toBeNull();

    const t0 = new Date().toISOString();
    const del = await admin.client.from('plantas').delete().eq('id', c!.id).select('id, codigo_sistema, es_prueba');
    expect(del.error?.code).toBe('42501');
    expect(del.data).toBeNull();

    const { count: nPlanta } = await ctx.service.from('plantas').select('id', { count: 'exact', head: true }).eq('id', c!.id);
    const { count: nEvento } = await ctx.service.from('registros_evento').select('id', { count: 'exact', head: true }).eq('id', ev.data!.id);
    expect(nPlanta).toBe(1);
    expect(nEvento).toBe(1);

    // Rastro del borrado: ninguna fila de audit_log del admin posterior a t0 (la RPC oficial sí escribiría borrado_cruzamiento_*).
    const { data: rastro } = await ctx.service.from('audit_log').select('accion').eq('usuario_id', admin.id).gte('ocurrido_en', t0);
    expect(rastro ?? []).toHaveLength(0);

    // La auditoría de alta conserva su vínculo con el cruce.
    const { data: alta } = await ctx.service.from('audit_log').select('planta_id, accion, detalle').eq('usuario_id', admin.id).eq('accion', 'alta_cruce').eq('detalle->>codigo_sistema', `AUD-V1-${ctx.R}-B`);
    expect(alta).toHaveLength(1);
    expect(alta![0].planta_id).toBe(c!.id);
  });
});
