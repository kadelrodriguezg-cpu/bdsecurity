/**
 * G5 / E04-E05 — Corregir y anular una evaluación cerrada (admin, con motivo).
 *
 * No existe pantalla para esto (EvaluacionesLista es solo lectura; la única
 * transición a `anulada` en la app es «descartar borrador»): el flujo solo
 * existe por API (hallazgo A1-G5-03). Acá se verifica lo que la base permite
 * y audita cuando un admin lo hace por PostgREST:
 * - el operario no alcanza una evaluación cerrada;
 * - corregir/anular exige motivo y deja edicion_evaluacion (valores) y
 *   cambio_estado_evaluacion (motivo);
 * - el admin puede cambiar valores de una `completa` SIN motivo y sin pasar
 *   por `corregida` (A1-G5-05, `it.fails`);
 * - el admin puede resucitar una `anulada` a `completa` sin motivo
 *   (A1-G5-05, `it.fails`);
 * - el admin puede reabrir (`corregida` -> `borrador`) y el autor vuelve a
 *   editar: camino existente pero no documentado;
 * - el admin puede reasignar la autoría (`created_by`) (A1-G5-14, `it.fails`).
 */
import { iniciarRondaAnual } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  camposCompletaConMuestra,
  crearCruce,
  crearIndividuo,
  prepararContexto,
  purgarCruces,
  ultimoAudit,
  type ContextoG5,
} from './g5-setup';

let ctx: ContextoG5;
let cruce: string;
let n = 0;

beforeAll(async () => {
  ctx = await prepararContexto('corr');
  cruce = await crearCruce(ctx, 'CORR', 'evaluacion_anual');
}, 60_000);

afterAll(async () => {
  await purgarCruces(ctx, [cruce]);
});

/** Evaluación completa del operario, con calibre y brix, en una ronda nueva. */
async function completaDelOperario(): Promise<{ evaluacionId: string; rondaId: string }> {
  const individuo = await crearIndividuo(ctx, cruce, `CORR-${++n}`);
  const { data: ronda, error: errRonda } = await iniciarRondaAnual(ctx.operario, individuo);
  if (errRonda) throw new Error(`setup ronda: ${errRonda.message}`);
  const rondaId = (ronda as { ronda_id: string }).ronda_id;
  const { data, error } = await ctx.operario
    .from('evaluaciones')
    .insert({ ronda_id: rondaId, fecha: '2026-03-01', created_by: ctx.operarioId, calibre_mm: 18, brix: 12, ...camposCompletaConMuestra() })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup evaluacion: ${error?.message}`);
  return { evaluacionId: data.id as string, rondaId };
}

async function leer(evaluacionId: string) {
  const { data, error } = await ctx.service.from('evaluaciones').select('*').eq('id', evaluacionId).single();
  if (error) throw error;
  return data;
}

describe('E04 — corregir', () => {
  it('el operario (incluso el autor) no alcanza una evaluación cerrada: 0 filas, sin error', async () => {
    const { evaluacionId } = await completaDelOperario();
    const { data, error } = await ctx.operario
      .from('evaluaciones')
      .update({ estado: 'corregida', motivo_cambio: 'intento', calibre_mm: 19 })
      .eq('id', evaluacionId)
      .select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    expect((await leer(evaluacionId)).estado).toBe('completa');
  });

  it('el admin no puede corregir sin motivo (23514 con mensaje propio)', async () => {
    const { evaluacionId } = await completaDelOperario();
    const { error } = await ctx.admin.from('evaluaciones').update({ estado: 'corregida', calibre_mm: 19 }).eq('id', evaluacionId);
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('requiere motivo');
    const soloEspacios = await ctx.admin.from('evaluaciones').update({ estado: 'corregida', motivo_cambio: '   ' }).eq('id', evaluacionId);
    expect(soloEspacios.error?.code).toBe('23514');
  });

  it('el admin corrige con motivo: queda corregida, con edicion_evaluacion (valores anterior/nuevo) y cambio_estado_evaluacion (motivo)', async () => {
    const { evaluacionId } = await completaDelOperario();
    const { data, error } = await ctx.admin
      .from('evaluaciones')
      .update({ estado: 'corregida', motivo_cambio: 'Calibre mal anotado en terreno', calibre_mm: 19.5 })
      .eq('id', evaluacionId)
      .select('estado, calibre_mm, created_by')
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ estado: 'corregida', calibre_mm: 19.5, created_by: ctx.operarioId });

    const edicion = await ultimoAudit(ctx, 'edicion_evaluacion', 'evaluacion_id', evaluacionId);
    expect(edicion.usuario_id).toBe(ctx.adminId);
    expect(edicion.detalle.cambios).toEqual({
      calibre_mm: { anterior: 18, nuevo: 19.5 },
      estado: { anterior: 'completa', nuevo: 'corregida' },
      motivo_cambio: { anterior: null, nuevo: 'Calibre mal anotado en terreno' },
    });
    const estado = await ultimoAudit(ctx, 'cambio_estado_evaluacion', 'evaluacion_id', evaluacionId);
    expect(estado.usuario_id).toBe(ctx.adminId);
    expect(estado.detalle).toMatchObject({ estado_anterior: 'completa', estado_nuevo: 'corregida', motivo: 'Calibre mal anotado en terreno' });
  });

  it('una segunda corrección sobre una corregida NO deja rastro de estado si el admin no cambia el motivo (solo edicion_evaluacion)', async () => {
    const { evaluacionId } = await completaDelOperario();
    await ctx.admin.from('evaluaciones').update({ estado: 'corregida', motivo_cambio: 'Primera corrección', calibre_mm: 19 }).eq('id', evaluacionId);
    const { error } = await ctx.admin.from('evaluaciones').update({ brix: 13 }).eq('id', evaluacionId);
    expect(error).toBeNull();
    const estado = await ultimoAudit(ctx, 'cambio_estado_evaluacion', 'evaluacion_id', evaluacionId);
    expect(estado.detalle.motivo).toBe('Primera corrección');
    const edicion = await ultimoAudit(ctx, 'edicion_evaluacion', 'evaluacion_id', evaluacionId);
    expect(edicion.detalle.cambios).toEqual({ brix: { anterior: 12, nuevo: 13 } });
  });

  it.fails('el admin NO debería poder cambiar valores de una completa sin motivo ni pasar por corregida (A1-G5-05)', async () => {
    const { evaluacionId } = await completaDelOperario();
    const { error } = await ctx.admin.from('evaluaciones').update({ calibre_mm: 22, brix: 16 }).eq('id', evaluacionId);
    expect(error).not.toBeNull();
  });

  it('documenta el estado actual: la edición silenciosa de una completa queda como completa, sin motivo, y solo la delata edicion_evaluacion', async () => {
    const { evaluacionId } = await completaDelOperario();
    const { data, error } = await ctx.admin
      .from('evaluaciones')
      .update({ calibre_mm: 22, brix: 16 })
      .eq('id', evaluacionId)
      .select('estado, motivo_cambio, calibre_mm')
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ estado: 'completa', motivo_cambio: null, calibre_mm: 22 });
    const edicion = await ultimoAudit(ctx, 'edicion_evaluacion', 'evaluacion_id', evaluacionId);
    expect(edicion.detalle.cambios).toEqual({ calibre_mm: { anterior: 18, nuevo: 22 }, brix: { anterior: 12, nuevo: 16 } });
    const estado = await ultimoAudit(ctx, 'cambio_estado_evaluacion', 'evaluacion_id', evaluacionId);
    expect(estado).toBeNull();
  });

  it('reabrir (corregida -> borrador) está permitido al admin, queda auditado, y el autor vuelve a editar y cerrar', async () => {
    const { evaluacionId } = await completaDelOperario();
    await ctx.admin.from('evaluaciones').update({ estado: 'corregida', motivo_cambio: 'Falta un dato' }).eq('id', evaluacionId);
    const reabrir = await ctx.admin.from('evaluaciones').update({ estado: 'borrador' }).eq('id', evaluacionId).select('estado').single();
    expect(reabrir.error).toBeNull();
    expect(reabrir.data!.estado).toBe('borrador');
    const estado = await ultimoAudit(ctx, 'cambio_estado_evaluacion', 'evaluacion_id', evaluacionId);
    expect(estado.detalle).toMatchObject({ estado_anterior: 'corregida', estado_nuevo: 'borrador' });

    const autor = await ctx.operario.from('evaluaciones').update({ brix: 14, ...camposCompletaConMuestra() }).eq('id', evaluacionId).select('estado, brix').single();
    expect(autor.error).toBeNull();
    expect(autor.data).toEqual({ estado: 'completa', brix: 14 });
  });

  it.fails('el admin NO debería poder reasignar la autoría de una evaluación (A1-G5-14)', async () => {
    const { evaluacionId } = await completaDelOperario();
    const { error } = await ctx.admin.from('evaluaciones').update({ created_by: ctx.adminId }).eq('id', evaluacionId);
    expect(error).not.toBeNull();
  });
});

describe('E05 — anular', () => {
  it('anular exige motivo; con motivo queda anulada y auditada; desaparece del historial y de la unificación', async () => {
    const { evaluacionId, rondaId } = await completaDelOperario();
    const sinMotivo = await ctx.admin.from('evaluaciones').update({ estado: 'anulada' }).eq('id', evaluacionId);
    expect(sinMotivo.error?.code).toBe('23514');
    const { data, error } = await ctx.admin
      .from('evaluaciones')
      .update({ estado: 'anulada', motivo_cambio: 'Individuo equivocado' })
      .eq('id', evaluacionId)
      .select('estado')
      .single();
    expect(error).toBeNull();
    expect(data!.estado).toBe('anulada');
    const estado = await ultimoAudit(ctx, 'cambio_estado_evaluacion', 'evaluacion_id', evaluacionId);
    expect(estado.detalle).toMatchObject({ estado_anterior: 'completa', estado_nuevo: 'anulada', motivo: 'Individuo equivocado' });

    const { data: unificada } = await ctx.operario.rpc('unificar_evaluacion_ronda', { p_ronda_id: rondaId });
    expect(unificada).toEqual([]);
  });

  it.fails('una anulada NO debería volver a completa sin motivo (A1-G5-05)', async () => {
    const { evaluacionId } = await completaDelOperario();
    await ctx.admin.from('evaluaciones').update({ estado: 'anulada', motivo_cambio: 'Error' }).eq('id', evaluacionId);
    const { error } = await ctx.admin.from('evaluaciones').update({ estado: 'completa' }).eq('id', evaluacionId);
    expect(error).not.toBeNull();
  });

  it('documenta el estado actual: anulada -> completa pasa; el motivo viejo queda colgado y la ronda vuelve a contar', async () => {
    const { evaluacionId, rondaId } = await completaDelOperario();
    await ctx.admin.from('evaluaciones').update({ estado: 'anulada', motivo_cambio: 'Error' }).eq('id', evaluacionId);
    const { data, error } = await ctx.admin.from('evaluaciones').update({ estado: 'completa' }).eq('id', evaluacionId).select('estado, motivo_cambio').single();
    expect(error).toBeNull();
    expect(data).toEqual({ estado: 'completa', motivo_cambio: 'Error' });
    const { data: unificada } = await ctx.operario.rpc('unificar_evaluacion_ronda', { p_ronda_id: rondaId });
    expect(unificada).toHaveLength(1);
  });

  it('el operario no puede anular una evaluación cerrada (ni la propia)', async () => {
    const { evaluacionId } = await completaDelOperario();
    const { data } = await ctx.operario
      .from('evaluaciones')
      .update({ estado: 'anulada', motivo_cambio: 'x' })
      .eq('id', evaluacionId)
      .select('id');
    expect(data).toHaveLength(0);
    expect((await leer(evaluacionId)).estado).toBe('completa');
  });

  it('nadie borra una evaluación (ni el admin): DELETE sin grant', async () => {
    const { evaluacionId } = await completaDelOperario();
    const { error } = await ctx.admin.from('evaluaciones').delete().eq('id', evaluacionId);
    expect(error?.code).toBe('42501');
  });
});
