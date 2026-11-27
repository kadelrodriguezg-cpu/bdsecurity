/**
 * Verificación independiente de A1-G1-01, actualizada tras corregirlo:
 * el alta manual rechaza casi-duplicados y el ranking acumula en la misma variedad.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, especieArandano, usuario, type Contexto } from './v1-helpers';

let ctx: Contexto;
let especie: string;
let admin: Awaited<ReturnType<typeof usuario>>;
let operario: Awaited<ReturnType<typeof usuario>>;
const variedades: string[] = [];
const cruces: string[] = [];
const lotes: string[] = [];

beforeAll(async () => {
  ctx = contexto();
  especie = await especieArandano(ctx);
  admin = await usuario(ctx, 'g101', 'admin');
  operario = await usuario(ctx, 'g101', 'operario');
}, 60_000);

afterAll(async () => {
  if (cruces.length) await ctx.service.from('polinizacion_evento').delete().in('planta_id', cruces);
  if (cruces.length) await ctx.service.from('plantas').delete().in('id', cruces);
  if (lotes.length) await ctx.service.from('importacion_lote').delete().in('id', lotes);
  if (variedades.length) await ctx.service.from('variedades').delete().in('id', variedades);
  await ctx.service.from('variedades').delete().ilike('nombre', `AUD-V1 %${ctx.R}%`);
});

describe('A1-G1-01 casi-duplicados de variedad', () => {
  it('un OPERARIO puede crear «BCH 1» y recibe 23505 al intentar «BCH-1»', async () => {
    const a = await operario.client
      .from('variedades')
      .insert({ especie_id: especie, nombre: `AUD-V1 BCH 1 ${ctx.R}`, created_by: operario.id })
      .select('id')
      .single();
    const b = await operario.client
      .from('variedades')
      .insert({ especie_id: especie, nombre: `AUD-V1 BCH-1 ${ctx.R}`, created_by: operario.id })
      .select('id')
      .single();
    expect(a.error).toBeNull();
    expect(b.error?.code).toBe('23505');
    expect(b.data).toBeNull();
    variedades.push(a.data!.id);
  });

  it('la clave que usa el importador SÍ las considera la misma variedad', async () => {
    const { data } = await ctx.service.rpc('clave_nombre_variedad', { p_nombre: `AUD-V1 BCH 1 ${ctx.R}` });
    const { data: data2 } = await ctx.service.rpc('clave_nombre_variedad', { p_nombre: `AUD-V1 BCH-1 ${ctx.R}` });
    expect(data).toBe(data2);
  });

  it('el importador rechaza una tercera grafía («BCH_1») como parecida a una existente', async () => {
    const fila = { codigo_sistema: `AUD-V1-IMP-${ctx.R}`, especie: 'Arándano', cruzamiento: 'X', mama: `AUD-V1 BCH_1 ${ctx.R}`, papa: '' };
    const r = await admin.client.rpc('previsualizar_importacion_cruces', { p_filas: [fila], p_archivo_nombre: `aud-v1-${ctx.R}.csv` });
    expect(r.error).toBeNull();
    lotes.push(r.data.lote_id);
    expect(r.data.filas[0].errores).toContain('mama_parecida_a_existente');
  });

  it('el ranking de polinización varietal acumula ambos cruces en una fila de 10 flores', async () => {
    const { data: c, error } = await ctx.service
      .from('plantas')
      .insert([
        { codigo_sistema: `AUD-V1-${ctx.R}-R1`, especie_id: especie, es_prueba: true, mama_id: variedades[0] },
        { codigo_sistema: `AUD-V1-${ctx.R}-R2`, especie_id: especie, es_prueba: true, mama_id: variedades[0] },
      ])
      .select('id');
    expect(error).toBeNull();
    cruces.push(...c!.map((x) => x.id));
    const ev = await ctx.service
      .from('polinizacion_evento')
      .insert(c!.map((x) => ({ planta_id: x.id, fecha: '2026-10-02', n_flores_cruzadas: 5, created_by: admin.id })));
    expect(ev.error).toBeNull();

    const { data, error: e2 } = await admin.client.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especie, p_rol: 'mama' });
    expect(e2).toBeNull();
    const mias = (data as Array<{ variedad_id: string; flores_totales: number }>).filter((f) => variedades.includes(f.variedad_id));
    expect(mias).toHaveLength(1);
    expect(mias.map((f) => Number(f.flores_totales))).toEqual([10]);
  });
});
