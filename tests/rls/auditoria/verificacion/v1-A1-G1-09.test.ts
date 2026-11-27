/**
 * Verificación independiente de A1-G1-09 tras el índice de A1-002.
 * La observación original exigía timeout/curva lenta. El índice puede hacerla
 * rápida según el plan SQL; A1-014 sigue no-fix y no se promete rendimiento.
 * Se conserva catálogo grande, RPC/timeout reales y se comprueba integridad
 * tanto al completar como al agotar tiempo, sin exigir lentitud artificial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, especieArandano, usuario, type Contexto } from './v1-helpers';

let ctx: Contexto;
let especie: string;
let admin: Awaited<ReturnType<typeof usuario>>;
const lotes: string[] = [];
const tiempos: Record<string, number> = {};

function filas(n: number, tag: string) {
  return Array.from({ length: n }, (_, i) => ({
    codigo_sistema: `AUD-V1-${ctx.R}-${tag}-${i}`,
    especie: 'Arándano',
    cruzamiento: `AUD-V1 cruce ${i}`,
    mama: `AUD-V1 Zmama${tag}${i} ${ctx.R}`, // progenitores inexistentes: el caso de la primera carga
    papa: `AUD-V1 Zpapa${tag}${i} ${ctx.R}`,
  }));
}

async function prev(n: number, tag: string) {
  const t = Date.now();
  const r = await admin.client.rpc('previsualizar_importacion_cruces', { p_filas: filas(n, tag), p_archivo_nombre: `aud-v1-${tag}-${ctx.R}.csv` });
  tiempos[`${n} filas`] = Date.now() - t;
  if (r.data?.lote_id) lotes.push(r.data.lote_id);
  return r;
}

beforeAll(async () => {
  ctx = contexto();
  especie = await especieArandano(ctx);
  admin = await usuario(ctx, 'g109', 'admin');
  // Línea base con el catálogo local tal cual (~10 variedades en Arándano).
  await prev(200, 'base');
  tiempos['200 filas, catálogo chico'] = tiempos['200 filas'];
  // Catálogo de ~93 variedades en total (producción tiene 83).
  const { error } = await ctx.service
    .from('variedades')
    .insert(Array.from({ length: 83 }, (_, i) => ({ especie_id: especie, nombre: `AUD-V1 Cat ${i} ${ctx.R}`, created_by: admin.id })));
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  console.log('Tiempos A1-G1-09 (ms):', JSON.stringify(tiempos));
  if (lotes.length) await ctx.service.from('importacion_lote').delete().in('id', lotes);
  await ctx.service.from('variedades').delete().ilike('nombre', `AUD-V1 Cat % ${ctx.R}`);
});

describe('A1-G1-09 escala de previsualizar_importacion_cruces', () => {
  it('200 filas con progenitores nuevos: funciona (control)', async () => {
    const r = await prev(200, 'a');
    expect(r.error).toBeNull();
    expect(r.data.filas_total).toBe(200);
  }, 30_000);

  it('2000 filas: si completa conserva conteo; si agota el timeout normal revierte el lote (medición A1-G1-09)', async () => {
    const r = await prev(2000, 'b');
    if (r.error) {
      expect(r.error.code).toBe('57014'); expect(r.data).toBeNull();
      const lote = await ctx.service.from('importacion_lote').select('id').eq('archivo_nombre', `aud-v1-b-${ctx.R}.csv`);
      expect(lote.error).toBeNull(); expect(lote.data).toHaveLength(0);
    } else {
      expect(r.data.filas_total).toBe(2000);
      expect(r.data.lote_id).toMatch(/^[0-9a-f-]{36}$/i);
    }
  }, 30_000);

  it('800 filas con catálogo ampliado: valida integridad y mide los tiempos sin exigir una curva lenta', async () => {
    const r = await prev(800, 'c');
    const t200 = tiempos['200 filas'];
    const t800 = tiempos['800 filas'];
    const base = tiempos['200 filas, catálogo chico'];
    console.log('800 filas:', r.error?.code ?? 'ok', t800, 'ms; 200 filas:', t200, 'ms; 200 filas con catálogo chico:', base, 'ms');
    const catalogo = await ctx.service.from('variedades').select('id', { count: 'exact', head: true }).eq('especie_id', especie);
    expect(catalogo.error).toBeNull(); expect(catalogo.count).toBeGreaterThanOrEqual(83);
    if (r.error) {
      expect(r.error.code).toBe('57014'); expect(r.data).toBeNull();
      const lote = await ctx.service.from('importacion_lote').select('id').eq('archivo_nombre', `aud-v1-c-${ctx.R}.csv`);
      expect(lote.error).toBeNull(); expect(lote.data).toHaveLength(0);
    } else {
      expect(r.data.filas_total).toBe(800);
    }
  }, 30_000);
});
