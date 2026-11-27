import { afterAll, beforeAll, expect, it } from 'vitest';
import { prepararContexto, crearCruce, purgarCruces, type ContextoG5, type EstadoPlanta } from '../auditoria/g5-setup';
let ctx: ContextoG5;
let insumo: string;
let sustrato: string;
const cruces: string[] = [];
const fases: EstadoPlanta[] = ['sin_empezar', 'polinizacion', 'cosecha', 'siembra_semilla', 'germinacion', 'trasplante', 'crecimiento', 'evaluacion_anual', 'traslado_destino', 'proceso_finalizado'];
beforeAll(async () => {
  ctx = await prepararContexto('fix028', { especiePropia: true });
  const i = await ctx.service.from('insumo').insert({ nombre: `FIX028-I-${ctx.sufijo}`, tipo: 'otro' }).select('id').single(); expect(i.error).toBeNull(); insumo = i.data!.id;
  const s = await ctx.service.from('sustrato').insert({ nombre: `FIX028-S-${ctx.sufijo}` }).select('id').single(); expect(s.error).toBeNull(); sustrato = s.data!.id;
});
afterAll(async () => {
  await purgarCruces(ctx, cruces, { especieIds: [ctx.especieId] });
  expect((await ctx.service.from('insumo').delete().eq('id', insumo)).error).toBeNull();
  expect((await ctx.service.from('sustrato').delete().eq('id', sustrato)).error).toBeNull();
  for (const id of [ctx.operario2Id, ctx.operarioId, ctx.adminId]) expect((await ctx.service.auth.admin.deleteUser(id)).error).toBeNull();
});
const capturas = [
  { tabla: 'polinizacion_evento', etapa: 'polinizacion', datos: () => ({ fecha: '2026-10-01', n_flores_cruzadas: 2 }) },
  { tabla: 'cosecha_fruto', etapa: 'cosecha', datos: () => ({ numero_fruto: 0, cantidad_semillas: 2 }) },
  { tabla: 'germinacion_evento', etapa: 'germinacion', datos: () => ({ fecha: '2026-10-01', cantidad_nueva: 2 }) },
  { tabla: 'plantas_insumo', etapa: 'siembra_semilla', datos: () => ({ insumo_id: insumo }) },
  { tabla: 'plantas_sustrato', etapa: 'siembra_semilla', datos: () => ({ sustrato_id: sustrato, porcentaje: 50 }) },
] as const;
it.each(capturas)('$tabla: diez fases y ambos roles solo permiten capturas alcanzadas antes del cierre', async ({ tabla, etapa, datos }) => {
  for (const [cliente, autor] of [[ctx.admin, ctx.adminId], [ctx.operario, ctx.operarioId]] as const) for (const estado of fases) {
    const planta = await crearCruce(ctx, `${tabla}-${autor.slice(0, 6)}-${estado}`, estado); cruces.push(planta);
    const fila = { planta_id: planta, ...datos(), ...(['plantas_insumo', 'plantas_sustrato'].includes(tabla) ? {} : { created_by: autor }) };
    const res = await cliente.from(tabla).insert(fila);
    const permitido = fases.indexOf(estado) >= fases.indexOf(etapa) && estado !== 'proceso_finalizado';
    if (permitido) expect(res.error, `${tabla}/${estado}`).toBeNull();
    else expect(res.error?.code, `${tabla}/${estado}`).toBe('55000');
    const filas = await ctx.service.from(tabla).select('*').eq('planta_id', planta);
    expect(filas.error).toBeNull(); expect(filas.data).toHaveLength(permitido ? 1 : 0);
  }
});
it('tras retroceder conserva edición/borrado existentes y auditoría, pero rechaza altas nuevas', async () => {
  const planta = await crearCruce(ctx, 'retroceso', 'germinacion'); cruces.push(planta);
  const sesion = await ctx.operario.from('polinizacion_evento').insert({ planta_id: planta, fecha: '2026-10-01', n_flores_cruzadas: 2, created_by: ctx.operarioId }).select('id').single(); expect(sesion.error).toBeNull();
  const registro = await ctx.operario.from('registros_evento').insert({ planta_id: planta, tipo_evento: 'germinacion', fecha: '2026-10-01', created_by: ctx.operarioId }).select('id').single(); expect(registro.error).toBeNull();
  expect((await ctx.service.from('plantas').update({ estado: 'sin_empezar' }).eq('id', planta)).error).toBeNull();
  // Editar un registro existente tras el retroceso es corregir un dato real, no anticiparlo.
  expect((await ctx.operario.from('registros_evento').update({ notas: 'corregida' }).eq('id', registro.data!.id)).error).toBeNull();
  // Las altas nuevas anticipadas siguen rechazadas.
  expect((await ctx.operario.from('polinizacion_evento').insert({ planta_id: planta, fecha: '2026-10-02', n_flores_cruzadas: 1, created_by: ctx.operarioId })).error?.code).toBe('55000');
  expect((await ctx.operario.from('germinacion_evento').insert({ planta_id: planta, fecha: '2026-10-02', cantidad_nueva: 1, created_by: ctx.operarioId })).error?.code).toBe('55000');
  // Quitar lo existente sigue permitido y deja traza.
  expect((await ctx.operario.from('polinizacion_evento').delete().eq('id', sesion.data!.id)).error).toBeNull();
  const audit = await ctx.service.from('audit_log').select('id').eq('planta_id', planta).like('accion', '%polinizacion%');
  expect(audit.error).toBeNull(); expect(audit.data!.length).toBeGreaterThan(0);
});
it('columnas: rechaza anticipadas sin respaldo, permite vaciar o resincronizar registros existentes y congela el cierre', async () => {
  const planta = await crearCruce(ctx, 'columnas', 'sin_empezar'); cruces.push(planta);
  for (const datos of [{ n_flores_cruzadas: 3 }, { n_semillas: 5 }, { semillas_sembradas: 5 }]) {
    expect((await ctx.operario.from('plantas').update(datos).eq('id', planta)).error?.code).toBe('55000');
  }
  expect((await ctx.service.from('polinizacion_evento').insert({ planta_id: planta, fecha: '2026-10-01', n_flores_cruzadas: 2, created_by: ctx.operarioId })).error).toBeNull();
  expect((await ctx.operario.from('plantas').update({ n_flores_cruzadas: 2, fecha_polinizacion: '2026-10-01' }).eq('id', planta)).error).toBeNull();
  expect((await ctx.operario.from('plantas').update({ n_flores_cruzadas: null, fecha_polinizacion: null }).eq('id', planta)).error).toBeNull();
  expect((await ctx.service.from('plantas').update({ estado: 'proceso_finalizado' }).eq('id', planta)).error).toBeNull();
  expect((await ctx.operario.from('plantas').update({ n_flores_cruzadas: 2 }).eq('id', planta)).error?.code).toBe('55000');
  expect((await ctx.operario.from('polinizacion_evento').delete().eq('planta_id', planta)).error?.code).toBe('55000');
  expect((await ctx.admin.rpc('borrar_cruzamiento', { p_planta_id: planta, p_tipo: 'hard' })).error).toBeNull();
  cruces.splice(cruces.indexOf(planta), 1);
});
