/**
 * v3 (A8, migración 20261024100000): «Corregir» una evaluación cerrada. Solo el admin, con motivo; la corrección
 * conserva el ID, queda `corregida` y el historial (obtener_correcciones_individuo) muestra a todos quién, cuándo y
 * por qué. Se verifica contra la base local.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearCruce, crearEvaluacion, crearIndividuos, crearRonda, iniciarContexto, limpiarContexto,
  type ContextoG6, type Fila,
} from '../auditoria/g6-helpers';

let ctx: ContextoG6;
let individuoId: string;
let evaluacionId: string;

beforeAll(async () => {
  ctx = await iniciarContexto('v3-corregir');
  const cruce = await crearCruce(ctx, { codigo: `V3-CORR-${ctx.R}` });
  const [ind] = await crearIndividuos(ctx, cruce, 1);
  individuoId = ind.id;
  evaluacionId = await crearEvaluacion(ctx, await crearRonda(ctx, ind.id), { brix: 12, firmeza: 3 }, { estado: 'completa' });
}, 60_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

async function evaluacion(): Promise<Fila> {
  const { data } = await ctx.service.from('evaluaciones').select('id, estado, brix, firmeza, motivo_cambio').eq('id', evaluacionId).single();
  return data as Fila;
}

async function correcciones(cliente: ContextoG6['operario']) {
  return cliente.rpc('obtener_correcciones_individuo', { p_individuo_id: individuoId });
}

describe('Corregir una evaluación cerrada (A8)', () => {
  it('el operario no puede corregir: la fila no cambia', async () => {
    const { data, error } = await ctx.operario.from('evaluaciones').update({ brix: 99, estado: 'corregida', motivo_cambio: 'intento' }).eq('id', evaluacionId).select('id');
    expect(error === null ? data : []).toEqual([]);
    expect(await evaluacion()).toMatchObject({ estado: 'completa', brix: 12 });
  });

  it('el admin sin motivo no puede corregir (23514)', async () => {
    const { error } = await ctx.admin.from('evaluaciones').update({ brix: 13, estado: 'corregida' }).eq('id', evaluacionId);
    expect(error?.code).toBe('23514');
    expect(await evaluacion()).toMatchObject({ estado: 'completa', brix: 12 });
  });

  it('el admin corrige con motivo: mismo ID, estado corregida y una fila correccion_evaluacion', async () => {
    const { error } = await ctx.admin.from('evaluaciones').update({ brix: 13.5, estado: 'corregida', motivo_cambio: 'Brix mal tipeado' }).eq('id', evaluacionId);
    expect(error).toBeNull();
    expect(await evaluacion()).toMatchObject({ id: evaluacionId, estado: 'corregida', brix: 13.5, motivo_cambio: 'Brix mal tipeado' });
    const { data: filas } = await ctx.service.from('audit_log').select('usuario_id, accion, detalle').eq('accion', 'correccion_evaluacion').eq('detalle->>evaluacion_id', evaluacionId);
    expect(filas).toHaveLength(1);
    expect(filas![0]).toMatchObject({ usuario_id: ctx.adminId, detalle: { individuo_id: individuoId, estado_anterior: 'completa', motivo: 'Brix mal tipeado', campos: ['brix'] } });
  });

  it('el historial lo ve también el operario: quién (solo el nombre), cuándo, por qué y qué campos', async () => {
    const { data, error } = await correcciones(ctx.operario);
    expect(error).toBeNull();
    const lista = data as Fila[];
    expect(lista).toHaveLength(1);
    const { data: perfil } = await ctx.service.from('perfiles').select('nombre').eq('id', ctx.adminId).single();
    expect(lista[0]).toMatchObject({ evaluacion_id: evaluacionId, corregido_por: perfil!.nombre, motivo: 'Brix mal tipeado', campos: ['brix'] });
    expect(Object.keys(lista[0]).sort()).toEqual(['campos', 'corregido_por', 'evaluacion_id', 'fecha', 'motivo']);
  });

  it('una segunda corrección (corregida → corregida) también queda, con su propio motivo, primero en la lista', async () => {
    const { error } = await ctx.admin.from('evaluaciones').update({ firmeza: 4, motivo_cambio: 'Firmeza revisada en terreno' }).eq('id', evaluacionId);
    expect(error).toBeNull();
    const lista = (await correcciones(ctx.operario)).data as Fila[];
    expect(lista.map((c) => c.motivo)).toEqual(['Firmeza revisada en terreno', 'Brix mal tipeado']);
    expect(lista[0].campos).toEqual(['firmeza']);
  });

  it('anular o editar un borrador no cuenta como corrección', async () => {
    const otra = await crearEvaluacion(ctx, (await ctx.service.from('evaluaciones').select('ronda_id').eq('id', evaluacionId).single()).data!.ronda_id, { brix: 10 }, { estado: 'borrador' });
    const { error } = await ctx.admin.from('evaluaciones').update({ brix: 11 }).eq('id', otra);
    expect(error).toBeNull();
    expect(((await correcciones(ctx.operario)).data as Fila[])).toHaveLength(2);
  });

  it('N30: con el cruce en otra fase, el admin corrige; el operario no; y nadie crea ni cierra evaluaciones fuera de la fase', async () => {
    const cruce = await crearCruce(ctx, { codigo: `V3-CORR-FASE-${ctx.R}` });
    const [ind] = await crearIndividuos(ctx, cruce, 1);
    const ronda = await crearRonda(ctx, ind.id);
    const cerrada = await crearEvaluacion(ctx, ronda, { brix: 12 }, { estado: 'completa' });
    const borrador = await crearEvaluacion(ctx, ronda, { brix: 11 }, { estado: 'borrador', createdBy: ctx.adminId });
    const { error: errFase } = await ctx.service.from('plantas').update({ estado: 'traslado_destino' }).eq('id', cruce);
    expect(errFase).toBeNull();

    // El admin corrige la evaluación cerrada (completa -> corregida y luego corregida -> corregida).
    const primera = await ctx.admin.from('evaluaciones').update({ brix: 12.5, estado: 'corregida', motivo_cambio: 'Brix revisado tras el traslado' }).eq('id', cerrada).select('id');
    expect(primera.error).toBeNull();
    expect(primera.data).toHaveLength(1);
    const segunda = await ctx.admin.from('evaluaciones').update({ brix: 12.6, motivo_cambio: 'Segunda revisión' }).eq('id', cerrada).select('id');
    expect(segunda.error).toBeNull();
    // Sin motivo, ni fuera de fase se puede.
    const sinMotivo = await ctx.admin.from('evaluaciones').update({ brix: 1, motivo_cambio: ' ' }).eq('id', cerrada);
    expect(sinMotivo.error?.code).toBe('23514');

    // El operario no puede corregir (la fila no cambia).
    const op = await ctx.operario.from('evaluaciones').update({ brix: 99, estado: 'corregida', motivo_cambio: 'intento' }).eq('id', cerrada).select('id');
    expect(op.error === null ? op.data : []).toEqual([]);

    // Nadie crea una evaluación nueva fuera de la fase, ni completa ni borrador.
    for (const [cliente, autor] of [[ctx.admin, ctx.adminId], [ctx.operario, ctx.operarioId]] as const) {
      for (const estado of ['completa', 'borrador'] as const) {
        const nueva = await cliente.from('evaluaciones').insert({ ronda_id: ronda, fecha: '2026-10-20', estado, created_by: autor, cantidad_frutos: 10, peso_total_g: 100 });
        expect(nueva.error?.code, `${autor === ctx.adminId ? 'admin' : 'operario'} ${estado}`).toBe('55000');
      }
    }
    // Ni cerrar un borrador fuera de la fase (no es una corrección).
    const cerrarBorrador = await ctx.admin.from('evaluaciones').update({ estado: 'completa' }).eq('id', borrador);
    expect(cerrarBorrador.error?.code).toBe('55000');

    const { data } = await ctx.service.from('evaluaciones').select('estado, brix').eq('id', cerrada).single();
    expect(data).toMatchObject({ estado: 'corregida', brix: 12.6 });
  });

  it('N37: con el individuo dado de baja el admin corrige (el operario no, y nadie crea evaluaciones nuevas)', async () => {
    const cruce = await crearCruce(ctx, { codigo: `V3-CORR-BAJA-${ctx.R}` });
    const [ind] = await crearIndividuos(ctx, cruce, 1);
    const ronda = await crearRonda(ctx, ind.id);
    const cerrada = await crearEvaluacion(ctx, ronda, { brix: 12 }, { estado: 'completa' });
    const { error: errBaja } = await ctx.service.from('individuos').update({ estado_vital: 'muerto', fecha_baja: '2026-10-20' }).eq('id', ind.id);
    expect(errBaja).toBeNull();

    const corr = await ctx.admin.from('evaluaciones').update({ brix: 12.4, estado: 'corregida', motivo_cambio: 'Brix revisado antes de la baja' }).eq('id', cerrada).select('id');
    expect(corr.error).toBeNull();
    expect(corr.data).toHaveLength(1);
    const op = await ctx.operario.from('evaluaciones').update({ brix: 99, estado: 'corregida', motivo_cambio: 'intento' }).eq('id', cerrada).select('id');
    expect(op.error === null ? op.data : []).toEqual([]);
    const nueva = await ctx.admin.from('evaluaciones').insert({ ronda_id: ronda, fecha: '2026-10-21', estado: 'borrador', created_by: ctx.adminId });
    expect(nueva.error).not.toBeNull();
    const { data } = await ctx.service.from('evaluaciones').select('estado, brix').eq('id', cerrada).single();
    expect(data).toMatchObject({ estado: 'corregida', brix: 12.4 });
  });

  it('N37: con el cruce archivado nadie corrige, y el mensaje lo explica', async () => {
    const cruce = await crearCruce(ctx, { codigo: `V3-CORR-ARCH-${ctx.R}` });
    const [ind] = await crearIndividuos(ctx, cruce, 1);
    const cerrada = await crearEvaluacion(ctx, await crearRonda(ctx, ind.id), { brix: 12 }, { estado: 'completa' });
    const { error: errArch } = await ctx.service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', cruce);
    expect(errArch).toBeNull();

    const { error } = await ctx.admin.from('evaluaciones').update({ brix: 13, estado: 'corregida', motivo_cambio: 'intento con el cruce archivado' }).eq('id', cerrada);
    expect(error?.code).toBe('55000');
    expect(error?.message).toContain('El cruce está archivado: sus evaluaciones no se pueden corregir');
    const { data } = await ctx.service.from('evaluaciones').select('estado, brix').eq('id', cerrada).single();
    expect(data).toMatchObject({ estado: 'completa', brix: 12 });
  });

  it('anon no puede leer el historial; un individuo inexistente da P0002', async () => {
    expect((await correcciones(ctx.anon)).error).not.toBeNull();
    const { error } = await ctx.operario.rpc('obtener_correcciones_individuo', { p_individuo_id: '00000000-0000-0000-0000-000000000000' });
    expect(error?.code).toBe('P0002');
  });
});
