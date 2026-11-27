// Fase 2, Sprint 2 (S2-1) — la ronda N+1 solo se abre con la ronda N cerrada
// (una evaluación completa o corregida), también en la base. La regla es un
// trigger sobre ronda_evaluacion_anual: ninguna RPC puede saltársela.
import { iniciarRondaAnual } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  camposCompletaConMuestra,
  crearCruce,
  crearIndividuo,
  crearRondaServicio,
  prepararContexto,
  purgarCruces,
  type ContextoG5,
} from '../auditoria/g5-setup';

let ctx: ContextoG5;
let cruceAnual: string;
let cruceMulti: string;
const plantas: string[] = [];
let n = 0;

beforeAll(async () => {
  ctx = await prepararContexto('s2ronda');
  cruceAnual = await crearCruce(ctx, 'S2R-A', 'evaluacion_anual');
  cruceMulti = await crearCruce(ctx, 'S2R-M', 'traslado_destino');
  plantas.push(cruceAnual, cruceMulti);
}, 60_000);

afterAll(async () => {
  await purgarCruces(ctx, plantas);
});

type Tipo = 'anual' | 'multisitio';
const MENSAJE_ANUAL = (numero: number) => `La ronda ${numero} todavía no tiene una evaluación completa. Ciérrala antes de iniciar la siguiente.`;

async function individuoNuevo(tipo: Tipo = 'anual'): Promise<string> {
  return crearIndividuo(ctx, tipo === 'anual' ? cruceAnual : cruceMulti, `S2R-${++n}`);
}

const iniciar = (individuo: string, numero: number, tipo: Tipo = 'anual') =>
  ctx.operario.rpc('iniciar_ronda_esperada', { p_individuo_id: individuo, p_tipo: tipo, p_numero_esperado: numero });

async function abrir(individuo: string, numero: number, tipo: Tipo = 'anual'): Promise<string> {
  const { data, error } = await iniciar(individuo, numero, tipo);
  if (error) throw new Error(`abrir ronda ${numero}: ${error.message}`);
  return (data as { ronda_id: string }).ronda_id;
}

async function borradorDe(ronda: string): Promise<string> {
  const { data, error } = await ctx.operario
    .from('evaluaciones')
    .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`borrador: ${error?.message}`);
  return data.id as string;
}

async function cerrar(ronda: string): Promise<string> {
  const id = await borradorDe(ronda);
  const { error } = await ctx.operario.from('evaluaciones').update(camposCompletaConMuestra()).eq('id', id);
  if (error) throw new Error(`cerrar: ${error.message}`);
  return id;
}

async function filasDeRonda(individuo: string, tipo: Tipo = 'anual') {
  const { data } = await ctx.service.from('ronda_evaluacion_anual').select('id, numero_ronda').eq('individuo_id', individuo).eq('tipo_ronda', tipo).order('numero_ronda');
  return data ?? [];
}

describe('ronda N+1 exige la ronda N cerrada (serie anual)', () => {
  it('la ronda 1 no tiene restricción', async () => {
    const individuo = await individuoNuevo();
    const { data, error } = await iniciar(individuo, 1);
    expect(error).toBeNull();
    expect((data as { numero_ronda: number }).numero_ronda).toBe(1);
  });

  it('con la ronda 1 sin ninguna evaluación se rechaza la ronda 2 (55000, mensaje claro) y no se crea nada', async () => {
    const individuo = await individuoNuevo();
    await abrir(individuo, 1);
    const { error } = await iniciar(individuo, 2);
    expect(error?.code).toBe('55000');
    expect(error?.message).toBe(MENSAJE_ANUAL(1));
    expect(await filasDeRonda(individuo)).toHaveLength(1);
  });

  it('con la ronda 1 solo en borrador se rechaza la ronda 2', async () => {
    const individuo = await individuoNuevo();
    const r1 = await abrir(individuo, 1);
    await borradorDe(r1);
    const { error } = await iniciar(individuo, 2);
    expect(error?.code).toBe('55000');
    expect(error?.message).toBe(MENSAJE_ANUAL(1));
    expect(await filasDeRonda(individuo)).toHaveLength(1);
  });

  it('una evaluación anulada no cuenta como cierre', async () => {
    const individuo = await individuoNuevo();
    const r1 = await abrir(individuo, 1);
    const id = await borradorDe(r1);
    const { error: errAnular } = await ctx.operario.from('evaluaciones').update({ estado: 'anulada', motivo_cambio: 'Se anotó en el individuo equivocado' }).eq('id', id);
    expect(errAnular).toBeNull();
    const { error } = await iniciar(individuo, 2);
    expect(error?.code).toBe('55000');
  });

  it('con la ronda 1 completa se abre la ronda 2; repetir la misma devuelve la existente', async () => {
    const individuo = await individuoNuevo();
    const r1 = await abrir(individuo, 1);
    await cerrar(r1);
    const { data, error } = await iniciar(individuo, 2);
    expect(error).toBeNull();
    expect((data as { numero_ronda: number }).numero_ronda).toBe(2);
    const otra = await iniciar(individuo, 2);
    expect(otra.error).toBeNull();
    expect(otra.data).toEqual(data);
    expect(await filasDeRonda(individuo)).toHaveLength(2);
  });

  it('con la ronda 1 corregida (la corrige el admin) se abre la ronda 2', async () => {
    const individuo = await individuoNuevo();
    const r1 = await abrir(individuo, 1);
    const id = await cerrar(r1);
    const { error: errCorregir } = await ctx.admin.from('evaluaciones').update({ estado: 'corregida', motivo_cambio: 'Calibre mal anotado', calibre_mm: 19.5 }).eq('id', id);
    expect(errCorregir).toBeNull();
    const { data, error } = await iniciar(individuo, 2);
    expect(error).toBeNull();
    expect((data as { numero_ronda: number }).numero_ronda).toBe(2);
  });

  it('la ronda 3 exige cerrada la ronda 2, no basta con la 1', async () => {
    const individuo = await individuoNuevo();
    await cerrar(await abrir(individuo, 1));
    const r2 = await abrir(individuo, 2);
    const sinCerrar = await iniciar(individuo, 3);
    expect(sinCerrar.error?.code).toBe('55000');
    expect(sinCerrar.error?.message).toBe(MENSAJE_ANUAL(2));
    await cerrar(r2);
    const { data, error } = await iniciar(individuo, 3);
    expect(error).toBeNull();
    expect((data as { numero_ronda: number }).numero_ronda).toBe(3);
  });

  it('la RPC anual directa tampoco la salta, y un administrador tampoco', async () => {
    const individuo = await individuoNuevo();
    await abrir(individuo, 1);
    const operario = await iniciarRondaAnual(ctx.operario, individuo);
    expect(operario.error?.code).toBe('55000');
    const admin = await iniciarRondaAnual(ctx.admin, individuo);
    expect(admin.error?.code).toBe('55000');
    expect(admin.error?.message).toBe(MENSAJE_ANUAL(1));
    expect(await filasDeRonda(individuo)).toHaveLength(1);
  });

  it('el cierre de la ronda 1 de otro individuo no habilita la ronda 2 de este', async () => {
    const [a, b] = [await individuoNuevo(), await individuoNuevo()];
    await cerrar(await abrir(a, 1));
    await abrir(b, 1);
    expect((await iniciar(a, 2)).error).toBeNull();
    expect((await iniciar(b, 2)).error?.code).toBe('55000');
  });

  it('las fixtures con service_role (sin sesión) no se ven afectadas', async () => {
    const individuo = await individuoNuevo();
    await crearRondaServicio(ctx, individuo, { numero: 1 });
    await expect(crearRondaServicio(ctx, individuo, { numero: 2 })).resolves.toBeTruthy();
    expect(await filasDeRonda(individuo)).toHaveLength(2);
  });
});

describe('ronda N+1 exige la ronda N cerrada (serie multisitio)', () => {
  it('rechaza la 2 con la 1 en borrador y la abre al cerrarla; la serie anual no interfiere', async () => {
    const individuo = await individuoNuevo('multisitio');
    const r1 = await abrir(individuo, 1, 'multisitio');
    await borradorDe(r1);
    const rechazo = await iniciar(individuo, 2, 'multisitio');
    expect(rechazo.error?.code).toBe('55000');
    expect(rechazo.error?.message).toBe('La ronda multisitio 1 todavía no tiene una evaluación completa. Ciérrala antes de iniciar la siguiente.');
    const { data: borrador } = await ctx.service.from('evaluaciones').select('id').eq('ronda_id', r1).single();
    const { error: errCerrar } = await ctx.operario.from('evaluaciones').update(camposCompletaConMuestra()).eq('id', borrador!.id);
    expect(errCerrar).toBeNull();
    const { data, error } = await iniciar(individuo, 2, 'multisitio');
    expect(error).toBeNull();
    expect((data as { numero_ronda: number }).numero_ronda).toBe(2);
    expect(await filasDeRonda(individuo, 'multisitio')).toHaveLength(2);
  });

  it('una ronda 1 anual cerrada no habilita la ronda 2 multisitio', async () => {
    // Mismo individuo con ronda anual 1 cerrada (service_role) y multisitio 1 sin cerrar.
    const individuo = await individuoNuevo('multisitio');
    const anual = await crearRondaServicio(ctx, individuo, { numero: 1, tipo: 'anual' });
    const { error: errEval } = await ctx.service.from('evaluaciones').insert({ ronda_id: anual, fecha: '2026-03-01', created_by: ctx.operarioId, ...camposCompletaConMuestra() });
    expect(errEval).toBeNull();
    await abrir(individuo, 1, 'multisitio');
    const { error } = await iniciar(individuo, 2, 'multisitio');
    expect(error?.code).toBe('55000');
  });
});
