/**
 * Verificación independiente de A1-G2-08 (la resiembra no es atómica: 4-6 escrituras
 * sueltas desde el cliente) y A1-G2-09 (borrar/insertar plantas_insumo y
 * plantas_sustrato ahora deja rastro por A1-022).
 * Conserva las llamadas sueltas antiguas como control del transporte; la API
 * actual usa guardar_siembra, cubierta por correccion/a1-023.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, especieArandano, usuario, type Contexto } from './v1-helpers';

let ctx: Contexto;
let especie: string;
let opA: Awaited<ReturnType<typeof usuario>>;
let opB: Awaited<ReturnType<typeof usuario>>;
let plantaId: string;
let insumos: string[];
let sustratos: string[];
const FK_INVALIDA = '00000000-0000-0000-0000-00000000dead';

async function auditoriaDelCruce() {
  const { count } = await ctx.service.from('audit_log').select('id', { count: 'exact', head: true }).eq('planta_id', plantaId);
  return count ?? 0;
}
async function conteos() {
  const i = await ctx.service.from('plantas_insumo').select('insumo_id').eq('planta_id', plantaId);
  const s = await ctx.service.from('plantas_sustrato').select('sustrato_id').eq('planta_id', plantaId);
  return { insumos: i.data!.length, sustratos: s.data!.length };
}

beforeAll(async () => {
  ctx = contexto();
  especie = await especieArandano(ctx);
  opA = await usuario(ctx, 'g208a', 'operario');
  opB = await usuario(ctx, 'g208b', 'operario');
  // Catálogos propios: la base recién reiniciada no trae insumos ni sustratos suficientes.
  const ins = await ctx.service
    .from('insumo')
    .insert([1, 2, 3].map((n) => ({ nombre: `AUD-V1-${ctx.R}-insumo-${n}`, tipo: 'otro' })))
    .select('id');
  if (ins.error) throw ins.error;
  const sus = await ctx.service
    .from('sustrato')
    .insert([1, 2, 3].map((n) => ({ nombre: `AUD-V1-${ctx.R}-sustrato-${n}` })))
    .select('id');
  if (sus.error) throw sus.error;
  insumos = ins.data!.map((x) => x.id);
  sustratos = sus.data!.map((x) => x.id);
  const { data, error } = await ctx.service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-V1-${ctx.R}-S`, especie_id: especie, es_prueba: true, estado: 'siembra_semilla' })
    .select('id')
    .single();
  if (error) throw error;
  plantaId = data!.id;
}, 60_000);

afterAll(async () => {
  await ctx.service.from('plantas_insumo').delete().eq('planta_id', plantaId);
  await ctx.service.from('plantas_sustrato').delete().eq('planta_id', plantaId);
  await ctx.service.from('registros_evento').delete().eq('planta_id', plantaId);
  await ctx.service.from('plantas').delete().eq('id', plantaId);
  await ctx.service.from('insumo').delete().like('nombre', `AUD-V1-${ctx.R}-insumo-%`);
  await ctx.service.from('sustrato').delete().like('nombre', `AUD-V1-${ctx.R}-sustrato-%`);
});

describe('A1-G2-08 / A1-G2-09 siembra', () => {
  it('estado inicial: siembra previa de A con 2 insumos y 2 sustratos', async () => {
    await ctx.service.from('plantas_insumo').insert(insumos.slice(0, 2).map((insumo_id) => ({ planta_id: plantaId, insumo_id })));
    await ctx.service.from('plantas_sustrato').insert(sustratos.slice(0, 2).map((sustrato_id) => ({ planta_id: plantaId, sustrato_id, porcentaje: 50 })));
    expect(await conteos()).toEqual({ insumos: 2, sustratos: 2 });
  });

  it('A1-G2-08: si la inserción de insumos falla a mitad de la resiembra, quedan columnas nuevas + 0 insumos + sustratos viejos + sin bitácora', async () => {
    // Paso 1 de actualizarSiembra: update de columnas (OK)
    const upd = await opB.client.from('plantas').update({ semillas_sembradas: 777 }).eq('id', plantaId).select('id');
    expect(upd.error).toBeNull();
    expect(upd.data).toHaveLength(1);
    // Paso 2: delete de insumos (OK)
    const del = await opB.client.from('plantas_insumo').delete().eq('planta_id', plantaId).select('insumo_id');
    expect(del.error).toBeNull();
    expect(del.data).toHaveLength(2);
    // Paso 3: insert de insumos (falla: señal perdida en terreno; aquí, FK inválida)
    const ins = await opB.client.from('plantas_insumo').insert([{ planta_id: plantaId, insumo_id: FK_INVALIDA }]);
    expect(ins.error).not.toBeNull();

    // Resultado: estado mixto entre dos siembras
    const { data: p } = await ctx.service.from('plantas').select('semillas_sembradas').eq('id', plantaId).single();
    expect(p!.semillas_sembradas).toBe(777); // columnas de la siembra NUEVA
    expect(await conteos()).toEqual({ insumos: 0, sustratos: 2 }); // insumos perdidos; sustratos de la siembra VIEJA
    const { data: bit } = await ctx.service.from('registros_evento').select('id').eq('planta_id', plantaId).eq('tipo_evento', 'siembra_semilla');
    expect(bit).toHaveLength(0); // sin fila de bitácora
  });

  it('A1-G2-09: borrar y volver a insertar insumos/sustratos conserva autor y valores en audit_log', async () => {
    const antes = await auditoriaDelCruce();
    const t0 = new Date().toISOString();

    expect((await opA.client.from('plantas_sustrato').delete().eq('planta_id', plantaId)).error).toBeNull();
    expect((await opA.client.from('plantas_insumo').insert([{ planta_id: plantaId, insumo_id: insumos[2] ?? insumos[0] }])).error).toBeNull();
    expect((await opA.client.from('plantas_sustrato').insert([{ planta_id: plantaId, sustrato_id: sustratos[0], porcentaje: 100 }])).error).toBeNull();

    expect(await auditoriaDelCruce()).toBe(antes + 4);
    const { data: rastro, error } = await ctx.service.from('audit_log').select('accion,detalle').eq('planta_id', plantaId).eq('usuario_id', opA.id).gte('ocurrido_en', t0);
    expect(error).toBeNull(); expect(rastro).toHaveLength(4);
    expect(rastro!.every(f => f.accion === 'cambio_material_siembra')).toBe(true);
    expect(rastro!.filter(f => f.detalle.operacion === 'DELETE')).toHaveLength(2);
    expect(rastro!.some(f => f.detalle.tabla === 'plantas_insumo' && f.detalle.nuevo?.insumo_id === (insumos[2] ?? insumos[0]))).toBe(true);
    expect(rastro!.some(f => f.detalle.tabla === 'plantas_sustrato' && f.detalle.nuevo?.porcentaje === 100)).toBe(true);
    // ... y el set efectivo cambió: sustratos 2 → 1, insumos 0 → 1
    expect(await conteos()).toEqual({ insumos: 1, sustratos: 1 });
  });

  it('control: las columnas y los materiales se auditan con acciones diferentes', async () => {
    const { data } = await ctx.service.from('audit_log').select('accion').eq('planta_id', plantaId);
    // el UPDATE de columnas de fase del paso 1 sí dejó rastro por trg_plantas_auditoria_fase
    expect((data ?? []).length).toBeGreaterThan(0);
    expect(data!.some(f => f.accion === 'escritura_fase')).toBe(true);
    expect(data!.some(f => f.accion === 'cambio_material_siembra')).toBe(true);
  });
});
