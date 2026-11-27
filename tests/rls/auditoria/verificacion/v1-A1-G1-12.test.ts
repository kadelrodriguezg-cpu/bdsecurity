/**
 * Verificación independiente de A1-G1-12: un admin lee el linaje en bloque desde
 * importacion_lote.filas y audit_log.detalle sin dejar fila `lectura_linaje` y
 * sin el límite de 20 lecturas/min de obtener_planta. Control: el operario
 * (incluso con puede_ver_linaje) no lee ninguna de las dos tablas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, especieArandano, usuario, type Contexto } from './v1-helpers';

let ctx: Contexto;
let especie: string;
let admin: Awaited<ReturnType<typeof usuario>>;
let operarioLinaje: Awaited<ReturnType<typeof usuario>>;
let varA: string;
let varB: string;
const plantas: string[] = [];
const lotes: string[] = [];
const SECRETO = () => `AUD-V1-SECRETO-${ctx.R}`;

async function lecturasDe(uid: string) {
  const { count } = await ctx.service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', uid).in('accion', ['lectura_linaje', 'lectura_ficha']);
  return count ?? 0;
}

beforeAll(async () => {
  ctx = contexto();
  especie = await especieArandano(ctx);
  admin = await usuario(ctx, 'g112', 'admin');
  operarioLinaje = await usuario(ctx, 'g112', 'operario', true);
  const { data } = await ctx.service
    .from('variedades')
    .insert([
      { especie_id: especie, nombre: `AUD-V1 Mama12 ${ctx.R}`, created_by: admin.id },
      { especie_id: especie, nombre: `AUD-V1 Papa12 ${ctx.R}`, created_by: admin.id },
    ])
    .select('id, nombre');
  varA = data!.find((v) => v.nombre.includes('Mama12'))!.id;
  varB = data!.find((v) => v.nombre.includes('Papa12'))!.id;
  const { data: c, error } = await admin.client
    .from('plantas')
    .insert({ codigo_sistema: `AUD-V1-${ctx.R}-L12`, especie_id: especie, es_prueba: true, cruzamiento: SECRETO(), mama_id: varA, papa_id: varB })
    .select('id')
    .single();
  if (error) throw error;
  plantas.push(c!.id);
  const prev = await admin.client.rpc('previsualizar_importacion_cruces', {
    p_filas: [{ codigo_sistema: `AUD-V1-${ctx.R}-L12B`, especie: 'Arándano', cruzamiento: SECRETO(), mama: `AUD-V1 Mama12 ${ctx.R}`, papa: `AUD-V1 Papa12 ${ctx.R}` }],
    p_archivo_nombre: `aud-v1-${ctx.R}.csv`,
  });
  if (prev.error) throw prev.error;
  lotes.push(prev.data.lote_id);
}, 60_000);

afterAll(async () => {
  if (lotes.length) await ctx.service.from('importacion_lote').delete().in('id', lotes);
  await ctx.service.from('plantas').delete().in('id', plantas);
  await ctx.service.from('variedades').delete().in('id', [varA, varB]);
});

describe('A1-G1-12 lectura de linaje sin auditoría por tablas de apoyo', () => {
  it('control: obtener_planta SÍ registra la lectura (fila lectura_linaje) y tiene tope de 20/min', async () => {
    const antes = await lecturasDe(admin.id);
    const r = await admin.client.rpc('obtener_planta', { p_planta_id: plantas[0] });
    expect(r.error).toBeNull();
    expect(r.data.cruzamiento).toBe(SECRETO());
    expect(await lecturasDe(admin.id)).toBe(antes + 1);
  });

  it('A1-004: SELECT de lotes se rechaza y la auditoría no copia texto de linaje', async () => {
    const antes = await lecturasDe(admin.id);
    const lote = await admin.client.from('importacion_lote').select('filas').eq('id', lotes[0]).single();
    expect(lote.error?.code).toBe('42501');
    expect(lote.data).toBeNull();

    const log = await admin.client.from('audit_log').select('planta_id, detalle').eq('planta_id', plantas[0]).eq('accion', 'alta_cruce');
    expect(log.error).toBeNull();
    expect(JSON.stringify(log.data)).not.toContain(SECRETO());

    expect(await lecturasDe(admin.id)).toBe(antes); // 0 rastro de lectura
  });

  it('A1-004: las 40 lecturas directas de lotes se rechazan', async () => {
    const resultados = await Promise.all(Array.from({ length: 40 }, () => admin.client.from('importacion_lote').select('filas').eq('id', lotes[0]).single()));
    expect(resultados.every((r) => r.error?.code === '42501')).toBe(true);
  });

  it('control: un operario con puede_ver_linaje no lee ni importacion_lote ni audit_log', async () => {
    const lote = await operarioLinaje.client.from('importacion_lote').select('filas');
    expect(lote.data ?? []).toHaveLength(0);
    const log = await operarioLinaje.client.from('audit_log').select('detalle').eq('planta_id', plantas[0]);
    expect(log.data ?? []).toHaveLength(0);
  });
});
