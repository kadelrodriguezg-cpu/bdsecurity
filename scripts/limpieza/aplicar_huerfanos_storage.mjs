#!/usr/bin/env node
/**
 * Clase 1 (APLICAR): borra por la API de Storage los objetos huérfanos de los
 * buckets de la app. Ver informe_huerfanos_storage.sql para la definición
 * (A1-035, A1-036, A1-037; invariante B02).
 *
 * Por qué una API y no SQL: `delete from storage.objects` borra la fila pero
 * deja el binario en el almacén. Solo la API de Storage borra las dos cosas.
 *
 * NO ES PARA CORRER EN PRODUCCIÓN SIN respaldo previo (docs/respaldo_produccion.md)
 * y el OK escrito de Kadel. Probado solo en local.
 *
 * Seguridad:
 *  - NUNCA lee archivos .env. URL y clave llegan por variables de entorno explícitas:
 *      LIMPIEZA_SUPABASE_URL    p. ej. http://127.0.0.1:54600
 *      LIMPIEZA_SERVICE_KEY     clave service_role de ESA base
 *  - Si el host no es 127.0.0.1 / localhost / [::1], se niega a correr salvo con
 *    --produccion-confirmado.
 *  - Por defecto es modo SECO: solo informa. Para borrar hace falta --aplicar,
 *    --esperado <n> igual al conteo calculado y --operador "<nombre>".
 *  - Solo borra objetos con edad >= --min-edad-horas (24 por defecto): la app sube el
 *    binario antes de escribir la fila, así que una subida en curso parece un huérfano.
 *  - Antes de borrar vuelve a comprobar que ninguno haya pasado a estar referenciado;
 *    si alguno lo está, aborta sin borrar nada.
 *  - Deja rastro en audit_log (accion 'limpieza_datos' con la lista de objetos, antes de
 *    borrar, y 'limpieza_datos_resumen' al terminar). Si no puede escribir el rastro, no borra.
 *
 * Uso:
 *   LIMPIEZA_SUPABASE_URL=... LIMPIEZA_SERVICE_KEY=... \
 *     node scripts/limpieza/aplicar_huerfanos_storage.mjs [opciones]
 *
 * Opciones:
 *   --aplicar                   borra de verdad (sin esto: modo seco)
 *   --esperado <n>              número total de huérfanos que mostró el modo seco
 *   --operador "<nombre>"       quien ejecuta; queda en audit_log (obligatorio con --aplicar)
 *   --min-edad-horas <h>        edad mínima del objeto (24)
 *   --bucket <nombre>           media-plantas o evecl-fotos (repetible; por defecto ambos)
 *   --prefijo <texto>           solo objetos cuyo nombre empieza con este texto
 *   --listar                    en modo seco, listar todos (no solo los primeros 50)
 *   --produccion-confirmado     permite un host que no es local
 */
import { createClient } from '@supabase/supabase-js';

const BUCKETS_APP = ['media-plantas', 'evecl-fotos'];
const LOTE = 100;

function leerArgumentos(argv) {
  const opciones = { aplicar: false, listar: false, produccion: false, buckets: [], minEdadHoras: 24, prefijo: '', operador: '', esperado: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const valor = () => {
      i += 1;
      if (i >= argv.length) fallar(2, `Falta el valor de ${arg}.`);
      return argv[i];
    };
    if (arg === '--aplicar') opciones.aplicar = true;
    else if (arg === '--listar') opciones.listar = true;
    else if (arg === '--produccion-confirmado') opciones.produccion = true;
    else if (arg === '--esperado') opciones.esperado = valor();
    else if (arg === '--operador') opciones.operador = valor();
    else if (arg === '--min-edad-horas') opciones.minEdadHoras = Number(valor());
    else if (arg === '--prefijo') opciones.prefijo = valor();
    else if (arg === '--bucket') opciones.buckets.push(valor());
    else fallar(2, `Opción desconocida: ${arg}`);
  }
  if (!Number.isFinite(opciones.minEdadHoras) || opciones.minEdadHoras < 0) fallar(2, '--min-edad-horas debe ser un número >= 0.');
  if (opciones.buckets.length === 0) opciones.buckets = [...BUCKETS_APP];
  for (const b of opciones.buckets) if (!BUCKETS_APP.includes(b)) fallar(2, `Bucket no soportado: ${b}. Los de la app son ${BUCKETS_APP.join(', ')}.`);
  return opciones;
}

function fallar(codigo, mensaje) {
  console.error(`ERROR: ${mensaje}`);
  process.exit(codigo);
}

const HOSTS_LOCALES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function validarEntorno(opciones) {
  const url = process.env.LIMPIEZA_SUPABASE_URL;
  const clave = process.env.LIMPIEZA_SERVICE_KEY;
  if (!url || !clave) fallar(2, 'Define LIMPIEZA_SUPABASE_URL y LIMPIEZA_SERVICE_KEY en el entorno (este script nunca lee .env).');
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    fallar(2, `LIMPIEZA_SUPABASE_URL no es una URL válida: ${url}`);
  }
  const local = HOSTS_LOCALES.has(host);
  if (!local && !opciones.produccion) {
    fallar(2, `El host ${host} no es local. Este script solo corre contra 127.0.0.1/localhost salvo con --produccion-confirmado (y con respaldo previo y el OK escrito de Kadel).`);
  }
  return { url, clave, host, local };
}

/** Lista recursivamente todos los objetos de un bucket (la API devuelve carpetas con id null). */
async function listarObjetos(cliente, bucket, prefijo) {
  const inicio = prefijo.includes('/') ? prefijo.slice(0, prefijo.lastIndexOf('/')) : '';
  const objetos = [];
  const pendientes = [inicio];
  while (pendientes.length > 0) {
    const carpeta = pendientes.pop();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await cliente.storage.from(bucket).list(carpeta, {
        limit: 1000, offset, sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`No pude listar ${bucket}/${carpeta}: ${error.message}`);
      for (const item of data) {
        const ruta = carpeta ? `${carpeta}/${item.name}` : item.name;
        if (item.id === null) pendientes.push(ruta);
        else objetos.push({ bucket, name: ruta, created_at: item.created_at, bytes: Number(item.metadata?.size ?? 0) });
      }
      if (data.length < 1000) break;
    }
  }
  return objetos.filter((o) => o.name.startsWith(prefijo) && !/(^|\/)\.emptyFolderPlaceholder$/.test(o.name));
}

/** Pagina una columna de texto de una tabla (PostgREST corta en 1000 filas). */
async function leerColumna(cliente, tabla, columna, orden) {
  const valores = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await cliente.from(tabla).select(columna).not(columna, 'is', null).order(orden).range(desde, desde + 999);
    if (error) throw new Error(`No pude leer ${tabla}.${columna}: ${error.message}`);
    valores.push(...data.map((fila) => fila[columna]));
    if (data.length < 1000) break;
  }
  return valores;
}

const FUENTES = {
  'media-plantas': [['evento_archivos', 'storage_path', 'storage_path'], ['pcr_analisis', 'informe_pdf_url', 'id']],
  'evecl-fotos': [['evecl_respuesta', 'foto_path', 'id']],
};

async function leerReferencias(cliente, bucket) {
  const referencias = new Set();
  for (const [tabla, columna, orden] of FUENTES[bucket]) for (const v of await leerColumna(cliente, tabla, columna, orden)) referencias.add(v);
  return referencias;
}

/** Devuelve los nombres de `nombres` que HOY están referenciados (comprobación puntual previa al borrado). */
async function referenciadosAhora(cliente, bucket, nombres) {
  const encontrados = new Set();
  for (let i = 0; i < nombres.length; i += LOTE) {
    const lote = nombres.slice(i, i + LOTE);
    for (const [tabla, columna] of FUENTES[bucket]) {
      const { data, error } = await cliente.from(tabla).select(columna).in(columna, lote);
      if (error) throw new Error(`No pude comprobar ${tabla}.${columna}: ${error.message}`);
      for (const fila of data) encontrados.add(fila[columna]);
    }
  }
  return encontrados;
}

async function registrarAuditoria(cliente, accion, detalle) {
  const { error } = await cliente.from('audit_log').insert({ usuario_id: null, planta_id: null, accion, campos_expuestos: ['storage.objects'], detalle });
  if (error) throw new Error(`No pude escribir el rastro en audit_log (${accion}): ${error.message}`);
}

const opciones = leerArgumentos(process.argv.slice(2));
const entorno = validarEntorno(opciones);
const cliente = createClient(entorno.url, entorno.clave, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`Base: ${entorno.host}${entorno.local ? ' (local)' : ' (NO LOCAL, --produccion-confirmado)'}`);
console.log(`Modo: ${opciones.aplicar ? 'APLICAR' : 'SECO (no borra nada)'} | buckets: ${opciones.buckets.join(', ')} | edad mínima: ${opciones.minEdadHoras} h | prefijo: "${opciones.prefijo}"`);

const limite = Date.now() - opciones.minEdadHoras * 3600 * 1000;
const candidatos = [];
const recientes = [];
for (const bucket of opciones.buckets) {
  // Primero los objetos y después las referencias: si una subida en curso escribe su fila
  // entre las dos lecturas, el objeto ya listado queda protegido por la referencia.
  const objetos = await listarObjetos(cliente, bucket, opciones.prefijo);
  const referencias = await leerReferencias(cliente, bucket);
  for (const o of objetos) {
    if (referencias.has(o.name)) continue;
    const creado = o.created_at ? Date.parse(o.created_at) : NaN;
    // Sin fecha legible se trata como reciente: ante la duda no se borra.
    if (Number.isFinite(creado) && creado < limite) candidatos.push(o);
    else recientes.push(o);
  }
  console.log(`- ${bucket}: ${objetos.length} objetos, ${referencias.size} referencias`);
}

const bytes = candidatos.reduce((suma, o) => suma + o.bytes, 0);
console.log(`Huérfanos antiguos (corregibles): ${candidatos.length} (${bytes} bytes). Recientes excluidos: ${recientes.length}.`);
for (const o of opciones.listar ? candidatos : candidatos.slice(0, 50)) console.log(`  ${o.bucket}/${o.name}  ${o.created_at ?? '?'}  ${o.bytes} B`);
if (!opciones.listar && candidatos.length > 50) console.log(`  ... y ${candidatos.length - 50} más (usa --listar).`);

if (!opciones.aplicar) {
  console.log(`MODO SECO: no se borró nada. Para aplicar: --aplicar --esperado ${candidatos.length} --operador "<nombre>"`);
  process.exit(0);
}

if (!opciones.operador.trim()) fallar(3, 'Con --aplicar hace falta --operador "<nombre>". No se borró nada.');
if (opciones.esperado === null || String(candidatos.length) !== String(opciones.esperado).trim()) {
  fallar(3, `--esperado (${opciones.esperado}) no coincide con el conteo actual (${candidatos.length}). No se borró nada.`);
}
if (candidatos.length === 0) {
  console.log('Nada que borrar.');
  process.exit(0);
}

const porBucket = new Map();
for (const o of candidatos) porBucket.set(o.bucket, [...(porBucket.get(o.bucket) ?? []), o.name]);

// Comprobación final: nada de lo que se va a borrar debe estar referenciado ahora.
for (const [bucket, nombres] of porBucket) {
  const ahora = await referenciadosAhora(cliente, bucket, nombres);
  if (ahora.size > 0) fallar(4, `${ahora.size} objeto(s) de ${bucket} pasaron a estar referenciados (p. ej. ${[...ahora][0]}). No se borró nada; vuelve a correr el modo seco.`);
}

// Rastro ANTES de borrar: si no se puede escribir, no se borra.
for (const [bucket, nombres] of porBucket) {
  await registrarAuditoria(cliente, 'limpieza_datos', {
    clase: 'huerfano_storage', script: 'aplicar_huerfanos_storage.mjs', cambio: 'borrar_objetos_storage', bucket,
    cantidad: nombres.length, objetos: nombres, min_edad_horas: opciones.minEdadHoras, prefijo: opciones.prefijo,
    motivo: 'Objeto sin fila de metadatos que lo referencie (A1-G3-04/05/06).', operador: opciones.operador,
  });
}

let borrados = 0;
const fallidos = [];
for (const [bucket, nombres] of porBucket) {
  for (let i = 0; i < nombres.length; i += LOTE) {
    const lote = nombres.slice(i, i + LOTE);
    const { data, error } = await cliente.storage.from(bucket).remove(lote);
    if (error) {
      fallidos.push(...lote.map((n) => `${bucket}/${n}: ${error.message}`));
      continue;
    }
    const quitados = new Set(data.map((d) => d.name));
    borrados += quitados.size;
    for (const n of lote) if (!quitados.has(n)) fallidos.push(`${bucket}/${n}: la API no lo devolvió como borrado`);
  }
}

await registrarAuditoria(cliente, 'limpieza_datos_resumen', {
  clase: 'huerfano_storage', script: 'aplicar_huerfanos_storage.mjs', esperado: candidatos.length, borrados,
  fallidos: fallidos.length, buckets: opciones.buckets, prefijo: opciones.prefijo, operador: opciones.operador,
});

console.log(`APLICADO: ${borrados} de ${candidatos.length} objetos borrados por la API de Storage.`);
if (fallidos.length > 0) {
  for (const f of fallidos.slice(0, 20)) console.error(`  fallo: ${f}`);
  process.exit(5);
}
