/**
 * Auditoría integral, Corrida 1, grupo G1 — flujos C08 (editar linaje) y C01
 * (alta manual de cruce con linaje), más el catálogo de variedades que
 * participa del linaje (SelectorVariedad) y su efecto en el ranking varietal.
 *
 * Los `it.fails` demuestran hallazgos abiertos (ID A1-G1-NN en cada uno).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

const R = Date.now();

let creds: ReturnType<typeof getLocalCreds>;
let service: SupabaseClient;
let anon: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let operarioId: string;
let operarioLinaje: SupabaseClient;
let especieId: string;
let especieMoraId: string;
let varA: string;
let varB: string;
let varMora: string;
let varInactiva: string;
let plantaId: string;
const plantasCreadas: string[] = [];
const variedadesCreadas: string[] = [];

async function ultimaAuditoria(usuarioId: string, accion: string) {
  const { data, error } = await service
    .from('audit_log')
    .select('*')
    .eq('usuario_id', usuarioId)
    .eq('accion', accion)
    .order('ocurrido_en', { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

async function linajeReal(id: string) {
  const { data, error } = await service.from('plantas').select('cruzamiento, mama, papa, mama_id, papa_id, eliminado_at').eq('id', id).single();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-escritura-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  const op = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-escritura-operario-${R}@test.local`, rol: 'operario' });
  operario = op.client;
  operarioId = op.userId;
  operarioLinaje = (await crearUsuarioDePrueba(creds, service, {
    email: `aud-g1-escritura-operario-linaje-${R}@test.local`,
    rol: 'operario',
    puedeVerLinaje: true,
  })).client;

  const { data: especies, error: errEsp } = await service.from('especies').select('id, nombre').in('nombre', ['Arándano', 'Mora']);
  if (errEsp || !especies || especies.length < 2) throw new Error(`setup especies: ${errEsp?.message}`);
  especieId = especies.find((e) => e.nombre === 'Arándano')!.id;
  especieMoraId = especies.find((e) => e.nombre === 'Mora')!.id;

  const { data: variedades, error: errVar } = await service
    .from('variedades')
    .insert([
      { especie_id: especieId, nombre: `Var A aud-g1 ${R}`, created_by: adminId, activo: true },
      { especie_id: especieId, nombre: `Var B aud-g1 ${R}`, created_by: adminId, activo: true },
      { especie_id: especieId, nombre: `Var inactiva aud-g1 ${R}`, created_by: adminId, activo: false },
      { especie_id: especieMoraId, nombre: `Var mora aud-g1 ${R}`, created_by: adminId, activo: true },
    ])
    .select('id, nombre');
  if (errVar || !variedades) throw new Error(`setup variedades: ${errVar?.message}`);
  const porNombre = (n: string) => variedades.find((v) => v.nombre.startsWith(n))!.id;
  varA = porNombre('Var A');
  varB = porNombre('Var B');
  varInactiva = porNombre('Var inactiva');
  varMora = porNombre('Var mora');
  variedadesCreadas.push(varA, varB, varInactiva, varMora);

  const { data: planta, error: errPl } = await service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-G1-${R}-ESC`, especie_id: especieId, cruzamiento: `SINT-ESC-${R}`, mama_id: varA, papa_id: varB, es_prueba: true })
    .select('id')
    .single();
  if (errPl || !planta) throw new Error(`setup planta: ${errPl?.message}`);
  plantaId = planta.id;
  plantasCreadas.push(plantaId);
}, 60_000);

afterAll(async () => {
  // Primero lo que cuelga de los cruces (polinizacion_evento es RESTRICT: sin esto el DELETE en bloque
  // falla entero y deja los cruces y las variedades en la base), luego los cruces (FK restrict hacia
  // variedades) y al final las variedades.
  const { data: propios } = await service.from('plantas').select('id').like('codigo_sistema', `AUD-G1-${R}-%`);
  const ids = [...new Set([...plantasCreadas, ...(propios ?? []).map((p) => p.id as string)])];
  if (ids.length) await service.from('polinizacion_evento').delete().in('planta_id', ids);
  if (ids.length) await service.from('plantas').delete().in('id', ids);
  await service.from('variedades').delete().in('id', variedadesCreadas);
  await service.from('variedades').delete().ilike('nombre', `%aud-g1 ${R}%`);
});

describe('C08 escritura: actualizar_linaje', () => {
  it('anon, operario y operario con permiso de ver linaje no pueden escribir linaje', async () => {
    const args = { p_planta_id: plantaId, p_cruzamiento: 'HACKEADO', p_mama_id: varB, p_papa_id: varA };
    expect((await anon.rpc('actualizar_linaje', args)).error).not.toBeNull();
    expect((await operario.rpc('actualizar_linaje', args)).error?.code).toBe('42501');
    expect((await operarioLinaje.rpc('actualizar_linaje', args)).error?.code).toBe('42501');
    expect((await linajeReal(plantaId)).cruzamiento).toBe(`SINT-ESC-${R}`);
  });

  it('ni admin ni operario pueden hacer UPDATE directo de las columnas de linaje (grant por columna)', async () => {
    for (const cliente of [admin, operario]) {
      for (const cambio of [{ cruzamiento: 'X' }, { mama_id: varB }, { papa_id: varA }, { mama: 'texto' }, { papa: 'texto' }]) {
        const { error } = await cliente.from('plantas').update(cambio).eq('id', plantaId).select('id');
        expect(error, JSON.stringify(cambio)).not.toBeNull();
        expect(error!.code).toBe('42501');
      }
    }
    expect((await linajeReal(plantaId)).cruzamiento).toBe(`SINT-ESC-${R}`);
  });

  it('admin escribe linaje: queda auditado con autor, anterior y nuevo; el texto congelado mama/papa no se toca', async () => {
    const { error } = await admin.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: `NUEVO-${R}`, p_mama_id: varB, p_papa_id: varA });
    expect(error).toBeNull();
    const real = await linajeReal(plantaId);
    expect(real).toMatchObject({ cruzamiento: `NUEVO-${R}`, mama_id: varB, papa_id: varA, mama: null, papa: null });
    const fila = await ultimaAuditoria(adminId, 'escritura_linaje');
    expect(fila.planta_id).toBe(plantaId);
    expect(fila.detalle.anterior).toEqual({ mama_id: varA, papa_id: varB });
    expect(fila.detalle.nuevo).toEqual({ mama_id: varB, papa_id: varA });
    expect(JSON.stringify(fila.detalle)).not.toContain(`NUEVO-${R}`);
  });

  it('admin puede vaciar el linaje (nulls) y también queda auditado', async () => {
    const { error } = await admin.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: null, p_mama_id: null, p_papa_id: null });
    expect(error).toBeNull();
    expect(await linajeReal(plantaId)).toMatchObject({ cruzamiento: null, mama_id: null, papa_id: null });
    const fila = await ultimaAuditoria(adminId, 'escritura_linaje');
    expect(fila.detalle.nuevo).toEqual({ mama_id: null, papa_id: null });
  });

  // A1-G1-04: la RPC no valida que la variedad sea de la misma especie que el cruce.
  it.fails('rechaza una variedad de otra especie como progenitor (A1-G1-04)', async () => {
    const { error } = await admin.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: null, p_mama_id: varMora, p_papa_id: null });
    expect(error).not.toBeNull();
    expect((await linajeReal(plantaId)).mama_id).not.toBe(varMora);
  });

  // A1-G1-04: tampoco valida que la variedad esté activa.
  it.fails('rechaza una variedad desactivada como progenitor (A1-G1-04)', async () => {
    const { error } = await admin.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: null, p_mama_id: varInactiva, p_papa_id: null });
    expect(error).not.toBeNull();
    expect((await linajeReal(plantaId)).mama_id).not.toBe(varInactiva);
  });

  it('la escritura 11 dentro del minuto falla con 58503', async () => {
    const { client: escritor } = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-escritura-ratelimit-${R}@test.local`, rol: 'admin' });
    // Deja el cruce en un estado conocido antes de contar.
    for (let i = 0; i < 10; i++) {
      const { error } = await escritor.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: `RL-${i}`, p_mama_id: varA, p_papa_id: varB });
      expect(error, `escritura ${i + 1}`).toBeNull();
    }
    const { error } = await escritor.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: 'RL-11', p_mama_id: varA, p_papa_id: varB });
    expect(error?.code).toBe('58503');
    expect((await linajeReal(plantaId)).cruzamiento).toBe('RL-9');
  }, 60_000);
});

describe('C01 alta manual de cruce', () => {
  it('operario, operario con permiso de linaje y anon no pueden insertar en plantas', async () => {
    const fila = { codigo_sistema: `AUD-G1-${R}-OP`, especie_id: especieId, es_prueba: true };
    expect((await operario.from('plantas').insert(fila)).error?.code).toBe('42501');
    expect((await operarioLinaje.from('plantas').insert(fila)).error?.code).toBe('42501');
    expect((await anon.from('plantas').insert(fila)).error).not.toBeNull();
  });

  it('admin: el INSERT de crearPlanta crea el cruce con linaje y deja alta_cruce con autor y valores', async () => {
    const codigo = `AUD-G1-${R}-ALTA`;
    const { data, error } = await admin
      .from('plantas')
      .insert({ codigo_sistema: codigo, especie_id: especieId, cruzamiento: `ALTA-${R}`, mama_id: varA, papa_id: varB, estado: 'sin_empezar', es_prueba: true })
      .select('id, codigo_sistema')
      .single();
    expect(error).toBeNull();
    plantasCreadas.push(data!.id);
    const { data: filas } = await service.from('audit_log').select('usuario_id, detalle').eq('accion', 'alta_cruce').eq('planta_id', data!.id);
    expect(filas).toHaveLength(1);
    expect(filas![0].usuario_id).toBe(adminId);
    expect(filas![0].detalle.nuevo).toEqual({ mama_id: varA, papa_id: varB });
    expect(filas![0].detalle.nuevo).not.toHaveProperty('cruzamiento');
  });

  it('un código repetido falla con 23505 y no crea nada (unicidad en la base)', async () => {
    const { error } = await admin.from('plantas').insert({ codigo_sistema: `AUD-G1-${R}-ALTA`, especie_id: especieId, es_prueba: true });
    expect(error?.code).toBe('23505');
  });

  it('el alta sin progenitores es aceptada por la base (sin regla de dominio escrita; ver informe)', async () => {
    const { data, error } = await admin
      .from('plantas')
      .insert({ codigo_sistema: `AUD-G1-${R}-SINLIN`, especie_id: especieId, estado: 'polinizacion', es_prueba: true })
      .select('id')
      .single();
    expect(error).toBeNull();
    plantasCreadas.push(data!.id);
    expect(await linajeReal(data!.id)).toMatchObject({ cruzamiento: null, mama_id: null, papa_id: null });
  });

  it('el alta acepta cualquier estado inicial, también uno avanzado (la pantalla lo ofrece); queda en alta_cruce.detalle.estado', async () => {
    const { data, error } = await admin
      .from('plantas')
      .insert({ codigo_sistema: `AUD-G1-${R}-AVANZ`, especie_id: especieId, estado: 'evaluacion_anual', es_prueba: true })
      .select('id')
      .single();
    expect(error).toBeNull();
    plantasCreadas.push(data!.id);
    const { data: filas } = await service.from('audit_log').select('detalle').eq('accion', 'alta_cruce').eq('planta_id', data!.id);
    expect(filas![0].detalle.estado).toBe('evaluacion_anual');
  });

  // A1-G1-05: el grant de INSERT incluye las columnas congeladas mama/papa y
  // columnas administrativas (eliminado_at, lote_importacion_id, id, created_at).
  it.fails('rechaza escribir el texto congelado mama/papa en el alta (A1-G1-05)', async () => {
    const { data, error } = await admin
      .from('plantas')
      .insert({ codigo_sistema: `AUD-G1-${R}-TXT`, especie_id: especieId, mama: 'Texto libre', papa: 'Texto libre', es_prueba: true })
      .select('id')
      .single();
    if (data) plantasCreadas.push(data.id);
    expect(error).not.toBeNull();
  });

  it.fails('rechaza crear un cruce ya archivado (eliminado_at en el INSERT) (A1-G1-05)', async () => {
    const { data, error } = await admin
      .from('plantas')
      .insert({ codigo_sistema: `AUD-G1-${R}-NACEARCH`, especie_id: especieId, es_prueba: true, eliminado_at: new Date().toISOString() })
      .select('id')
      .single();
    if (data) plantasCreadas.push(data.id);
    expect(error).not.toBeNull();
  });

  // A1-G1-04: la base no valida que mama_id/papa_id pertenezcan a la especie del cruce.
  it.fails('rechaza en el alta un progenitor de otra especie (A1-G1-04)', async () => {
    const { data, error } = await admin
      .from('plantas')
      .insert({ codigo_sistema: `AUD-G1-${R}-MORA`, especie_id: especieId, mama_id: varMora, es_prueba: true })
      .select('id')
      .single();
    if (data) plantasCreadas.push(data.id);
    expect(error).not.toBeNull();
  });

  // A1-G1-06: codigo_sistema solo tiene UNIQUE; el recorte y la no-vacuidad viven en el cliente.
  it.fails('rechaza un código en blanco o con espacios alrededor (A1-G1-06)', async () => {
    const blanco = await admin.from('plantas').insert({ codigo_sistema: '   ', especie_id: especieId, es_prueba: true }).select('id').single();
    if (blanco.data) plantasCreadas.push(blanco.data.id);
    const espacios = await admin.from('plantas').insert({ codigo_sistema: ` AUD-G1-${R}-ESP `, especie_id: especieId, es_prueba: true }).select('id').single();
    if (espacios.data) plantasCreadas.push(espacios.data.id);
    expect(blanco.error).not.toBeNull();
    expect(espacios.error).not.toBeNull();
  });
});

describe('C01/C11 borrado directo: el grant de DELETE en plantas salta a borrar_cruzamiento', () => {
  // A1-G1-02: policy plantas_delete_admin + grant DELETE a authenticated. Un
  // admin puede borrar físicamente por PostgREST un cruce REAL (es_prueba =
  // false) sin pasar por la puerta de borrar_cruzamiento ni dejar snapshot.
  it('un admin NO puede borrar físicamente un cruce real sin hijos con DELETE directo (A1-G1-02)', async () => {
    const codigo = `AUD-G1-${R}-REAL`;
    // es_prueba = false a propósito: es la puerta que el DELETE directo salta. Se limpia en afterAll.
    const { data: planta } = await service
      .from('plantas')
      .insert({ codigo_sistema: codigo, especie_id: especieId, cruzamiento: `REAL-${R}`, mama_id: varA, es_prueba: false })
      .select('id')
      .single();
    plantasCreadas.push(planta!.id);

    const { data: borradas, error } = await admin.from('plantas').delete().eq('id', planta!.id).select('id');
    const { data: sigue } = await service.from('plantas').select('id').eq('id', planta!.id);
    const { data: snapshot } = await service.from('audit_log').select('id').like('accion', 'borrado_cruzamiento_%').eq('detalle->>codigo_sistema', codigo);

    expect(error ?? borradas?.length).toBeTruthy(); // o falla, o 0 filas
    expect(sigue).toHaveLength(1);
    expect(snapshot).toHaveLength(0);
  });

  it('un operario no borra nada con DELETE directo', async () => {
    const { data, error } = await operario.from('plantas').delete().eq('id', plantaId).select('id');
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
    expect((await service.from('plantas').select('id').eq('id', plantaId)).data).toHaveLength(1);
  });
});

describe('C01 catálogo de variedades (SelectorVariedad) y ranking varietal', () => {
  it('cualquier operario crea variedades a su nombre; no puede crearlas a nombre de otro ni editarlas', async () => {
    const { data, error } = await operario
      .from('variedades')
      .insert({ especie_id: especieId, nombre: `Var operario aud-g1 ${R}`, created_by: operarioId })
      .select('id')
      .single();
    expect(error).toBeNull();
    variedadesCreadas.push(data!.id);
    const ajena = await operario.from('variedades').insert({ especie_id: especieId, nombre: `Var ajena aud-g1 ${R}`, created_by: adminId }).select('id');
    expect(ajena.error?.code).toBe('42501');
    const edicion = await operario.from('variedades').update({ nombre: 'renombrada' }).eq('id', data!.id).select('id');
    if (edicion.error) expect(edicion.error).toBeTruthy();
    else expect(edicion.data).toHaveLength(0); // RLS: 0 filas
    expect((await service.from('variedades').select('nombre').eq('id', data!.id).single()).data!.nombre).toBe(`Var operario aud-g1 ${R}`);
  });

  it('el duplicado exacto (mayúsculas/espacios) sí lo bloquea el índice único', async () => {
    const { error } = await admin.from('variedades').insert({ especie_id: especieId, nombre: `  VAR A AUD-G1 ${R} `, created_by: adminId }).select('id');
    expect(error?.code).toBe('23505');
  });

  // A1-G1-01: el alta manual (SelectorVariedad + policy de INSERT) permite
  // crear «BCH-1» cuando existe «BCH 1»; clave_nombre_variedad() (la regla del
  // importador) las considera la misma variedad. Producción ya tiene dos pares.
  it('el alta manual rechaza un casi-duplicado que el importador sí rechaza (A1-G1-01)', async () => {
    const base = `BCH 1 aud-g1 ${R}`;
    const casi = `BCH-1 aud-g1 ${R}`;
    const { data: v1 } = await admin.from('variedades').insert({ especie_id: especieId, nombre: base, created_by: adminId }).select('id').single();
    variedadesCreadas.push(v1!.id);
    const { data: clave } = await service.rpc('clave_nombre_variedad', { p_nombre: base });
    const { data: clave2 } = await service.rpc('clave_nombre_variedad', { p_nombre: casi });
    expect(clave).toBe(clave2); // misma variedad según la regla del importador

    const { data: v2, error } = await admin.from('variedades').insert({ especie_id: especieId, nombre: casi, created_by: adminId }).select('id').single();
    if (v2) variedadesCreadas.push(v2.id);
    expect(error?.code).toBe('23505');
  });

  // A1-G1-01, consecuencia científica: con «BCH3» y «BCH-3» como dos filas de
  // variedades, el ranking agrupa por variedad_id y muestra dos filas de 5
  // flores en vez de una de 10. Debería haber una sola variedad.
  // OJO: los cruces de este test son es_prueba = true (regla de la auditoría) y hoy el ranking
  // varietal SÍ los cuenta (A1-G1-16, ver g1-variedades.test.ts). Si se corrige A1-G1-16, este test
  // tendrá que pasar a cruces reales para seguir probando A1-G1-01.
  it('el ranking de polinización varietal no parte la misma variedad en dos filas (A1-G1-01)', async () => {
    const { data: pares } = await service
      .from('variedades')
      .insert([{ especie_id: especieId, nombre: `BCH3 aud-g1 ${R}`, created_by: adminId, activo: true }])
      .select('id');
    const b1 = pares![0].id;
    variedadesCreadas.push(b1);
    const duplicada = await service.from('variedades').insert({ especie_id: especieId, nombre: `BCH-3 aud-g1 ${R}`, created_by: adminId });
    expect(duplicada.error?.code).toBe('23505');
    const { data: cruces } = await service
      .from('plantas')
      .insert([
        { codigo_sistema: `AUD-G1-${R}-RK1`, especie_id: especieId, mama_id: b1, es_prueba: true, estado: 'polinizacion' },
        { codigo_sistema: `AUD-G1-${R}-RK2`, especie_id: especieId, mama_id: b1, es_prueba: true, estado: 'polinizacion' },
      ])
      .select('id');
    plantasCreadas.push(...cruces!.map((c) => c.id));
    await service.from('polinizacion_evento').insert(cruces!.map((c) => ({ planta_id: c.id, fecha: '2026-10-02', n_flores_cruzadas: 5, created_by: adminId })));

    const { data, error } = await admin.rpc('obtener_ranking_polinizacion_varietal', { p_especie_id: especieId, p_rol: 'mama' });
    expect(error).toBeNull();
    const filas = (data as Array<{ tipo_fila: string; variedad_id: string; flores_totales: number }>).filter((f) => f.variedad_id === b1);
    expect(filas).toHaveLength(1);
    expect(Number(filas[0].flores_totales)).toBe(10);
  });
});
