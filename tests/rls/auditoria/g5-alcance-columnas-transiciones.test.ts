/**
 * G5 / E02-E05 — Alcance de las escrituras sobre `evaluaciones` y
 * `ronda_evaluacion_anual`, columnas de procedencia y máquina de estados.
 *
 * Qué se demuestra contra la base local, con usuarios reales:
 * - la fase del cruce, el archivado y la baja del individuo se validan solo
 *   en la UI y en la RPC de iniciar ronda, no en el INSERT de evaluaciones
 *   ni en el UPDATE de un borrador (A1-G5-10);
 * - el UPDATE de `evaluaciones` no fija las columnas de procedencia: el
 *   autor puede ceder su borrador a otro usuario y un admin puede mover una
 *   evaluación cerrada a la ronda de OTRO cruce, con la auditoría anotada solo
 *   en el cruce de destino (A1-G5-02, A1-G5-14);
 * - la «máquina de estados» es solo la regla del motivo: desde `anulada` se
 *   puede ir a cualquier estado y un motivo viejo vale para la transición
 *   siguiente (A1-G5-05);
 * - reabrir (completa -> borrador) no exige motivo (A1-G5-05).
 */
import { iniciarRondaAnual } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  camposCompletaConMuestra,
  crearCruce,
  crearIndividuo,
  darDeBaja,
  prepararContexto,
  purgarCruces,
  ultimoAudit,
  type ContextoG5,
} from './g5-setup';

let ctx: ContextoG5;
let cruce: string;
const plantas: string[] = [];
let n = 0;

beforeAll(async () => {
  ctx = await prepararContexto('alc');
  cruce = await crearCruce(ctx, 'ALC', 'evaluacion_anual');
  plantas.push(cruce);
}, 60_000);

afterAll(async () => {
  await purgarCruces(ctx, plantas);
});

async function rondaNueva(cruceId = cruce): Promise<{ individuo: string; ronda: string }> {
  const individuo = await crearIndividuo(ctx, cruceId, `ALC-${++n}`);
  const { data, error } = await iniciarRondaAnual(ctx.operario, individuo);
  if (error) throw new Error(`setup ronda: ${error.message}`);
  return { individuo, ronda: (data as { ronda_id: string }).ronda_id };
}

async function leer(id: string) {
  const { data, error } = await ctx.service.from('evaluaciones').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

describe('A1-G5-10 — fase del cruce, archivado y baja se validan en la base', () => {
  it('iniciar_ronda_evaluacion rechaza un individuo de un cruce ARCHIVADO (eliminado_at)', async () => {
    const archivado = await crearCruce(ctx, 'ALC-ARCH', 'evaluacion_anual');
    plantas.push(archivado);
    const individuo = await crearIndividuo(ctx, archivado, `ALC-${++n}`);
    await ctx.service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', archivado);
    const { error } = await iniciarRondaAnual(ctx.operario, individuo);
    expect(error?.code).toBe('55000');
  });

  it('debería rechazar iniciar una ronda sobre un cruce archivado (A1-G5-10)', async () => {
    const archivado = await crearCruce(ctx, 'ALC-ARCH2', 'evaluacion_anual');
    plantas.push(archivado);
    const individuo = await crearIndividuo(ctx, archivado, `ALC-${++n}`);
    await ctx.service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', archivado);
    const { error } = await iniciarRondaAnual(ctx.operario, individuo);
    expect(error).not.toBeNull();
  });

  it('un INSERT directo de evaluación en la ronda de un cruce finalizado se rechaza', async () => {
    const { ronda } = await rondaNueva();
    await ctx.service.from('plantas').update({ estado: 'proceso_finalizado' }).eq('id', cruce);
    const { error } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', created_by: ctx.operarioId, ...camposCompletaConMuestra() });
    await ctx.service.from('plantas').update({ estado: 'evaluacion_anual' }).eq('id', cruce);
    expect(error?.code).toBe('55000');
  });

  it('debería rechazar una evaluación nueva en la ronda anual de un cruce que ya salió de evaluacion_anual (A1-G5-10)', async () => {
    const { ronda } = await rondaNueva();
    await ctx.service.from('plantas').update({ estado: 'proceso_finalizado' }).eq('id', cruce);
    const { error } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', created_by: ctx.operarioId, ...camposCompletaConMuestra() });
    await ctx.service.from('plantas').update({ estado: 'evaluacion_anual' }).eq('id', cruce);
    expect(error).not.toBeNull();
  });

  it('un borrador abierto sobrevive a la baja como historial, pero no se cierra DESPUÉS de la baja', async () => {
    const { individuo, ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', estado: 'borrador', created_by: ctx.operarioId, brix: 14 })
      .select('id')
      .single();
    await darDeBaja(ctx, individuo);

    const nuevo = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-02', created_by: ctx.operarioId, ...camposCompletaConMuestra() });
    expect(nuevo.error?.code).toBe('42501');

    const cierre = await ctx.operario
      .from('evaluaciones')
      .update({ ...camposCompletaConMuestra() })
      .eq('id', borrador!.id)
      .select('estado')
      .single();
    expect(cierre.error?.code).toBe('42501');
    expect((await leer(borrador!.id)).estado).toBe('borrador');
  });
});

describe('A1-G5-14 / A1-G5-02 — columnas de procedencia modificables', () => {
  it('el autor NO puede ceder su borrador a otro usuario: el WITH CHECK de la policy exige created_by = auth.uid() (control positivo)', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', estado: 'borrador', created_by: ctx.operarioId })
      .select('id')
      .single();
    const { error } = await ctx.operario.from('evaluaciones').update({ created_by: ctx.operario2Id }).eq('id', borrador!.id);
    expect(error?.code).toBe('42501');
    expect((await leer(borrador!.id)).created_by).toBe(ctx.operarioId);
  });

  it('el UPDATE acepta cambiar id, created_at, idempotency_key y predio_id (sin FK) de un borrador propio: el GRANT es de tabla completa', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', estado: 'borrador', created_by: ctx.operarioId })
      .select('id')
      .single();
    const predioInexistente = crypto.randomUUID();
    const { data, error } = await ctx.operario
      .from('evaluaciones')
      .update({ created_at: '2020-01-01T00:00:00Z', idempotency_key: crypto.randomUUID(), predio_id: predioInexistente })
      .eq('id', borrador!.id)
      .select('created_at, predio_id')
      .single();
    // Resultado observado: created_at e idempotency_key cambian; predio_id se
    // acepta si no hay FK, o se rechaza con 23503 si la hay. Se documenta lo
    // que ocurre sin presuponerlo.
    if (error) {
      expect(['23503', '23514']).toContain(error.code);
    } else {
      expect(data!.created_at.startsWith('2020-01-01')).toBe(true);
    }
  });

  // A1-058 corregido en la Fase 2 (20261023110000): ronda_id es inmutable, también para un admin.
  it('un admin NO puede mover una evaluación CERRADA a la ronda de otro individuo de OTRO cruce (A1-G5-02 / A1-058)', async () => {
    const cruceB = await crearCruce(ctx, 'ALC-B', 'evaluacion_anual');
    plantas.push(cruceB);
    const origen = await rondaNueva(cruce);
    const destino = await rondaNueva(cruceB);
    const { data: cerrada } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: origen.ronda, fecha: '2026-06-01', created_by: ctx.operarioId, brix: 14, ...camposCompletaConMuestra() })
      .select('id')
      .single();

    const { error } = await ctx.admin.from('evaluaciones').update({ ronda_id: destino.ronda }).eq('id', cerrada!.id);
    expect(error?.code).toBe('23514');

    const { data: fila } = await ctx.service.from('evaluaciones').select('ronda_id').eq('id', cerrada!.id).single();
    expect(fila?.ronda_id).toBe(origen.ronda);
    const { count } = await ctx.service
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('planta_id', cruceB)
      .eq('accion', 'edicion_evaluacion')
      .eq('detalle->>evaluacion_id', cerrada!.id);
    expect(count).toBe(0);
  });
});

describe('A1-G5-05 — transiciones de estado', () => {
  type Estado = 'borrador' | 'completa' | 'corregida' | 'anulada';
  const ESTADOS: Estado[] = ['borrador', 'completa', 'corregida', 'anulada'];

  async function evaluacionEn(estado: Estado): Promise<string> {
    const { ronda } = await rondaNueva();
    const base = { ronda_id: ronda, fecha: '2026-06-01', created_by: ctx.operarioId, cantidad_frutos: 10, peso_total_g: 120, brix: 14 };
    const { data, error } = await ctx.operario
      .from('evaluaciones')
      .insert({ ...base, estado: estado === 'borrador' ? 'borrador' : 'completa' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`setup evaluacion ${estado}: ${error?.message}`);
    if (estado === 'corregida' || estado === 'anulada') {
      const { error: errAdmin } = await ctx.admin.from('evaluaciones').update({ estado, motivo_cambio: `motivo inicial ${estado}` }).eq('id', data.id);
      if (errAdmin) throw new Error(`setup ${estado}: ${errAdmin.message}`);
    }
    return data.id as string;
  }

  it('el admin logra TODAS las transiciones entre los 4 estados (con motivo donde se exige): no hay máquina de estados', async () => {
    const resultado: Record<string, string> = {};
    for (const desde of ESTADOS) {
      for (const hacia of ESTADOS) {
        if (desde === hacia) continue;
        const id = await evaluacionEn(desde);
        const { error } = await ctx.admin
          .from('evaluaciones')
          .update({ estado: hacia, motivo_cambio: `motivo ${desde}->${hacia}` })
          .eq('id', id);
        resultado[`${desde}->${hacia}`] = error ? `rechazada ${error.code}` : 'aceptada';
      }
    }
    expect(Object.values(resultado).every((r) => r === 'aceptada'), JSON.stringify(resultado)).toBe(true);
  }, 60_000);

  it.fails('desde anulada NO debería poder volver a ningún otro estado (A1-G5-05)', async () => {
    const id = await evaluacionEn('anulada');
    const { error } = await ctx.admin.from('evaluaciones').update({ estado: 'completa' }).eq('id', id);
    expect(error).not.toBeNull();
  });

  it.fails('un borrador que nunca se cerró NO debería poder pasar a corregida (A1-G5-05)', async () => {
    const id = await evaluacionEn('borrador');
    const { error } = await ctx.admin.from('evaluaciones').update({ estado: 'corregida', motivo_cambio: 'x' }).eq('id', id);
    expect(error).not.toBeNull();
  });

  it('el motivo se valida contra la COLUMNA, no contra la transición: corregida -> anulada reutiliza el motivo de la corrección anterior', async () => {
    const id = await evaluacionEn('corregida'); // motivo_cambio = 'motivo inicial corregida'
    const { error } = await ctx.admin.from('evaluaciones').update({ estado: 'anulada' }).eq('id', id);
    expect(error).toBeNull();
    const fila = await ultimoAudit(ctx, 'cambio_estado_evaluacion', 'evaluacion_id', id);
    expect(fila.detalle).toMatchObject({ estado_anterior: 'corregida', estado_nuevo: 'anulada', motivo: 'motivo inicial corregida' });
  });

  it('con motivo_cambio explícitamente null, corregida y anulada se rechazan; completa y borrador se aceptan sin motivo', async () => {
    const id = await evaluacionEn('completa');
    const corregir = await ctx.admin.from('evaluaciones').update({ estado: 'corregida', motivo_cambio: null }).eq('id', id);
    expect(corregir.error?.code).toBe('23514');
    const anular = await ctx.admin.from('evaluaciones').update({ estado: 'anulada', motivo_cambio: null }).eq('id', id);
    expect(anular.error?.code).toBe('23514');
    const reabrir = await ctx.admin.from('evaluaciones').update({ estado: 'borrador', motivo_cambio: null }).eq('id', id);
    expect(reabrir.error).toBeNull();
  });

  it('reabrir una completa (admin, sin motivo) deja que el autor cambie los valores y la vuelva a cerrar como completa, sin rastro de corrección', async () => {
    const id = await evaluacionEn('completa'); // brix 14
    const reabrir = await ctx.admin.from('evaluaciones').update({ estado: 'borrador' }).eq('id', id);
    expect(reabrir.error).toBeNull();

    const autor = await ctx.operario.from('evaluaciones').update({ brix: 18, ...camposCompletaConMuestra() }).eq('id', id).select('estado, brix, motivo_cambio').single();
    expect(autor.error).toBeNull();
    expect(autor.data).toEqual({ estado: 'completa', brix: 18, motivo_cambio: null });
    const final = await leer(id);
    expect(final.estado).toBe('completa'); // nunca figuró como 'corregida'
    const estados = await ctx.service
      .from('audit_log')
      .select('detalle')
      .eq('accion', 'cambio_estado_evaluacion')
      .eq('detalle->>evaluacion_id', id)
      .order('id');
    expect((estados.data ?? []).map((f) => `${f.detalle.estado_anterior}->${f.detalle.estado_nuevo}`)).toEqual(['completa->borrador', 'borrador->completa']);
    expect((estados.data ?? []).every((f) => f.detalle.motivo === null)).toBe(true);
  });

  it.fails('reabrir una evaluación cerrada debería exigir motivo, como corregir y anular (A1-G5-05)', async () => {
    const id = await evaluacionEn('completa');
    const { error } = await ctx.admin.from('evaluaciones').update({ estado: 'borrador', motivo_cambio: null }).eq('id', id);
    expect(error).not.toBeNull();
  });
});

describe('A1-G5-18 — el mismo autor en dos dispositivos (formulario desactualizado)', () => {
  it('last-write-wins: el dispositivo B, con un valor viejo en pantalla, pisa sin aviso lo que guardó el dispositivo A', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', estado: 'borrador', created_by: ctx.operarioId, brix: 12 })
      .select('id')
      .single();
    // Dispositivo A corrige el Brix a 15.
    await ctx.operario.from('evaluaciones').update({ brix: 15 }).eq('id', borrador!.id);
    // Dispositivo B cargó el borrador antes (brix 12) y guarda el formulario completo.
    const b = await ctx.operario.from('evaluaciones').update({ brix: 12, firmeza: 3 }).eq('id', borrador!.id).select('brix, firmeza').single();
    expect(b.error).toBeNull();
    expect(Number((await leer(borrador!.id)).brix)).toBe(12); // el 15 de A se perdió (queda solo en audit_log)
  });

  it('si A ya cerró la evaluación, el guardado de B afecta 0 filas y .single() responde PGRST116 (la app lo muestra como «código PGRST116»)', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', estado: 'borrador', created_by: ctx.operarioId })
      .select('id')
      .single();
    await ctx.operario.from('evaluaciones').update({ ...camposCompletaConMuestra() }).eq('id', borrador!.id);
    const b = await ctx.operario.from('evaluaciones').update({ brix: 13 }).eq('id', borrador!.id).select('*').single();
    expect(b.error?.code).toBe('PGRST116');
  });
});
