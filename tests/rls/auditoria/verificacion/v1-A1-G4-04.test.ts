/**
 * Verificación independiente de A1-G4-04: individualizar_plantas no tiene tope. Un
 * operario que escribe 1500 en lugar de 150 crea 1500 individuos reales que ni
 * él ni un admin pueden borrar (solo dar de baja). Se usa un cruce es_prueba y
 * la limpieza es el borrado hard oficial (único camino, solo vale para es_prueba).
 */
import { individualizarPlantas } from '../../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, especieArandano, usuario, type Contexto } from './v1-helpers';

let ctx: Contexto;
let especie: string;
let operario: Awaited<ReturnType<typeof usuario>>;
let admin: Awaited<ReturnType<typeof usuario>>;
let plantaId: string;
let realId: string;
const CANTIDAD = 1500;

beforeAll(async () => {
  ctx = contexto();
  especie = await especieArandano(ctx);
  operario = await usuario(ctx, 'g404', 'operario');
  admin = await usuario(ctx, 'g404', 'admin');
  const { data, error } = await ctx.service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-V1-${ctx.R}-IND`, especie_id: especie, es_prueba: true, estado: 'trasplante' })
    .select('id')
    .single();
  if (error) throw error;
  plantaId = data!.id;
  const real = await ctx.service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-V1-${ctx.R}-REAL`, especie_id: especie, es_prueba: false, estado: 'trasplante' })
    .select('id')
    .single();
  if (real.error) throw real.error;
  realId = real.data!.id;
}, 60_000);

afterAll(async () => {
  // El cruce REAL se limpia con service_role (preparación/limpieza, no es una prueba de permisos).
  const { error: eInd } = await ctx.service.from('individuos').delete().eq('planta_id', realId);
  if (eInd) console.log('limpieza individuos del cruce real falló:', eInd.message);
  await ctx.service.from('plantas').delete().eq('id', realId);
  // Limpieza por el camino oficial (soft + hard) para cruces de prueba.
  const r = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });
  if (r.error) {
    console.log('limpieza hard falló:', r.error.message);
    await ctx.service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', plantaId);
  }
}, 120_000);

describe('A1-G4-04 tope de individualización por llamada', () => {
  it.each([1001, 2147483647])('rechaza el exceso %i sin crear individuos', async cantidad => {
    const antes = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId);
    expect(antes.error).toBeNull();
    const res = await individualizarPlantas(operario.client, { p_planta_id: plantaId, p_cantidad: cantidad });
    expect(res.error?.code).toBe('22023');
    expect(res.error?.message).toContain('1000');
    const despues = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId);
    expect(despues.error).toBeNull();
    expect(despues.count).toBe(antes.count);
  });

  it(`rechaza ${CANTIDAD} de una vez sin crear filas y permite acumularlos con llamadas de 1000 y 500`, async () => {
    const r = await individualizarPlantas(operario.client, { p_planta_id: plantaId, p_cantidad: CANTIDAD });
    expect(r.error?.code).toBe('22023');
    expect(r.error?.message).toContain('1000');
    const antes = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId);
    expect(antes.error).toBeNull();
    expect(antes.count).toBe(0);
    for (const cantidad of [1000, 500]) {
      const lote = await individualizarPlantas(operario.client, { p_planta_id: plantaId, p_cantidad: cantidad });
      expect(lote.error).toBeNull();
      expect(lote.data.cantidad).toBe(cantidad);
    }
    const { count } = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId);
    expect(count).toBe(CANTIDAD);
  }, 60_000);

  it('ni el operario ni el admin pueden borrar individuos: DELETE directo afecta 0 filas', async () => {
    const { data: uno } = await ctx.service.from('individuos').select('id').eq('planta_id', plantaId).limit(1).single();
    for (const u of [operario, admin]) {
      const d = await u.client.from('individuos').delete().eq('id', uno!.id).select('id');
      expect(d.data ?? []).toHaveLength(0);
    }
    const { count } = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId);
    expect(count).toBe(CANTIDAD);
  });

  it('la lista de la API se corta en el tope de PostgREST (el cruce muestra menos de los que tiene)', async () => {
    const { data } = await admin.client.from('individuos').select('id').eq('planta_id', plantaId);
    expect(data!.length).toBeLessThan(CANTIDAD);
  });

  it('cada llamada aceptada registra su cantidad y códigos, y la llamada rechazada no genera auditoría de éxito', async () => {
    const { data, error } = await ctx.service.from('audit_log').select('detalle').eq('planta_id', plantaId).eq('accion', 'individualizacion');
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.map(f => f.detalle.cantidad).sort((a, b) => a - b)).toEqual([500, 1000]);
    expect(data!.flatMap(f => f.detalle.codigos)).toHaveLength(CANTIDAD);
  });

  it('en un cruce REAL los individuos creados por error no tienen salida: ni borrado hard ni DELETE del cruce', async () => {
    const r = await individualizarPlantas(operario.client, { p_planta_id: realId, p_cantidad: 150 });
    expect(r.error).toBeNull();
    const hard = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: realId, p_tipo: 'hard' });
    expect(hard.error?.code).toBe('42501');
    const directo = await admin.client.from('plantas').delete().eq('id', realId).select('id');
    expect(directo.error?.code).toBe('42501'); // A1-003 cierra DELETE antes de evaluar la FK
    const { count } = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', realId);
    expect(count).toBe(150);
  });
});
