/**
 * G5 / E06 — «Adjuntar foto a evaluación / PCR».
 *
 * Hallazgo de alcance: la evaluación NO tiene fotos. No existe columna de
 * archivo en `evaluaciones`, ni tipo de evento `evaluacion`, ni componente de
 * carga en `EvaluacionForm`. Lo único que se adjunta en este flujo es el PDF
 * del PCR (`PcrForm` -> `subirPdfPcr` -> bucket `media-plantas`), cuyo
 * recorrido completo (orden archivo -> fila, huérfanos, idempotencia, borrado
 * solo por el dueño) ya lo cubre `g4-evaluacion-reducida-pcr.test.ts`.
 *
 * Acá se verifica lo que sí es de este grupo:
 * - el esquema confirma que una evaluación no admite adjuntos;
 * - el bucket `media-plantas` no limita tipo de archivo (el input del PCR
 *   pide `application/pdf`, pero eso es solo de la UI) (A1-G5-17);
 * - el dueño borra su objeto, otro operario y el admin no.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepararContexto, psqlRoot, type ContextoG5 } from './g5-setup';

const BUCKET = 'media-plantas';
let ctx: ContextoG5;
const subidos: string[] = [];

beforeAll(async () => {
  ctx = await prepararContexto('foto');
}, 60_000);

afterAll(async () => {
  if (subidos.length > 0) await ctx.service.storage.from(BUCKET).remove(subidos);
});

describe('E06 — la evaluación no tiene adjuntos', () => {
  it('evaluaciones no tiene ninguna columna de archivo, foto o url', () => {
    const salida = psqlRoot(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'evaluaciones'
        and (column_name ~* '(foto|archivo|url|imagen|media|pdf|path)');
    `).trim();
    expect(salida).toBe('');
  });

  it('el enum tipo_evento (bitácora con archivos) no incluye un tipo para evaluación', () => {
    const salida = psqlRoot(`select enum_range(null::tipo_evento);`).trim();
    expect(salida).not.toMatch(/evaluaci/);
  });

  it('las únicas tablas con una columna de ruta a Storage son evento_archivos y pcr_analisis (y las de EVECL)', () => {
    const salida = psqlRoot(`
      select table_name || '.' || column_name from information_schema.columns
      where table_schema = 'public' and column_name ~* '(storage_path|informe_pdf_url|foto_path|archivo_path|path)$'
      order by 1;
    `);
    expect(salida).toMatch(/evento_archivos\./);
    expect(salida).toMatch(/pcr_analisis\.informe_pdf_url/);
    expect(salida).not.toMatch(/evaluaciones\./);
  });
});

describe('E06 — bucket media-plantas (camino del PDF del PCR)', () => {
  const contenidoHtml = () => new Blob(['<html><script>alert(1)</script></html>'], { type: 'text/html' });

  it('no restringe el tipo de archivo ni el tamaño por bucket: un operario sube un .html con content-type text/html (A1-G5-17)', async () => {
    const salida = psqlRoot(`select coalesce(file_size_limit::text,'null') || '|' || coalesce(allowed_mime_types::text,'null') from storage.buckets where id = '${BUCKET}';`).trim();
    expect(salida).toBe('null|null');

    const ruta = `pcr/AUD-G5-FOTO-${ctx.sufijo}/${crypto.randomUUID()}/${Date.now()}-no-es-pdf.html`;
    const { error } = await ctx.operario.storage.from(BUCKET).upload(ruta, contenidoHtml(), { contentType: 'text/html' });
    expect(error).toBeNull();
    subidos.push(ruta);
  });

  it('el dueño borra su objeto; otro operario y el admin no (quedan huérfanos si la fila no se crea)', async () => {
    const ruta = `pcr/AUD-G5-FOTO-${ctx.sufijo}/${crypto.randomUUID()}/${Date.now()}-dueno.pdf`;
    const { error } = await ctx.operario.storage.from(BUCKET).upload(ruta, new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }));
    expect(error).toBeNull();
    subidos.push(ruta);

    const carpeta = ruta.slice(0, ruta.lastIndexOf('/'));
    const existe = async () => {
      const { data } = await ctx.service.storage.from(BUCKET).list(carpeta);
      return (data ?? []).length > 0;
    };
    await ctx.operario2.storage.from(BUCKET).remove([ruta]);
    expect(await existe()).toBe(true);
    await ctx.admin.storage.from(BUCKET).remove([ruta]);
    expect(await existe()).toBe(true);
    await ctx.operario.storage.from(BUCKET).remove([ruta]);
    expect(await existe()).toBe(false);
  });

  it('anon no puede subir ni listar', async () => {
    const ruta = `pcr/AUD-G5-FOTO-${ctx.sufijo}/anon.pdf`;
    const subida = await ctx.anon.storage.from(BUCKET).upload(ruta, new Blob(['x'], { type: 'application/pdf' }));
    expect(subida.error).not.toBeNull();
    const lista = await ctx.anon.storage.from(BUCKET).list('pcr');
    expect((lista.data ?? []).length).toBe(0);
  });
});
