/**
 * G5 / E01 — Iniciar ronda anual y multisitio.
 *
 * Qué se verifica contra la base local:
 * - las dos RPC (`iniciar_ronda_evaluacion`, `iniciar_ronda_multisitio`)
 *   aplican sus reglas: fase del cruce, individuo vivo, máximo 3 por serie,
 *   predio activo, auditoría de la creación;
 * - la carrera de dos usuarios iniciando la misma ronda (transacciones
 *   solapadas vía psql) no crea una cuarta ronda ni duplica el número, pero el
 *   perdedor recibe un 23505 crudo (hallazgo A1-G5-09);
 * - el INSERT directo en `ronda_evaluacion_anual` por cualquier autenticado se
 *   salta TODAS esas reglas, incluida la elección de `scoring_version_id`
 *   (hallazgo A1-G5-01, `it.fails`);
 * - nadie, ni un admin, puede editar o borrar una ronda (irreversible).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarRondaAnual, iniciarRondaMultisitio, psqlComoUsuario, psqlInterno } from '../envolturas';
import {
  borrarVersionesScoring,
  cerrarRondaServicio,
  contarAudit,
  crearCruce,
  crearIndividuo,
  crearPredio,
  crearVersionScoring,
  darDeBaja,
  prepararContexto,
  purgarCruces,
  ultimoAudit,
  type ContextoG5,
} from './g5-setup';

let ctx: ContextoG5;
let cruceEvaluacion: string;
let crucePolinizacion: string;
let cruceTraslado: string;
let predioInactivo: string;
let predioActivo: string;
let versionInactiva: string;
let especieVersion: string;
const plantas: string[] = [];

beforeAll(async () => {
  ctx = await prepararContexto('rondas');
  // Versión de scoring inactiva PROPIA (en una especie propia): las pruebas de INSERT directo
  // necesitan una para elegirla a mano; la base recién reiniciada no trae ninguna.
  const { data: especie, error: errEspecie } = await ctx.service
    .from('especies')
    .insert({ nombre: `AUD-G5 rondas-version ${ctx.sufijo}` })
    .select('id')
    .single();
  if (errEspecie || !especie) throw new Error(`setup especie de la versión: ${errEspecie?.message}`);
  especieVersion = especie.id as string;
  versionInactiva = await crearVersionScoring(ctx, especieVersion, { nombre: 'inactiva', desde: '2026-01-01', estado: 'inactiva' });
  cruceEvaluacion = await crearCruce(ctx, 'RON-EVAL', 'evaluacion_anual');
  crucePolinizacion = await crearCruce(ctx, 'RON-POLI', 'polinizacion');
  cruceTraslado = await crearCruce(ctx, 'RON-TRAS', 'traslado_destino');
  plantas.push(cruceEvaluacion, crucePolinizacion, cruceTraslado);
  predioActivo = await crearPredio(ctx, 'activo', true);
  predioInactivo = await crearPredio(ctx, 'inactivo', false);
}, 60_000);

afterAll(async () => {
  await purgarCruces(ctx, plantas, { predioIds: [predioActivo, predioInactivo] });
  borrarVersionesScoring([versionInactiva]);
  await ctx.service.from('especies').delete().eq('id', especieVersion);
});

async function rondasDe(individuoId: string) {
  const { data, error } = await ctx.service
    .from('ronda_evaluacion_anual')
    .select('id, numero_ronda, tipo_ronda, anio, scoring_version_id, predio_id')
    .eq('individuo_id', individuoId)
    .order('tipo_ronda')
    .order('numero_ronda');
  if (error) throw error;
  return data ?? [];
}

describe('E01 — RPC iniciar_ronda_evaluacion (serie anual)', () => {
  let individuo: string;

  beforeAll(async () => {
    individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-A');
  });

  it('anon no puede iniciar una ronda', async () => {
    const { error } = await iniciarRondaAnual(ctx.anon, individuo);
    expect(error).not.toBeNull();
  });

  it('un operario crea las rondas 1, 2 y 3; la cuarta se rechaza con mensaje de negocio', async () => {
    for (const esperado of [1, 2, 3]) {
      const { data, error } = await iniciarRondaAnual(ctx.operario, individuo);
      expect(error).toBeNull();
      expect((data as { numero_ronda: number }).numero_ronda).toBe(esperado);
      await cerrarRondaServicio(ctx, (data as { ronda_id: string }).ronda_id); // S2-1: la N+1 exige la N cerrada
    }
    // La envoltura (iniciar_ronda_esperada) rechaza el número 4 con 22023; el tope de 3 de la
    // firma vieja sigue vigente y se comprueba con el permiso del dueño (paso 39).
    const cuarta = await iniciarRondaAnual(ctx.operario, individuo);
    expect(cuarta.error?.code).toBe('22023');
    const cuartaInterna = await psqlInterno(ctx.operarioId, `public.iniciar_ronda_evaluacion('${individuo}')`);
    expect(cuartaInterna.error?.code).toBe('42501');
    expect(cuartaInterna.error?.message).toContain('3 rondas');
    expect(await rondasDe(individuo)).toHaveLength(3);
  });

  it('las tres rondas quedan con el mismo anio (año calendario del servidor): nada impide dos rondas anuales en un mismo año', async () => {
    const rondas = await rondasDe(individuo);
    const anios = new Set(rondas.map((r) => r.anio));
    // Documenta el comportamiento actual (hallazgo A1-G5-13): `anio` no lo
    // elige el usuario y no es único por individuo.
    expect(anios.size).toBe(1);
    expect([...anios][0]).toBe(new Date().getFullYear());
  });

  it('cada creación deja auditoría creacion_ronda_evaluacion_anual con el usuario y el cruce', async () => {
    const rondas = await rondasDe(individuo);
    const fila = await ultimoAudit(ctx, 'creacion_ronda_evaluacion_anual', 'ronda_id', rondas[0].id);
    expect(fila).not.toBeNull();
    expect(fila.usuario_id).toBe(ctx.operarioId);
    expect(fila.planta_id).toBe(cruceEvaluacion);
    expect(fila.detalle).toMatchObject({ individuo_id: individuo, numero_ronda: 1, tipo_ronda: 'anual' });
  });

  it('rechaza un individuo muerto', async () => {
    const muerto = await crearIndividuo(ctx, cruceEvaluacion, 'RON-MUERTO');
    await darDeBaja(ctx, muerto);
    const { error } = await iniciarRondaAnual(ctx.operario, muerto);
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain('no está vivo');
  });

  it('rechaza un cruce que no está en evaluacion_anual', async () => {
    const enPolinizacion = await crearIndividuo(ctx, crucePolinizacion, 'RON-POLI-A');
    const { error } = await iniciarRondaAnual(ctx.operario, enPolinizacion);
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain('Evaluación anual');
  });

  it('un individuo inexistente devuelve P0002', async () => {
    const { error } = await iniciarRondaAnual(ctx.operario, '00000000-0000-0000-0000-000000000001');
    expect(error?.code).toBe('P0002');
  });
});

describe('E01 — RPC iniciar_ronda_multisitio', () => {
  it('rechaza un cruce en evaluacion_anual (la serie multisitio exige traslado_destino)', async () => {
    const individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-MS-NO');
    const { error } = await iniciarRondaMultisitio(ctx.operario, individuo);
    expect(error?.code).toBe('42501');
  });

  it('en traslado_destino crea la serie 1-3 con contador propio, sin predio (la app nunca manda p_predio_id)', async () => {
    const individuo = await crearIndividuo(ctx, cruceTraslado, 'RON-MS-A');
    for (const esperado of [1, 2, 3]) {
      const { data, error } = await iniciarRondaMultisitio(ctx.operario, individuo);
      expect(error).toBeNull();
      expect((data as { numero_ronda: number }).numero_ronda).toBe(esperado);
      await cerrarRondaServicio(ctx, (data as { ronda_id: string }).ronda_id); // S2-1: la N+1 exige la N cerrada
    }
    const cuarta = await iniciarRondaMultisitio(ctx.operario, individuo);
    expect(cuarta.error?.code).toBe('22023');
    const cuartaInterna = await psqlInterno(ctx.operarioId, `public.iniciar_ronda_multisitio('${individuo}')`);
    expect(cuartaInterna.error?.code).toBe('42501');
    const rondas = await rondasDe(individuo);
    expect(rondas).toHaveLength(3);
    expect(rondas.every((r) => r.tipo_ronda === 'multisitio' && r.anio === null && r.predio_id === null)).toBe(true);
  });

  it('rechaza un predio inactivo y acepta uno activo', async () => {
    const individuo = await crearIndividuo(ctx, cruceTraslado, 'RON-MS-B');
    // iniciar_ronda_esperada no recibe predio (la app nunca lo manda): la regla del predio vive
    // en la firma vieja, que ya no es ejecutable por authenticated (paso 39). Se invoca con el
    // permiso del dueño y el JWT del operario.
    const inactivo = await psqlInterno(ctx.operarioId, `public.iniciar_ronda_multisitio('${individuo}', '${predioInactivo}')`);
    expect(inactivo.error?.code).toBe('23514');
    const activo = await psqlInterno(ctx.operarioId, `public.iniciar_ronda_multisitio('${individuo}', '${predioActivo}')`);
    expect(activo.error).toBeNull();
    const rondas = await rondasDe(individuo);
    expect(rondas[0].predio_id).toBe(predioActivo);
  });

  it('la serie multisitio no consume cupos de la serie anual del mismo individuo', async () => {
    // Un cruce no puede estar en dos fases a la vez: se crea la serie
    // multisitio por RPC y la anual con service_role (misma tabla, contadores
    // separados por el UNIQUE (individuo, tipo, numero)).
    const individuo = await crearIndividuo(ctx, cruceTraslado, 'RON-MS-C');
    for (let i = 0; i < 3; i += 1) {
      const { data, error } = await iniciarRondaMultisitio(ctx.operario, individuo);
      expect(error).toBeNull();
      await cerrarRondaServicio(ctx, (data as { ronda_id: string }).ronda_id); // S2-1: la N+1 exige la N cerrada
    }
    const { error } = await ctx.service
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo, tipo_ronda: 'anual', numero_ronda: 1, anio: 2026, created_by: ctx.adminId });
    expect(error).toBeNull();
    expect(await rondasDe(individuo)).toHaveLength(4);
  });
});

describe('E01 — concurrencia: dos usuarios inician la misma ronda a la vez', () => {
  it('firma vieja (permiso del dueño, paso 39): no se crea una cuarta ronda ni se repite el número, pero el perdedor recibe un 23505 crudo (A1-G5-09)', async () => {
    const individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-RACE');
    // La sesión 1 deja la transacción abierta 3 s después de insertar; la
    // sesión 2 arranca medio segundo más tarde, cuenta 0 rondas (la 1 no está
    // confirmada), intenta el número 1 y queda bloqueada por el UNIQUE hasta
    // que la 1 confirma. Es la misma carrera que dos celulares con el botón
    // «Iniciar ronda 1», sin depender del azar del scheduler.
    const sesion1 = psqlComoUsuario(ctx.operarioId, `select iniciar_ronda_evaluacion('${individuo}'); select pg_sleep(3);`, { rol: 'dueno' });
    await new Promise((r) => setTimeout(r, 500));
    const sesion2 = psqlComoUsuario(ctx.operario2Id, `select iniciar_ronda_evaluacion('${individuo}');`, { rol: 'dueno' });
    const [r1, r2] = await Promise.all([sesion1, sesion2]);

    expect(r1.codigo).toBe(0);
    expect(r2.codigo).not.toBe(0);
    // El perdedor no recibe el mensaje de negocio «ya tiene N rondas» sino la
    // violación del UNIQUE, que la app traduce como «¿código de sistema duplicado?».
    expect(r2.salida).toMatch(/duplicate key value violates unique constraint "ronda_evaluacion_anual_individuo_tipo_numero_key"/);

    const rondas = await rondasDe(individuo);
    expect(rondas).toHaveLength(1);
    expect(rondas[0].numero_ronda).toBe(1);
  }, 30_000);

  it('envoltura iniciar_ronda_esperada (como authenticated): la misma carrera no crea una cuarta ronda ni repite el número, y el perdedor recibe la ronda ya creada, sin 23505', async () => {
    const individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-RACE-ESP');
    // Misma carrera que arriba: la sesión 1 retiene la transacción 3 s; la sesión 2 pide el mismo
    // número esperado (1) y espera el lock de la serie hasta que la 1 confirma.
    const sesion1 = psqlComoUsuario(ctx.operarioId, `select public.iniciar_ronda_esperada('${individuo}', 'anual', 1); select pg_sleep(3);`);
    await new Promise((r) => setTimeout(r, 500));
    const sesion2 = psqlComoUsuario(ctx.operario2Id, `select public.iniciar_ronda_esperada('${individuo}', 'anual', 1);`);
    const [r1, r2] = await Promise.all([sesion1, sesion2]);

    expect(r1.codigo, r1.salida).toBe(0);
    expect(r2.codigo, r2.salida).toBe(0);
    expect(r2.salida).not.toMatch(/duplicate key/);

    const rondas = await rondasDe(individuo);
    expect(rondas).toHaveLength(1);
    expect(rondas[0].numero_ronda).toBe(1);
    // Los dos recibieron la misma ronda.
    expect(r1.salida).toContain(rondas[0].id);
    expect(r2.salida).toContain(rondas[0].id);
  }, 30_000);
});

describe('E01 — INSERT directo en ronda_evaluacion_anual (camino que se salta la RPC)', () => {
  // La tabla tiene GRANT INSERT completo a authenticated y la policy solo
  // exige created_by = auth.uid(). No hay trigger de validación: todas las
  // reglas viven solo en las RPC. Hallazgo A1-G5-01.

  it('rechaza crear a nombre de otro usuario (policy created_by = auth.uid())', async () => {
    const individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-DIR-0');
    const { error } = await ctx.operario
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo, tipo_ronda: 'anual', numero_ronda: 1, anio: 2026, created_by: ctx.adminId });
    expect(error?.code).toBe('42501');
  });

  it('debería rechazar una ronda anual sobre un cruce que no está en evaluacion_anual (A1-G5-01)', async () => {
    const individuo = await crearIndividuo(ctx, crucePolinizacion, 'RON-DIR-1');
    const { error } = await ctx.operario
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo, tipo_ronda: 'anual', numero_ronda: 1, anio: 2026, created_by: ctx.operarioId });
    expect(error).not.toBeNull();
  });

  it('debería rechazar una ronda sobre un individuo muerto (A1-G5-01)', async () => {
    const individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-DIR-2');
    await darDeBaja(ctx, individuo);
    const { error } = await ctx.operario
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo, tipo_ronda: 'anual', numero_ronda: 1, anio: 2026, created_by: ctx.operarioId });
    expect(error).not.toBeNull();
  });

  it('debería rechazar numero_ronda no correlativo y anio arbitrario (A1-G5-01)', async () => {
    const individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-DIR-3');
    const { error } = await ctx.operario
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo, tipo_ronda: 'anual', numero_ronda: 3, anio: 1999, fecha_inicio: '1999-01-01', created_by: ctx.operarioId });
    expect(error).not.toBeNull();
  });

  it('debería rechazar que el usuario elija scoring_version_id (la migración 140000 dice que solo la escribe el trigger) (A1-G5-01)', async () => {
    const individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-DIR-4');
    const { error } = await ctx.operario
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo, tipo_ronda: 'anual', numero_ronda: 1, anio: 2026, scoring_version_id: versionInactiva, created_by: ctx.operarioId });
    expect(error).not.toBeNull();
  });

  it('A1-007: INSERT directo con scoring_version_id elegido se rechaza y no crea ronda', async () => {
    const individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-DIR-5');
    const { data, error } = await ctx.operario
      .from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo, tipo_ronda: 'multisitio', numero_ronda: 2, anio: null, predio_id: predioInactivo, scoring_version_id: versionInactiva, created_by: ctx.operarioId })
      .select('id, scoring_version_id, predio_id')
      .single();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
    const rondas = await ctx.service.from('ronda_evaluacion_anual').select('id').eq('individuo_id', individuo);
    expect(rondas.error).toBeNull();
    expect(rondas.data).toEqual([]);
  });
});

describe('E01 — una ronda no se edita ni se borra (ni por admin): irreversible', () => {
  it('admin no puede cambiar anio ni fecha_inicio', async () => {
    const individuo = await crearIndividuo(ctx, cruceEvaluacion, 'RON-INM');
    const { data: creada } = await iniciarRondaAnual(ctx.operario, individuo);
    const rondaId = (creada as { ronda_id: string }).ronda_id;
    const { data, error } = await ctx.admin.from('ronda_evaluacion_anual').update({ anio: 2020 }).eq('id', rondaId).select('id');
    // Sin GRANT UPDATE: PostgREST responde 42501 (permission denied).
    expect(error?.code ?? '42501').toBe('42501');
    expect(data ?? []).toHaveLength(0);
    const { error: errDelete } = await ctx.admin.from('ronda_evaluacion_anual').delete().eq('id', rondaId);
    expect(errDelete?.code).toBe('42501');
    expect(await rondasDe(individuo)).toHaveLength(1);
  });
});
