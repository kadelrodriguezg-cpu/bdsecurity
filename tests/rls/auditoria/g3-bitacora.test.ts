/**
 * Auditoría integral, Corrida 1, grupo G3: flujo C12 (bitácora con archivos:
 * crear evento con foto o video, editar, eliminar con soft delete, quitar un
 * archivo) y el bucket `media-plantas`.
 *
 * Las funciones `subir`, `registrarHistorial`, `registrarArchivo` y
 * `quitarArchivo` repiten, llamada por llamada, lo que hacen
 * `frontend/src/api/eventos.ts` (subirBinarioEvento, registrarArchivoDeEvento,
 * eliminarArchivoDeEvento) y `frontend/src/api/fases.ts` (registrarHistorial,
 * subirArchivoSiHay, vincularArchivoSiHay), para que las pruebas muestren lo
 * que la app realmente deja en la base y en Storage.
 *
 * `it.fails` = hallazgo abierto (A1-G3-NN en el comentario).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BUCKET, JPEG_1X1, auditoriasDe, crearContexto, existeObjeto, limpiar, nuevoCruce, subirObjeto, type Contexto,
} from './g3-setup';

let ctx: Contexto;

beforeAll(async () => {
  ctx = await crearContexto('bit');
}, 60_000);

afterAll(async () => {
  await limpiar(ctx);
});

// --- Réplica de la capa de datos del frontend ---------------------------------

/** eventos.ts:75-88 */
async function subir(cliente: SupabaseClient, codigo: string, nombre = 'foto.jpg', tipoMime = 'image/jpeg') {
  const path = `plantas/${codigo}/${crypto.randomUUID()}/${Date.now()}-${nombre}`;
  ctx.objetosStorage.push(path);
  const { error } = await cliente.storage.from(BUCKET).upload(path, JPEG_1X1, { contentType: tipoMime });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
  return { path, tipo: tipoMime.startsWith('video/') ? ('video' as const) : ('foto' as const) };
}

/** fases.ts:55-76 */
async function registrarHistorial(cliente: SupabaseClient, uid: string, plantaId: string, extra: Record<string, unknown> = {}) {
  return cliente
    .from('registros_evento')
    .insert({ planta_id: plantaId, tipo_evento: 'otro', fecha: '2026-10-01', datos: { k: 1 }, created_by: uid, notas: null, ...extra })
    .select('id')
    .single();
}

/** eventos.ts:95-119 */
async function registrarArchivo(cliente: SupabaseClient, uid: string, registroId: string, path: string, tipo: 'foto' | 'video') {
  const { data, error } = await cliente
    .from('evento_archivos')
    .insert({ registro_id: registroId, storage_path: path, tipo, created_by: uid })
    .select('id, storage_path, tipo')
    .single();
  if (error) {
    await cliente.storage.from(BUCKET).remove([path]);
    throw new Error(error.message);
  }
  return data as { id: string; storage_path: string; tipo: string };
}

/** eventos.ts:128-132 */
async function quitarArchivo(cliente: SupabaseClient, archivo: { id: string; storage_path: string }) {
  const { error } = await cliente.from('evento_archivos').delete().eq('id', archivo.id);
  if (error) throw new Error(error.message);
  const rem = await cliente.storage.from(BUCKET).remove([archivo.storage_path]);
  return rem;
}

/** Evento con foto, creado por `cliente` (flujo completo y exitoso). */
async function eventoConFoto(cliente: SupabaseClient, uid: string, plantaId: string, codigo: string) {
  const subido = await subir(cliente, codigo);
  const { data: reg, error } = await registrarHistorial(cliente, uid, plantaId);
  if (error) throw new Error(error.message);
  const archivo = await registrarArchivo(cliente, uid, reg!.id, subido.path, subido.tipo);
  return { registroId: reg!.id as string, archivo, path: subido.path };
}

async function nEventos(plantaId: string) {
  const { count } = await ctx.service.from('registros_evento').select('*', { count: 'exact', head: true }).eq('planta_id', plantaId);
  return count ?? 0;
}

// --- Camino feliz y visibilidad ------------------------------------------------

describe('C12 · crear un evento con foto y quién la ve', () => {
  it('subir → insertar evento → registrar archivo deja evento, metadato y binario; el alta del evento no escribe en audit_log', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    expect(await existeObjeto(ctx, e.path)).toBe(true);
    const { data: fila } = await ctx.service.from('registros_evento').select('created_by, eliminado_at').eq('id', e.registroId).single();
    expect(fila).toMatchObject({ created_by: ctx.opAId, eliminado_at: null });
    // No hay trigger de INSERT en registros_evento ni en evento_archivos: la creación no deja fila de auditoría.
    const log = (await auditoriasDe(ctx, id)).filter((a) => /evento|archivo/.test(a.accion));
    expect(log).toHaveLength(0);
  });

  it('cualquier usuario autenticado (también un operario sin permiso de linaje) lee la foto de otro; anon no ve nada', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    for (const lector of [ctx.opB, ctx.admin]) {
      const { data: filas } = await lector.from('evento_archivos').select('storage_path').eq('id', e.archivo.id);
      expect(filas).toHaveLength(1);
      const { data: firmada, error } = await lector.storage.from(BUCKET).createSignedUrl(e.path, 60);
      expect(error).toBeNull();
      const res = await fetch(firmada!.signedUrl);
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBe(JPEG_1X1.byteLength);
    }
    const { data: lista } = await ctx.opB.storage.from(BUCKET).list(`plantas/${codigo}`);
    expect(lista!.length).toBeGreaterThan(0); // puede enumerar las carpetas de cualquier cruce
    // anon
    const { data: anonFilas, error: anonErr } = await ctx.anon.from('evento_archivos').select('id').eq('id', e.archivo.id);
    expect(anonErr !== null || (anonFilas ?? []).length === 0).toBe(true);
    const { error: anonFirma } = await ctx.anon.storage.from(BUCKET).createSignedUrl(e.path, 60);
    expect(anonFirma).toBeTruthy();
    const { error: anonSube } = await ctx.anon.storage.from(BUCKET).upload(`anon-${ctx.R}.jpg`, JPEG_1X1);
    expect(anonSube).toBeTruthy();
  });

  // A1-G3-11 (supuesto en cuanto al contenido): el bucket no separa carpetas ni mira puede_ver_linaje.
  it('un operario SIN puede_ver_linaje descarga el informe PCR de cualquier cruce (carpeta pcr/): la policy solo mira el bucket', async () => {
    const path = `pcr/AUD-G3-BIT-${ctx.R}-P01/${crypto.randomUUID()}/informe.pdf`;
    const up = await subirObjeto(ctx, ctx.opA, path, '%PDF-1.4 informe de prueba', 'application/pdf');
    expect(up.error).toBeNull();
    const { data: perfil } = await ctx.service.from('perfiles').select('puede_ver_linaje, rol').eq('id', ctx.opBId).single();
    expect(perfil).toEqual({ puede_ver_linaje: false, rol: 'operario' });
    const { data, error } = await ctx.opB.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(error).toBeNull();
    expect((await fetch(data!.signedUrl)).status).toBe(200);
  });

  // A1-G3-11 (supuesto en cuanto al contenido de los PDF): la policy de SELECT del bucket solo mira bucket_id.
  it.fails('A1-G3-11: un operario SIN puede_ver_linaje no puede descargar los informes de la carpeta pcr/ de otro usuario', async () => {
    const path = `pcr/AUD-G3-BIT-${ctx.R}-P02/${crypto.randomUUID()}/informe.pdf`;
    await subirObjeto(ctx, ctx.opA, path, '%PDF-1.4 informe de prueba', 'application/pdf');
    const { error } = await ctx.opB.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(error).toBeTruthy();
  });
});

// --- Atomicidad y huérfanos --------------------------------------------------------

describe('C12 · atomicidad: archivos huérfanos en Storage', () => {
  // A1-G3-05: fases.ts:176-192 y similares suben el binario antes de escribir y no lo limpian si el insert falla.
  it.fails('A1-G3-05: si el insert del evento falla después de subir el archivo, no queda un binario sin metadato', async () => {
    const { codigo } = await nuevoCruce(ctx, 'cosecha');
    const subido = await subir(ctx.opA, codigo);
    // El historial falla (aquí: el cruce ya no existe, FK 23503; en terreno: cualquier error de red o de RLS).
    const { error } = await registrarHistorial(ctx.opA, ctx.opAId, crypto.randomUUID());
    expect(error?.code).toBe('23503');
    // La app lanza el error sin borrar el archivo (no hay try/catch alrededor de subirArchivoSiHay / registrarHistorial).
    const { count } = await ctx.service.from('evento_archivos').select('*', { count: 'exact', head: true }).eq('storage_path', subido.path);
    expect(count).toBe(0);
    expect(await existeObjeto(ctx, subido.path)).toBe(false);
  });

  it('(estado actual) cada reintento tras el error vuelve a subir el archivo con otra carpeta: N intentos fallidos dejan N binarios', async () => {
    const { codigo } = await nuevoCruce(ctx, 'cosecha');
    const rutas: string[] = [];
    for (let i = 0; i < 3; i++) {
      rutas.push((await subir(ctx.opA, codigo)).path);
      expect((await registrarHistorial(ctx.opA, ctx.opAId, crypto.randomUUID())).error).toBeTruthy();
    }
    expect(new Set(rutas).size).toBe(3);
    for (const r of rutas) expect(await existeObjeto(ctx, r)).toBe(true);
  });

  it('si falla el insert del metadato, la app sí limpia el binario recién subido (camino correcto de registrarArchivoDeEvento)', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const subido = await subir(ctx.opA, codigo);
    const { data: reg } = await registrarHistorial(ctx.opA, ctx.opAId, id);
    await expect(registrarArchivo(ctx.opA, ctx.opBId /* created_by ajeno: la policy lo rechaza */, reg!.id, subido.path, subido.tipo)).rejects.toThrow();
    expect(await existeObjeto(ctx, subido.path)).toBe(false);
  });

  // A1-G3-06: Storage solo deja borrar al dueño del objeto; evento_archivos deja borrar también al admin.
  it.fails('A1-G3-06: cuando un admin quita el adjunto de un operario, el binario también se elimina', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    const rem = await quitarArchivo(ctx.admin, e.archivo);
    expect(rem.error).toBeNull();
    const { count } = await ctx.service.from('evento_archivos').select('*', { count: 'exact', head: true }).eq('id', e.archivo.id);
    expect(count).toBe(0); // el metadato sí se borró
    expect(await existeObjeto(ctx, e.path)).toBe(false); // el binario NO: remove() devuelve [] sin error (RLS de Storage)
  });

  it('(estado actual) remove() del admin sobre un objeto ajeno devuelve éxito con lista vacía y el objeto sigue ahí', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    const rem = await ctx.admin.storage.from(BUCKET).remove([e.path]);
    expect(rem.error).toBeNull();
    expect(rem.data).toEqual([]);
    expect(await existeObjeto(ctx, e.path)).toBe(true);
  });

  it('un operario no puede sobrescribir (upsert) ni mover el archivo de otro: la policy de Storage no tiene UPDATE', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    const up = await ctx.opB.storage.from(BUCKET).upload(e.path, new Uint8Array([1, 2, 3]), { upsert: true, contentType: 'image/jpeg' });
    expect(up.error).toBeTruthy();
    const mv = await ctx.opB.storage.from(BUCKET).move(e.path, e.path + '.movido');
    expect(mv.error).toBeTruthy();
    const { data: firmada } = await ctx.opA.storage.from(BUCKET).createSignedUrl(e.path, 60);
    expect((await (await fetch(firmada!.signedUrl)).arrayBuffer()).byteLength).toBe(JPEG_1X1.byteLength);
  });

  it('el dueño sí elimina metadato y binario con quitarArchivo', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    const rem = await quitarArchivo(ctx.opA, e.archivo);
    expect(rem.data).toHaveLength(1);
    expect(await existeObjeto(ctx, e.path)).toBe(false);
  });

  // B03 de producción: el soft delete del evento no toca sus archivos, y nadie puede limpiarlos después.
  it('(estado actual) eliminar un evento (soft) deja su metadato y su binario; cualquier operario sigue pudiendo leerlos por la API', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    const { error } = await ctx.admin.from('registros_evento').update({ eliminado_at: new Date().toISOString() }).eq('id', e.registroId);
    expect(error).toBeNull();
    // El evento desaparece para el operario...
    const { data: ev } = await ctx.opB.from('registros_evento').select('id').eq('id', e.registroId);
    expect(ev).toHaveLength(0);
    // ...pero su archivo no.
    const { data: ar } = await ctx.opB.from('evento_archivos').select('storage_path').eq('id', e.archivo.id);
    expect(ar).toHaveLength(1);
    const { data: firmada, error: eF } = await ctx.opB.storage.from(BUCKET).createSignedUrl(e.path, 60);
    expect(eF).toBeNull();
    expect((await fetch(firmada!.signedUrl)).status).toBe(200);
  });

  // A1-G3-20 (baja): lo que el operario ya no ve como evento no debería seguir accesible como archivo.
  it.fails('A1-G3-20: tras eliminar un evento, sus archivos dejan de ser legibles por quien ya no ve el evento', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    await ctx.admin.from('registros_evento').update({ eliminado_at: new Date().toISOString() }).eq('id', e.registroId);
    const { data: ar } = await ctx.opB.from('evento_archivos').select('storage_path').eq('id', e.archivo.id);
    expect(ar).toHaveLength(0);
  });
});

// --- Permisos: editar, eliminar, quitar archivos -------------------------------------

describe('C12 · quién puede editar, eliminar y quitar archivos', () => {
  it('un operario no edita ni elimina el evento de otro: el UPDATE afecta 0 filas y no avisa; el autor edita lo suyo y queda auditado con antes y después', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    const { data: reg } = await registrarHistorial(ctx.opA, ctx.opAId, id, { notas: 'original' });
    const r = await ctx.opB.from('registros_evento').update({ notas: 'pisada por B' }).eq('id', reg!.id).select('id');
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(0);
    const r2 = await ctx.opB.from('registros_evento').update({ eliminado_at: new Date().toISOString() }).eq('id', reg!.id).select('id');
    expect(r2.data ?? []).toHaveLength(0);
    const { data: sigue } = await ctx.service.from('registros_evento').select('notas, eliminado_at').eq('id', reg!.id).single();
    expect(sigue).toEqual({ notas: 'original', eliminado_at: null });

    const ok = await ctx.opA.from('registros_evento').update({ notas: 'editada por A' }).eq('id', reg!.id).select('id');
    expect(ok.data).toHaveLength(1);
    const [a] = await auditoriasDe(ctx, id, 'edicion_evento');
    expect(a.usuario_id).toBe(ctx.opAId);
    expect(a.detalle).toMatchObject({ anterior: { notas: 'original' }, nuevo: { notas: 'editada por A' } });
  });

  it('solo un admin elimina (soft) un evento: el autor recibe 42501; el admin lo logra y queda auditado con autor', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    const { data: reg } = await registrarHistorial(ctx.opA, ctx.opAId, id);
    const propio = await ctx.opA.from('registros_evento').update({ eliminado_at: new Date().toISOString() }).eq('id', reg!.id);
    expect(propio.error?.code).toBe('42501');
    const adm = await ctx.admin.from('registros_evento').update({ eliminado_at: new Date().toISOString() }).eq('id', reg!.id);
    expect(adm.error).toBeNull();
    const [a] = await auditoriasDe(ctx, id, 'eliminacion_evento');
    expect(a.usuario_id).toBe(ctx.adminId);
    // El autor ya no ve su propio evento, ni lo puede restaurar.
    const { data: ve } = await ctx.opA.from('registros_evento').select('id').eq('id', reg!.id);
    expect(ve).toHaveLength(0);
  });

  it('un operario no puede borrar físicamente eventos ni quitar el archivo de otro: 0 filas, sin error, y el binario no se toca', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    const del = await ctx.opB.from('registros_evento').delete().eq('id', e.registroId).select('id');
    expect(del.data ?? []).toHaveLength(0);
    const rem = await quitarArchivo(ctx.opB, e.archivo); // lo que hace eliminarArchivoDeEvento
    expect(rem.error).toBeNull(); // la app no ve ningún error
    expect(rem.data).toEqual([]);
    const { count } = await ctx.service.from('evento_archivos').select('*', { count: 'exact', head: true }).eq('id', e.archivo.id);
    expect(count).toBe(1);
    expect(await existeObjeto(ctx, e.path)).toBe(true);
  });

  // A1-G3-21 (baja): la UI ofrece la X en adjuntos que el usuario no puede quitar y no dice nada al fallar.
  it.fails('A1-G3-21: quitar un adjunto ajeno avisa con un error en vez de «funcionar» sin hacer nada', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.admin, ctx.adminId, id, codigo);
    // El operario es autor de un evento al que el admin adjuntó una foto: el Sheet de edición se la muestra con su X.
    // eliminarArchivoDeEvento hace delete().eq('id') sin .select(): PostgREST responde 204 aunque la RLS dejó 0 filas.
    const r = await ctx.opA.from('evento_archivos').delete().eq('id', e.archivo.id).select('id');
    expect(r.error !== null || (r.data ?? []).length === 1).toBe(true); // o falla con aviso, o borra de verdad
  });

  it('(estado corregido A1-003) el admin no borra físicamente un evento; solo soft delete', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    const { data: reg } = await registrarHistorial(ctx.opA, ctx.opAId, id, { notas: 'a borrar' });
    const del = await ctx.admin.from('registros_evento').delete().eq('id', reg!.id).select('id');
    expect(del.error?.code).toBe('42501');
    expect(del.data).toBeNull();
    const restante = await ctx.service.from('registros_evento').select('id').eq('id', reg!.id);
    expect(restante.error).toBeNull();
    expect(restante.data).toHaveLength(1);
    const log = (await auditoriasDe(ctx, id)).filter((a) => /evento/.test(a.accion));
    expect(log).toHaveLength(0);
  });

  // A1-G3-09: columnas editables sin rastro.
  it.fails('A1-G3-09: mover un evento a otro cruce (UPDATE de planta_id) deja rastro en audit_log', async () => {
    const a = await nuevoCruce(ctx, 'cosecha');
    const b = await nuevoCruce(ctx, 'cosecha');
    const { data: reg } = await registrarHistorial(ctx.opA, ctx.opAId, a.id);
    const mov = await ctx.opA.from('registros_evento').update({ planta_id: b.id }).eq('id', reg!.id).select('id');
    expect(mov.data).toHaveLength(1); // la policy y los grants de columna lo permiten al autor
    const rastro = [...(await auditoriasDe(ctx, a.id)), ...(await auditoriasDe(ctx, b.id))].filter((x) => /evento/.test(x.accion));
    expect(rastro.length).toBeGreaterThan(0);
  });

  it.fails('A1-G3-09: reescribir created_at (retrodatar el registro) o restaurar un evento eliminado deja rastro en audit_log', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    const { data: reg } = await registrarHistorial(ctx.opA, ctx.opAId, id);
    const r = await ctx.opA.from('registros_evento').update({ created_at: '2020-01-01T00:00:00Z' }).eq('id', reg!.id).select('id');
    expect(r.data).toHaveLength(1);
    await ctx.admin.from('registros_evento').update({ eliminado_at: new Date().toISOString() }).eq('id', reg!.id);
    await ctx.admin.from('registros_evento').update({ eliminado_at: null }).eq('id', reg!.id);
    const filas = (await auditoriasDe(ctx, id)).filter((x) => /evento/.test(x.accion)).map((x) => x.accion);
    // Hoy solo existe 'eliminacion_evento': ni el retrodatado ni la restauración dejan fila.
    expect(filas.filter((a) => a !== 'eliminacion_evento').length).toBeGreaterThanOrEqual(2);
  });

  it('un operario no puede firmar un evento a nombre de otro (created_by distinto de auth.uid()) ni insertar sin sesión', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    const r = await registrarHistorial(ctx.opB, ctx.opAId, id);
    expect(r.error?.code).toBe('42501');
    const anon = await ctx.anon.from('registros_evento').insert({ planta_id: id, tipo_evento: 'otro', fecha: '2026-10-01', datos: {}, created_by: ctx.opAId });
    expect(anon.error).toBeTruthy();
  });

  it('la base rechaza eventos en un cruce archivado (A1-029) y acepta los genéricos en cualquier fase (ver A1-G2-02 para las tablas de fase)', async () => {
    const archivado = await nuevoCruce(ctx, 'proceso_finalizado', { eliminado_at: new Date().toISOString() });
    expect((await registrarHistorial(ctx.opA, ctx.opAId, archivado.id)).error?.code).toBe('55000');
    const finalizado = await nuevoCruce(ctx, 'proceso_finalizado');
    expect((await registrarHistorial(ctx.opA, ctx.opAId, finalizado.id)).error).toBeNull();
  });
});

// --- Validación de lo que llega ------------------------------------------------------------

describe('C12 · validación en el servidor: datos, notas, tamaño y tipo de archivo', () => {
  // A1-G3-22 (baja): sin forma ni tamaño máximos en `datos` ni `notas`.
  it.fails('A1-G3-22: `datos` debe ser un objeto de tamaño razonable y `notas` tiene un máximo', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    const arreglo = await registrarHistorial(ctx.opA, ctx.opAId, id, { datos: [1, 2, 3] });
    const enorme = await registrarHistorial(ctx.opA, ctx.opAId, id, { datos: { relleno: 'x'.repeat(3_000_000) } });
    const notasLargas = await registrarHistorial(ctx.opA, ctx.opAId, id, { notas: 'n'.repeat(1_000_000) });
    expect(arreglo.error).toBeTruthy();
    expect(enorme.error).toBeTruthy();
    expect(notasLargas.error).toBeTruthy();
  });

  it('(estado actual) datos acepta arreglos, escalares y claves arbitrarias; la lista del frontend los dibuja con Object.entries', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    for (const datos of [[1, 2], 'texto', 42, { contenedor_id: 'no-es-uuid', '<img src=x onerror=alert(1)>': '<b>' }]) {
      const r = await registrarHistorial(ctx.opA, ctx.opAId, id, { datos });
      expect(r.error, JSON.stringify(datos)).toBeNull();
    }
    expect(await nEventos(id)).toBe(4);
  });

  it('fecha: acepta fechas muy antiguas o futuras, y rechaza texto que no es fecha (22007)', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    expect((await registrarHistorial(ctx.opA, ctx.opAId, id, { fecha: '1900-01-01' })).error).toBeNull();
    expect((await registrarHistorial(ctx.opA, ctx.opAId, id, { fecha: '2999-12-31' })).error).toBeNull();
    expect((await registrarHistorial(ctx.opA, ctx.opAId, id, { fecha: 'mañana' })).error?.code).toBe('22007');
    expect((await registrarHistorial(ctx.opA, ctx.opAId, id, { tipo_evento: 'inventado' })).error?.code).toBe('22P02');
  });

  it('el bucket media-plantas no define límite de tamaño ni tipos MIME permitidos', async () => {
    const { data, error } = await ctx.service.storage.getBucket(BUCKET);
    expect(error).toBeNull();
    expect(data!.public).toBe(false);
    expect(data!.file_size_limit ?? null).toBeNull();
    expect(data!.allowed_mime_types ?? null).toBeNull();
  });

  // A1-G3-23 (baja): cualquier tipo de archivo, no solo imagen o video.
  it.fails('A1-G3-23: el bucket rechaza archivos que no son imagen, video o PDF (HTML, SVG, ejecutables)', async () => {
    const { codigo } = await nuevoCruce(ctx, 'cosecha');
    const base = `plantas/${codigo}/${crypto.randomUUID()}`;
    const html = await subirObjeto(ctx, ctx.opA, `${base}/a.html`, '<html><script>alert(1)</script></html>', 'text/html');
    const svg = await subirObjeto(ctx, ctx.opA, `${base}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml');
    const exe = await subirObjeto(ctx, ctx.opA, `${base}/a.exe`, new Uint8Array([77, 90, 0, 0]), 'application/x-msdownload');
    expect(html.error).toBeTruthy();
    expect(svg.error).toBeTruthy();
    expect(exe.error).toBeTruthy();
  });

  it('(estado actual) un SVG con script se sirve como image/svg+xml sin CSP ni nosniff; el HTML se sirve como text/plain', async () => {
    const { codigo } = await nuevoCruce(ctx, 'cosecha');
    const base = `plantas/${codigo}/${crypto.randomUUID()}`;
    await subirObjeto(ctx, ctx.opA, `${base}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml');
    await subirObjeto(ctx, ctx.opA, `${base}/a.html`, '<html><script>alert(1)</script></html>', 'text/html');
    const svg = await fetch((await ctx.opB.storage.from(BUCKET).createSignedUrl(`${base}/a.svg`, 60)).data!.signedUrl);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(svg.headers.get('content-security-policy')).toBeNull();
    expect(svg.headers.get('x-content-type-options')).toBeNull();
    const html = await fetch((await ctx.opB.storage.from(BUCKET).createSignedUrl(`${base}/a.html`, 60)).data!.signedUrl);
    expect(html.headers.get('content-type')).toMatch(/^text\/plain/);
  });
});

describe('C12 · evento_archivos: qué metadatos acepta la base', () => {
  // A1-G3-10: ni el evento destino ni la ruta se validan.
  it.fails('A1-G3-10: solo el autor del evento (o un admin) puede adjuntarle archivos, y la ruta debe existir y pertenecer al cruce', async () => {
    const a = await nuevoCruce(ctx, 'cosecha');
    const b = await nuevoCruce(ctx, 'cosecha');
    const { data: reg } = await registrarHistorial(ctx.opA, ctx.opAId, a.id);
    const rutaDeOtroCruce = (await subir(ctx.opB, b.codigo)).path;
    // B (sin relación con el evento de A) le cuelga un archivo de OTRO cruce.
    const r = await ctx.opB.from('evento_archivos').insert({ registro_id: reg!.id, storage_path: rutaDeOtroCruce, tipo: 'foto', created_by: ctx.opBId }).select('id');
    // B también apunta a una ruta que no existe.
    const r2 = await ctx.opB.from('evento_archivos').insert({ registro_id: reg!.id, storage_path: `plantas/${a.codigo}/no-existe.jpg`, tipo: 'foto', created_by: ctx.opBId }).select('id');
    expect(r.error).toBeTruthy();
    expect(r2.error).toBeTruthy();
  });

  it('(estado actual) hoy B adjunta a un evento ajeno un archivo de otro cruce y una ruta inexistente; el autor del evento no puede quitárselos', async () => {
    const a = await nuevoCruce(ctx, 'cosecha');
    const b = await nuevoCruce(ctx, 'cosecha');
    const { data: reg } = await registrarHistorial(ctx.opA, ctx.opAId, a.id);
    const ruta = (await subir(ctx.opB, b.codigo)).path;
    const r = await ctx.opB.from('evento_archivos').insert({ registro_id: reg!.id, storage_path: ruta, tipo: 'foto', created_by: ctx.opBId }).select('id').single();
    expect(r.error).toBeNull();
    const r2 = await ctx.opB.from('evento_archivos').insert({ registro_id: reg!.id, storage_path: `plantas/${a.codigo}/no-existe.jpg`, tipo: 'foto', created_by: ctx.opBId }).select('id').single();
    expect(r2.error).toBeNull();
    // El autor del evento lo ve en su historial y no lo puede quitar (0 filas).
    const quitar = await ctx.opA.from('evento_archivos').delete().eq('id', r.data!.id).select('id');
    expect(quitar.data ?? []).toHaveLength(0);
  });

  it('la misma ruta no se puede registrar dos veces (UNIQUE storage_path); tipo fuera del enum se rechaza', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    const e = await eventoConFoto(ctx.opA, ctx.opAId, id, codigo);
    const dup = await ctx.opA.from('evento_archivos').insert({ registro_id: e.registroId, storage_path: e.path, tipo: 'foto', created_by: ctx.opAId });
    expect(dup.error?.code).toBe('23505');
    const mal = await ctx.opA.from('evento_archivos').insert({ registro_id: e.registroId, storage_path: `${e.path}.2`, tipo: 'audio', created_by: ctx.opAId });
    expect(mal.error?.code).toBe('22P02');
  });
});

describe('C12 · idempotencia y escala', () => {
  it('(estado actual) dos envíos idénticos del mismo alta (reintento con mala señal) crean dos eventos y dos binarios: no hay clave de idempotencia', async () => {
    const { id, codigo } = await nuevoCruce(ctx, 'cosecha');
    for (let i = 0; i < 2; i++) {
      const s = await subir(ctx.opA, codigo, 'foto.jpg');
      const { data: reg } = await registrarHistorial(ctx.opA, ctx.opAId, id, { notas: 'mismo envío' });
      await registrarArchivo(ctx.opA, ctx.opAId, reg!.id, s.path, s.tipo);
    }
    expect(await nEventos(id)).toBe(2);
    const { count } = await ctx.service.from('evento_archivos').select('*, registros_evento!inner(planta_id)', { count: 'exact', head: true }).eq('registros_evento.planta_id', id);
    expect(count).toBe(2);
  });

  // A1-G3-26 (baja): listarEventosDePlanta no pagina.
  it.fails('A1-G3-26: el historial de un cruce con más de 1000 eventos se devuelve completo', async () => {
    const { id } = await nuevoCruce(ctx, 'cosecha');
    const filas = Array.from({ length: 1100 }, (_, i) => ({
      planta_id: id, tipo_evento: 'otro', fecha: '2026-10-01', datos: { i }, created_by: ctx.opAId,
    }));
    for (let i = 0; i < filas.length; i += 550) {
      const { error } = await ctx.service.from('registros_evento').insert(filas.slice(i, i + 550));
      if (error) throw new Error(error.message);
    }
    // Misma consulta que frontend/src/api/eventos.ts:28-38
    const { data } = await ctx.opB
      .from('registros_evento')
      .select('id, planta_id, tipo_evento, fecha, datos, notas, created_by, created_at, archivos:evento_archivos(id, storage_path, tipo)')
      .eq('planta_id', id)
      .is('eliminado_at', null)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });
    expect(data!.length).toBe(1100);
  }, 60_000);
});
