/**
 * Auditoría integral, Corrida 1, grupo G1 — flujo C08 (linaje): barridos de
 * fuga que complementan g1-linaje-lectura.test.ts.
 *
 *  1. Oráculos por filtro/orden sobre las columnas revocadas (PostgREST exige
 *     SELECT de columna para filtrar u ordenar, también dentro de un embed).
 *  2. Barrido automático de TODAS las tablas con FK hacia `plantas`: ningún
 *     embed `plantas(<columna de linaje>)` funciona para ningún rol.
 *  3. Guardas de catálogo: grants de columna, columnas con nombre de linaje en
 *     otras tablas y el conjunto exacto de funciones que tocan mama_id/papa_id.
 *  4. Caminos que sacan linaje a un ADMIN sin pasar por `obtener_planta`
 *     (sin auditoría de lectura y sin límite de frecuencia): `importacion_lote`
 *     y `audit_log.detalle`.
 *  5. Lo que `obtener_planta` devuelve a quien NO tiene permiso de linaje
 *     (genetica_a/genetica_b) y lo que declara en `campos_expuestos`.
 *
 * Los `it.fails` demuestran hallazgos abiertos (ID A1-G1-NN en cada uno).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

const R = Date.now();
const COLUMNAS_LINAJE = ['cruzamiento', 'mama', 'papa', 'mama_id', 'papa_id'] as const;
const CRUZAMIENTO = `SINT-FUGA-${R}`;
const NOMBRE_MAMA = `Mama fuga-g1 ${R}`;
const NOMBRE_PAPA = `Papa fuga-g1 ${R}`;

function psql(sql: string): string {
  return execFileSync('docker', ['exec', 'supabase_db_dbsecurity-frutales', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', sql], { encoding: 'utf8' }).trim();
}

let creds: ReturnType<typeof getLocalCreds>;
let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let operarioLinaje: SupabaseClient;
let operarioLinajeId: string;
let especieId: string;
let varMamaId: string;
let varPapaId: string;
let plantaId: string;
let loteId: string;

async function contarAuditoriaTotal(usuarioId: string) {
  const { count, error } = await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', usuarioId);
  if (error) throw error;
  return count ?? 0;
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-fuga-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  operario = (await crearUsuarioDePrueba(creds, service, { email: `aud-g1-fuga-operario-${R}@test.local`, rol: 'operario' })).client;
  const opl = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-fuga-operario-linaje-${R}@test.local`, rol: 'operario', puedeVerLinaje: true });
  operarioLinaje = opl.client;
  operarioLinajeId = opl.userId;

  const { data: esp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  especieId = esp!.id;
  const { data: vars, error: errVar } = await service
    .from('variedades')
    .insert([
      { especie_id: especieId, nombre: NOMBRE_MAMA, created_by: adminId },
      { especie_id: especieId, nombre: NOMBRE_PAPA, created_by: adminId },
    ])
    .select('id, nombre');
  if (errVar || !vars) throw new Error(`setup variedades: ${errVar?.message}`);
  varMamaId = vars.find((v) => v.nombre === NOMBRE_MAMA)!.id;
  varPapaId = vars.find((v) => v.nombre === NOMBRE_PAPA)!.id;

  // El cruce nace por el camino real del admin (INSERT con linaje → alta_cruce) y recibe una edición de linaje.
  const { data: planta, error: errPl } = await admin
    .from('plantas')
    .insert({ codigo_sistema: `AUD-G1-${R}-FUGA`, especie_id: especieId, cruzamiento: CRUZAMIENTO, mama_id: varMamaId, papa_id: varPapaId, es_prueba: true })
    .select('id')
    .single();
  if (errPl || !planta) throw new Error(`setup planta: ${errPl?.message}`);
  plantaId = planta.id;
  const { error: errLin } = await admin.rpc('actualizar_linaje', { p_planta_id: plantaId, p_cruzamiento: `${CRUZAMIENTO}-ED`, p_mama_id: varPapaId, p_papa_id: varMamaId });
  if (errLin) throw new Error(`setup linaje: ${errLin.message}`);

  // Un lote del importador con linaje en claro (nombres de variedad y cruzamiento).
  const prev = await admin.rpc('previsualizar_importacion_cruces', {
    p_filas: [{ codigo_sistema: `AUD-G1-${R}-FUGA-IMP`, especie: 'Arándano', cruzamiento: `${CRUZAMIENTO}-IMP`, mama: NOMBRE_MAMA, papa: NOMBRE_PAPA, es_prueba: 'si' }],
    p_archivo_nombre: `aud-g1-fuga-${R}.csv`,
  });
  if (prev.error) throw new Error(`setup lote: ${prev.error.message}`);
  loteId = (prev.data as { lote_id: string }).lote_id;
  const conf = await admin.rpc('confirmar_importacion_cruces', { p_lote_id: loteId, p_crear_variedades: false, p_idempotency_key: randomUUID() });
  if (conf.error) throw new Error(`setup confirmar: ${conf.error.message}`);

  // Datos heredados de Notion en el cruce (los escribe un script administrativo, nunca la app).
  await service.from('plantas').update({ genetica_a: `Programa A ${R}`, genetica_b: `Programa B ${R}` }).eq('id', plantaId);
}, 60_000);

afterAll(async () => {
  await service.from('plantas').delete().like('codigo_sistema', `AUD-G1-${R}-%`);
  if (loteId) await service.from('importacion_lote').delete().eq('id', loteId);
  await service.from('variedades').delete().ilike('nombre', `%fuga-g1 ${R}%`);
}, 60_000);

describe('C08 oráculos por filtro y orden sobre las columnas revocadas', () => {
  it('filtrar, ordenar o buscar por una columna de linaje falla con 42501 (operario, operario con permiso y admin)', async () => {
    for (const [rol, cliente] of [['operario', operario], ['operario-linaje', operarioLinaje], ['admin', admin]] as const) {
      for (const col of COLUMNAS_LINAJE) {
        // Un valor mal tipado se rechaza antes (22P02) que el permiso: para las columnas uuid se manda un uuid válido.
        const valor = col.endsWith('_id') ? '00000000-0000-4000-8000-000000000000' : 'x';
        const intentos: Record<string, PromiseLike<{ error: { code?: string } | null }>> = {
          eq: cliente.from('plantas').select('id').eq(col, valor).limit(1),
          nulo: cliente.from('plantas').select('id').not(col, 'is', null).limit(1),
          orden: cliente.from('plantas').select('id').order(col).limit(1),
        };
        if (!col.endsWith('_id')) intentos.ilike = cliente.from('plantas').select('id').ilike(col, '%a%').limit(1);
        for (const [tipo, consulta] of Object.entries(intentos)) {
          const { error } = await consulta;
          expect(error?.code, `${rol} ${tipo} ${col}`).toBe('42501');
        }
      }
    }
  });

  it('el filtro por linaje dentro de un embed (plantas!inner) también falla con 42501', async () => {
    for (const cliente of [operario, admin]) {
      for (const col of COLUMNAS_LINAJE) {
        const valor = col.endsWith('_id') ? '00000000-0000-4000-8000-000000000000' : 'x';
        const { error } = await cliente.from('individuos').select('id, plantas!inner(id)').eq(`plantas.${col}`, valor).limit(1);
        expect(error?.code, col).toBe('42501');
      }
    }
  });
});

describe('C08 barrido de embeds desde todas las tablas con FK hacia plantas', () => {
  const tablasHijas = psql(
    `select distinct conrelid::regclass::text from pg_constraint where confrelid = 'public.plantas'::regclass and contype = 'f' and conrelid::regclass::text <> 'plantas' order by 1`,
  ).split('\n').filter(Boolean);

  it('el catálogo trae las tablas hijas esperadas (el barrido no queda vacío)', () => {
    expect(tablasHijas.length).toBeGreaterThanOrEqual(10);
    expect(tablasHijas).toEqual(expect.arrayContaining(['individuos', 'polinizacion_evento', 'registros_evento', 'audit_log']));
  });

  it('ningún embed plantas(<linaje>) devuelve datos desde ninguna tabla hija, para ningún rol', async () => {
    for (const tabla of tablasHijas) {
      for (const [rol, cliente] of [['operario', operario], ['operario-linaje', operarioLinaje], ['admin', admin]] as const) {
        for (const col of COLUMNAS_LINAJE) {
          const { data, error } = await cliente.from(tabla).select(`plantas(${col})`).limit(1);
          // Dos desenlaces válidos: error de permiso, o sin relación embebible (la FK puede no ser navegable). Jamás datos.
          if (!error) {
            const texto = JSON.stringify(data ?? []);
            expect(texto, `${rol} ${tabla}.plantas(${col})`).not.toMatch(/SINT-FUGA|fuga-g1/);
            expect(texto, `${rol} ${tabla}.plantas(${col})`).not.toContain(`"${col}"`);
          }
        }
      }
    }
  }, 120_000);
});

describe('C08 guardas de catálogo', () => {
  it('authenticated y anon no tienen SELECT, UPDATE ni REFERENCES sobre las columnas de linaje de plantas', () => {
    const filas = psql(
      `select grantee||'.'||column_name||'.'||privilege_type from information_schema.column_privileges where table_schema='public' and table_name='plantas' and grantee in ('anon','authenticated','public') and column_name in ('cruzamiento','mama','papa','mama_id','papa_id') and privilege_type in ('SELECT','UPDATE','REFERENCES') order by 1`,
    );
    expect(filas).toBe('');
  });

  it('ninguna otra relación de public tiene una columna llamada como el linaje (salvo plantas y perfiles.puede_ver_linaje)', () => {
    const filas = psql(
      `select table_name||'.'||column_name from information_schema.columns where table_schema='public' and column_name ~* '(cruzamiento|^mama|^papa|linaje|progenitor)' and not (table_name='plantas') and not (table_name='perfiles' and column_name='puede_ver_linaje') order by 1`,
    );
    expect(filas).toBe('');
  });

  it('el conjunto de funciones que tocan mama_id/papa_id es exactamente el revisado en esta auditoría', () => {
    const funciones = psql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosrc ~* '(mama_id|papa_id)' order by 1`,
    ).split('\n');
    // Cualquier función nueva que lea linaje obliga a revisar su gate de rol, su auditoría y su límite de frecuencia.
    expect(funciones).toEqual([
      'actualizar_linaje',
      'auditar_alta_cruce',
      'auditar_cambio_catalogo_linaje', // trigger sin EXECUTE cliente; solo registra ID y cantidad de referencias
      'confirmar_importacion_cruces',
      'obtener_planta',
      'obtener_ranking_polinizacion_varietal',
      'validar_filas_importacion_cruces',
    ]);
  });

  it('la única vista de public que lee plantas es plantas_operativas y es security_invoker', () => {
    const vistas = psql(`select c.relname||':'||coalesce(c.reloptions::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m') order by 1`);
    expect(vistas).toBe('plantas_operativas:{security_invoker=on}');
  });

  it('plantas no está en ninguna publicación de Realtime (que no respeta grants de columna)', () => {
    expect(psql(`select count(*) from pg_publication_tables where tablename in ('plantas','importacion_lote','audit_log','variedades')`)).toBe('0');
  });
});

describe('C08 linaje que un admin puede sacar sin pasar por obtener_planta', () => {
  it('A1-004: el lote confirmado no conserva filas ni permite SELECT directo al admin', async () => {
    const { data, error } = await admin.from('importacion_lote').select('id, filas').eq('id', loteId).single();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
    const lote = await service.from('importacion_lote').select('filas').eq('id', loteId).single();
    expect(lote.error).toBeNull();
    expect(lote.data!.filas).toEqual([]);
    const { data: ajeno } = await operarioLinaje.from('importacion_lote').select('id, filas').eq('id', loteId);
    expect(ajeno ?? []).toHaveLength(0);
  });

  it('A1-004: audit_log conserva identificadores de alta/edición sin texto sensible, y solo lo lee un admin', async () => {
    const { data, error } = await admin.from('audit_log').select('accion, detalle').eq('planta_id', plantaId).in('accion', ['alta_cruce', 'escritura_linaje']);
    expect(error).toBeNull();
    const alta = data!.find((f) => f.accion === 'alta_cruce')!;
    expect(alta.detalle.nuevo).toMatchObject({ mama_id: varMamaId, papa_id: varPapaId });
    const edicion = data!.find((f) => f.accion === 'escritura_linaje')!;
    expect(edicion.detalle.anterior).toMatchObject({ mama_id: varMamaId });
    expect(JSON.stringify(data)).not.toContain(CRUZAMIENTO);
    const { data: ajeno } = await operarioLinaje.from('audit_log').select('id').eq('planta_id', plantaId);
    expect(ajeno ?? []).toHaveLength(0);
  });

  // A1-G1-12: leer importacion_lote.filas o audit_log.detalle entrega el linaje
  // de cientos de cruces en UNA petición, sin fila lectura_linaje y sin el
  // límite de 20/min con que se protegió obtener_planta.
  it('un admin no obtiene linaje en bloque sin dejar rastro de lectura (importacion_lote) (A1-G1-12)', async () => {
    const antes = await contarAuditoriaTotal(adminId);
    const { data, error } = await admin.from('importacion_lote').select('filas').eq('id', loteId);
    const despues = await contarAuditoriaTotal(adminId);
    const devolvioLinaje = !error && JSON.stringify(data).includes(NOMBRE_MAMA);
    // Correcto: o no devuelve el linaje, o la lectura queda auditada.
    expect(!devolvioLinaje || despues > antes).toBe(true);
  });

  it('un admin no obtiene texto de linaje en bloque sin dejar rastro de lectura (audit_log) (A1-G1-12)', async () => {
    const antes = await contarAuditoriaTotal(adminId);
    const { data, error } = await admin.from('audit_log').select('detalle').eq('planta_id', plantaId).eq('accion', 'alta_cruce');
    const despues = await contarAuditoriaTotal(adminId);
    // El plan permite identificadores de variedad; el texto sensible no debe copiarse.
    const devolvioLinaje = !error && JSON.stringify(data).includes(CRUZAMIENTO);
    expect(!devolvioLinaje || despues > antes).toBe(true);
  });

  it('100 lecturas en paralelo de importacion_lote por un admin se rechazan (A1-G1-12)', async () => {
    const respuestas = await Promise.all(Array.from({ length: 100 }, () => admin.from('importacion_lote').select('filas').eq('id', loteId)));
    expect(respuestas.some((r) => r.error)).toBe(true);
  });
});

describe('C08 el permiso de ver linaje no se puede conseguir solo', () => {
  it('un operario no puede ponerse puede_ver_linaje = true ni subirse a admin (UPDATE de su propio perfil)', async () => {
    const { client, userId } = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-fuga-escalada-${R}@test.local`, rol: 'operario' });
    const a = await client.from('perfiles').update({ puede_ver_linaje: true }).eq('id', userId).select('id');
    const b = await client.from('perfiles').update({ rol: 'admin' }).eq('id', userId).select('id');
    expect(a.error ?? b.error).toBeTruthy();
    const { data } = await service.from('perfiles').select('rol, puede_ver_linaje').eq('id', userId).single();
    expect(data).toMatchObject({ rol: 'operario', puede_ver_linaje: false });
    // Y con la ficha: sigue sin linaje.
    const ficha = await client.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(ficha.data).not.toHaveProperty('cruzamiento');
  });

  it('un admin lee el linaje por obtener_planta y queda lectura_linaje a su nombre', async () => {
    const antes = (await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', adminId).eq('accion', 'lectura_linaje')).count ?? 0;
    const { data, error } = await admin.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(error).toBeNull();
    expect(data).toMatchObject({ cruzamiento: `${CRUZAMIENTO}-ED`, mama_id: varPapaId, papa_id: varMamaId });
    const despues = (await service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', adminId).eq('accion', 'lectura_linaje')).count ?? 0;
    expect(despues).toBe(antes + 1);
  });
});

describe('C09 lo que obtener_planta devuelve a quien no tiene permiso de linaje', () => {
  it('la ficha de un operario sin permiso incluye genetica_a/genetica_b y numero_notion_legacy (decisión de la migración 010)', async () => {
    const { data, error } = await operario.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(error).toBeNull();
    expect(data).toMatchObject({ genetica_a: `Programa A ${R}`, genetica_b: `Programa B ${R}` });
    const { data: vista } = await operario.from('plantas_operativas').select('genetica_a, genetica_b').eq('id', plantaId).single();
    expect(vista).toMatchObject({ genetica_a: `Programa A ${R}` });
  });

  // A1-G1-13: v_campos del caso sin linaje declara 3 campos, pero la respuesta
  // trae 8 claves. Si genetica_a/b resultaran sensibles, la auditoría no lo diría.
  it.fails('campos_expuestos de lectura_ficha enumera todo lo que la respuesta devolvió (A1-G1-13)', async () => {
    const { client: lector, userId } = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-fuga-lector-${R}@test.local`, rol: 'operario' });
    const { data, error } = await lector.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(error).toBeNull();
    const { data: fila } = await service
      .from('audit_log')
      .select('campos_expuestos')
      .eq('usuario_id', userId)
      .eq('accion', 'lectura_ficha')
      .order('ocurrido_en', { ascending: false })
      .limit(1)
      .single();
    const devueltas = Object.keys(data as Record<string, unknown>).filter((k) => k !== 'id');
    expect(fila!.campos_expuestos).toEqual(expect.arrayContaining(devueltas));
  });

  it('un operario con permiso de linaje que no es admin no puede reiniciar, borrar ni restaurar el cruce (aunque la ficha le muestre «Gestión de este cruce»)', async () => {
    const reiniciar = await operarioLinaje.rpc('reiniciar_cruzamiento', { p_planta_id: plantaId });
    const borrar = await operarioLinaje.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'soft' });
    const restaurar = await operarioLinaje.rpc('restaurar_cruzamiento', { p_planta_id: plantaId });
    expect(reiniciar.error?.code).toBe('42501');
    expect(borrar.error?.code).toBe('42501');
    expect(restaurar.error?.code).toBe('42501');
    const { data } = await service.from('plantas').select('eliminado_at').eq('id', plantaId).single();
    expect(data!.eliminado_at).toBeNull();
    expect(operarioLinajeId).toBeTruthy();
  });
});
