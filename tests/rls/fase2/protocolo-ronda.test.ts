// Fase 2, Sprint 1 — protocolo de ronda, congelado por evaluación y 4 estados
// (20261023110000_fase2_protocolo_ronda.sql).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';
import { limpiarPrueba } from '../limpieza-pruebas';

describe('protocolo de ronda y estados por descriptor (Fase 2)', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let operario2: SupabaseClient;
  let admin: SupabaseClient;
  let operarioId: string;
  let operario2Id: string;
  const plantasCreadas: string[] = [];
  let plantaId: string;
  let otraPlantaId: string;
  let secuencia = 0;
  const sufijo = Date.now();

  async function crearPlanta(codigo: string): Promise<string> {
    const { data: esp } = await service.from('especies').select('id').limit(1).single();
    const { data, error } = await service.from('plantas')
      .insert({ codigo_sistema: codigo, especie_id: esp!.id, estado: 'evaluacion_anual', es_prueba: true }).select('id').single();
    if (error || !data) throw error ?? new Error('No se creó la planta');
    plantasCreadas.push(data.id as string);
    return data.id as string;
  }

  async function rondaNueva(planta = plantaId): Promise<{ ronda: string; individuo: string }> {
    secuencia += 1;
    const { data: ind, error: e1 } = await service.from('individuos').insert({
      planta_id: planta, codigo_display: 'GENERADO-POR-TRIGGER',
      fecha_individualizacion: `2027-01-${String((secuencia % 28) + 1).padStart(2, '0')}`, created_by: operarioId,
    }).select('id').single();
    if (e1 || !ind) throw e1 ?? new Error('No se creó el individuo');
    const { data: ronda, error: e2 } = await service.from('ronda_evaluacion_anual').insert({
      individuo_id: ind.id, numero_ronda: 1, anio: 2027, fecha_inicio: '2027-01-01', created_by: operarioId,
    }).select('id').single();
    if (e2 || !ronda) throw e2 ?? new Error('No se creó la ronda');
    return { ronda: ronda.id as string, individuo: ind.id as string };
  }

  const definir = (cliente: SupabaseClient, descriptores: unknown, planta = plantaId, nombre = 'Protocolo de prueba') =>
    cliente.rpc('definir_protocolo_ronda', {
      p_planta_id: planta, p_tipo_ronda: 'anual', p_numero_ronda: 1, p_nombre: nombre, p_descriptores: descriptores,
    });

  beforeAll(async () => {
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const u = await crearUsuarioDePrueba(creds, service, { email: `protocolo-op-${sufijo}@test.local`, rol: 'operario' });
    operario = u.client;
    operarioId = u.userId;
    const u2 = await crearUsuarioDePrueba(creds, service, { email: `protocolo-op2-${sufijo}@test.local`, rol: 'operario' });
    operario2 = u2.client;
    operario2Id = u2.userId;
    admin = (await crearUsuarioDePrueba(creds, service, { email: 'protocolo-admin@test.local', rol: 'admin' })).client;
    plantaId = await crearPlanta(`PR-${sufijo}`);
    otraPlantaId = await crearPlanta(`PR2-${sufijo}`);
  }, 60_000);

  afterAll(async () => {
    // protocolo_ronda es inmutable por diseño (trigger protocolo_ronda_inmutable): los cruces con protocolo
    // definido NO se pueden borrar (quedan, ya como es_prueba = true). Sí se borran sus individuos, rondas y
    // evaluaciones, y los operarios (el protocolo lo firma el admin fijo protocolo-admin@test.local).
    await limpiarPrueba(service, { plantaIds: plantasCreadas, usuarioIds: [operarioId, operario2Id] }, 'protocolo-ronda');
  }, 60_000);

  it('solo un admin define el protocolo; se valida contra el esquema de fase', async () => {
    expect((await definir(operario, { brotacion: 'obligatorio' })).error?.code).toBe('42501');
    expect((await definir(admin, { inventado: 'obligatorio' })).error?.code).toBe('23514');
    expect((await definir(admin, { brotacion: 'a veces' })).error?.code).toBe('23514');
    expect((await definir(admin, { peso_promedio_g: 'opcional' })).error?.code).toBe('23514'); // derivado
    expect((await definir(admin, {})).error?.code).toBe('23514');
  });

  it('cada evaluación queda con el protocolo vigente al crearla, aunque después cambie', async () => {
    const v1 = await definir(admin, { brotacion: 'obligatorio', floracion: 'opcional', calibre_mm: 'opcional' });
    expect(v1.error).toBeNull();
    const a = await rondaNueva();
    const { data: ev1 } = await operario.from('evaluaciones')
      .insert({ ronda_id: a.ronda, fecha: '2027-03-01', estado: 'borrador', created_by: operarioId, brotacion: 3 })
      .select('id, protocolo_id').single();
    expect(ev1?.protocolo_id).toBe(v1.data);

    const v2 = await definir(admin, { brotacion: 'obligatorio' }, plantaId, 'Protocolo corregido');
    expect(v2.error).toBeNull();
    const { data: filasV } = await operario.from('protocolo_ronda').select('version').eq('planta_id', plantaId).order('version');
    expect(filasV!.map((f) => f.version)).toEqual([1, 2]);

    const b = await rondaNueva();
    const { data: ev2 } = await operario.from('evaluaciones')
      .insert({ ronda_id: b.ronda, fecha: '2027-03-01', estado: 'completa', created_by: operarioId, brotacion: 4 })
      .select('protocolo_id').single();
    expect(ev2?.protocolo_id).toBe(v2.data);
    // La primera sigue con la versión 1 al guardarse de nuevo.
    const { data: ev1b } = await operario.from('evaluaciones').update({ floracion: 2 }).eq('id', ev1!.id).select('protocolo_id').single();
    expect(ev1b?.protocolo_id).toBe(v1.data);
  });

  it('el protocolo es inmutable y no se puede cambiar el de una evaluación', async () => {
    const { data: proto } = await operario.from('protocolo_ronda').select('id').eq('planta_id', plantaId).eq('version', 1).single();
    const upd = await admin.from('protocolo_ronda').update({ nombre: 'otro' }).eq('id', proto!.id).select('id');
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const del = await admin.from('protocolo_ronda').delete().eq('id', proto!.id).select('id');
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);

    const r = await rondaNueva();
    const { data: ev } = await operario.from('evaluaciones')
      .insert({ ronda_id: r.ronda, fecha: '2027-03-01', estado: 'borrador', created_by: operarioId, brotacion: 1 })
      .select('id').single();
    const cambio = await operario.from('evaluaciones').update({ protocolo_id: proto!.id }).eq('id', ev!.id);
    expect(cambio.error?.code).toBe('23514');
  });

  it('no acepta el protocolo de otro cruce', async () => {
    const otro = await definir(admin, { brotacion: 'obligatorio' }, otraPlantaId);
    const r = await rondaNueva();
    const { error } = await operario.from('evaluaciones')
      .insert({ ronda_id: r.ronda, fecha: '2027-03-01', estado: 'borrador', created_by: operarioId, protocolo_id: otro.data });
    expect(error?.code).toBe('23514');
  });

  it('A1-058: una evaluación no se mueve a la ronda de otro individuo', async () => {
    const origen = await rondaNueva();
    const destino = await rondaNueva();
    const { data: ev } = await operario.from('evaluaciones')
      .insert({ ronda_id: origen.ronda, fecha: '2027-03-01', estado: 'borrador', created_by: operarioId, brotacion: 2 })
      .select('id').single();
    const mover = await operario.from('evaluaciones').update({ ronda_id: destino.ronda }).eq('id', ev!.id);
    expect(mover.error?.code).toBe('23514');
    const moverAdmin = await admin.from('evaluaciones').update({ ronda_id: destino.ronda }).eq('id', ev!.id);
    expect(moverAdmin.error?.code).toBe('23514');
  });

  it('estados por descriptor: medido, faltó, no evaluado y marcado', async () => {
    const r = await rondaNueva();
    // Vigente: versión 2 (solo brotacion obligatorio). Defino una v3 con más campos.
    const v3 = await definir(admin, { brotacion: 'obligatorio', floracion: 'obligatorio', calibre_mm: 'opcional', color: 'opcional', cantidad_frutos: 'opcional', peso_total_g: 'opcional' });
    expect(v3.error).toBeNull();
    const { data: rr } = await service.from('rango_referencia').select('limite_revision_superior')
      .eq('metrica', 'calibre_mm').eq('activo', true).not('limite_revision_superior', 'is', null).limit(1);
    const limite = Number(rr?.[0]?.limite_revision_superior ?? NaN);
    const calibre = Number.isFinite(limite) ? limite + 5 : 18;
    const { data: ev, error } = await operario.from('evaluaciones')
      .insert({ ronda_id: r.ronda, fecha: '2027-03-01', estado: 'completa', created_by: operarioId,
        brotacion: 4, calibre_mm: calibre, cantidad_frutos: 10, peso_total_g: 20, dano_calor: 2 })
      .select('id, requiere_revision').single();
    expect(error).toBeNull();
    const { data: planilla } = await operario.rpc('obtener_planilla_ronda', { p_planta_id: plantaId, p_numero_ronda: 1 });
    const fila = (planilla as { individuos: { evaluacion_id: string; estados: Record<string, string> }[] }).individuos
      .find((i) => i.evaluacion_id === ev!.id)!;
    expect(fila.estados.brotacion).toBe('medido');
    expect(fila.estados.floracion).toBe('falto');
    expect(fila.estados.precocidad).toBe('no_evaluado');
    expect(fila.estados.color).toBe('no_evaluado'); // opcional sin valor: no es «faltó»
    expect(fila.estados.dano_calor).toBe('medido'); // fuera del protocolo pero cargado: se conserva
    if (Number.isFinite(limite)) {
      expect(fila.estados.calibre_mm).toBe('marcado');
      expect(ev!.requiere_revision).toBe(true);
    }
  });

  it('la planilla mide avance por evaluación cerrada y dice de quién es cada borrador', async () => {
    const sinIniciar = await rondaNueva();
    const conBorradorAjeno = await rondaNueva();
    await operario2.from('evaluaciones').insert({
      ronda_id: conBorradorAjeno.ronda, fecha: '2027-03-01', estado: 'borrador',
      created_by: (await operario2.auth.getUser()).data.user!.id, brotacion: 3,
    });
    const { data, error } = await operario.rpc('obtener_planilla_ronda', { p_planta_id: plantaId, p_numero_ronda: 1 });
    expect(error).toBeNull();
    const p = data as {
      numero_ronda: number;
      protocolo: { version: number } | null;
      avance: Record<string, number>;
      individuos: { individuo_id: string; estado: string; es_mia: boolean; protocolo_distinto: boolean; numero: number | null }[];
    };
    expect(p.numero_ronda).toBe(1);
    expect(p.protocolo?.version).toBe(3);
    expect(p.individuos.find((i) => i.individuo_id === sinIniciar.individuo)?.estado).toBe('sin_iniciar');
    expect(p.individuos.find((i) => i.individuo_id === conBorradorAjeno.individuo)).toMatchObject({ estado: 'borrador', es_mia: false });
    const total = p.avance.sin_ronda + p.avance.sin_iniciar + p.avance.borrador + p.avance.completa;
    expect(total).toBe(p.avance.vivos);
    expect(p.individuos.some((i) => i.protocolo_distinto)).toBe(true);
    const numeros = p.individuos.map((i) => i.numero ?? Infinity);
    expect([...numeros].sort((a, b) => a - b)).toEqual(numeros); // recorrido por número de planta
  });

  // Despliegue: en producción hay borradores creados antes de que existieran los protocolos.
  it('un borrador anterior a los protocolos sigue sin protocolo, conserva sus datos y se puede finalizar', async () => {
    const planta = await crearPlanta(`PRL-${sufijo}`);
    const r = await rondaNueva(planta);
    const { data: borrador, error: e1 } = await operario.from('evaluaciones')
      .insert({ ronda_id: r.ronda, fecha: '2027-03-01', estado: 'borrador', created_by: operarioId, brotacion: 3, observaciones: 'visita de prueba' })
      .select('id, protocolo_id, updated_at').single();
    expect(e1).toBeNull();
    expect(borrador!.protocolo_id).toBeNull();
    // Después el admin define el protocolo de esa ronda, con floración obligatoria.
    expect((await definir(admin, { brotacion: 'obligatorio', floracion: 'obligatorio' }, planta)).error).toBeNull();
    // El autor sigue el borrador y lo finaliza sin floración: la base no lo bloquea.
    const { data: cerrada, error: e2 } = await operario.from('evaluaciones')
      .update({ estado: 'completa', precocidad: 4 }).eq('id', borrador!.id).select('estado, protocolo_id, brotacion, precocidad, observaciones').single();
    expect(e2).toBeNull();
    expect(cerrada).toMatchObject({ estado: 'completa', protocolo_id: null, brotacion: 3, precocidad: 4, observaciones: 'visita de prueba' });
    // Sin protocolo propio: nada figura como «faltó», ni se marca como protocolo anterior.
    const { data: est } = await operario.rpc('obtener_estados_evaluacion', { p_evaluacion_id: borrador!.id });
    const estados = est as { protocolo: unknown; estados: Record<string, string> };
    expect(estados.protocolo).toBeNull();
    expect(estados.estados.floracion).toBe('no_evaluado');
    expect(Object.values(estados.estados)).not.toContain('falto');
    const { data: pl } = await operario.rpc('obtener_planilla_ronda', { p_planta_id: planta, p_numero_ronda: 1 });
    const fila = (pl as { individuos: { evaluacion_id: string; estado: string; protocolo_distinto: boolean }[] }).individuos.find((i) => i.evaluacion_id === borrador!.id);
    expect(fila).toMatchObject({ estado: 'completa', protocolo_distinto: false });
    // Una evaluación nueva de esa ronda sí queda con el protocolo.
    const otra = await rondaNueva(planta);
    const { data: nueva } = await operario.from('evaluaciones')
      .insert({ ronda_id: otra.ronda, fecha: '2027-03-02', estado: 'borrador', created_by: operarioId, brotacion: 2 }).select('protocolo_id').single();
    expect(nueva!.protocolo_id).not.toBeNull();
  });
});
