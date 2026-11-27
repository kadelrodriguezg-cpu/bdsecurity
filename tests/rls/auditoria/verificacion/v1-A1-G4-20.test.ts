/**
 * Verificación independiente de A1-G4-20: la baja individual es irreversible para todos
 * (operario, admin y service_role) y el servidor no pide más confirmación que
 * «al menos un criterio». La parte de interfaz (BajaForm / IndividuosSeccion sin
 * advertencia) se verifica por lectura de código y con
 * frontend/src/features/individuos/BajaForm.verificacion-v1.test.tsx.
 */
import { individualizarPlantas } from '../../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, especieArandano, usuario, type Contexto } from './v1-helpers';

let ctx: Contexto;
let operario: Awaited<ReturnType<typeof usuario>>;
let admin: Awaited<ReturnType<typeof usuario>>;
let plantaId: string;
let individuoId: string;

beforeAll(async () => {
  ctx = contexto();
  const especie = await especieArandano(ctx);
  operario = await usuario(ctx, 'g420', 'operario');
  admin = await usuario(ctx, 'g420', 'admin');
  const { data, error } = await ctx.service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-V1-${ctx.R}-BAJA`, especie_id: especie, es_prueba: true, estado: 'trasplante' })
    .select('id')
    .single();
  if (error) throw error;
  plantaId = data!.id;
  const r = await individualizarPlantas(operario.client, { p_planta_id: plantaId, p_cantidad: 2 });
  if (r.error) throw r.error;
  const { data: ind } = await ctx.service.from('individuos').select('id').eq('planta_id', plantaId).order('codigo_display').limit(1).single();
  individuoId = ind!.id;
}, 60_000);

afterAll(async () => {
  const r = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });
  if (r.error) console.log('limpieza hard falló:', r.error.message);
}, 60_000);

describe('A1-G4-20 baja individual', () => {
  it('el servidor rechaza una baja sin criterio (único freno): hay que elegir al menos un criterio', async () => {
    const r = await operario.client.rpc('marcar_baja_individuo', {
      p_individuo_id: individuoId,
      p_estado: 'descartado',
      p_criterios: [],
      p_nota: null,
      p_fecha: new Date().toISOString().slice(0, 10),
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(r.error?.code).toBe('22023');
    const { data } = await ctx.service.from('individuos').select('estado_vital').eq('id', individuoId).single();
    expect(data!.estado_vital).toBe('vivo');
  });

  it('con un criterio, un solo llamado deja al individuo descartado, sin confirmación ni segundo paso', async () => {
    const r = await operario.client.rpc('marcar_baja_individuo', {
      p_individuo_id: individuoId,
      p_estado: 'descartado',
      p_criterios: ['vigor'],
      p_nota: null,
      p_fecha: new Date().toISOString().slice(0, 10),
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(r.error).toBeNull();
    const { data } = await ctx.service.from('individuos').select('estado_vital').eq('id', individuoId).single();
    expect(data!.estado_vital).toBe('descartado');
  });

  it('no hay vuelta atrás: ni operario, ni admin, ni service_role pueden devolverlo a «vivo»', async () => {
    for (const cliente of [operario.client, admin.client, ctx.service]) {
      const u = await cliente.from('individuos').update({ estado_vital: 'vivo' }).eq('id', individuoId).select('id');
      expect((u.data ?? []).length === 0 || u.error !== null).toBe(true);
    }
    const { data } = await ctx.service.from('individuos').select('estado_vital').eq('id', individuoId).single();
    expect(data!.estado_vital).toBe('descartado');
  });

  it('tampoco se puede cambiar el tipo de baja (descartado → muerto) con service_role: el trigger no distingue roles', async () => {
    const u = await ctx.service.from('individuos').update({ estado_vital: 'muerto' }).eq('id', individuoId).select('id');
    expect(u.error?.code).toBe('42501');
  });
});
