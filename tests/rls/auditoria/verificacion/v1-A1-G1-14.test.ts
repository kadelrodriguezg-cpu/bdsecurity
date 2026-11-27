/**
 * Verificación independiente de A1-G1-14: tras revertir un lote importado, los
 * códigos siguen ocupados y el mismo archivo corregido no se puede volver a
 * previsualizar (todas las filas «codigo_existente»).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, usuario, type Contexto } from './v1-helpers';

let ctx: Contexto;
let admin: Awaited<ReturnType<typeof usuario>>;
const lotes: string[] = [];
let loteId: string;

function archivo() {
  return [1, 2, 3].map((i) => ({
    codigo_sistema: `AUD-V1-${ctx.R}-IMP${i}`,
    especie: 'Arándano',
    cruzamiento: `AUD-V1 cruce ${i}`,
    mama: '',
    papa: '',
    es_prueba: 'true',
  }));
}

beforeAll(async () => {
  ctx = contexto();
  admin = await usuario(ctx, 'g114', 'admin');
}, 60_000);

afterAll(async () => {
  await ctx.service.from('plantas').delete().like('codigo_sistema', `AUD-V1-${ctx.R}-IMP%`);
  if (lotes.length) await ctx.service.from('importacion_lote').delete().in('id', lotes);
});

describe('A1-G1-14 revertir una importación no libera los códigos', () => {
  it('importar → revertir → volver a previsualizar el mismo archivo: las 3 filas dan codigo_existente', async () => {
    const p1 = await admin.client.rpc('previsualizar_importacion_cruces', { p_filas: archivo(), p_archivo_nombre: `aud-v1-${ctx.R}.csv` });
    expect(p1.error).toBeNull();
    expect(p1.data.filas_con_error).toBe(0);
    loteId = p1.data.lote_id;
    lotes.push(loteId);

    const c = await admin.client.rpc('confirmar_importacion_cruces', { p_lote_id: loteId, p_crear_variedades: false, p_idempotency_key: randomUUID() });
    expect(c.error).toBeNull();
    expect(c.data.cruces_creados).toBe(3);

    const r = await admin.client.rpc('revertir_importacion', { p_lote_id: loteId });
    expect(r.error).toBeNull();
    expect(r.data.cruces_archivados).toBe(3);

    // Los cruces siguen en la tabla (archivados): el código sigue ocupado por el UNIQUE.
    const { data: filas } = await ctx.service.from('plantas').select('codigo_sistema, eliminado_at').like('codigo_sistema', `AUD-V1-${ctx.R}-IMP%`);
    expect(filas).toHaveLength(3);
    expect(filas!.every((f) => f.eliminado_at !== null)).toBe(true);

    const p2 = await admin.client.rpc('previsualizar_importacion_cruces', { p_filas: archivo(), p_archivo_nombre: `aud-v1-${ctx.R}-bis.csv` });
    expect(p2.error).toBeNull();
    lotes.push(p2.data.lote_id);
    expect(p2.data.filas_con_error).toBe(3); // lo correcto sería 0
    for (const f of p2.data.filas) expect(f.errores).toContain('codigo_existente');
  });

  it('no existe una restauración en lote: restaurar_cruzamiento recibe un solo p_planta_id', async () => {
    const { data } = await ctx.service.from('plantas').select('id').like('codigo_sistema', `AUD-V1-${ctx.R}-IMP%`).limit(1).single();
    const r = await admin.client.rpc('restaurar_cruzamiento', { p_planta_id: data!.id });
    expect(r.error).toBeNull(); // la salida manual existe, pero es de a uno
  });
});
