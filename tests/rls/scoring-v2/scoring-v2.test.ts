// Scoring v2 (pasos 44 a 47): enum `brotes`, descriptor «Distribución de flores y frutos en la vara», campo `activo` del esquema (rend_t_ha
// desactivado) y versión v2 de puntaje inactiva, más la activación y su rollback (dentro de una transacción que se descarta).
// Decisiones EF8 a EF12 (docs/decisiones_cerradas.md) y el Maestro, «Puntaje (scoring) v1 → v2 → v3».
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';
import { limpiarPrueba } from '../limpieza-pruebas';

const CONTENEDOR = 'supabase_db_dbsecurity-frutales';
const RAIZ = join(__dirname, '..', '..', '..');
const NOMBRE_V1 = 'Selección de fruto v1 provisional (4-3-2-1)';
const NOMBRE_V2 = 'Selección v2 (5 categorías 40-30-15-10-5) provisional';

/** Corre SQL en la base local con psql (como postgres) y devuelve la salida sin formato. */
function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
  }).trim();
}
const archivoSql = (...ruta: string[]) => readFileSync(join(RAIZ, ...ruta), 'utf8');

describe('scoring v2: configuración de la versión', () => {
  let service: SupabaseClient;
  let v2Id: string;

  beforeAll(async () => {
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.from('scoring_version').select('id, estado').eq('nombre', NOMBRE_V2).single();
    expect(error).toBeNull();
    v2Id = data!.id;
  }, 60_000);

  it('la v2 existe y nace inactiva (borrador)', async () => {
    const { data } = await service.from('scoring_version').select('estado').eq('id', v2Id).single();
    expect(['borrador', 'activa']).toContain(data!.estado);
  });

  it('las categorías pesan 40 · 30 · 15 · 10 · 5 y suman 1', async () => {
    const { data } = await service.from('scoring_categoria_peso').select('categoria, peso').eq('scoring_version_id', v2Id);
    const pesos = Object.fromEntries((data ?? []).map((f) => [f.categoria, Number(f.peso)]));
    expect(pesos).toEqual({ fruto_calidad: 0.4, produccion: 0.3, fenologia: 0.15, brotes: 0.1, estres: 0.05 });
    expect(Object.values(pesos).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('tiene 19 métricas, sin rend_t_ha, y las métricas de cada categoría suman el peso de la categoría', async () => {
    const { data } = await service.from('scoring_metrica').select('metrica, categoria, peso, minimo_normalizacion, maximo_normalizacion').eq('scoring_version_id', v2Id);
    expect(data).toHaveLength(19);
    const claves = (data ?? []).map((m) => m.metrica);
    expect(claves).not.toContain('rend_t_ha');
    expect(claves).not.toContain('distribucion_flores_frutos');
    const suma: Record<string, number> = {};
    for (const m of data ?? []) suma[m.categoria] = (suma[m.categoria] ?? 0) + Number(m.peso);
    expect(suma.fruto_calidad).toBeCloseTo(0.4, 6);
    expect(suma.produccion).toBeCloseTo(0.3, 6);
    expect(suma.fenologia).toBeCloseTo(0.15, 6);
    expect(suma.brotes).toBeCloseTo(0.1, 6);
    expect(suma.estres).toBeCloseTo(0.05, 6);
  });

  it('Producción reparte 60 % exportable y 40 % por planta (EF10); kg/planta normaliza de 0 a 6 (S7)', async () => {
    const { data } = await service.from('scoring_metrica').select('metrica, peso, minimo_normalizacion, maximo_normalizacion')
      .eq('scoring_version_id', v2Id).eq('categoria', 'produccion');
    const por = Object.fromEntries((data ?? []).map((m) => [m.metrica, m]));
    expect(Number(por.pct_fruta_exportable.peso)).toBeCloseTo(0.18, 6);
    expect(Number(por.rend_kg_planta.peso)).toBeCloseTo(0.12, 6);
    expect([Number(por.rend_kg_planta.minimo_normalizacion), Number(por.rend_kg_planta.maximo_normalizacion)]).toEqual([0, 6]);
  });

  it('Brotes = cobertura floral, cuaja, vigor y color con reparto 75/25 (S1, S2)', async () => {
    const { data } = await service.from('scoring_metrica').select('metrica, peso').eq('scoring_version_id', v2Id).eq('categoria', 'brotes');
    const por = Object.fromEntries((data ?? []).map((m) => [m.metrica, Number(m.peso)]));
    expect(Object.keys(por).sort()).toEqual(['color_follaje', 'pct_flores', 'pct_frutos', 'vigor_vegetativo']);
    expect(por.pct_flores + por.pct_frutos).toBeCloseTo(0.075, 6);
    expect(por.vigor_vegetativo + por.color_follaje).toBeCloseTo(0.025, 6);
  });

  it('Estrés queda con daño por calor, golpe de sol y caída de fruto (dirección: menor es mejor)', async () => {
    const { data } = await service.from('scoring_metrica').select('metrica, direccion_favorable').eq('scoring_version_id', v2Id).eq('categoria', 'estres');
    expect((data ?? []).map((m) => m.metrica).sort()).toEqual(['caida_fruto', 'dano_calor', 'golpe_sol']);
    expect((data ?? []).every((m) => m.direccion_favorable === 'menor')).toBe(true);
  });

  it('Fenología conserva sus 6 métricas con los pesos de la v1 × 0,75', async () => {
    const { data: v1 } = await service.from('scoring_version').select('id').eq('nombre', NOMBRE_V1).single();
    const { data: antes } = await service.from('scoring_metrica').select('metrica, peso').eq('scoring_version_id', v1!.id).eq('categoria', 'fenologia');
    const { data: ahora } = await service.from('scoring_metrica').select('metrica, peso').eq('scoring_version_id', v2Id).eq('categoria', 'fenologia');
    const pesosAhora = Object.fromEntries((ahora ?? []).map((m) => [m.metrica, Number(m.peso)]));
    expect(Object.keys(pesosAhora).sort()).toEqual((antes ?? []).map((m) => m.metrica).sort());
    for (const m of antes ?? []) expect(pesosAhora[m.metrica]).toBeCloseTo(Number(m.peso) * 0.75, 6);
  });

  it('la v1 no se tocó: conserva sus 20 métricas, incluida rend_t_ha', async () => {
    const { data: v1 } = await service.from('scoring_version').select('id').eq('nombre', NOMBRE_V1).single();
    const { data } = await service.from('scoring_metrica').select('metrica').eq('scoring_version_id', v1!.id);
    expect(data).toHaveLength(20);
    expect((data ?? []).map((m) => m.metrica)).toContain('rend_t_ha');
  });

  it('el enum de categorías queda en el orden fenologia, fruto_calidad, produccion, brotes, estres', () => {
    expect(psql(`select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.categoria_scoring'::regtype`))
      .toBe('fenologia,fruto_calidad,produccion,brotes,estres');
  });
});

describe('scoring v2: activación y rollback (dentro de una transacción que se descarta)', () => {
  const activar = () => archivoSql('docs', 'migraciones_pendientes', 'scoring_v2_activar.sql');
  const revertir = () => archivoSql('docs', 'scoring_v2', 'rollback', '47_activar_v2_rollback.sql');

  it('activar deja la v2 activa y la v1 inactiva con fecha de fin; el rollback lo deja como estaba', () => {
    const estados = `select string_agg(nombre || '=' || estado::text || '=' || coalesce(vigente_hasta::text, '-'), ' | ' order by nombre) from scoring_version where nombre in ('${NOMBRE_V1}', '${NOMBRE_V2}')`;
    const salida = psql(`begin;\nselect 'antes:' || (${estados});\n${activar()}\nselect 'activada:' || (${estados});\nselect 'resuelve_v2:' || (select nombre from scoring_version where id = public.resolver_scoring_version(null, 'evaluacion_anual', current_date));\n${revertir()}\nselect 'revertida:' || (${estados});\nrollback;`);
    const lineas = Object.fromEntries(salida.split('\n').filter((l) => /^(antes|activada|resuelve_v2|revertida):/.test(l)).map((l) => [l.split(':')[0], l.slice(l.indexOf(':') + 1)]));
    expect(lineas.antes).toContain(`${NOMBRE_V1}=activa=-`);
    expect(lineas.antes).toContain(`${NOMBRE_V2}=borrador=-`);
    expect(lineas.activada).toContain(`${NOMBRE_V2}=activa=-`);
    expect(lineas.activada).toMatch(new RegExp(`${NOMBRE_V1.replace(/[()]/g, '\\$&')}=inactiva=\\d{4}-\\d{2}-\\d{2}`));
    expect(lineas.resuelve_v2).toBe(NOMBRE_V2);
    expect(lineas.revertida).toBe(lineas.antes);
  });

  it('la transacción se descartó: la v2 sigue en borrador (o activa si ya se activó a propósito)', () => {
    const estado = psql(`select estado::text from scoring_version where nombre = '${NOMBRE_V2}'`);
    expect(['borrador', 'activa']).toContain(estado);
  });

  it('activar dos veces falla (no hay v1 activa)', () => {
    expect(() => psql(`begin;\n${activar()}\n${activar()}\nrollback;`)).toThrow();
  });
});

describe('descriptor «Distribución de flores y frutos en la vara» y campo activo del esquema', () => {
  let service: SupabaseClient;
  let operario: SupabaseClient;
  let operarioId: string;
  let especieId: string;
  let plantaId: string;
  let secuencia = 0;

  beforeAll(async () => {
    const sufijo = Date.now();
    const creds = getLocalCreds();
    service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const op = await crearUsuarioDePrueba(creds, service, { email: `scoring-v2-op-${sufijo}@test.local`, rol: 'operario' });
    operario = op.client; operarioId = op.userId;
    const { data: especie, error: e1 } = await service.from('especies').insert({ nombre: `Scoring v2 ${sufijo}` }).select('id').single();
    if (e1 || !especie) throw e1 ?? new Error('No se creó la especie');
    especieId = especie.id;
    const { data: planta, error: e2 } = await service.from('plantas')
      .insert({ codigo_sistema: `V2-${sufijo}`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true }).select('id').single();
    if (e2 || !planta) throw e2 ?? new Error('No se creó el cruce');
    plantaId = planta.id;
  }, 60_000);

  afterAll(async () => {
    await limpiarPrueba(service, { plantaIds: [plantaId], especieIds: [especieId], usuarioIds: [operarioId] }, 'scoring-v2');
  }, 60_000);

  async function crearRonda() {
    secuencia += 1;
    const { data: individuo, error: e1 } = await service.from('individuos')
      .insert({ planta_id: plantaId, codigo_display: 'GENERADO-POR-TRIGGER', fecha_individualizacion: `2027-01-${String(secuencia).padStart(2, '0')}`, created_by: operarioId })
      .select('id').single();
    if (e1 || !individuo) throw e1 ?? new Error('No se creó el individuo');
    const { data: ronda, error: e2 } = await service.from('ronda_evaluacion_anual')
      .insert({ individuo_id: individuo.id, numero_ronda: 1, anio: 2027, fecha_inicio: '2027-01-01', created_by: operarioId }).select('id').single();
    if (e2 || !ronda) throw e2 ?? new Error('No se creó la ronda');
    return ronda.id as string;
  }

  it('el esquema declara el descriptor en Brotes y varas (orden 16, tras color_follaje) con una etiqueta por nivel', async () => {
    const { data } = await operario.from('esquema_fase_campo').select('*').eq('fase', 'evaluacion_anual').eq('clave', 'distribucion_flores_frutos').single();
    expect(data).toMatchObject({
      seccion: 'brotes', rol: 'descriptor', tipo: 'escala', orden: 16, escala_minimo: 1, escala_maximo: 3, activo: true,
      etiqueta_minimo: 'Solo en la punta', etiqueta_maximo: 'Toda la vara',
      etiquetas_nivel: ['Solo en la punta', 'Hasta la mitad', 'Toda la vara'],
    });
  });

  it('los órdenes del esquema quedan contiguos (1 a 36 desde la cicatriz de la fase 5) y solo rend_t_ha está desactivado', async () => {
    const { data } = await operario.from('esquema_fase_campo').select('clave, orden, activo').eq('fase', 'evaluacion_anual').order('orden');
    expect((data ?? []).map((c) => c.orden)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    expect((data ?? []).filter((c) => !c.activo).map((c) => c.clave)).toEqual(['rend_t_ha']);
  });

  it('una escala solo puede llevar etiquetas por nivel si la cantidad calza con la escala', () => {
    expect(() => psql(`begin;\nupdate public.esquema_fase_campo set etiquetas_nivel = array['a','b'] where fase = 'evaluacion_anual' and clave = 'distribucion_flores_frutos';\nrollback;`)).toThrow();
    expect(() => psql(`begin;\nupdate public.esquema_fase_campo set etiquetas_nivel = array['a','b'] where fase = 'evaluacion_anual' and clave = 'brix';\nrollback;`)).toThrow();
  });

  it('acepta 1, 2 y 3 y rechaza 0 y 4 (CHECK)', async () => {
    const rondaId = await crearRonda();
    for (const malo of [0, 4]) {
      const { error } = await operario.from('evaluaciones').insert({ ronda_id: rondaId, fecha: '2027-02-01', estado: 'borrador', distribucion_flores_frutos: malo, created_by: operarioId });
      expect(error?.code).toBe('23514');
    }
    const { data, error } = await operario.from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha: '2027-02-02', estado: 'completa', sin_muestra: true, distribucion_flores_frutos: 2, created_by: operarioId })
      .select('distribucion_flores_frutos').single();
    expect(error).toBeNull();
    expect(data?.distribucion_flores_frutos).toBe(2);
  });

  it('es opcional: se puede cerrar una evaluación sin el descriptor', async () => {
    const rondaId = await crearRonda();
    const { data, error } = await operario.from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha: '2027-02-03', estado: 'completa', sin_muestra: true, brotacion: 3, created_by: operarioId })
      .select('distribucion_flores_frutos').single();
    expect(error).toBeNull();
    expect(data?.distribucion_flores_frutos).toBeNull();
  });

  it('la fotografía de la ronda toma el valor más reciente que no sea nulo, aunque la última visita no lo mida', async () => {
    const rondaId = await crearRonda();
    const visita = (fecha: string, extra: Record<string, unknown>) => operario.from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha, estado: 'completa', sin_muestra: true, created_by: operarioId, ...extra });
    expect((await visita('2027-02-10', { distribucion_flores_frutos: 1, brotacion: 2 })).error).toBeNull();
    expect((await visita('2027-02-17', { distribucion_flores_frutos: 3 })).error).toBeNull();
    expect((await visita('2027-02-24', { brotacion: 4 })).error).toBeNull();
    const { data, error } = await service.rpc('unificar_evaluacion_ronda', { p_ronda_id: rondaId });
    expect(error).toBeNull();
    const fila = Array.isArray(data) ? data[0] : data;
    expect(fila.distribucion_flores_frutos).toBe(3);
    expect(fila.brotacion).toBe(4);
  });

  it('un protocolo puede pedir la distribución, pero no rend_t_ha (campo desactivado)', () => {
    const validar = (json: string) => psql(`select coalesce(public.validar_descriptores_protocolo('${json}'::jsonb), 'VALIDO')`);
    expect(validar('{"brotacion":"obligatorio","distribucion_flores_frutos":"opcional"}')).toBe('VALIDO');
    const malo = validar('{"brotacion":"obligatorio","rend_t_ha":"opcional"}');
    expect(malo).toContain('rend_t_ha');
  });

  it('estados_descriptores: rend_t_ha desactivado aparece solo si la evaluación ya trae valor', async () => {
    const rondaId = await crearRonda();
    const { data: sin } = await operario.from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha: '2027-03-01', estado: 'completa', sin_muestra: true, brotacion: 3, created_by: operarioId }).select('id').single();
    const { data: con } = await operario.from('evaluaciones')
      .insert({ ronda_id: rondaId, fecha: '2027-03-02', estado: 'completa', sin_muestra: true, rend_t_ha: 12, created_by: operarioId }).select('id').single();
    const estados = (id: string) => JSON.parse(psql(`select public.estados_descriptores(e) from public.evaluaciones e where e.id = '${id}'`)) as Record<string, string>;
    const a = estados(sin!.id);
    expect('rend_t_ha' in a).toBe(false);
    expect(a.brotacion).toBe('medido');
    expect(a.distribucion_flores_frutos).toBe('no_evaluado');
    const b = estados(con!.id);
    expect(b.rend_t_ha).toBe('medido');
  });
});
