/**
 * Scripts de limpieza de datos (scripts/limpieza/, ítem S3-4) — ensayo EMPÍRICO
 * contra la base y el Storage LOCALES.
 *
 * Siembra casos de cada clase con datos propios (cruces `LIMP-<R>-...`), más casos
 * legítimos y casos «revisar a mano» que NO deben tocarse, y comprueba:
 *   1. el informe encuentra exactamente lo sembrado (y nada de los fixtures 02-9xx);
 *   2. la aplicación sin confirmar, o con un conteo esperado distinto, no cambia nada;
 *   3. con confirmación corrige solo lo sembrado y deja rastro en audit_log;
 *   4. el informe posterior da 0 en lo corregible.
 *
 * Los scripts SQL se ejecutan por `docker exec ... psql` en el contenedor local y el
 * de Storage con node y las claves del contenedor Kong local. Todos los filtros
 * (`filtro_codigo`, `filtro_ruta`, `--prefijo`) acotan la acción a lo sembrado: las
 * inconsistencias previas de la base local NO se corrigen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from './helpers';

const DIR = fileURLToPath(new URL('../../scripts/limpieza/', import.meta.url));
const CONTENEDOR_DB = 'supabase_db_dbsecurity-frutales';
const R = Date.now();
const PREFIJO = `LIMP-${R}`;
const OPERADOR = `LIMP-TEST-${R}`;
const FOTO = Buffer.from('/9j/4AAQSkZJRgABAQ', 'base64'); // bytes mínimos; Storage no valida el contenido

let creds: LocalCreds;
let service: SupabaseClient;
let adminId: string;
let especieId: string;

// Ids sembrados
let cruceA = '';
let cruceB = '';
let cruceC = '';
const ev: Record<string, string> = {};
const archivoId: Record<string, string> = {};
const sesion: Record<string, string> = {};

const rutas = {
  huerfano1: `plantas/${PREFIJO}-A/huerfano1/foto.jpg`,
  huerfano2: `plantas/${PREFIJO}-A/huerfano2/foto.jpg`,
  reciente: `plantas/${PREFIJO}-A/reciente/foto.jpg`,
  ligado: `plantas/${PREFIJO}-A/ligado/foto.jpg`,
  eliminado: `plantas/${PREFIJO}-A/eliminado/foto.jpg`,
  fantasma: `plantas/${PREFIJO}-A/fantasma/foto.jpg`, // la fila existe, el objeto no
  evecl: `evecl/${PREFIJO}/1/1/1.jpg`,
};

/** Ejecuta un script SQL de scripts/limpieza dentro del contenedor local. -A -t -F| para poder parsear. */
function psql(archivo: string, vars: Record<string, string> = {}): string {
  const args = ['exec', '-i', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  return execFileSync('docker', args, { input: readFileSync(DIR + archivo, 'utf8'), encoding: 'utf8' });
}

/** SQL suelto en el contenedor local (solo para preparar/consultar datos propios). */
function sql(consulta: string): string {
  return execFileSync('docker', ['exec', '-i', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    input: consulta, encoding: 'utf8',
  }).trim();
}

/** Primera línea totalmente numérica del informe (la fila de resumen), como números. */
function resumen(salida: string): number[] {
  const linea = salida.split('\n').find((l) => /^\d+(\|\d+)*$/.test(l.trim()));
  if (!linea) throw new Error(`No hallé la fila de resumen en:\n${salida}`);
  return linea.trim().split('|').map(Number);
}

function resumenHuerfanos(salida: string, bucket: string): number[] {
  const linea = salida.split('\n').find((l) => l.startsWith(`${bucket}|`));
  return linea ? linea.split('|').slice(1).map(Number) : [0, 0, 0, 0];
}

interface ResultadoMjs { codigo: number; salida: string }
function mjs(args: string[], envExtra: Record<string, string> = {}): ResultadoMjs {
  try {
    const salida = execFileSync('node', [DIR + 'aplicar_huerfanos_storage.mjs', ...args], {
      encoding: 'utf8',
      env: { ...process.env, LIMPIEZA_SUPABASE_URL: creds.url, LIMPIEZA_SERVICE_KEY: creds.serviceKey, ...envExtra },
    });
    return { codigo: 0, salida };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { codigo: err.status ?? -1, salida: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

async function subir(bucket: string, ruta: string): Promise<void> {
  const { error } = await service.storage.from(bucket).upload(ruta, FOTO, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`subir ${bucket}/${ruta}: ${error.message}`);
}

async function existe(bucket: string, ruta: string): Promise<boolean> {
  const carpeta = ruta.slice(0, ruta.lastIndexOf('/'));
  const nombre = ruta.slice(ruta.lastIndexOf('/') + 1);
  const { data, error } = await service.storage.from(bucket).list(carpeta, { search: nombre });
  if (error) throw new Error(`listar ${bucket}/${carpeta}: ${error.message}`);
  return data.some((o) => o.name === nombre);
}

async function crearCruce(sufijo: string, estado = 'polinizacion'): Promise<string> {
  const { data, error } = await service
    .from('plantas')
    .insert({ codigo_sistema: `${PREFIJO}-${sufijo}`, especie_id: especieId, estado, es_prueba: true })
    .select('id').single();
  if (error || !data) throw new Error(`setup cruce ${sufijo}: ${error?.message}`);
  return data.id;
}

async function crearSesion(plantaId: string, fecha: string, flores: number): Promise<string> {
  const { data, error } = await service
    .from('polinizacion_evento')
    .insert({ planta_id: plantaId, fecha, n_flores_cruzadas: flores, created_by: adminId })
    .select('id').single();
  if (error || !data) throw new Error(`setup sesión ${fecha}: ${error?.message}`);
  return data.id;
}

async function crearEvento(plantaId: string, fecha: string, notas: string, eliminado = false): Promise<string> {
  const { data, error } = await service
    .from('registros_evento')
    .insert({
      planta_id: plantaId, tipo_evento: 'polinizacion', fecha, notas, created_by: adminId,
      datos: { fecha_polinizacion: fecha, n_flores_cruzadas: 5 },
      eliminado_at: eliminado ? new Date().toISOString() : null,
    })
    .select('id').single();
  if (error || !data) throw new Error(`setup evento ${fecha}: ${error?.message}`);
  return data.id;
}

async function crearArchivo(registroId: string, ruta: string): Promise<string> {
  const { data, error } = await service
    .from('evento_archivos')
    .insert({ registro_id: registroId, storage_path: ruta, tipo: 'foto', created_by: adminId })
    .select('id').single();
  if (error || !data) throw new Error(`setup archivo ${ruta}: ${error?.message}`);
  return data.id;
}

async function eventoEliminado(id: string): Promise<boolean> {
  const { data } = await service.from('registros_evento').select('eliminado_at').eq('id', id).single();
  return data?.eliminado_at != null;
}

async function existeArchivoFila(id: string): Promise<boolean> {
  const { data } = await service.from('evento_archivos').select('id').eq('id', id).maybeSingle();
  return data != null;
}

let baseline4 = 0; // sesiones sin bitácora en cruces activos, sin filtro, antes de sembrar
let baseline5 = 0; // bitácora sin sesión automatizable, sin filtro, antes de sembrar

beforeAll(async () => {
  creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ad = await crearUsuarioDePrueba(creds, service, { email: 'admin@test.local', rol: 'admin' });
  adminId = ad.userId;
  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  especieId = esp.id;

  // Estado previo de toda la base local (no se corrige nada de esto).
  baseline4 = resumen(psql('informe_sesiones_sin_bitacora.sql'))[1];
  baseline5 = resumen(psql('informe_bitacora_sin_sesion.sql'))[1];

  cruceA = await crearCruce('A');
  cruceB = await crearCruce('B');
  cruceC = await crearCruce('C', 'proceso_finalizado');

  // --- Cruce A: activo en polinización ---
  sesion.s1 = await crearSesion(cruceA, '2026-03-01', 10); // CLASE 4: sesión sin bitácora
  sesion.s2 = await crearSesion(cruceA, '2026-03-02', 11); // legítima: tiene su evento
  ev.e2 = await crearEvento(cruceA, '2026-03-02', 'legítimo con sesión');
  ev.e3 = await crearEvento(cruceA, '2026-03-05', 'CLASE 5: sin sesión, automatizable');
  ev.e4 = await crearEvento(cruceA, '2026-03-06', 'sin sesión pero con archivo: revisar a mano');
  sesion.s5 = await crearSesion(cruceA, '2026-03-07', 12);
  ev.e5 = await crearEvento(cruceA, '2026-03-07', 'legítimo con sesión y con un archivo cuyo objeto no existe');
  ev.e6 = await crearEvento(cruceA, '2026-03-08', 'eliminado (lógico) con archivo en Storage', true); // CLASE 3

  // --- Cruce B: archivado (se archiva al final, tras sembrar) ---
  sesion.sB = await crearSesion(cruceB, '2026-03-01', 7); // sesión sin bitácora en cruce archivado
  ev.eB = await crearEvento(cruceB, '2026-03-09', 'sin sesión en cruce archivado');
  // --- Cruce C: proceso finalizado ---
  ev.eC = await crearEvento(cruceC, '2026-03-09', 'sin sesión en cruce finalizado');

  // --- Storage ---
  for (const r of [rutas.huerfano1, rutas.huerfano2, rutas.reciente, rutas.ligado, rutas.eliminado]) await subir('media-plantas', r);
  await subir('evecl-fotos', rutas.evecl);
  archivoId.ligado = await crearArchivo(ev.e4, rutas.ligado); // referenciado por e4
  archivoId.eliminado = await crearArchivo(ev.e6, rutas.eliminado); // referenciado por un evento eliminado (CLASE 3)
  archivoId.fantasma = await crearArchivo(ev.e5, rutas.fantasma); // CLASE 2: el objeto no existe

  // Los huérfanos «antiguos» se envejecen en la base local; `reciente` queda con la hora de ahora.
  sql(`update storage.objects set created_at = now() - interval '3 days'
       where (bucket_id = 'media-plantas' and name like 'plantas/${PREFIJO}-A/%' and name not like '%/reciente/%')
          or (bucket_id = 'evecl-fotos' and name like 'evecl/${PREFIJO}/%');`);

  // El cruce B se archiva al final, ya con sus datos.
  await service.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', cruceB);
}, 120_000);

afterAll(async () => {
  // Rastro de auditoría de esta prueba, antes de borrar los cruces (la FK es SET NULL).
  const ids = [cruceA, cruceB, cruceC].filter(Boolean);
  if (ids.length) await service.from('audit_log').delete().in('planta_id', ids);
  await service.from('audit_log').delete().in('accion', ['limpieza_datos', 'limpieza_datos_resumen']).eq('detalle->>operador', OPERADOR);
  for (const bucket of ['media-plantas', 'evecl-fotos']) {
    const todas = Object.values(rutas);
    await service.storage.from(bucket).remove(todas);
  }
  if (ids.length) {
    await service.from('evento_archivos').delete().in('registro_id', Object.values(ev));
    await service.from('registros_evento').delete().in('planta_id', ids);
    await service.from('polinizacion_evento').delete().in('planta_id', ids);
    await service.from('plantas').delete().in('id', ids);
  }
}, 120_000);

describe('Informes: encuentran lo sembrado y solo eso', () => {
  it('Clase 1 (huérfanos de Storage): con la edad mínima por defecto no cuenta nada; con 0 h aparecen los antiguos', () => {
    const porDefecto = resumenHuerfanos(psql('informe_huerfanos_storage.sql', { filtro_ruta: `plantas/${PREFIJO}` }), 'media-plantas');
    // [objetos, antiguos, recientes, bytes]: 5 objetos propios; 2 huérfanos antiguos; 1 reciente; ligado y eliminado referenciados.
    expect(porDefecto.slice(0, 3)).toEqual([5, 2, 1]);
    const evecl = resumenHuerfanos(psql('informe_huerfanos_storage.sql', { filtro_ruta: `evecl/${PREFIJO}` }), 'evecl-fotos');
    expect(evecl.slice(0, 3)).toEqual([1, 1, 0]);
  });

  it('Clase 2 (metadatos sin objeto): exactamente la fila fantasma', () => {
    expect(resumen(psql('informe_metadatos_sin_objeto.sql', { filtro_codigo: PREFIJO }))).toEqual([1, 0]);
  });

  it('Clase 3 (eventos eliminados con archivos): solo informe, un evento y un archivo', () => {
    expect(resumen(psql('informe_eventos_eliminados_con_archivos.sql', { filtro_codigo: PREFIJO }))).toEqual([1, 1]);
  });

  it('Clase 4 (sesiones sin bitácora): una en el cruce activo; la del cruce archivado queda excluida', () => {
    // [total, en activos, excluidas por archivado, eventos a crear]
    expect(resumen(psql('informe_sesiones_sin_bitacora.sql', { filtro_codigo: PREFIJO }))).toEqual([2, 1, 1, 1]);
  });

  it('Clase 5 (bitácora sin sesión): un automatizable; los de archivos, cruce archivado y finalizado van «a mano»', () => {
    // [total, automatizables, a mano con archivos, a mano cruce archivado, a mano finalizado]
    expect(resumen(psql('informe_bitacora_sin_sesion.sql', { filtro_codigo: PREFIJO }))).toEqual([4, 1, 1, 1, 1]);
  });

  it('No marca nada de los fixtures 02-9xx', () => {
    for (const f of ['informe_metadatos_sin_objeto.sql', 'informe_eventos_eliminados_con_archivos.sql']) {
      expect(resumen(psql(f, { filtro_codigo: '02-9' }))[0]).toBe(0);
    }
    expect(resumen(psql('informe_sesiones_sin_bitacora.sql', { filtro_codigo: '02-9' }))[0]).toBe(0);
    expect(resumen(psql('informe_bitacora_sin_sesion.sql', { filtro_codigo: '02-9' }))[0]).toBe(0);
  });
});

describe('Aplicar sin autorización: no cambia nada', () => {
  const sinCambios = async () => {
    expect(await existe('media-plantas', rutas.huerfano1)).toBe(true);
    expect(await existe('media-plantas', rutas.huerfano2)).toBe(true);
    expect(await existe('evecl-fotos', rutas.evecl)).toBe(true);
    expect(await existeArchivoFila(archivoId.fantasma)).toBe(true);
    expect(await eventoEliminado(ev.e3)).toBe(false);
    expect(Number(sql(`select count(*) from registros_evento where planta_id = '${cruceA}' and tipo_evento = 'polinizacion'`))).toBe(5);
  };

  it('SQL: sin confirmar, con esperado incorrecto, sin operador o sin admin válido hacen rollback', async () => {
    const base = { operador: OPERADOR, filtro_codigo: PREFIJO };
    const casos: Array<[string, Record<string, string>]> = [
      ['aplicar_sesiones_sin_bitacora.sql', { ...base, esperado: '1' }], // falta confirmar
      ['aplicar_sesiones_sin_bitacora.sql', { ...base, esperado: '99', confirmar: 'SI' }], // conteo distinto
      ['aplicar_sesiones_sin_bitacora.sql', { filtro_codigo: PREFIJO, esperado: '1', confirmar: 'SI' }], // sin operador
      ['aplicar_sesiones_sin_bitacora.sql', { ...base, esperado: '1', confirmar: 'si' }], // debe ser exactamente SI
      ['aplicar_bitacora_sin_sesion.sql', { ...base, admin_id: adminId, esperado: '1' }],
      ['aplicar_bitacora_sin_sesion.sql', { ...base, admin_id: adminId, esperado: '2', confirmar: 'SI' }],
      ['aplicar_bitacora_sin_sesion.sql', { ...base, esperado: '1', confirmar: 'SI' }], // sin admin_id
      ['aplicar_bitacora_sin_sesion.sql', { ...base, admin_id: '00000000-0000-0000-0000-000000000000', esperado: '1', confirmar: 'SI' }], // no es admin
      ['aplicar_metadatos_sin_objeto.sql', { ...base, esperado: '1' }],
      ['aplicar_metadatos_sin_objeto.sql', { ...base, esperado: '0', confirmar: 'SI' }],
    ];
    for (const [archivo, vars] of casos) {
      const salida = psql(archivo, vars);
      expect(salida, `${archivo} ${JSON.stringify(vars)}`).toContain('NO SE APLICÓ NADA');
    }
    await sinCambios();
  });

  it('Storage: modo seco, esperado incorrecto, sin operador y host no local no borran nada', async () => {
    const comun = ['--prefijo', `plantas/${PREFIJO}`, '--bucket', 'media-plantas'];
    const seco = mjs(comun);
    expect(seco.codigo).toBe(0);
    expect(seco.salida).toContain('MODO SECO');
    expect(seco.salida).toContain('Huérfanos antiguos (corregibles): 2');
    expect(mjs([...comun, '--aplicar', '--esperado', '9', '--operador', OPERADOR]).codigo).toBe(3);
    expect(mjs([...comun, '--aplicar', '--esperado', '2']).codigo).toBe(3);
    // Un host que no es local se rechaza antes de abrir ninguna conexión.
    const remoto = mjs(comun, { LIMPIEZA_SUPABASE_URL: 'https://ejemplo.invalid' });
    expect(remoto.codigo).toBe(2);
    expect(remoto.salida).toContain('--produccion-confirmado');
    // Sin variables de entorno no cae a ningún .env.
    expect(mjs(comun, { LIMPIEZA_SERVICE_KEY: '' }).codigo).toBe(2);
    await sinCambios();
  });
});

describe('Aplicar con confirmación: corrige solo lo sembrado', () => {
  const filtro = { operador: OPERADOR, filtro_codigo: PREFIJO, confirmar: 'SI' };

  it('Clase 4: crea el evento de bitácora que faltaba, con los datos de la sesión y rastro en audit_log', async () => {
    const salida = psql('aplicar_sesiones_sin_bitacora.sql', { ...filtro, esperado: '1' });
    expect(salida).toContain('APLICADO');
    const { data } = await service.from('registros_evento').select('id, datos, created_by, eliminado_at')
      .eq('planta_id', cruceA).eq('tipo_evento', 'polinizacion').eq('fecha', '2026-03-01');
    expect(data).toHaveLength(1);
    expect(data![0].datos).toEqual({ fecha_polinizacion: '2026-03-01', n_flores_cruzadas: 10 });
    expect(data![0].created_by).toBe(adminId);
    // El cruce archivado no se tocó.
    expect(Number(sql(`select count(*) from registros_evento where planta_id = '${cruceB}' and fecha = '2026-03-01'`))).toBe(0);
    const { data: rastro } = await service.from('audit_log').select('detalle').eq('accion', 'limpieza_datos').eq('planta_id', cruceA);
    expect(rastro?.filter((r) => r.detalle.clase === 'sesion_sin_bitacora')).toHaveLength(1);
    expect(rastro![0].detalle.operador).toBe(OPERADOR);
    // Idempotente: una segunda pasada encuentra 0.
    expect(psql('aplicar_sesiones_sin_bitacora.sql', { ...filtro, esperado: '0' })).toContain('APLICADO');
  });

  it('Clase 5: marca como eliminado (reversible) solo el evento automatizable', async () => {
    const salida = psql('aplicar_bitacora_sin_sesion.sql', { ...filtro, admin_id: adminId, esperado: '1' });
    expect(salida).toContain('APLICADO');
    expect(await eventoEliminado(ev.e3)).toBe(true);
    for (const intocable of ['e2', 'e4', 'e5', 'eB', 'eC']) expect(await eventoEliminado(ev[intocable]), intocable).toBe(false);
    const { data: rastro } = await service.from('audit_log').select('usuario_id, accion, detalle').eq('planta_id', cruceA)
      .in('accion', ['limpieza_datos', 'eliminacion_evento']);
    expect(rastro?.some((r) => r.accion === 'eliminacion_evento')).toBe(true); // trigger propio de la bitácora
    const limpieza = rastro?.filter((r) => r.accion === 'limpieza_datos' && r.detalle.clase === 'bitacora_sin_sesion');
    expect(limpieza).toHaveLength(1);
    expect(limpieza![0].usuario_id).toBe(adminId);
    // Es reversible (restaurar exige ser admin: se hace como lo haría la app) y la pasada siguiente lo vuelve a marcar.
    sql(`begin; select set_config('request.jwt.claim.sub', '${adminId}', true);
         update registros_evento set eliminado_at = null where id = '${ev.e3}'; commit;`);
    expect(await eventoEliminado(ev.e3)).toBe(false);
    expect(resumen(psql('informe_bitacora_sin_sesion.sql', { filtro_codigo: PREFIJO }))[1]).toBe(1);
    expect(psql('aplicar_bitacora_sin_sesion.sql', { ...filtro, admin_id: adminId, esperado: '1' })).toContain('APLICADO');
    expect(await eventoEliminado(ev.e3)).toBe(true);
  });

  it('Clase 2: borra solo la fila cuyo objeto no existe y guarda la fila completa en audit_log', async () => {
    const salida = psql('aplicar_metadatos_sin_objeto.sql', { ...filtro, esperado: '1' });
    expect(salida).toContain('APLICADO');
    expect(await existeArchivoFila(archivoId.fantasma)).toBe(false);
    expect(await existeArchivoFila(archivoId.ligado)).toBe(true);
    expect(await existeArchivoFila(archivoId.eliminado)).toBe(true);
    const { data: rastro } = await service.from('audit_log').select('detalle').eq('accion', 'limpieza_datos').eq('planta_id', cruceA);
    const fila = rastro?.find((r) => r.detalle.clase === 'metadato_sin_objeto');
    expect(fila?.detalle.fila.storage_path).toBe(rutas.fantasma);
  });

  it('Clase 1: con la edad por defecto borra solo los antiguos por la API; los recientes y los referenciados quedan', async () => {
    const comun = ['--prefijo', `plantas/${PREFIJO}`, '--bucket', 'media-plantas'];
    const r = mjs([...comun, '--aplicar', '--esperado', '2', '--operador', OPERADOR]);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('APLICADO: 2 de 2');
    expect(await existe('media-plantas', rutas.huerfano1)).toBe(false);
    expect(await existe('media-plantas', rutas.huerfano2)).toBe(false);
    expect(await existe('media-plantas', rutas.reciente)).toBe(true);
    expect(await existe('media-plantas', rutas.ligado)).toBe(true);
    expect(await existe('media-plantas', rutas.eliminado)).toBe(true);
    // Bucket evecl-fotos, con su propio prefijo.
    const e = mjs(['--prefijo', `evecl/${PREFIJO}`, '--bucket', 'evecl-fotos', '--aplicar', '--esperado', '1', '--operador', OPERADOR]);
    expect(e.codigo, e.salida).toBe(0);
    expect(await existe('evecl-fotos', rutas.evecl)).toBe(false);
    // El binario se borró de verdad (no solo la fila): pedirlo devuelve error.
    const { error } = await service.storage.from('media-plantas').download(rutas.huerfano1);
    expect(error).toBeTruthy();
    // Rastro: lista de objetos antes de borrar y resumen.
    const { data: rastro } = await service.from('audit_log').select('accion, detalle').in('accion', ['limpieza_datos', 'limpieza_datos_resumen'])
      .eq('detalle->>operador', OPERADOR);
    const lista = rastro?.find((x) => x.accion === 'limpieza_datos' && x.detalle.bucket === 'media-plantas');
    expect(lista?.detalle.objetos.sort()).toEqual([rutas.huerfano1, rutas.huerfano2].sort());
    expect(rastro?.some((x) => x.accion === 'limpieza_datos_resumen' && x.detalle.borrados === 2)).toBe(true);
  });

  it('La Clase 3 sigue intacta (solo informe) y nada fuera de lo sembrado cambió', async () => {
    expect(await existe('media-plantas', rutas.eliminado)).toBe(true);
    expect(await existeArchivoFila(archivoId.eliminado)).toBe(true);
    expect(resumen(psql('informe_eventos_eliminados_con_archivos.sql', { filtro_codigo: PREFIJO }))).toEqual([1, 1]);
    // Las inconsistencias previas de toda la base local siguen exactamente como estaban.
    expect(resumen(psql('informe_sesiones_sin_bitacora.sql'))[1]).toBe(baseline4);
    expect(resumen(psql('informe_bitacora_sin_sesion.sql'))[1]).toBe(baseline5);
  });
});

describe('Informes posteriores: 0 en lo corregible', () => {
  it('Clases 1, 2, 4 y 5 dan 0 corregibles; lo «a mano» y la Clase 3 permanecen', () => {
    const media = resumenHuerfanos(psql('informe_huerfanos_storage.sql', { filtro_ruta: `plantas/${PREFIJO}` }), 'media-plantas');
    expect(media.slice(0, 3)).toEqual([3, 0, 1]); // quedan ligado, eliminado y el reciente (no antiguo)
    expect(resumenHuerfanos(psql('informe_huerfanos_storage.sql', { filtro_ruta: `evecl/${PREFIJO}` }), 'evecl-fotos')[1]).toBe(0);
    expect(resumen(psql('informe_metadatos_sin_objeto.sql', { filtro_codigo: PREFIJO }))[0]).toBe(0);
    expect(resumen(psql('informe_sesiones_sin_bitacora.sql', { filtro_codigo: PREFIJO }))).toEqual([1, 0, 1, 0]); // solo la del cruce archivado
    expect(resumen(psql('informe_bitacora_sin_sesion.sql', { filtro_codigo: PREFIJO }))).toEqual([3, 0, 1, 1, 1]); // los tres «a mano»
  });
});
