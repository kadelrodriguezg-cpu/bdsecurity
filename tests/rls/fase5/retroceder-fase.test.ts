/**
 * Fase 5, hallazgo 1 de la guía del administrador (decisión G1): el admin retrocede la fase de un cruce aunque tenga plantas,
 * con motivo obligatorio y auditado; se bloquea si dejaría datos huérfanos. Además, antes de pasar de Evaluación anual a
 * Multisitio se cuentan las plantas con la poscosecha sin terminar (15, 30 o 45 días).
 */
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditoriaDe, crearCruce, crearEvaluacion, crearIndividuos, crearRonda, iniciarContexto, limpiarContexto,
  type ContextoG6,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;

beforeAll(async () => {
  ctx = await iniciarContexto('fase5-retroceder');
}, 120_000);

afterAll(async () => {
  // El protocolo que define la prueba de poscosecha es inmutable (ni service_role lo borra): se quita como en g10, solo el propio.
  if (cruceConProtocolo) {
    execFileSync('docker', ['exec', 'supabase_db_dbsecurity-frutales', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
      `set session_replication_role = replica; update evaluaciones set protocolo_id = null where protocolo_id in (select id from protocolo_ronda where planta_id = '${cruceConProtocolo}'); delete from protocolo_ronda where planta_id = '${cruceConProtocolo}';`]);
  }
  await limpiarContexto(ctx);
}, 60_000);

let cruceConProtocolo: string | null = null;

const retroceder = (cliente: typeof ctx.admin, plantaId: string, estadoActual: string, motivo: string) =>
  cliente.rpc('retroceder_fase_cruce', { p_planta_id: plantaId, p_estado_actual: estadoActual, p_motivo: motivo });

async function estadoDe(plantaId: string): Promise<string> {
  const { data } = await ctx.service.from('plantas').select('estado').eq('id', plantaId).single();
  return (data as { estado: string }).estado;
}

describe('retroceder_fase_cruce', () => {
  it('un cruce en Crecimiento con plantas vuelve a Trasplante con motivo, y queda auditado', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-A-${ctx.R}`, estado: 'crecimiento' });
    await crearIndividuos(ctx, cruce, 3);
    const { data, error } = await retroceder(ctx.admin, cruce, 'crecimiento', 'Se avanzó por error');
    expect(error).toBeNull();
    expect(data).toBe('trasplante');
    expect(await estadoDe(cruce)).toBe('trasplante');
    const filas = (await auditoriaDe(ctx, ctx.adminId, 'retroceso_fase')).filter((f) => f.planta_id === cruce);
    expect(filas).toHaveLength(1);
    expect(filas[0].detalle).toMatchObject({ estado_anterior: 'crecimiento', estado_nuevo: 'trasplante', motivo: 'Se avanzó por error' });
  });

  it('el motivo es obligatorio', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-B-${ctx.R}`, estado: 'cosecha' });
    const { error } = await retroceder(ctx.admin, cruce, 'cosecha', '   ');
    expect(error?.code).toBe('22023');
    expect(await estadoDe(cruce)).toBe('cosecha');
  });

  it('el operario no puede retroceder', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-C-${ctx.R}`, estado: 'cosecha' });
    const { error } = await retroceder(ctx.operario, cruce, 'cosecha', 'Prueba');
    expect(error?.code).toBe('42501');
    expect(await estadoDe(cruce)).toBe('cosecha');
  });

  it('si la fase cambió desde otra sesión, se rechaza sin tocar nada', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-D-${ctx.R}`, estado: 'germinacion' });
    const { error } = await retroceder(ctx.admin, cruce, 'cosecha', 'Prueba');
    expect(error?.code).toBe('55000');
    expect(await estadoDe(cruce)).toBe('germinacion');
  });

  it('se bloquea si dejaría datos huérfanos: rondas anuales al volver a Crecimiento', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-E-${ctx.R}`, estado: 'evaluacion_anual' });
    const [ind] = await crearIndividuos(ctx, cruce, 1);
    await crearRonda(ctx, ind.id);
    const { error } = await retroceder(ctx.admin, cruce, 'evaluacion_anual', 'Prueba');
    expect(error?.code).toBe('23514');
    expect(error?.message).toMatch(/rondas de evaluación anual/);
    expect(await estadoDe(cruce)).toBe('evaluacion_anual');
  });

  it('se bloquea si dejaría datos huérfanos: rondas de Multisitio al volver a Evaluación anual', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-F-${ctx.R}`, estado: 'traslado_destino' });
    const [ind] = await crearIndividuos(ctx, cruce, 1);
    await crearRonda(ctx, ind.id, 1, 'multisitio');
    const { error } = await retroceder(ctx.admin, cruce, 'traslado_destino', 'Prueba');
    expect(error?.code).toBe('23514');
    expect(error?.message).toMatch(/Multisitio/);
  });

  it('se bloquea si dejaría plantas sin su fase: de Trasplante a Germinación con individuos', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-G-${ctx.R}`, estado: 'trasplante' });
    await crearIndividuos(ctx, cruce, 1);
    const { error } = await retroceder(ctx.admin, cruce, 'trasplante', 'Prueba');
    expect(error?.code).toBe('23514');
    expect(error?.message).toMatch(/plantas/);
  });

  it('desde Proceso finalizado vuelve a Multisitio sin bloqueos', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-H-${ctx.R}`, estado: 'proceso_finalizado' });
    await crearIndividuos(ctx, cruce, 1);
    const { data, error } = await retroceder(ctx.admin, cruce, 'proceso_finalizado', 'Falta un traslado');
    expect(error).toBeNull();
    expect(data).toBe('traslado_destino');
  });

  it('un cruce en Sin empezar no tiene fase anterior', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-I-${ctx.R}`, estado: 'sin_empezar' });
    const { error } = await retroceder(ctx.admin, cruce, 'sin_empezar', 'Prueba');
    expect(error?.code).toBe('22023');
  });

  it('un cruce archivado no se retrocede', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-RET-J-${ctx.R}`, estado: 'cosecha', eliminado: true });
    const { error } = await retroceder(ctx.admin, cruce, 'cosecha', 'Prueba');
    expect(error).not.toBeNull();
    expect(await estadoDe(cruce)).toBe('cosecha');
  });
});

describe('poscosecha_incompleta_cruce', () => {
  it('cuenta las plantas con lecturas empezadas sin terminar, y las que el protocolo pide sin ninguna lectura', async () => {
    const cruce = await crearCruce(ctx, { codigo: `F5-POS-${ctx.R}`, estado: 'evaluacion_anual' });
    cruceConProtocolo = cruce;
    const [a, b, c, d] = await crearIndividuos(ctx, cruce, 4);
    // a: solo 15 días (incompleta); b: las tres (completa); c: sin lecturas; d: 15 y 30 en visitas distintas (incompleta)
    await crearEvaluacion(ctx, await crearRonda(ctx, a.id), { pct_buen_estado_15d: 90 });
    await crearEvaluacion(ctx, await crearRonda(ctx, b.id), { pct_buen_estado_15d: 90, pct_buen_estado_30d: 80, pct_buen_estado_45d: 70 });
    await crearEvaluacion(ctx, await crearRonda(ctx, c.id), {});
    const rd = await crearRonda(ctx, d.id);
    await crearEvaluacion(ctx, rd, { pct_buen_estado_15d: 90 });
    await crearEvaluacion(ctx, rd, { pct_buen_estado_30d: 85 }, { fecha: '2026-06-30' });

    const sinProtocolo = await ctx.admin.rpc('poscosecha_incompleta_cruce', { p_planta_id: cruce });
    expect(sinProtocolo.error).toBeNull();
    expect(sinProtocolo.data).toBe(2);

    // Con un protocolo que pide la poscosecha, la planta sin ninguna lectura también cuenta.
    const def = await ctx.admin.rpc('definir_protocolo_ronda', {
      p_planta_id: cruce, p_tipo_ronda: 'anual', p_numero_ronda: 1, p_nombre: 'Con poscosecha',
      p_descriptores: { pct_buen_estado_15d: 'opcional', pct_buen_estado_30d: 'opcional', pct_buen_estado_45d: 'opcional' },
    });
    expect(def.error).toBeNull();
    const conProtocolo = await ctx.admin.rpc('poscosecha_incompleta_cruce', { p_planta_id: cruce });
    expect(conProtocolo.data).toBe(3);
  });

  it('anon no la puede llamar', async () => {
    const { error } = await ctx.anon.rpc('poscosecha_incompleta_cruce', { p_planta_id: '00000000-0000-0000-0000-000000000000' });
    expect(error).not.toBeNull();
  });
});
