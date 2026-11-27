/**
 * G9 / Storage transversal — políticas de los dos buckets privados
 * (`media-plantas` y `evecl-fotos`) probadas con usuarios reales.
 *
 * Políticas vigentes (storage.objects): SELECT e INSERT para cualquier
 * autenticado del bucket; DELETE solo del dueño (`owner = auth.uid()`); no hay
 * policy de UPDATE. Los huérfanos de `media-plantas` los cubre G3: no se
 * repiten acá.
 *
 * Estas pruebas FOTOGRAFÍAN el comportamiento vigente (todas pasan en verde); los hallazgos
 * que se desprenden de él tienen sus `it.fails` en g9-frontend-api-fotos.test.ts:
 *  - A1-G9-01  sin policy UPDATE el upsert de EVECL nunca puede reemplazar una foto
 *  - A1-G9-05  el admin no puede borrar objetos ajenos y `remove()` responde [] sin error
 *  - A1-G9-17  los buckets no restringen tipo ni tamaño (misma raíz que A1-G5-17)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoG9, psqlRoot, type UsuarioG9 } from './g9-setup';

const ctx = new ContextoG9();
let admin: UsuarioG9;
let dueno: UsuarioG9;
let otro: UsuarioG9;

const BUCKETS = ['evecl-fotos', 'media-plantas'] as const;
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });

beforeAll(async () => {
  admin = await ctx.usuario('sto-admin', 'admin');
  dueno = await ctx.usuario('sto-dueno', 'operario');
  otro = await ctx.usuario('sto-otro', 'operario');
}, 60_000);

afterAll(async () => {
  await ctx.limpiar();
}, 60_000);

async function subir(bucket: string, u: UsuarioG9, nombre: string, contenido: Blob = jpeg(), contentType = 'image/jpeg'): Promise<string> {
  const path = `AUD-G9-STO-${ctx.sufijo}/${nombre}`;
  ctx.registrarObjeto(bucket, path);
  const { error } = await u.client.storage.from(bucket).upload(path, contenido, { contentType });
  if (error) throw new Error(`subir ${bucket}/${path}: ${error.message}`);
  return path;
}

async function existe(bucket: string, path: string): Promise<boolean> {
  const carpeta = path.slice(0, path.lastIndexOf('/'));
  const { data } = await ctx.service.storage.from(bucket).list(carpeta);
  return (data ?? []).some((o) => o.name === path.slice(path.lastIndexOf('/') + 1));
}

describe.each(BUCKETS)('Storage — bucket %s', (bucket) => {
  it('es privado: la URL pública no sirve el archivo', async () => {
    const path = await subir(bucket, dueno, 'publico.jpg');
    const { data } = ctx.anon.storage.from(bucket).getPublicUrl(path);
    const resp = await fetch(data.publicUrl);
    expect(resp.ok).toBe(false);
    expect(psqlRoot(`select public from storage.buckets where id = '${bucket}'`).trim()).toBe('f');
  });

  it('anon no lista, no descarga, no firma URLs y no sube', async () => {
    const path = await subir(bucket, dueno, 'anon.jpg');
    const carpeta = path.slice(0, path.lastIndexOf('/'));
    const lista = await ctx.anon.storage.from(bucket).list(carpeta);
    expect(lista.data ?? []).toHaveLength(0);
    expect((await ctx.anon.storage.from(bucket).download(path)).error).not.toBeNull();
    expect((await ctx.anon.storage.from(bucket).createSignedUrl(path, 60)).error).not.toBeNull();
    const sube = await ctx.anon.storage.from(bucket).upload(`${carpeta}/anon-sube.jpg`, jpeg(), { contentType: 'image/jpeg' });
    expect(sube.error).not.toBeNull();
    ctx.registrarObjeto(bucket, `${carpeta}/anon-sube.jpg`);
  });

  it('el dueño no puede sobrescribir su propio objeto (no hay policy UPDATE): upsert → 403', async () => {
    const path = await subir(bucket, dueno, 'propio.jpg');
    const { error } = await dueno.client.storage.from(bucket).upload(path, jpeg(), { contentType: 'image/jpeg', upsert: true });
    expect((error as { statusCode?: string } | null)?.statusCode).toBe('403');
    const sinUpsert = await dueno.client.storage.from(bucket).upload(path, jpeg(), { contentType: 'image/jpeg' });
    expect((sinUpsert.error as { statusCode?: string } | null)?.statusCode).toBe('409');
  });

  it('otro operario no puede sobrescribir (upsert ni update()) ni mover el objeto de otro', async () => {
    const path = await subir(bucket, dueno, 'ajeno.jpg');
    const up = await otro.client.storage.from(bucket).upload(path, jpeg(), { contentType: 'image/jpeg', upsert: true });
    expect((up.error as { statusCode?: string } | null)?.statusCode).toBe('403');
    const upd = await otro.client.storage.from(bucket).update(path, jpeg(), { contentType: 'image/jpeg' });
    expect(upd.error).not.toBeNull();
    const mv = await otro.client.storage.from(bucket).move(path, `${path}.movido`);
    expect(mv.error).not.toBeNull();
    expect(await existe(bucket, path)).toBe(true);
  });

  it('otro operario no borra el objeto de otro: remove() responde [] SIN error y el objeto sigue (falla en silencio)', async () => {
    const path = await subir(bucket, dueno, 'no-borrable.jpg');
    const { data, error } = await otro.client.storage.from(bucket).remove([path]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await existe(bucket, path)).toBe(true);
  });

  it('A1-G9-05 — el admin tampoco puede borrar un objeto ajeno por la API (la policy DELETE no tiene excepción de admin)', async () => {
    const path = await subir(bucket, dueno, 'admin-no-borra.jpg');
    const { data, error } = await admin.client.storage.from(bucket).remove([path]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await existe(bucket, path)).toBe(true);
  });

  it('el dueño sí borra su objeto', async () => {
    const path = await subir(bucket, dueno, 'dueno-borra.jpg');
    const { data, error } = await dueno.client.storage.from(bucket).remove([path]);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await existe(bucket, path)).toBe(false);
  });

  it('cualquier autenticado lista el bucket, descarga y firma URLs de objetos ajenos (SELECT abierto por diseño: "cualquiera")', async () => {
    const path = await subir(bucket, dueno, 'visible.jpg');
    const carpeta = path.slice(0, path.lastIndexOf('/'));
    const lista = await otro.client.storage.from(bucket).list(carpeta);
    expect((lista.data ?? []).map((o) => o.name)).toContain('visible.jpg');
    const raiz = await otro.client.storage.from(bucket).list('');
    expect(raiz.error).toBeNull();
    expect((raiz.data ?? []).length).toBeGreaterThan(0);
    const firmada = await otro.client.storage.from(bucket).createSignedUrl(path, 60);
    expect(firmada.data?.signedUrl).toBeTruthy();
    const resp = await fetch(firmada.data!.signedUrl);
    expect(resp.ok).toBe(true);
    expect((await otro.client.storage.from(bucket).download(path)).data?.size).toBe(7);
  });

  it('cualquier autenticado puede copiar el objeto de otro a una ruta nueva y queda como dueño de la copia', async () => {
    const path = await subir(bucket, dueno, 'original.jpg');
    const destino = `${path}.copia`;
    ctx.registrarObjeto(bucket, destino);
    const { error } = await otro.client.storage.from(bucket).copy(path, destino);
    expect(error).toBeNull();
    const dueno_ = psqlRoot(`select owner_id from storage.objects where bucket_id = '${bucket}' and name = '${destino}'`).trim();
    expect(dueno_).toBe(otro.userId);
  });

  it('INSERT: cualquier ruta del bucket es escribible por cualquier autenticado (la policy solo mira bucket_id), incluidas rutas con la forma de las del sistema', async () => {
    const raiz = `AUD-G9-RAIZ-${ctx.sufijo}.jpg`;
    ctx.registrarObjeto(bucket, raiz);
    const r = await otro.client.storage.from(bucket).upload(raiz, jpeg(), { contentType: 'image/jpeg' });
    expect(r.error).toBeNull();
  });

  it('A1-G9-17 — el bucket no limita tipo ni tamaño: acepta HTML y SVG con su content-type (la restricción vive solo en la UI)', async () => {
    const fila = psqlRoot(`select coalesce(file_size_limit::text, 'null') || '|' || coalesce(allowed_mime_types::text, 'null') from storage.buckets where id = '${bucket}'`).trim();
    expect(fila).toBe('null|null');
    const html = await subir(bucket, otro, 'x.html', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'text/html');
    const svg = await subir(bucket, otro, 'x.svg', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'image/svg+xml');
    expect(await existe(bucket, html)).toBe(true);
    expect(await existe(bucket, svg)).toBe(true);
  });
});

describe('Storage — las policies vigentes (fotografía del catálogo)', () => {
  it('solo existen SELECT, INSERT y DELETE por bucket; ninguna policy de UPDATE; ninguna con rol anon', () => {
    const filas = psqlRoot(`
      select policyname || '|' || cmd || '|' || roles::text
      from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1`).trim().split('\n');
    expect(filas).toEqual([
      'storage_evecl_fotos_delete_propietario|DELETE|{authenticated}',
      'storage_evecl_fotos_insert_autenticados|INSERT|{authenticated}',
      'storage_evecl_fotos_select_autenticados|SELECT|{authenticated}',
      'storage_media_delete_propietario|DELETE|{authenticated}',
      'storage_media_insert_autenticados|INSERT|{authenticated}',
      'storage_media_select_autenticados|SELECT|{authenticated}',
    ]);
  });

  it('un objeto de un bucket no se lee con la ruta del otro bucket (las policies filtran por bucket_id)', async () => {
    const path = await subir('evecl-fotos', dueno, 'cruce-buckets.jpg');
    const { error } = await otro.client.storage.from('media-plantas').download(path);
    expect(error).not.toBeNull();
  });
});
