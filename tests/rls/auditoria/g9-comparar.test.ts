/**
 * G9 / T07 — `evecl_comparar`: reglas de ranking del Maestro 9.4.3, validación
 * de parámetros y los defectos encontrados.
 *
 * Cada prueba trabaja con su propio ensayo y pide la comparación con
 * `p_ensayo_id`, así el min-max solo ve sus grupos (no los de otros ensayos).
 *
 * Hallazgos (cada `it.fails` está escrito con lo que DEBERÍA pasar):
 *  - A1-G9-08  valores no finitos (NaN / Infinity) aceptados y devueltos como "NaN"
 *  - A1-G9-09  un descriptor de tipo estado acepta `valor_numerico` y éste manda sobre la nota
 *  - A1-G9-10  "Duke" y "duke" forman grupos distintos en entre_grupos pero uno solo en entre_fichas
 *  - A1-G9-11  fichas de un ensayo archivado siguen contando en comparar y rompen la ficha en la UI
 */
import { guardarFichaEvecl } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoG9, type DescriptorG9, type UsuarioG9 } from './g9-setup';

const ctx = new ContextoG9();
let autor: UsuarioG9;
let otro: UsuarioG9;
let cat: DescriptorG9[];

type Item = { grupo_key: string; grupo_label: string; variedad: string; tipo: string; puntaje: number | string; n_con_dato: number; n_total: number };
type PerfilItem = { grupo_key: string; descriptor: string; nota_moda: number; label_moda: string | null; divergente: boolean; n_con_dato: number; n_total: number };
type Comparacion = { modo: string; conjunto: string | null; ranking_calidad: Item[]; ranking_productividad: Item[]; perfil_fenologia: PerfilItem[]; perfil_adaptabilidad: PerfilItem[] };

const upov = (n: number) => cat.find((d) => d.codigo_upov === n)!;
const nombre = (inicio: string) => cat.find((d) => d.nombre.startsWith(inicio))!;
const firmeza = () => upov(28);
const dulzor = () => upov(29);
const acidez = () => upov(30);
const cicatriz = () => nombre('Tamaño de la cicatriz');
const rendimiento = () => nombre('Rendimiento');
const tamanoFruto = () => upov(20);

type Resp = { descriptor_id: number; nota?: number | null; valor_numerico?: number | string | null };

async function ficha(ensayoId: number, variedad: string, rep: number, respuestas: Resp[], extra: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await guardarFichaEvecl(autor.client, {
    p_ensayo_id: ensayoId, p_variedad: variedad, p_numero_repeticion: rep, p_respuestas: respuestas, ...extra,
  });
  if (error) throw new Error(`ficha ${variedad}/${rep}: ${error.message}`);
  return Number(data);
}

async function comparar(ensayoId: number, conjunto = 'todos', modo = 'entre_grupos', variedad?: string): Promise<Comparacion> {
  const { data, error } = await autor.client.rpc('evecl_comparar', {
    p_modo: modo, p_ensayo_id: ensayoId, p_variedad: variedad ?? null, p_conjunto: conjunto,
  });
  if (error) throw new Error(`comparar: ${error.message}`);
  return data as Comparacion;
}

const porVariedad = (items: Item[], v: string) => items.find((i) => i.variedad === v);

beforeAll(async () => {
  autor = await ctx.usuario('cmp-autor', 'operario');
  otro = await ctx.usuario('cmp-otro', 'operario');
  cat = await ctx.catalogo(autor.client);
}, 60_000);

afterAll(async () => {
  await ctx.limpiar();
}, 60_000);

describe('T07 — evecl_comparar: reglas de ranking del Maestro 9.4.3 (confirmaciones)', () => {
  it('normaliza min-max dentro del conjunto: 10 / 15 / 20 de firmeza → 0 / 50 / 100', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-MINMAX');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }]);
    await ficha(e, 'AUD-G9-B', 1, [{ descriptor_id: firmeza().id, valor_numerico: 15 }]);
    await ficha(e, 'AUD-G9-C', 1, [{ descriptor_id: firmeza().id, valor_numerico: 20 }]);
    const r = await comparar(e);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-A')!.puntaje)).toBe(0);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-B')!.puntaje)).toBe(50);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-C')!.puntaje)).toBe(100);
    expect(r.ranking_calidad.map((i) => i.variedad)).toEqual(['AUD-G9-C', 'AUD-G9-B', 'AUD-G9-A']);
  });

  it('la dirección "menor" invierte la escala (cicatriz peduncular: menos mm es mejor)', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-MENOR');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: cicatriz().id, valor_numerico: 2 }]);
    await ficha(e, 'AUD-G9-B', 1, [{ descriptor_id: cicatriz().id, valor_numerico: 6 }]);
    const r = await comparar(e);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-A')!.puntaje)).toBe(100);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-B')!.puntaje)).toBe(0);
  });

  it('un criterio sin dato se omite del promedio y NO cuenta como 0', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-NULOS');
    // A: firmeza alta y nada de dulzor. B: firmeza baja y dulzor medido (solo B).
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: firmeza().id, valor_numerico: 20 }]);
    await ficha(e, 'AUD-G9-B', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }, { descriptor_id: dulzor().id, valor_numerico: 14 }]);
    const r = await comparar(e);
    // Si el dulzor ausente contara como 0, A promediaría (100+0)/2 = 50.
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-A')!.puntaje)).toBe(100);
  });

  it('si todas las fichas tienen el mismo valor (max = min) todas obtienen 100, sin NaN ni error', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-IGUALES');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: dulzor().id, valor_numerico: 13 }]);
    await ficha(e, 'AUD-G9-B', 1, [{ descriptor_id: dulzor().id, valor_numerico: 13 }]);
    const r = await comparar(e);
    expect(r.ranking_calidad.map((i) => Number(i.puntaje))).toEqual([100, 100]);
  });

  it('un eje sin ningún dato devuelve lista vacía (no 0 ni error)', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-SINDATO');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: firmeza().id, valor_numerico: 12 }]);
    const r = await comparar(e);
    expect(r.ranking_calidad).toHaveLength(1);
    expect(r.ranking_productividad).toEqual([]);
    expect(r.perfil_adaptabilidad).toEqual([]);
  });

  it('la acidez sola NO entra al ranking (excluida en aislado); el ratio °Brix/Acidez usa distancia a 18', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-ACIDEZ');
    await ficha(e, 'AUD-G9-SOLOACIDEZ', 1, [{ descriptor_id: acidez().id, valor_numerico: 0.8 }]);
    const r0 = await comparar(e);
    expect(r0.ranking_calidad).toEqual([]);

    // Ratios 18 (óptimo) y 30: distancias 0 y 12 → 100 y 0. Nótese que dulzor (mayor=mejor) también puntúa: se anula usando el mismo dulzor.
    await ficha(e, 'AUD-G9-R18', 1, [{ descriptor_id: dulzor().id, valor_numerico: 18 }, { descriptor_id: acidez().id, valor_numerico: 1 }]);
    await ficha(e, 'AUD-G9-R30', 1, [{ descriptor_id: dulzor().id, valor_numerico: 18 }, { descriptor_id: acidez().id, valor_numerico: 0.6 }]);
    const r = await comparar(e);
    // dulzor 18 y 18 → ambos 100 en ese criterio; ratio 18 vs 30 → 100 y 0; promedio 100 y 50.
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-R18')!.puntaje)).toBe(100);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-R30')!.puntaje)).toBe(50);
    // La ficha con solo acidez sigue fuera del ranking.
    expect(porVariedad(r.ranking_calidad, 'AUD-G9-SOLOACIDEZ')).toBeUndefined();
  });

  it('el ratio ignora fichas con acidez 0 (sin división por cero)', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-ACIDEZ0');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: dulzor().id, valor_numerico: 15 }, { descriptor_id: acidez().id, valor_numerico: 0 }]);
    const r = await comparar(e);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-A')!.puntaje)).toBe(100);
  });

  it('Fenología y Adaptabilidad no se rankean: ningún descriptor de esos ejes es rankeable y el perfil no trae puntaje', async () => {
    expect(cat.filter((d) => (d.eje === 'fenologia' || d.eje === 'adaptabilidad') && d.rankeable)).toEqual([]);
    const e = await ctx.ensayo(autor.client, 'CMP-FENOLOGIA');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: upov(1).id, nota: 5 }]);
    const r = await comparar(e);
    expect(r.perfil_fenologia).toHaveLength(1);
    expect(Object.keys(r.perfil_fenologia[0])).not.toContain('puntaje');
    expect(r.ranking_calidad).toEqual([]);
    expect(r.ranking_productividad).toEqual([]);
  });

  it('el perfil marca divergencia cuando las plantas no coinciden, y n_con_dato / n_total reflejan la evidencia', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-DIVERGE');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: upov(1).id, nota: 3 }]);
    await ficha(e, 'AUD-G9-A', 2, [{ descriptor_id: upov(1).id, nota: 3 }]);
    await ficha(e, 'AUD-G9-A', 3, [{ descriptor_id: upov(1).id, nota: 7 }]);
    await ficha(e, 'AUD-G9-A', 4, []);
    await ficha(e, 'AUD-G9-A', 5, []);
    const r = await comparar(e);
    const vigor = r.perfil_fenologia.find((p) => p.descriptor === 'Vigor')!;
    expect(vigor.nota_moda).toBe(3);
    expect(vigor.divergente).toBe(true);
    expect(Number(vigor.n_con_dato)).toBe(3);
    expect(Number(vigor.n_total)).toBe(5);
  });

  it('n_con_dato y n_total por grupo: 2 de 5 plantas con dato en el eje', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-EVIDENCIA');
    for (let rep = 1; rep <= 5; rep++) await ficha(e, 'AUD-G9-A', rep, rep <= 2 ? [{ descriptor_id: firmeza().id, valor_numerico: 10 + rep }] : []);
    const r = await comparar(e);
    const g = porVariedad(r.ranking_calidad, 'AUD-G9-A')!;
    expect(Number(g.n_con_dato)).toBe(2);
    expect(Number(g.n_total)).toBe(5);
  });

  it('los conjuntos: solo_evaluacion descarta testigos y evaluacion_vs_testigo los separa', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-CONJUNTOS');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }]);
    await ficha(e, 'AUD-G9-A', 6, [{ descriptor_id: firmeza().id, valor_numerico: 30 }], { p_tipo: 'testigo' });
    const todos = await comparar(e, 'todos');
    expect(todos.ranking_calidad).toHaveLength(1);
    expect(Number(todos.ranking_calidad[0].n_total)).toBe(2);
    const soloEval = await comparar(e, 'solo_evaluacion');
    expect(soloEval.ranking_calidad).toHaveLength(1);
    expect(Number(soloEval.ranking_calidad[0].n_total)).toBe(1);
    const separados = await comparar(e, 'evaluacion_vs_testigo');
    expect(separados.ranking_calidad.map((i) => i.tipo).sort()).toEqual(['evaluacion', 'testigo']);
  });

  it('entre_fichas compara repeticiones de una variedad dentro de un ensayo (cada ficha su grupo)', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-ENTRE-FICHAS');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }]);
    await ficha(e, 'AUD-G9-A', 2, [{ descriptor_id: firmeza().id, valor_numerico: 20 }]);
    await ficha(e, 'AUD-G9-OTRA', 1, [{ descriptor_id: firmeza().id, valor_numerico: 99 }]);
    const r = await comparar(e, 'todos', 'entre_fichas', 'AUD-G9-A');
    expect(r.ranking_calidad).toHaveLength(2);
    expect(r.conjunto).toBeNull();
    expect(r.ranking_calidad.map((i) => Number(i.puntaje)).sort((a, b) => a - b)).toEqual([0, 100]);
    expect(r.ranking_calidad.every((i) => Number(i.n_total) === 1)).toBe(true);
    // A1-G9-24: con n_total = 1 por construcción, n_con_dato nunca llega a 3 y la UI (EjeRankingCard: n_con_dato < 3) marcaría TODO como evidencia débil.
    expect(r.ranking_calidad.every((i) => Number(i.n_con_dato) < 3)).toBe(true);
  });
});

describe('T07 — evecl_comparar: parámetros y permisos', () => {
  it('rechaza modo inválido, conjunto inválido y entre_fichas sin ensayo o sin variedad (22023)', async () => {
    for (const args of [
      { p_modo: 'otro' },
      { p_modo: 'entre_grupos', p_conjunto: 'otro' },
      { p_modo: 'entre_fichas' },
      { p_modo: 'entre_fichas', p_ensayo_id: 1 },
      { p_modo: 'entre_fichas', p_variedad: 'x' },
    ]) {
      const { error } = await autor.client.rpc('evecl_comparar', args);
      expect(error?.code, JSON.stringify(args)).toBe('22023');
    }
  });

  it('anon no puede ejecutar ninguna RPC de EVECL', async () => {
    for (const [fn, args] of [
      ['evecl_comparar', { p_modo: 'entre_grupos' }],
      ['evecl_obtener_ensayos', {}],
      ['evecl_obtener_fichas', {}],
      ['evecl_obtener_ficha', { p_ficha_id: 1 }],
      ['evecl_obtener_catalogo', {}],
      ['evecl_guardar_ensayo', { p_codigo_parcela: 'x' }],
      ['evecl_guardar_ficha', { p_ensayo_id: 1, p_variedad: 'x', p_numero_repeticion: 1 }],
      ['evecl_guardar_ficha_con_bajas', { p_entrada: { p_ensayo_id: 1, p_variedad: 'x', p_numero_repeticion: 1 } }],
      ['evecl_eliminar_ficha', { p_ficha_id: 1 }],
    ] as const) {
      const { error } = await ctx.anon.rpc(fn, args);
      expect(error, fn).not.toBeNull();
      expect(error!.code, fn).toBe('42501');
    }
  });

  it('el filtro de variedad es una comparación exacta sobre un parámetro: ni comodines ni SQL se interpretan', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-INYECCION');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }]);
    for (const v of ["%", "AUD-G9-%", "'; drop table evecl_ficha; --", "' or 1=1 --", '" or ""="']) {
      const r = await comparar(e, 'todos', 'entre_fichas', v);
      expect(r.ranking_calidad, v).toEqual([]);
    }
    const { count } = await ctx.service.from('evecl_ficha').select('id', { count: 'exact', head: true }).eq('ensayo_id', e);
    expect(count).toBe(1);
  });

  it('el filtro de variedad ignora mayúsculas y espacios (lower/trim), igual que el índice único', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-TRIM');
    await ficha(e, 'AUD-G9-Duke', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }]);
    const r = await comparar(e, 'todos', 'entre_fichas', '  aud-g9-DUKE ');
    expect(r.ranking_calidad).toHaveLength(1);
  });

  it('cualquier autenticado ve la comparación completa de ensayos ajenos (por diseño: "cualquiera")', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-AJENO');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }]);
    const { data, error } = await otro.client.rpc('evecl_comparar', { p_modo: 'entre_grupos', p_ensayo_id: e });
    expect(error).toBeNull();
    expect((data as Comparacion).ranking_calidad).toHaveLength(1);
  });
});

describe('T07 — A1-G9-08: valores no finitos', () => {
  it.fails('A1-G9-08 — la RPC debería rechazar NaN e Infinity en valor_numerico (hoy los acepta: NaN >= 0 es verdadero en Postgres)', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-NAN');
    const id = await ficha(e, 'AUD-G9-A', 1, []);
    for (const valor of ['NaN', 'Infinity']) {
      const { error } = await guardarFichaEvecl(autor.client, { p_id: id, p_respuestas: [{ descriptor_id: rendimiento().id, valor_numerico: valor }] });
      expect(error, valor).not.toBeNull();
    }
  });

  it.fails('A1-G9-08 — con un Infinity en un grupo, el puntaje de todos los grupos de ese criterio debería seguir siendo numérico (hoy se devuelve el texto "NaN")', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-INF');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: rendimiento().id, valor_numerico: 100 }]);
    await ficha(e, 'AUD-G9-B', 1, [{ descriptor_id: rendimiento().id, valor_numerico: 'Infinity' }]);
    await ficha(e, 'AUD-G9-C', 1, [{ descriptor_id: rendimiento().id, valor_numerico: 300 }]);
    const r = await comparar(e);
    for (const item of r.ranking_productividad) expect(typeof item.puntaje, item.variedad).toBe('number');
  });

  it.fails('A1-G9-08 — un tercero (que no es el autor) no debería poder insertar un NaN en una ficha ajena y arruinar la comparación (hoy la policy de INSERT de evecl_respuesta lo permite)', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-NAN-AJENO');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: dulzor().id, valor_numerico: 15 }]);
    const idB = await ficha(e, 'AUD-G9-B', 1, [{ descriptor_id: dulzor().id, valor_numerico: 12 }]);
    const { error } = await otro.client.from('evecl_respuesta').insert({ ficha_id: idB, descriptor_id: firmeza().id, valor_numerico: 'NaN' });
    expect(error).not.toBeNull();
  });
});

describe('T07 — A1-G9-09: estado con valor_numerico', () => {
  it.fails('A1-G9-09 — un descriptor de estado (Tamaño del fruto, UPOV 20) no debería aceptar valor_numerico: hoy éste manda sobre la nota y desordena el ranking', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-ESTADO-VALOR');
    // Notas reales: A = 5 (medio), B = 7 (grande). Lo correcto es que B quede arriba de A.
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: tamanoFruto().id, nota: 5, valor_numerico: 99999 }]);
    await ficha(e, 'AUD-G9-B', 1, [{ descriptor_id: tamanoFruto().id, nota: 7 }]);
    const r = await comparar(e);
    const a = Number(porVariedad(r.ranking_calidad, 'AUD-G9-A')?.puntaje);
    const b = Number(porVariedad(r.ranking_calidad, 'AUD-G9-B')?.puntaje);
    expect(b).toBeGreaterThan(a);
  });

  it('el trigger sí rechaza una nota fuera del descriptor, una nota en un descriptor de valor y un estado sin nota', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-TRIGGER');
    const id = await ficha(e, 'AUD-G9-A', 1, []);
    const casos: [string, Resp][] = [
      ['nota 4 en Vigor (solo define 3/5/7)', { descriptor_id: upov(1).id, nota: 4 }],
      ['nota en un descriptor de valor', { descriptor_id: firmeza().id, nota: 5, valor_numerico: 10 }],
      ['estado sin nota (solo valor)', { descriptor_id: upov(1).id, valor_numerico: 3 }],
    ];
    for (const [etiqueta, resp] of casos) {
      const { error } = await guardarFichaEvecl(autor.client, { p_id: id, p_respuestas: [resp] });
      expect(error, etiqueta).not.toBeNull();
      expect(error!.message, etiqueta).toMatch(/evecl_respuesta/);
    }
  });
});

describe('T07 — A1-G9-10: la variedad distingue mayúsculas al agrupar', () => {
  it('A1-G9-10 — "Duke" y "duke" se agrupan como la misma variedad en entre_grupos', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-CASING');
    await ficha(e, 'AUD-G9-Duke', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }]);
    const f2 = await ficha(e, 'aud-g9-duke', 2, [{ descriptor_id: firmeza().id, valor_numerico: 12 }]);
    expect((await ctx.service.from('evecl_ficha').update({ variedad: ' aud-g9-duke ' }).eq('id', f2)).error).toBeNull();
    await ficha(e, 'AUD-G9-Duke', 3, [{ descriptor_id: firmeza().id, valor_numerico: 14 }]);
    for (const conjunto of ['todos', 'solo_evaluacion', 'evaluacion_vs_testigo']) {
      const r = await comparar(e, conjunto);
      expect(r.ranking_calidad, conjunto).toHaveLength(1);
      expect(Number(r.ranking_calidad[0].n_total), conjunto).toBe(3);
    }
  });
});

describe('T07 — A1-G9-11: ensayo archivado', () => {
  it.fails('A1-G9-11 — las fichas de un ensayo archivado (eliminado_at) no deberían entrar a la comparación (hoy evecl_comparar no filtra evecl_ensayo.eliminado_at)', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-ARCHIVADO');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }]);
    await ctx.service.from('evecl_ensayo').update({ eliminado_at: new Date().toISOString() }).eq('id', e);
    const r = await comparar(e);
    expect(r.ranking_calidad).toEqual([]);
  });

  it.fails('A1-G9-11 — evecl_obtener_ficha de una ficha cuyo ensayo fue archivado debería fallar con claridad o devolver el ensayo (hoy devuelve "ensayo": null y obtenerFichaEvecl revienta con TypeError)', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-ARCHIVADO2');
    const id = await ficha(e, 'AUD-G9-A', 1, []);
    await ctx.service.from('evecl_ensayo').update({ eliminado_at: new Date().toISOString() }).eq('id', e);
    const { data, error } = await autor.client.rpc('evecl_obtener_ficha', { p_ficha_id: id });
    expect(error).toBeNull();
    expect(data.ensayo).not.toBeNull();
  });

  it.fails('A1-G9-11 — no debería poder crearse una ficha nueva dentro de un ensayo archivado (hoy la RPC y el INSERT directo lo permiten)', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-ARCHIVADO3');
    await ctx.service.from('evecl_ensayo').update({ eliminado_at: new Date().toISOString() }).eq('id', e);
    const { error } = await guardarFichaEvecl(autor.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-NUEVA', p_numero_repeticion: 1 });
    expect(error).not.toBeNull();
  });
});

describe('T07 — A1-G9-21: comportamiento del puntaje con cobertura desigual (se documenta, es decisión de diseño)', () => {
  it('un grupo con una sola ficha y un solo criterio que nadie más midió recibe 100 y queda primero del eje (consecuencia de max = min; ver rls.test.ts "un único grupo con dato en un eje da puntaje=100")', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-COBERTURA');
    // X e Y miden firmeza y dulzor y se reparten 0/100 → ambos 50. Z solo midió la cicatriz (nadie más la midió).
    await ficha(e, 'AUD-G9-X', 1, [{ descriptor_id: firmeza().id, valor_numerico: 20 }, { descriptor_id: dulzor().id, valor_numerico: 15 }]);
    await ficha(e, 'AUD-G9-Y', 1, [{ descriptor_id: firmeza().id, valor_numerico: 10 }, { descriptor_id: dulzor().id, valor_numerico: 20 }]);
    await ficha(e, 'AUD-G9-Z', 1, [{ descriptor_id: cicatriz().id, valor_numerico: 3 }]);
    const r = await comparar(e);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-X')!.puntaje)).toBe(50);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-Y')!.puntaje)).toBe(50);
    expect(Number(porVariedad(r.ranking_calidad, 'AUD-G9-Z')!.puntaje)).toBe(100);
    expect(r.ranking_calidad[0].variedad).toBe('AUD-G9-Z');
  });

  it('en un empate de la moda, el perfil muestra el estado de menor nota y lo marca divergente', async () => {
    const e = await ctx.ensayo(autor.client, 'CMP-MODA');
    await ficha(e, 'AUD-G9-A', 1, [{ descriptor_id: upov(33).id, nota: 9 }]);
    await ficha(e, 'AUD-G9-A', 2, [{ descriptor_id: upov(33).id, nota: 1 }]);
    const r = await comparar(e);
    const p = r.perfil_fenologia.find((x) => x.descriptor.startsWith('Época de inicio de floración (rama de un año)'))!;
    expect(p.nota_moda).toBe(1);
    expect(p.divergente).toBe(true);
  });
});
