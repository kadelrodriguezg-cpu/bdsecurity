/**
 * Purga irreversible de cruces de prueba — verificación EMPÍRICA contra la
 * base local (migraciones 20260907000000 y 20260907001000).
 *
 * Nada acá se da por bueno por diseño: cada puerta se prueba invocando el RPC
 * real como un usuario real, y el estado post-purga se comprueba con queries
 * directas tabla por tabla. Es el mismo criterio del invariante 11 del
 * documento maestro ("verificación por evidencia real").
 *
 * Lo que se cubre:
 *   - PUERTA 1: un cruce real (es_prueba = false) no se purga ni siendo admin.
 *   - `es_prueba` no es actualizable desde la API: no hay forma de re-marcar
 *     un cruce real para saltarse la puerta 1.
 *   - PUERTA 2: un cruce de prueba con evaluaciones terminadas se rechaza.
 *   - Purga exitosa: cero filas huérfanas en TODAS las tablas relacionadas.
 *   - audit_log: entrada completa, escrita antes del DELETE y sobreviviente
 *     al SET NULL de su propia FK.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';

let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let especieId: string;

const R = Date.now();

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ad = await crearUsuarioDePrueba(creds, service, { email: 'admin@test.local', rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;

  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  especieId = esp.id;
});

/** Crea un cruce con un individuo y una ronda; devuelve los ids para verificar después. */
async function crearCruce(sufijo: string, esPrueba: boolean) {
  const codigo = `PURGA-${sufijo}-${R}`;
  const { data: planta, error: errPlanta } = await service
    .from('plantas')
    .insert({ codigo_sistema: codigo, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: esPrueba })
    .select('id, es_prueba')
    .single();
  if (errPlanta || !planta) throw new Error(`setup planta ${codigo}: ${errPlanta?.message}`);

  const { data: individuo, error: errInd } = await service
    .from('individuos')
    .insert({ planta_id: planta.id, codigo_display: `${codigo}-P01`, created_by: adminId })
    .select('id')
    .single();
  if (errInd || !individuo) throw new Error(`setup individuo ${codigo}: ${errInd?.message}`);

  const { data: ronda, error: errRonda } = await service
    .from('ronda_evaluacion_anual')
    .insert({ individuo_id: individuo.id, numero_ronda: 1, anio: 2026, created_by: adminId })
    .select('id')
    .single();
  if (errRonda || !ronda) throw new Error(`setup ronda ${codigo}: ${errRonda?.message}`);

  return { codigo, plantaId: planta.id as string, individuoId: individuo.id as string, rondaId: ronda.id as string };
}

/**
 * Inserta una evaluación en el estado pedido. 'anulada' y 'corregida' pasan
 * por un trigger que exige un admin real (service_role no tiene auth.uid(),
 * así que `es_admin()` le da false) — por eso el cliente es parametrizable.
 */
async function crearEvaluacion(
  rondaId: string,
  estado: 'borrador' | 'completa' | 'anulada',
  cliente: SupabaseClient = service,
) {
  const { data, error } = await cliente
    .from('evaluaciones')
    .insert({
      ronda_id: rondaId, fecha: '2026-09-07', estado, created_by: adminId,
      // El trigger de corrección/anulación exige motivo; para 'borrador' y
      // 'completa' la columna simplemente queda sin usar.
      motivo_cambio: estado === 'anulada' ? 'Anulada en test de purga' : null,
      brotacion: 1, floracion: 1, cuaja: 1, concentracion_cosecha: 1, calibre_mm: 18, firmeza: 1, color: 1,
      bloom: 1, brix: 12, rend_kg_planta: 1, rend_t_ha: 1, pct_fruta_exportable: 50, dano_calor: 1, golpe_sol: 1,
      caida_fruto: 1, cantidad_frutos: 5, peso_total_g: 50,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup evaluacion: ${error?.message}`);
  return data.id as string;
}

describe('PUERTA 1 — la purga no existe para cruces reales', () => {
  it('admin NO puede purgar un cruce con es_prueba = false, y el cruce queda intacto', async () => {
    const { plantaId, individuoId, codigo } = await crearCruce('REAL', false);

    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/no está marcado como cruce de prueba/i);
    expect(error!.message).toContain(codigo);

    // Nada a medio camino: ni la planta, ni el individuo, ni una traza de
    // borrado en el audit_log (el INSERT vive en la misma transacción).
    const { data: plantaSigue } = await service.from('plantas').select('id, eliminado_at').eq('id', plantaId).single();
    expect(plantaSigue!.eliminado_at).toBeNull();
    const { data: individuoSigue } = await service.from('individuos').select('id').eq('id', individuoId).maybeSingle();
    expect(individuoSigue).toBeTruthy();
    const { data: auditoria } = await service
      .from('audit_log').select('id').eq('planta_id', plantaId).ilike('accion', 'borrado_cruzamiento%');
    expect(auditoria).toHaveLength(0);

    // Archivar sigue disponible: es la vía correcta para un cruce real.
    const { error: errSoft } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'soft' });
    expect(errSoft).toBeNull();
  });

  it('un admin NO puede re-marcar un cruce real como prueba para saltarse la puerta', async () => {
    const { plantaId } = await crearCruce('NOUPDATE', false);

    // Sin grant de UPDATE sobre la columna, el intento no puede prosperar.
    const { error } = await admin.from('plantas').update({ es_prueba: true }).eq('id', plantaId).select('id');
    expect(error).toBeTruthy();

    const { data: sigue } = await service.from('plantas').select('es_prueba').eq('id', plantaId).single();
    expect(sigue!.es_prueba).toBe(false);
  });
});

describe('PUERTA 2 — evaluaciones con datos reales bloquean la purga', () => {
  it('rechaza con mensaje claro un cruce de prueba con una evaluación completa', async () => {
    const { plantaId, rondaId, individuoId } = await crearCruce('EVALREAL', true);
    const evaluacionId = await crearEvaluacion(rondaId, 'completa');

    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/1 evaluación\(es\) terminada\(s\)/i);
    expect(error!.message).toMatch(/datos reales/i);

    // La evaluación y todo lo que cuelga siguen ahí, sin tocar.
    const { data: evalSigue } = await service.from('evaluaciones').select('id').eq('id', evaluacionId).maybeSingle();
    expect(evalSigue).toBeTruthy();
    const { data: individuoSigue } = await service.from('individuos').select('id').eq('id', individuoId).maybeSingle();
    expect(individuoSigue).toBeTruthy();
    const { data: auditoria } = await service
      .from('audit_log').select('id').eq('planta_id', plantaId).ilike('accion', 'borrado_cruzamiento%');
    expect(auditoria).toHaveLength(0);
  });

  it('una evaluación en borrador o anulada NO bloquea: no son dato científico vivo', async () => {
    const { plantaId, rondaId } = await crearCruce('EVALBORRADOR', true);
    await crearEvaluacion(rondaId, 'borrador');
    await crearEvaluacion(rondaId, 'anulada', admin);

    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });
    expect(error).toBeNull();
  });
});

describe('purga exitosa — cero huérfanos y auditoría completa', () => {
  it('borra el cruce y TODO lo que colgaba de él, verificado tabla por tabla', async () => {
    const { plantaId, individuoId, rondaId, codigo } = await crearCruce('OK', true);
    const evaluacionId = await crearEvaluacion(rondaId, 'borrador');

    // Se cuelga del cruce una fila de cada tabla que el DELETE en cascada
    // debe alcanzar, para que "cero huérfanos" signifique algo.
    const { data: proc } = await service
      .from('procedimientos')
      .insert({ nombre: `PURGA proc ${R}`, tipo: 'poda', fecha_inicio: '2026-09-07', estado: 'planificado', responsable_id: adminId, created_by: adminId })
      .select('id').single();
    await service.from('procedimiento_objetivos').insert({ procedimiento_id: proc!.id, tipo: 'cruzamiento', planta_id: plantaId });

    const { data: scoringVersion } = await service.from('scoring_version').select('id').limit(1).single();
    const { data: snapshot } = await service
      .from('ranking_snapshot')
      .insert({
        nombre: `PURGA snapshot ${R}`, alcance: 'cruzamiento', planta_id: plantaId, especie_id: especieId,
        scoring_version_id: scoringVersion!.id, poblacion_comparada: 1, criterios: [], created_by: adminId,
      })
      .select('id').single();
    await service.from('ranking_snapshot_resultado').insert({
      snapshot_id: snapshot!.id, individuo_id: individuoId, codigo_display: `${codigo}-P01`,
      evaluacion_id: evaluacionId, posicion: 1, puntaje: 0.5, detalle: {},
    });

    await service.from('registros_evento').insert({ planta_id: plantaId, tipo: 'polinizacion', fecha: '2026-09-07', datos: {}, created_by: adminId });
    await service.from('polinizacion_evento').insert({ planta_id: plantaId, fecha: '2026-09-07', n_flores_cruzadas: 12, created_by: adminId });

    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });
    expect(error).toBeNull();

    // --- Cero huérfanos, comprobado con query directa, no por diseño. ---
    const vacio = async (tabla: string, columna: string, valor: string) => {
      const { data, error: err } = await service.from(tabla).select('*', { count: 'exact' }).eq(columna, valor);
      expect(err, `${tabla}: ${err?.message}`).toBeNull();
      return data ?? [];
    };

    expect(await vacio('plantas', 'id', plantaId)).toHaveLength(0);
    expect(await vacio('individuos', 'planta_id', plantaId)).toHaveLength(0);
    expect(await vacio('individuos', 'id', individuoId)).toHaveLength(0);
    expect(await vacio('ronda_evaluacion_anual', 'individuo_id', individuoId)).toHaveLength(0);
    expect(await vacio('evaluaciones', 'ronda_id', rondaId)).toHaveLength(0);
    expect(await vacio('pcr_analisis', 'ronda_id', rondaId)).toHaveLength(0);
    expect(await vacio('multisitio', 'individuo_id', individuoId)).toHaveLength(0);
    expect(await vacio('baja_motivo', 'individuo_id', individuoId)).toHaveLength(0);
    expect(await vacio('evaluacion_reducida', 'individuo_id', individuoId)).toHaveLength(0);
    expect(await vacio('ranking_snapshot_resultado', 'individuo_id', individuoId)).toHaveLength(0);
    expect(await vacio('procedimiento_objetivos', 'planta_id', plantaId)).toHaveLength(0);
    expect(await vacio('procedimiento_objetivos', 'individuo_id', individuoId)).toHaveLength(0);
    expect(await vacio('registros_evento', 'planta_id', plantaId)).toHaveLength(0);
    expect(await vacio('germinacion_evento', 'planta_id', plantaId)).toHaveLength(0);
    expect(await vacio('cosecha_fruto', 'planta_id', plantaId)).toHaveLength(0);
    expect(await vacio('polinizacion_evento', 'planta_id', plantaId)).toHaveLength(0);
    expect(await vacio('procedimiento_cultivo', 'planta_id', plantaId)).toHaveLength(0);
    expect(await vacio('emplazamiento_individuo', 'individuo_id', individuoId)).toHaveLength(0);

    // La cabecera del snapshot y el procedimiento NO se tocan: pueden ser
    // compartidos con otros cruces. Son referencias legítimas, no huérfanos.
    const { data: cabecera } = await service.from('ranking_snapshot').select('id').eq('id', snapshot!.id).maybeSingle();
    expect(cabecera).toBeTruthy();
    const { data: procSigue } = await service.from('procedimientos').select('id').eq('id', proc!.id).maybeSingle();
    expect(procSigue).toBeTruthy();
  });

  it('deja en audit_log el detalle completo de la purga, y sobrevive al SET NULL de su propia FK', async () => {
    const { plantaId, codigo } = await crearCruce('AUDIT', true);

    const { error } = await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });
    expect(error).toBeNull();

    // audit_log.planta_id es FK ON DELETE SET NULL: tras la purga la columna
    // queda vacía, así que la entrada se busca por el detalle, que es
    // justamente donde se guardó el código y el id.
    const { data: entradas, error: errAudit } = await service
      .from('audit_log')
      .select('usuario_id, planta_id, accion, ocurrido_en, detalle')
      .eq('accion', 'borrado_cruzamiento_hard')
      .contains('detalle', { codigo_sistema: codigo });
    expect(errAudit).toBeNull();
    expect(entradas).toHaveLength(1);

    const entrada = entradas![0];
    expect(entrada.planta_id).toBeNull(); // el SET NULL ya ocurrió
    expect(entrada.usuario_id).toBe(adminId); // quién
    expect(entrada.ocurrido_en).toBeTruthy(); // cuándo
    const detalle = entrada.detalle as Record<string, unknown>;
    expect(detalle.planta_id).toBe(plantaId); // qué cruce, pese al SET NULL
    expect(detalle.codigo_sistema).toBe(codigo);
    expect(detalle.es_prueba).toBe(true);
    expect(detalle.tipo_borrado).toBe('hard');
    expect(detalle.n_individuos).toBe(1); // cuánto se llevó
    expect(detalle.n_rondas).toBe(1);
    expect(detalle.n_evaluaciones).toBe(0);
  });
});

describe('plantas_operativas — la vista expone la marca para poder filtrar', () => {
  it('devuelve es_prueba y permite excluir los cruces de prueba', async () => {
    const { plantaId } = await crearCruce('VISTA', true);

    const { data: conPruebas, error } = await admin
      .from('plantas_operativas').select('id, es_prueba').eq('id', plantaId);
    expect(error).toBeNull();
    expect(conPruebas).toHaveLength(1);
    expect(conPruebas![0].es_prueba).toBe(true);

    const { data: sinPruebas } = await admin
      .from('plantas_operativas').select('id').eq('id', plantaId).eq('es_prueba', false);
    expect(sinPruebas).toHaveLength(0);
  });
});

afterAll(async () => {
  // Limpieza: los cruces que quedaron en pie (los que la purga rechazó a
  // propósito) se borran con service_role para no dejar residuo acumulándose
  // entre corridas, que es lo que ensuciaba la base antes.
  const { data: restantes } = await service.from('plantas').select('id').like('codigo_sistema', `PURGA-%-${R}`);
  for (const planta of restantes ?? []) {
    await service.from('audit_log').delete().eq('planta_id', planta.id);
    const { data: inds } = await service.from('individuos').select('id').eq('planta_id', planta.id);
    const ids = (inds ?? []).map((i) => i.id);
    if (ids.length > 0) {
      const { data: rondas } = await service.from('ronda_evaluacion_anual').select('id').in('individuo_id', ids);
      const rondaIds = (rondas ?? []).map((r) => r.id);
      if (rondaIds.length > 0) await service.from('evaluaciones').delete().in('ronda_id', rondaIds);
      await service.from('ronda_evaluacion_anual').delete().in('individuo_id', ids);
      await service.from('individuos').delete().in('planta_id', [planta.id]);
    }
    await service.from('registros_evento').delete().eq('planta_id', planta.id);
    await service.from('plantas').delete().eq('id', planta.id);
  }
});
