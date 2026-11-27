/**
 * G5 / E02-E03 — Guardar evaluación (borrador, visita parcial, completa) y
 * cerrarla.
 *
 * Verificado contra la base local con usuarios reales:
 * - validación en el servidor (anio derivado, requiere_revision recalculado,
 *   rangos técnicos, muestra obligatoria al cerrar, cierre parcial permitido);
 * - idempotencia real: misma clave y distinto contenido (la segunda escritura
 *   se descarta en silencio, A1-G5-07);
 * - continuar un borrador: un valor vaciado en el formulario no se guarda
 *   porque supabase-js omite las claves `undefined` (A1-G5-04, `it.fails`);
 * - el autor puede mover su borrador a OTRA ronda, incluso de un individuo
 *   muerto, y cerrarla ahí (A1-G5-02, `it.fails`);
 * - dos autores en la misma ronda: el segundo queda bloqueado (A1-G5-06);
 * - anular el propio borrador exige motivo; el autor no corrige ni reabre;
 * - ligadura de la ronda a la versión de scoring según la fecha de la
 *   primera evaluación cerrada (una fecha anterior a toda vigencia deja la
 *   ronda sin versión hasta el siguiente cierre).
 */
import { iniciarRondaAnual } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  camposCompletaConMuestra,
  crearCruce,
  crearIndividuo,
  crearRondaServicio,
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
  ctx = await prepararContexto('eval');
  cruce = await crearCruce(ctx, 'EVAL', 'evaluacion_anual');
  plantas.push(cruce);
}, 60_000);

afterAll(async () => {
  await purgarCruces(ctx, plantas);
});

/** Individuo nuevo con su ronda 1 creada por la RPC (camino real de la app). */
async function rondaNueva(): Promise<{ individuo: string; ronda: string }> {
  const individuo = await crearIndividuo(ctx, cruce, `EVAL-${++n}`);
  const { data, error } = await iniciarRondaAnual(ctx.operario, individuo);
  if (error) throw new Error(`setup ronda: ${error.message}`);
  return { individuo, ronda: (data as { ronda_id: string }).ronda_id };
}

async function leer(evaluacionId: string) {
  const { data, error } = await ctx.service.from('evaluaciones').select('*').eq('id', evaluacionId).single();
  if (error) throw error;
  return data;
}

async function versionDeRonda(rondaId: string): Promise<string | null> {
  const { data } = await ctx.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', rondaId).single();
  return (data?.scoring_version_id as string | null) ?? null;
}

describe('E02 — validación en el servidor', () => {
  it('anio se deriva de fecha aunque el cliente mande otro', async () => {
    const { ronda } = await rondaNueva();
    const { data, error } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2025-03-01', anio: 2030, estado: 'borrador', created_by: ctx.operarioId })
      .select('anio')
      .single();
    expect(error).toBeNull();
    expect(data!.anio).toBe(2025);
  });

  it('requiere_revision lo calcula el servidor con rango_referencia (calibre >= 40) y pisa lo que mande el cliente', async () => {
    const { ronda } = await rondaNueva();
    const { data, error } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, calibre_mm: 45, requiere_revision: false })
      .select('id, requiere_revision')
      .single();
    expect(error).toBeNull();
    expect(data!.requiere_revision).toBe(true);

    const { data: normal } = await ctx.operario
      .from('evaluaciones')
      .update({ calibre_mm: 20 })
      .eq('id', data!.id)
      .select('requiere_revision')
      .single();
    expect(normal!.requiere_revision).toBe(false);
  });

  it('rechaza valores negativos, fuera de 1-5 y porcentaje > 100 aunque el cliente no valide', async () => {
    const { ronda } = await rondaNueva();
    const casos: Array<Record<string, unknown>> = [
      { brix: -1 },
      { cantidad_frutos: -3 },
      { firmeza: 6 },
      { pct_fruta_exportable: 101 },
      { n_varas_basales: -1 },
      { fecha_inicio_floracion: '1999-12-31' },
    ];
    for (const caso of casos) {
      const { error } = await ctx.operario
        .from('evaluaciones')
        .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, ...caso });
      expect(error?.code, JSON.stringify(caso)).toBe('23514');
    }
  });

  it('los campos calculados (peso_promedio_g, pct_flores, pct_frutos) son columnas generadas: no se pueden escribir', async () => {
    const { ronda } = await rondaNueva();
    const { error } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, cantidad_frutos: 10, peso_total_g: 100, peso_promedio_g: 999 });
    // 428C9 = generated_always; Postgres rechaza el valor explícito.
    expect(error?.code).toBe('428C9');

    const { data } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, cantidad_frutos: 10, peso_total_g: 100, n_varas_basales: 4, n_varas_con_flor: 1 })
      .select('peso_promedio_g, pct_flores, pct_frutos')
      .single();
    expect(Number(data!.peso_promedio_g)).toBe(10);
    expect(Number(data!.pct_flores)).toBe(25);
    expect(data!.pct_frutos).toBeNull();
  });

  it('cerrar con muestra exige cantidad y peso > 0; sin muestra se puede cerrar una visita parcial sin ningún descriptor', async () => {
    const { ronda } = await rondaNueva();
    // Fase 2 (regla de frutos): la exigencia nace de un dato de fruta (brix).
    const sinFrutos = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'completa', brix: 12, created_by: ctx.operarioId });
    expect(sinFrutos.error?.code).toBe('23514');
    expect(sinFrutos.error?.message).toContain('cantidad de frutos');

    const parcial = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'completa', sin_muestra: true, created_by: ctx.operarioId })
      .select('id, estado')
      .single();
    expect(parcial.error).toBeNull();
    expect(parcial.data!.estado).toBe('completa');
  });

  it('cerrar con muestra permite cantidad o peso en cero cuando sin_muestra = true aunque haya datos de muestra', async () => {
    // Caso raro documentado: sin_muestra = true desactiva la exigencia pero
    // no borra la tripleta, y la unificación la tomaría igual.
    const { ronda } = await rondaNueva();
    const { data, error } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'completa', sin_muestra: true, cantidad_frutos: 5, peso_total_g: 30, created_by: ctx.operarioId })
      .select('cantidad_frutos')
      .single();
    expect(error).toBeNull();
    expect(data!.cantidad_frutos).toBe(5);
  });

  it.fails('debería rechazar una fecha futura (EVECL ya lo hace con evecl_ficha_fecha_chk) (A1-G5-12)', async () => {
    const { ronda } = await rondaNueva();
    const { error } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2099-01-01', estado: 'borrador', created_by: ctx.operarioId });
    expect(error).not.toBeNull();
  });

  it('anon no inserta ni lee evaluaciones', async () => {
    const { ronda } = await rondaNueva();
    const { error } = await ctx.anon.from('evaluaciones').insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador' });
    expect(error).not.toBeNull();
    const { data, error: errLectura } = await ctx.anon.from('evaluaciones').select('id').limit(1);
    expect(errLectura ?? (data ?? []).length === 0).toBeTruthy();
  });
});

describe('E02 — idempotencia (misma clave, distinto contenido)', () => {
  it('el segundo INSERT con la misma idempotency_key falla con 23505 y la fila conserva el PRIMER contenido', async () => {
    const { ronda } = await rondaNueva();
    const clave = crypto.randomUUID();
    const primero = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, brix: 12, idempotency_key: clave })
      .select('id')
      .single();
    expect(primero.error).toBeNull();

    // Reintento tras un «éxito con respuesta perdida», pero el usuario ya
    // había cambiado brix antes de reintentar.
    const segundo = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, brix: 15, idempotency_key: clave })
      .select('id')
      .single();
    expect(segundo.error?.code).toBe('23505');
    expect(segundo.error?.message).toContain('evaluaciones_idempotency_key_key');

    // Esto es lo que crearEvaluacion() devuelve como «éxito»: la fila vieja.
    const { data: existente } = await ctx.operario.from('evaluaciones').select('id, brix').eq('idempotency_key', clave).single();
    expect(existente!.id).toBe(primero.data!.id);
    expect(Number(existente!.brix)).toBe(12); // el 15 se perdió sin aviso (A1-G5-07)
  });
});

describe('E02 — continuar un borrador', () => {
  it.fails('vaciar un descriptor en el formulario debería dejarlo en null al guardar (A1-G5-04)', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, brix: 12, firmeza: 4, evaluador: 'Ana' })
      .select('id')
      .single();

    // Payload exacto que arma EvaluacionForm.tsx (mutationFn, líneas 351-388)
    // cuando el usuario vació brix, firmeza y evaluador y pulsó «Finalizar»:
    // `numeroONull('') ?? undefined` y `d.firmeza` (undefined tras des-seleccionar).
    const cambios = {
      fecha: '2026-03-01',
      estado: 'completa',
      sin_muestra: true,
      evaluador: undefined,
      brix: undefined,
      firmeza: undefined,
    };
    const { data: cerrada, error } = await ctx.operario
      .from('evaluaciones')
      .update(cambios)
      .eq('id', borrador!.id)
      .select('estado, brix, firmeza, evaluador')
      .single();
    expect(error).toBeNull();
    expect(cerrada!.estado).toBe('completa');
    expect(cerrada!.brix).toBeNull();
    expect(cerrada!.firmeza).toBeNull();
    expect(cerrada!.evaluador).toBeNull();
  });

  it('documenta el estado actual: las claves undefined no viajan y los valores viejos quedan en la evaluación cerrada', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, brix: 12, firmeza: 4 })
      .select('id')
      .single();
    const { data: cerrada } = await ctx.operario
      .from('evaluaciones')
      .update({ estado: 'completa', sin_muestra: true, brix: undefined, firmeza: undefined })
      .eq('id', borrador!.id)
      .select('estado, brix, firmeza')
      .single();
    expect(cerrada).toEqual({ estado: 'completa', brix: 12, firmeza: 4 });
  });

  it('el autor puede corregir un valor de su borrador mandando null explícito (la base sí lo acepta)', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, brix: 12 })
      .select('id')
      .single();
    const { data } = await ctx.operario.from('evaluaciones').update({ brix: null }).eq('id', borrador!.id).select('brix').single();
    expect(data!.brix).toBeNull();
  });
});

describe('E02 — el borrador puede cambiar de ronda (policy de UPDATE sin fijar ronda_id)', () => {
  // A1-058 corregido en la Fase 2 (20261023110000): ronda_id es inmutable.
  it('rechaza mover un borrador a la ronda de otro individuo (A1-G5-02 / A1-058)', async () => {
    const origen = await rondaNueva();
    const destino = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: origen.ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId })
      .select('id')
      .single();
    const { error } = await ctx.operario.from('evaluaciones').update({ ronda_id: destino.ronda }).eq('id', borrador!.id);
    expect(error).not.toBeNull();
  });

  it('A1-140: el borrador no se puede mover a la ronda de un individuo MUERTO (42501) y queda en su ronda de origen', async () => {
    const origen = await rondaNueva();
    const destino = await rondaNueva();
    await darDeBaja(ctx, destino.individuo);

    // Insertar directo en la ronda del muerto está bloqueado por la policy de INSERT...
    const directo = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: destino.ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId });
    expect(directo.error?.code).toBe('42501');

    // ...y desde A1-140 moverlo por UPDATE tampoco.
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: origen.ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId })
      .select('id')
      .single();
    const movido = await ctx.operario
      .from('evaluaciones')
      .update({ ronda_id: destino.ronda, ...camposCompletaConMuestra() })
      .eq('id', borrador!.id)
      .select('ronda_id, estado')
      .single();
    // Desde A1-058 (Fase 2) lo rechaza antes la inmutabilidad de ronda_id (23514).
    expect(['42501', '23514']).toContain(movido.error?.code);
    const { data: intacto } = await ctx.service.from('evaluaciones').select('ronda_id, estado').eq('id', borrador!.id).single();
    expect(intacto).toEqual({ ronda_id: origen.ronda, estado: 'borrador' });
  });
});

describe('E02 — dos autores sobre la misma ronda', () => {
  it('el segundo autor no puede crear otro borrador (índice único) ni continuar/descartar el ajeno (RLS): queda bloqueado (A1-G5-06)', async () => {
    const { ronda } = await rondaNueva();
    const { data: borradorA } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId, brix: 12 })
      .select('id')
      .single();

    const propio = await ctx.operario2
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-02', estado: 'borrador', created_by: ctx.operario2Id });
    expect(propio.error?.code).toBe('23505');
    expect(propio.error?.message).toContain('evaluaciones_un_borrador_activo_por_ronda_uidx');

    // «Continuar borrador» del formulario: el UPDATE no alcanza la fila (USING
    // created_by = auth.uid()) y PostgREST devuelve PGRST116 con .single().
    const continuar = await ctx.operario2.from('evaluaciones').update({ brix: 13 }).eq('id', borradorA!.id).select('*').single();
    expect(continuar.error?.code).toBe('PGRST116');
    const descartar = await ctx.operario2
      .from('evaluaciones')
      .update({ estado: 'anulada', motivo_cambio: 'Borrador descartado por el autor' })
      .eq('id', borradorA!.id)
      .select('*')
      .single();
    expect(descartar.error?.code).toBe('PGRST116');
    expect((await leer(borradorA!.id)).brix).toBe(12);

    // Lo único que el segundo autor sí puede hacer, y la UI no ofrece: cerrar
    // una visita directamente como completa.
    const completaB = await ctx.operario2
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-02', created_by: ctx.operario2Id, ...camposCompletaConMuestra() })
      .select('id')
      .single();
    expect(completaB.error).toBeNull();
  });
});

describe('E03 — cierre, anulación del propio borrador y límites del autor', () => {
  it('anular el propio borrador exige motivo y queda auditado con el motivo', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId })
      .select('id')
      .single();
    const sinMotivo = await ctx.operario.from('evaluaciones').update({ estado: 'anulada' }).eq('id', borrador!.id);
    expect(sinMotivo.error?.code).toBe('23514');
    const conMotivo = await ctx.operario
      .from('evaluaciones')
      .update({ estado: 'anulada', motivo_cambio: 'Borrador descartado por el autor' })
      .eq('id', borrador!.id)
      .select('estado')
      .single();
    expect(conMotivo.data!.estado).toBe('anulada');
    const fila = await ultimoAudit(ctx, 'cambio_estado_evaluacion', 'evaluacion_id', borrador!.id);
    expect(fila.usuario_id).toBe(ctx.operarioId);
    expect(fila.detalle).toMatchObject({ estado_anterior: 'borrador', estado_nuevo: 'anulada', motivo: 'Borrador descartado por el autor' });
  });

  it('el autor no puede pasar su borrador a corregida ni crear una corregida/anulada de cero', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId })
      .select('id')
      .single();
    const corregir = await ctx.operario
      .from('evaluaciones')
      .update({ estado: 'corregida', motivo_cambio: 'x', sin_muestra: true })
      .eq('id', borrador!.id);
    expect(corregir.error?.code).toBe('42501');
    const deCero = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'anulada', motivo_cambio: 'x', created_by: ctx.operarioId });
    expect(deCero.error?.code).toBe('42501');
  });

  it('cerrada la evaluación, el autor ya no la toca (ni valores ni volver a borrador): el UPDATE no alcanza la fila', async () => {
    const { ronda } = await rondaNueva();
    const { data: cerrada } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', created_by: ctx.operarioId, brix: 12, ...camposCompletaConMuestra() })
      .select('id')
      .single();
    const { data, error } = await ctx.operario.from('evaluaciones').update({ brix: 13 }).eq('id', cerrada!.id).select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    const reabrir = await ctx.operario.from('evaluaciones').update({ estado: 'borrador' }).eq('id', cerrada!.id).select('id');
    expect(reabrir.data).toHaveLength(0);
    expect(Number((await leer(cerrada!.id)).brix)).toBe(12);
  });

  it('cerrar deja creacion_evaluacion (sin valores) y, si fue por UPDATE, cambio_estado_evaluacion + edicion_evaluacion con valores', async () => {
    const { ronda } = await rondaNueva();
    const { data: borrador } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-03-01', estado: 'borrador', created_by: ctx.operarioId })
      .select('id')
      .single();
    const creacion = await ultimoAudit(ctx, 'creacion_evaluacion', 'evaluacion_id', borrador!.id);
    expect(creacion.usuario_id).toBe(ctx.operarioId);
    expect(creacion.detalle.cambios).toBeUndefined();

    await ctx.operario.from('evaluaciones').update({ brix: 14, ...camposCompletaConMuestra() }).eq('id', borrador!.id);
    const estado = await ultimoAudit(ctx, 'cambio_estado_evaluacion', 'evaluacion_id', borrador!.id);
    expect(estado.detalle).toMatchObject({ estado_anterior: 'borrador', estado_nuevo: 'completa' });
    const edicion = await ultimoAudit(ctx, 'edicion_evaluacion', 'evaluacion_id', borrador!.id);
    expect(edicion.detalle.cambios.brix).toEqual({ anterior: null, nuevo: 14 });
    expect(edicion.detalle.cambios.estado).toEqual({ anterior: 'borrador', nuevo: 'completa' });
  });
});

describe('E03 — ligadura de la ronda a la versión de scoring', () => {
  it('una evaluación cerrada con fecha anterior a toda vigencia deja la ronda SIN versión; el siguiente cierre con fecha vigente la liga', async () => {
    const { ronda } = await rondaNueva();
    const vieja = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2025-06-01', created_by: ctx.operarioId, ...camposCompletaConMuestra() })
      .select('id')
      .single();
    expect(vieja.error).toBeNull();
    expect(await versionDeRonda(ronda)).toBeNull();

    const nueva = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', created_by: ctx.operarioId, ...camposCompletaConMuestra() })
      .select('id')
      .single();
    expect(nueva.error).toBeNull();
    const version = await versionDeRonda(ronda);
    expect(version).not.toBeNull();
    const { data: sv } = await ctx.service.from('scoring_version').select('vigente_desde, especie_id').eq('id', version!).single();
    expect(sv!.vigente_desde <= '2026-06-01').toBe(true);
  });

  it('la ligadura se fija una sola vez: anular o corregir después no la mueve, y el ranking por cruce la respeta', async () => {
    const { ronda, individuo } = await rondaNueva();
    const { data: cerrada } = await ctx.operario
      .from('evaluaciones')
      .insert({ ronda_id: ronda, fecha: '2026-06-01', created_by: ctx.operarioId, ...camposCompletaConMuestra() })
      .select('id')
      .single();
    const version = await versionDeRonda(ronda);
    expect(version).not.toBeNull();
    await ctx.admin.from('evaluaciones').update({ estado: 'anulada', motivo_cambio: 'prueba' }).eq('id', cerrada!.id);
    expect(await versionDeRonda(ronda)).toBe(version);

    const { data: scoring, error } = await ctx.operario.rpc('obtener_scoring_planta', { p_planta_id: cruce });
    expect(error).toBeNull();
    const fila = (scoring as Array<Record<string, unknown>>).find((f) => f.individuo_id === individuo);
    // Con la única evaluación anulada, el individuo vuelve a «sin evaluación completa».
    expect(fila?.motivo_exclusion).toBe('sin_evaluacion_completa_en_ronda_actual');
  });
});
