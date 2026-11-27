/**
 * Auditoría integral, Corrida 1, grupo G1 — flujos C08 (ver linaje) y C09
 * (abrir la ficha). Verifica contra la base local, con usuarios propios, que un
 * operario sin permiso no puede leer `cruzamiento`/`mama_id`/`papa_id` ni
 * `mama`/`papa` por ningún camino de la API (SELECT directo, `select=*`,
 * vista, embeds desde tablas hijas, RPC que devuelven cruces), y cómo se
 * comporta `obtener_planta` ante archivados, inexistentes y el límite 20/min.
 *
 * Los `it.fails` demuestran hallazgos abiertos (ID A1-G1-NN en cada uno).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from '../helpers';

const R = Date.now();
const CRUZAMIENTO = `SINT-AUD-G1-${R}`;
const NOMBRE_MAMA = `Mama aud-g1 ${R}`;
const NOMBRE_PAPA = `Papa aud-g1 ${R}`;
const CLAVES_LINAJE = /^(cruzamiento|mama|papa|mama_id|papa_id|mama_nombre|papa_nombre)$/;

let creds: ReturnType<typeof getLocalCreds>;
let service: SupabaseClient;
let anon: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let operarioId: string;
let operarioLinaje: SupabaseClient;
let operarioLinajeId: string;
let especieId: string;
let variedadMamaId: string;
let variedadPapaId: string;
let plantaId: string;
let plantaArchivadaId: string;
let individuoId: string;

/** Claves de linaje encontradas en cualquier nivel de un JSON. */
function clavesDeLinaje(valor: unknown, ruta = '$'): string[] {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => clavesDeLinaje(v, `${ruta}[${i}]`));
  if (valor && typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) => [
      ...(CLAVES_LINAJE.test(k) ? [`${ruta}.${k}`] : []),
      ...clavesDeLinaje(v, `${ruta}.${k}`),
    ]);
  }
  return [];
}

/** Valores de linaje de la planta de prueba que no deberían aparecer en ninguna respuesta. */
function contieneValoresDeLinaje(valor: unknown): boolean {
  const texto = JSON.stringify(valor) ?? '';
  return texto.includes(CRUZAMIENTO) || texto.includes(NOMBRE_MAMA) || texto.includes(NOMBRE_PAPA)
    || texto.includes(variedadMamaId) || texto.includes(variedadPapaId);
}

async function contarAuditoria(usuarioId: string, acciones: string[]) {
  const { count, error } = await service
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', usuarioId)
    .in('accion', acciones);
  if (error) throw error;
  return count ?? 0;
}

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ad = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-lectura-admin-${R}@test.local`, rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  const op = await crearUsuarioDePrueba(creds, service, { email: `aud-g1-lectura-operario-${R}@test.local`, rol: 'operario' });
  operario = op.client;
  operarioId = op.userId;
  const opl = await crearUsuarioDePrueba(creds, service, {
    email: `aud-g1-lectura-operario-linaje-${R}@test.local`,
    rol: 'operario',
    puedeVerLinaje: true,
  });
  operarioLinaje = opl.client;
  operarioLinajeId = opl.userId;

  const { data: esp, error: errEsp } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (errEsp || !esp) throw new Error(`setup especie: ${errEsp?.message}`);
  especieId = esp.id;

  const { data: variedades, error: errVar } = await service
    .from('variedades')
    .insert([
      { especie_id: especieId, nombre: NOMBRE_MAMA, created_by: adminId },
      { especie_id: especieId, nombre: NOMBRE_PAPA, created_by: adminId },
    ])
    .select('id, nombre');
  if (errVar || !variedades) throw new Error(`setup variedades: ${errVar?.message}`);
  variedadMamaId = variedades.find((v) => v.nombre === NOMBRE_MAMA)!.id;
  variedadPapaId = variedades.find((v) => v.nombre === NOMBRE_PAPA)!.id;

  const { data: plantas, error: errPl } = await service
    .from('plantas')
    .insert([
      {
        codigo_sistema: `AUD-G1-${R}-LEC`,
        especie_id: especieId,
        cruzamiento: CRUZAMIENTO,
        mama_id: variedadMamaId,
        papa_id: variedadPapaId,
        estado: 'polinizacion',
        es_prueba: true,
        eliminado_at: null,
      },
      {
        codigo_sistema: `AUD-G1-${R}-ARCH`,
        especie_id: especieId,
        cruzamiento: CRUZAMIENTO,
        mama_id: null,
        papa_id: null,
        estado: 'sin_empezar',
        es_prueba: true,
        eliminado_at: new Date().toISOString(),
      },
    ])
    .select('id, codigo_sistema');
  if (errPl || !plantas) throw new Error(`setup plantas: ${errPl?.message}`);
  plantaId = plantas.find((p) => p.codigo_sistema === `AUD-G1-${R}-LEC`)!.id;
  plantaArchivadaId = plantas.find((p) => p.codigo_sistema === `AUD-G1-${R}-ARCH`)!.id;

  const { data: ind, error: errInd } = await service
    .from('individuos')
    .insert({ planta_id: plantaId, codigo_display: `AUD-G1-${R}-LEC-P01`, created_by: adminId })
    .select('id')
    .single();
  if (errInd || !ind) throw new Error(`setup individuo: ${errInd?.message}`);
  individuoId = ind.id;

  const { error: errPol } = await service
    .from('polinizacion_evento')
    .insert({ planta_id: plantaId, fecha: '2026-10-01', n_flores_cruzadas: 3, created_by: adminId });
  if (errPol) throw new Error(`setup polinizacion: ${errPol.message}`);
}, 60_000);

afterAll(async () => {
  // El individuo no tiene borrado físico por diseño salvo vía borrar_cruzamiento(hard).
  if (plantaId) await admin.rpc('borrar_cruzamiento', { p_planta_id: plantaId, p_tipo: 'hard' });
  if (plantaArchivadaId) await service.from('plantas').delete().eq('id', plantaArchivadaId);
  await service.from('variedades').delete().in('id', [variedadMamaId, variedadPapaId].filter(Boolean));
});

describe('C08 lectura: caminos directos cerrados para el operario', () => {
  it('SELECT directo de cruzamiento/mama/papa/mama_id/papa_id en plantas: permiso denegado', async () => {
    for (const columnas of ['cruzamiento', 'mama', 'papa', 'mama_id', 'papa_id', 'cruzamiento, mama_id, papa_id']) {
      const { error } = await operario.from('plantas').select(columnas).eq('id', plantaId);
      expect(error, columnas).not.toBeNull();
      expect(error!.code).toBe('42501');
    }
  });

  it('select=* sobre plantas falla para operario y también para admin (el grant es por columna)', async () => {
    const { error: errOp } = await operario.from('plantas').select('*').eq('id', plantaId);
    expect(errOp?.code).toBe('42501');
    const { error: errAd } = await admin.from('plantas').select('*').eq('id', plantaId);
    expect(errAd?.code).toBe('42501');
  });

  it('la vista plantas_operativas con select=* no trae ninguna clave ni valor de linaje', async () => {
    const { data, error } = await operario.from('plantas_operativas').select('*').eq('id', plantaId).single();
    expect(error).toBeNull();
    expect(clavesDeLinaje(data)).toEqual([]);
    expect(contieneValoresDeLinaje(data)).toBe(false);
  });

  it('embeds desde individuos y polinizacion_evento: solo columnas no sensibles; pedir linaje o * falla', async () => {
    const ok = await operario.from('individuos').select('id, plantas(codigo_sistema)').eq('id', individuoId).single();
    expect(ok.error).toBeNull();
    expect((ok.data as { plantas: { codigo_sistema: string } }).plantas.codigo_sistema).toBe(`AUD-G1-${R}-LEC`);

    const intentos: Array<[string, string]> = [
      ['individuos', 'id, plantas(*)'],
      ['individuos', 'id, plantas(cruzamiento)'],
      ['individuos', 'id, plantas(mama_id, papa_id)'],
      ['polinizacion_evento', '*, plantas(*)'],
      ['polinizacion_evento', 'id, plantas(cruzamiento, mama, papa)'],
    ];
    for (const [tabla, columnas] of intentos) {
      const { error } = await operario.from(tabla).select(columnas).eq(tabla === 'individuos' ? 'id' : 'planta_id', tabla === 'individuos' ? individuoId : plantaId);
      expect(error, `${tabla}?select=${columnas}`).not.toBeNull();
      expect(error!.code, `${tabla}?select=${columnas}`).toBe('42501');
    }
  });

  it('las RPC que devuelven cruces no exponen claves ni valores de linaje al operario', async () => {
    const llamadas: Array<[string, Record<string, unknown>]> = [
      ['listar_cruces_analiticos', { p_busqueda: `AUD-G1-${R}`, p_limite: 100 }],
      ['obtener_dashboard_cientifico', { p_especie_id: especieId, p_limite: 8 }],
      ['obtener_mapa_cruce', { p_planta_id: plantaId }],
      ['consultar_mapa_viewport', { p_latitud_minima: -90, p_latitud_maxima: 90, p_longitud_minima: -180, p_longitud_maxima: 180, p_limite: 250 }],
      ['obtener_resumen_mapa_territorial', { p_especie_id: especieId, p_limite: 100 }],
      ['obtener_series_historicas_cientificas', { p_especie_id: especieId, p_planta_id: plantaId }],
      ['obtener_ranking_operativo', { p_planta_id: plantaId, p_limite: 25 }],
      ['obtener_scoring_planta', { p_planta_id: plantaId }],
      ['conteo_cruces_por_estado', {}],
      ['listar_canales_chat', {}],
    ];
    for (const [fn, args] of llamadas) {
      const { data, error } = await operario.rpc(fn, args);
      if (fn === 'consultar_mapa_viewport') {
        // Solo admin (valida es_admin adentro): para el operario el resultado correcto es 42501.
        expect(error?.code, fn).toBe('42501');
        continue;
      }
      expect(error, `${fn}: ${error?.message}`).toBeNull();
      expect(clavesDeLinaje(data), fn).toEqual([]);
      expect(contieneValoresDeLinaje(data), fn).toBe(false);
    }
    // Las mismas RPC como admin tampoco devuelven linaje: no es su camino (obtener_planta lo es).
    for (const [fn, args] of llamadas) {
      const { data, error } = await admin.rpc(fn, args);
      expect(error, `${fn} (admin): ${error?.message}`).toBeNull();
      expect(clavesDeLinaje(data), `${fn} (admin)`).toEqual([]);
      expect(contieneValoresDeLinaje(data), `${fn} (admin)`).toBe(false);
    }
  });

  it('la búsqueda de listar_cruces_analiticos no actúa como oráculo sobre el texto del cruzamiento', async () => {
    const { data, error } = await operario.rpc('listar_cruces_analiticos', { p_busqueda: CRUZAMIENTO, p_limite: 100 });
    expect(error).toBeNull();
    expect((data as { items: unknown[] }).items).toHaveLength(0);
  });

  it('audit_log e importacion_lote están vacíos para el operario, aun con permiso de linaje', async () => {
    for (const cliente of [operario, operarioLinaje]) {
      const audit = await cliente.from('audit_log').select('id, detalle').eq('planta_id', plantaId);
      if (audit.error) expect(audit.error).toBeTruthy();
      else expect(audit.data).toHaveLength(0);
      const lotes = await cliente.from('importacion_lote').select('id, filas');
      if (lotes.error) expect(lotes.error).toBeTruthy();
      else expect(lotes.data).toHaveLength(0);
    }
  });

  it('el operario puede listar variedades con created_at y created_by (decisión documentada; ver A1-G1 canal lateral)', async () => {
    const { data, error } = await operario.from('variedades').select('id, nombre, created_at, created_by, activo').in('id', [variedadMamaId, variedadPapaId]);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data![0].created_at).toBeTruthy();
    const { data: pl } = await operario.from('plantas_operativas').select('id, created_at').eq('id', plantaId).single();
    expect(pl?.created_at).toBeTruthy();
  });

  it('anon no puede llamar obtener_planta ni leer plantas_operativas, plantas o variedades', async () => {
    const rpc = await anon.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(rpc.error).not.toBeNull();
    for (const tabla of ['plantas_operativas', 'plantas', 'variedades']) {
      const { data, error } = await anon.from(tabla).select('id').limit(1);
      if (error) expect(error, tabla).toBeTruthy();
      else expect(data, tabla).toHaveLength(0);
    }
  });
});

describe('C08 lectura: obtener_planta según permiso', () => {
  it('operario sin permiso: ficha sin linaje y fila lectura_ficha a su nombre', async () => {
    const antes = await contarAuditoria(operarioId, ['lectura_ficha']);
    const { data, error } = await operario.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(error).toBeNull();
    expect(clavesDeLinaje(data)).toEqual([]);
    expect(contieneValoresDeLinaje(data)).toBe(false);
    expect(await contarAuditoria(operarioId, ['lectura_ficha'])).toBe(antes + 1);
  });

  it('operario con puede_ver_linaje: ficha con linaje, nombres resueltos y fila lectura_linaje', async () => {
    const antes = await contarAuditoria(operarioLinajeId, ['lectura_linaje']);
    const { data, error } = await operarioLinaje.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(error).toBeNull();
    const ficha = data as Record<string, unknown>;
    expect(ficha.cruzamiento).toBe(CRUZAMIENTO);
    expect(ficha.mama_id).toBe(variedadMamaId);
    expect(ficha.papa_id).toBe(variedadPapaId);
    expect(ficha.mama_nombre).toBe(NOMBRE_MAMA);
    expect(ficha.papa_nombre).toBe(NOMBRE_PAPA);
    expect(await contarAuditoria(operarioLinajeId, ['lectura_linaje'])).toBe(antes + 1);
    const { data: fila } = await service
      .from('audit_log')
      .select('campos_expuestos, detalle')
      .eq('usuario_id', operarioLinajeId)
      .eq('accion', 'lectura_linaje')
      .order('ocurrido_en', { ascending: false })
      .limit(1)
      .single();
    expect(fila!.campos_expuestos).toEqual(expect.arrayContaining(['cruzamiento', 'mama_id', 'papa_id']));
  });
});

describe('C09 apertura de ficha: archivados, inexistentes y límite de frecuencia', () => {
  it('un cruce archivado y un UUID inexistente devuelven P0002 (también para admin) y NO escriben auditoría', async () => {
    const antesOp = await contarAuditoria(operarioId, ['lectura_ficha', 'lectura_linaje']);
    const antesAd = await contarAuditoria(adminId, ['lectura_ficha', 'lectura_linaje']);
    for (const cliente of [operario, admin]) {
      const arch = await cliente.rpc('obtener_planta', { p_planta_id: plantaArchivadaId });
      expect(arch.error?.code).toBe('P0002');
      const nada = await cliente.rpc('obtener_planta', { p_planta_id: '00000000-0000-4000-8000-000000000000' });
      expect(nada.error?.code).toBe('P0002');
    }
    expect(await contarAuditoria(operarioId, ['lectura_ficha', 'lectura_linaje'])).toBe(antesOp);
    expect(await contarAuditoria(adminId, ['lectura_ficha', 'lectura_linaje'])).toBe(antesAd);
  });

  it('un operario puede leer directamente de plantas las columnas no sensibles de un cruce archivado', async () => {
    // La vista lo excluye, pero la policy de SELECT de la tabla no filtra eliminado_at.
    const { data, error } = await operario.from('plantas').select('id, codigo_sistema, eliminado_at').eq('id', plantaArchivadaId).single();
    expect(error).toBeNull();
    expect(data!.eliminado_at).not.toBeNull();
  });

  it('la lectura 21 dentro del minuto falla con 58503 y las 20 anteriores quedan auditadas', async () => {
    const { client: lector, userId } = await crearUsuarioDePrueba(creds, service, {
      email: `aud-g1-lectura-ratelimit-${R}@test.local`,
      rol: 'operario',
    });
    for (let i = 0; i < 20; i++) {
      const { error } = await lector.rpc('obtener_planta', { p_planta_id: plantaId });
      expect(error, `lectura ${i + 1}`).toBeNull();
    }
    const { error } = await lector.rpc('obtener_planta', { p_planta_id: plantaId });
    expect(error?.code).toBe('58503');
    expect(error?.message).toMatch(/20 lecturas por minuto/);
    expect(await contarAuditoria(userId, ['lectura_ficha'])).toBe(20);
  }, 60_000);
});
