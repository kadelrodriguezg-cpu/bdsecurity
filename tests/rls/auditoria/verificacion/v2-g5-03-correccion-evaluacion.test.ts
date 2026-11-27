/**
 * Verificación independiente de A1-G5-03 (parte de base de datos).
 *
 * La afirmación central del hallazgo (no existe pantalla para corregir ni anular
 * una evaluación cerrada) se demuestra por lectura de la UI, citada en el informe
 * `verificacion_G5-G9.md`. Aquí se comprueba lo que el hallazgo da por cierto de la base:
 *  - solo un admin puede corregir/anular una evaluación cerrada (el operario autor no puede);
 *  - la base sí lo soporta por API (con motivo obligatorio) y recalcula `requiere_revision`;
 *  - mientras `requiere_revision` está activo, el individuo queda fuera del ranking, y no
 *    hay otra forma de resolverlo que corregir el dato (no existe un «confirmar»).
 */
import { iniciarRondaAnual } from '../../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoV2, psql } from './v2-comun';

const ctx = new ContextoV2('g5-03');
let operario: Awaited<ReturnType<ContextoV2['usuario']>>;
let admin: Awaited<ReturnType<ContextoV2['usuario']>>;
let especieId: string;
let versionId: string;
let cruce: string;
let individuo: string;

beforeAll(async () => {
  admin = await ctx.usuario('admin');
  operario = await ctx.usuario('operario');
  const esp = await ctx.service.from('especies').insert({ nombre: `AUD-V2 g5-03 ${ctx.sufijo}` }).select('id').single();
  if (esp.error) throw new Error(esp.error.message);
  especieId = esp.data.id as string;
  const v = await ctx.service.from('scoring_version').insert({
    nombre: `AUD-V2 g5-03 ${ctx.sufijo}`, especie_id: especieId, fase: 'evaluacion_anual', vigente_desde: '2026-01-01', estado: 'activa',
  }).select('id').single();
  if (v.error) throw new Error(v.error.message);
  versionId = v.data.id as string;
  await ctx.service.from('scoring_metrica').insert([
    { scoring_version_id: versionId, categoria: 'fruto_calidad', metrica: 'firmeza', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 1 },
    { scoring_version_id: versionId, categoria: 'fruto_calidad', metrica: 'brix', peso: 1, direccion_favorable: 'mayor', metodo_normalizacion: 'escala', minimo_normalizacion: 10, maximo_normalizacion: 20, orden: 2 },
  ]);
  const c = await ctx.service.from('plantas').insert({
    codigo_sistema: `AUD-V2-G503-${ctx.sufijo}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true,
  }).select('id').single();
  if (c.error) throw new Error(c.error.message);
  cruce = c.data.id as string;
  const i = await ctx.service.from('individuos').insert({ planta_id: cruce, codigo_display: `AUD-V2-G503-I-${ctx.sufijo}`, created_by: admin.userId }).select('id').single();
  if (i.error) throw new Error(i.error.message);
  individuo = i.data.id as string;
}, 90_000);

afterAll(async () => {
  psql(`delete from evaluaciones where ronda_id in (select id from ronda_evaluacion_anual where individuo_id='${individuo}');`);
  const { error } = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: cruce, p_tipo: 'hard' });
  if (error) console.warn('[v2-g5-03] no se pudo purgar el cruce:', error.message);
  psql(`delete from scoring_metrica where scoring_version_id='${versionId}';
        delete from scoring_version where id='${versionId}';
        delete from especies where id='${especieId}';`);
  const fallos = await ctx.borrarUsuarios();
  if (fallos.length) console.warn('[v2-g5-03] usuarios no borrados:', fallos);
}, 90_000);

describe('A1-G5-03 — la base soporta corregir/anular, solo admin; el flujo en la app no existe', () => {
  it('un calibre >= 40 mm marca requiere_revision y saca al individuo del ranking; solo el admin puede corregirlo', async () => {
    const r = await iniciarRondaAnual(operario.client, individuo);
    expect(r.error).toBeNull();
    const rondaId = (r.data as { ronda_id: string }).ronda_id;
    const ins = await operario.client.from('evaluaciones').insert({
      ronda_id: rondaId, fecha: '2026-06-01', created_by: operario.userId,
      firmeza: 4, brix: 15, calibre_mm: 45, estado: 'completa', cantidad_frutos: 10, peso_total_g: 120,
    }).select('id,requiere_revision').single();
    expect(ins.error).toBeNull();
    expect(ins.data?.requiere_revision).toBe(true);
    const evalId = ins.data!.id as string;

    const filaRanking = async () => {
      const { data } = await operario.client.rpc('obtener_ranking_operativo', { p_planta_id: cruce, p_limite: 100 });
      return (data as { items: Array<Record<string, unknown>> }).items.find((x) => x.individuo_id === individuo);
    };
    const antes = await filaRanking();
    expect(antes?.elegible).toBe(false);
    expect(antes?.requiere_revision).toBe(true);

    // El operario autor no puede corregirla (RLS: solo borradores propios): 0 filas actualizadas.
    const op = await operario.client.from('evaluaciones').update({ calibre_mm: 25, estado: 'corregida', motivo_cambio: 'error de tipeo' }).eq('id', evalId).select('id');
    expect(op.data ?? []).toHaveLength(0);

    // El admin, sin motivo, es rechazado; con motivo, corrige y la marca se recalcula.
    const sinMotivo = await admin.client.from('evaluaciones').update({ calibre_mm: 25, estado: 'corregida' }).eq('id', evalId).select('id');
    expect(sinMotivo.error).not.toBeNull();
    const conMotivo = await admin.client.from('evaluaciones').update({ calibre_mm: 25, estado: 'corregida', motivo_cambio: 'error de tipeo' }).eq('id', evalId).select('requiere_revision,estado').single();
    expect(conMotivo.error).toBeNull();
    expect(conMotivo.data).toEqual({ requiere_revision: false, estado: 'corregida' });
    expect((await filaRanking())?.elegible).toBe(true);

    // Un valor extremo legítimo (por ejemplo 45 mm real) no tiene cómo «confirmarse»: cualquier escritura recalcula la marca.
    const legitimo = await admin.client.from('evaluaciones').update({ calibre_mm: 45, motivo_cambio: 'el valor es real' }).eq('id', evalId).select('requiere_revision').single();
    expect(legitimo.error).toBeNull();
    expect(legitimo.data?.requiere_revision).toBe(true);

    // Anular con motivo también funciona por API.
    const anul = await admin.client.from('evaluaciones').update({ estado: 'anulada', motivo_cambio: 'dato inválido' }).eq('id', evalId).select('estado').single();
    expect(anul.error).toBeNull();
    expect(anul.data?.estado).toBe('anulada');
  });
});
