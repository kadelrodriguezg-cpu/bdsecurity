// Fase 2 (seguimiento de U-09) — la planilla de ronda deja ver el borrador de una visita nueva.
//
// Una ronda puede tener una evaluación cerrada y, encima, un borrador de una visita nueva (a lo sumo uno por ronda).
// obtener_planilla_ronda elige UNA evaluación por ronda y la cerrada gana (A1-144); el borrador no se veía. La función
// agrega, por fila, `hay_borrador` y `borrador_mio` y, en `avance`, `con_borrador`: solo booleanos y un conteo.
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

interface FilaPlanilla {
  individuo_id: string;
  codigo_display: string;
  estado: string;
  evaluacion_id: string | null;
  evaluador: string | null;
  es_mia: boolean;
  hay_borrador?: boolean;
  borrador_mio?: boolean;
  [clave: string]: unknown;
}
interface Planilla {
  avance: { vivos: number; sin_iniciar: number; borrador: number; completa: number; con_borrador?: number };
  individuos: FilaPlanilla[];
}

let ctx: ContextoG5;
let cruce: string;
const ind: Record<'cerradaConBorrador' | 'sinEvaluacion' | 'soloBorrador' | 'soloCerrada', string> = {
  cerradaConBorrador: '', sinEvaluacion: '', soloBorrador: '', soloCerrada: '',
};
let evaluacionCerrada = '';
let borradorDeA = '';
const NOTA_SECRETA = 'nota-privada-del-borrador-visita-nueva';

beforeAll(async () => {
  ctx = await prepararContexto('planbor');
  cruce = await crearCruce(ctx, 'PLANBOR', 'evaluacion_anual');
  for (const clave of Object.keys(ind) as Array<keyof typeof ind>) ind[clave] = await crearIndividuo(ctx, cruce, `PB-${clave}`);
  const rondas = Object.fromEntries(await Promise.all((Object.keys(ind) as Array<keyof typeof ind>).map(async (clave) => [clave, await crearRondaServicio(ctx, ind[clave])]))) as Record<keyof typeof ind, string>;

  const cerrar = async (ronda: string) => {
    const { data, error } = await ctx.service.from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', created_by: ctx.adminId, ...camposCompletaConMuestra() }).select('id').single();
    if (error || !data) throw new Error(`cerrar: ${error?.message}`);
    return data.id as string;
  };
  const borrador = async (ronda: string, autor: string) => {
    const { data, error } = await ctx.service.from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-04-10', estado: 'borrador', created_by: autor, evaluador: 'Equipo A', observaciones: NOTA_SECRETA }).select('id').single();
    if (error || !data) throw new Error(`borrador: ${error?.message}`);
    return data.id as string;
  };
  // (i) cerrada + borrador de A (operario).
  evaluacionCerrada = await cerrar(rondas.cerradaConBorrador);
  borradorDeA = await borrador(rondas.cerradaConBorrador, ctx.operarioId);
  // (iii) solo borrador.
  await borrador(rondas.soloBorrador, ctx.operarioId);
  // Solo cerrada (sin borrador).
  await cerrar(rondas.soloCerrada);
  // (ii) sinEvaluacion no tiene nada.
}, 90_000);

afterAll(async () => {
  await purgarCruces(ctx, [cruce]);
});

async function planilla(cliente: ContextoG5['operario']): Promise<Planilla> {
  const { data, error } = await cliente.rpc('obtener_planilla_ronda', { p_planta_id: cruce, p_numero_ronda: 1 });
  expect(error).toBeNull();
  return data as Planilla;
}
const fila = (p: Planilla, individuo: string) => p.individuos.find((f) => f.individuo_id === individuo)!;

describe('(i) ronda con evaluación cerrada y un borrador de visita nueva de A', () => {
  it('quien no es el autor (operario B) ve hay_borrador = true y borrador_mio = false', async () => {
    const f = fila(await planilla(ctx.operario2), ind.cerradaConBorrador);
    expect(f.hay_borrador).toBe(true);
    expect(f.borrador_mio).toBe(false);
  });

  it('el autor (A) ve hay_borrador = true y borrador_mio = true', async () => {
    const f = fila(await planilla(ctx.operario), ind.cerradaConBorrador);
    expect(f.hay_borrador).toBe(true);
    expect(f.borrador_mio).toBe(true);
  });

  it('un admin que no es el autor también ve hay_borrador = true y borrador_mio = false', async () => {
    const f = fila(await planilla(ctx.admin), ind.cerradaConBorrador);
    expect(f.hay_borrador).toBe(true);
    expect(f.borrador_mio).toBe(false);
  });

  it('el estado de la fila sigue siendo «completa» y la evaluación elegida es la cerrada, no el borrador', async () => {
    const f = fila(await planilla(ctx.operario2), ind.cerradaConBorrador);
    expect(f.estado).toBe('completa');
    expect(f.evaluacion_id).toBe(evaluacionCerrada);
    expect(f.evaluacion_id).not.toBe(borradorDeA);
  });
});

describe('(ii) ronda sin borrador', () => {
  it('hay_borrador y borrador_mio son false, también para una ronda sin ninguna evaluación y para una solo cerrada', async () => {
    const p = await planilla(ctx.operario);
    for (const individuo of [ind.sinEvaluacion, ind.soloCerrada]) {
      const f = fila(p, individuo);
      expect(f.hay_borrador).toBe(false);
      expect(f.borrador_mio).toBe(false);
    }
    expect(fila(p, ind.sinEvaluacion).estado).toBe('sin_iniciar');
    expect(fila(p, ind.soloCerrada).estado).toBe('completa');
  });
});

describe('(iii) ronda con solo un borrador', () => {
  it('el estado de la fila no cambia: sigue siendo «borrador», y la evaluación elegida es ese borrador', async () => {
    const p = await planilla(ctx.operario2);
    const f = fila(p, ind.soloBorrador);
    expect(f.estado).toBe('borrador');
    expect(f.evaluacion_id).not.toBeNull();
    expect(f.es_mia).toBe(false);
    expect(f.hay_borrador).toBe(true);
    expect(f.borrador_mio).toBe(false);
  });
});

describe('avance: con_borrador no duplica ni cambia los conteos de siempre', () => {
  it('con_borrador cuenta solo las filas cerradas con borrador de visita nueva; completa/borrador/sin_iniciar quedan como antes', async () => {
    const { avance } = await planilla(ctx.operario2);
    expect(avance.con_borrador).toBe(1);
    expect(avance.completa).toBe(2); // cerradaConBorrador + soloCerrada
    expect(avance.borrador).toBe(1); // soloBorrador (el borrador de la fila cerrada NO se suma acá)
    expect(avance.sin_iniciar).toBe(1);
    expect(avance.vivos).toBe(4);
  });
});

describe('(iv) la clave nueva no expone el contenido del borrador ni quién lo creó', () => {
  it('hay_borrador y borrador_mio son booleanos; la fila no trae ni el id del borrador, ni sus notas, ni su autor', async () => {
    const f = fila(await planilla(ctx.operario2), ind.cerradaConBorrador);
    expect(typeof f.hay_borrador).toBe('boolean');
    expect(typeof f.borrador_mio).toBe('boolean');
    const texto = JSON.stringify(f);
    expect(texto).not.toContain(borradorDeA);
    expect(texto).not.toContain(NOTA_SECRETA);
    expect(texto).not.toContain('Equipo A');
    expect(texto).not.toContain(ctx.operarioId); // quién creó el borrador
  });

  it('el resto de la respuesta de la planilla tampoco filtra el contenido del borrador', async () => {
    const texto = JSON.stringify(await planilla(ctx.operario2));
    expect(texto).not.toContain(NOTA_SECRETA);
    expect(texto).not.toContain(ctx.operarioId);
  });
});
