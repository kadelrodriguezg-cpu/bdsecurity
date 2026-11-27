/**
 * G9 / T07 — la capa de datos REAL del frontend (`frontend/src/api/evecl.ts`)
 * ejecutada contra la base local, con el cliente de Supabase de cada usuario
 * de prueba (sujeto a RLS). Se reemplaza solo `./client` (el módulo que crea el
 * cliente con variables Vite); el resto —`guardarFichaEvecl`, `obtenerFichaEvecl`,
 * `subirFotoDescriptorEvecl`, `eliminarRespuestaEvecl`— es el código de la app.
 *
 * Hallazgos que demuestra (cada `it.fails` está escrito con lo que DEBERÍA pasar):
 *  - A1-G9-01  reemplazar una foto nunca funciona (upload con upsert sin policy UPDATE)
 *  - A1-G9-02  guardar una ficha borra respuestas y fotos ANTES de la RPC; si la RPC falla se pierden
 *  - A1-G9-03  reintentar con la misma idempotency_key descarta las ediciones en silencio
 *  - A1-G9-04  un descriptor desactivado se borra (con su foto) al editar cualquier ficha
 *  - A1-G9-05  un admin que "borra" la foto de otro autor deja el objeto huérfano sin avisar
 *  - A1-G9-06  la ruta de la foto es predecible y escribible por cualquiera (pre-ocupación)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ContextoG9, psqlRoot, type DescriptorG9, type UsuarioG9 } from './g9-setup';

vi.mock('../../../frontend/src/api/client', () => ({
  // El cliente efectivo lo fija cada prueba (usuario logueado con la clave anon).
  supabase: new Proxy({}, {
    get: (_t, prop) => (globalThis as unknown as { __g9: SupabaseClient & Record<string | symbol, unknown> }).__g9[prop],
  }),
  traducirError: (e: { message?: string } | null) => new Error(e?.message ?? 'error'),
}));

import {
  eliminarRespuestaEvecl,
  guardarFichaEvecl,
  obtenerCatalogoEvecl,
  obtenerFichaEvecl,
  type EveclFichaEntrada,
  type EveclFotoPendiente,
  type EveclRespuesta,
} from '../../../frontend/src/api/evecl';

const ctx = new ContextoG9();
let admin: UsuarioG9;
let autor: UsuarioG9;
let otro: UsuarioG9;
let cat: DescriptorG9[];
const BUCKET = 'evecl-fotos';

const comoCliente = (c: SupabaseClient) => {
  (globalThis as unknown as { __g9: SupabaseClient }).__g9 = c;
};
const como = (u: UsuarioG9) => comoCliente(u.client);

/** El mismo usuario, pero con la red caída solo para las subidas a Storage (simula el corte de señal en terreno). */
function conSubidaCaida(u: UsuarioG9): SupabaseClient {
  return new Proxy(u.client, {
    get(destino, prop) {
      if (prop === 'storage') {
        return {
          from: (bucket: string) => {
            const api = destino.storage.from(bucket) as unknown as Record<string, unknown>;
            return new Proxy(api, {
              get: (a, q) => (q === 'upload'
                ? async () => ({ data: null, error: new Error('Failed to fetch') })
                : typeof a[q as string] === 'function' ? (a[q as string] as (...args: unknown[]) => unknown).bind(a) : a[q as string]),
            });
          },
        };
      }
      const valor = (destino as unknown as Record<string | symbol, unknown>)[prop];
      return typeof valor === 'function' ? (valor as (...args: unknown[]) => unknown).bind(destino) : valor;
    },
  });
}

/** Un tercero sube un archivo a las rutas de foto de las próximas `n` fichas (ids secuenciales y predecibles). */
async function ocuparRutasFuturas(ensayoId: number, n: number): Promise<[number, number]> {
  const [ultimo, llamado] = psqlRoot(`select last_value, is_called from evecl_ficha_id_seq`).trim().split('|');
  const primera = Number(ultimo) + (llamado === 't' ? 1 : 0);
  for (let id = primera; id < primera + n; id++) {
    const ruta = `evecl/${ensayoId}/${id}/${firmeza().id}.jpg`;
    ctx.registrarObjeto(BUCKET, ruta);
    const { error } = await otro.client.storage.from(BUCKET).upload(ruta, jpeg('atacante.jpg'), { contentType: 'image/jpeg' });
    if (error) throw new Error(`el tercero no pudo ocupar ${ruta}: ${error.message}`);
  }
  return [primera, primera + n - 1];
}
const jpeg = (nombre = 'foto.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], nombre, { type: 'image/jpeg' });
const upov = (n: number) => cat.find((d) => d.codigo_upov === n)!;
const firmeza = () => upov(28);
const dulzor = () => upov(29);

async function anteriores(fichaId: number): Promise<Map<number, EveclRespuesta>> {
  const f = await obtenerFichaEvecl(fichaId);
  return new Map(f.respuestas.map((r) => [r.descriptor_id, r]));
}

function entrada(ensayoId: number, extra: Partial<EveclFichaEntrada> & Pick<EveclFichaEntrada, 'respuestas'>): EveclFichaEntrada {
  return {
    ensayo_id: ensayoId,
    variedad: `AUD-G9-API-${ctx.sufijo}`,
    tipo: 'evaluacion',
    numero_repeticion: 1,
    fecha_evaluacion: '2026-10-01',
    ...extra,
  };
}

async function existeObjeto(path: string): Promise<boolean> {
  const carpeta = path.slice(0, path.lastIndexOf('/'));
  const nombre = path.slice(path.lastIndexOf('/') + 1);
  const { data } = await ctx.service.storage.from(BUCKET).list(carpeta);
  return (data ?? []).some((o) => o.name === nombre);
}

async function filasRespuesta(fichaId: number): Promise<{ descriptor_id: number; foto_path: string | null }[]> {
  const { data } = await ctx.service.from('evecl_respuesta').select('descriptor_id, foto_path').eq('ficha_id', fichaId);
  return (data ?? []) as { descriptor_id: number; foto_path: string | null }[];
}

/** Crea una ficha con foto en Firmeza usando la función real de la app (autor). */
async function fichaConFoto(ensayoId: number, rep = 1): Promise<{ fichaId: number; path: string }> {
  como(autor);
  const fotos: EveclFotoPendiente[] = [{ descriptorId: firmeza().id, archivo: jpeg(), fotoPathAnterior: null }];
  const fichaId = await guardarFichaEvecl(
    entrada(ensayoId, {
      numero_repeticion: rep,
      respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }, { descriptor_id: dulzor().id, valor_numerico: 15 }],
      idempotency_key: crypto.randomUUID(),
    }),
    fotos,
    new Map(),
  );
  const path = `evecl/${ensayoId}/${fichaId}/${firmeza().id}.jpg`;
  ctx.registrarObjeto(BUCKET, path);
  return { fichaId, path };
}

beforeAll(async () => {
  admin = await ctx.usuario('api-admin', 'admin');
  autor = await ctx.usuario('api-autor', 'operario');
  otro = await ctx.usuario('api-otro', 'operario');
  cat = await ctx.catalogo(autor.client);
}, 60_000);

afterAll(async () => {
  await ctx.limpiar();
}, 60_000);

describe('T07 — guardarFichaEvecl con fotos (camino feliz, control)', () => {
  it('crear una ficha con foto: la fila queda con foto_path y el objeto existe en el bucket privado', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-OK');
    const { fichaId, path } = await fichaConFoto(ensayoId);
    const filas = await filasRespuesta(fichaId);
    expect(filas.find((f) => f.descriptor_id === firmeza().id)?.foto_path).toBe(path);
    expect(await existeObjeto(path)).toBe(true);
  });

  it('quitar la foto en una edición borra el objeto y deja foto_path en null conservando el valor (flujo en dos guardados)', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-QUITAR');
    const { fichaId, path } = await fichaConFoto(ensayoId);
    como(autor);
    await guardarFichaEvecl(
      entrada(ensayoId, { id: fichaId, respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10, foto_path: null }, { descriptor_id: dulzor().id, valor_numerico: 15 }] }),
      [],
      await anteriores(fichaId),
    );
    expect(await existeObjeto(path)).toBe(false);
    const f = (await filasRespuesta(fichaId)).find((x) => x.descriptor_id === firmeza().id);
    expect(f?.foto_path).toBeNull();
  });

  it('workaround de A1-G9-01: quitar la foto, guardar, y recién entonces agregar otra funciona', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-WORKAROUND');
    const { fichaId, path } = await fichaConFoto(ensayoId);
    como(autor);
    await guardarFichaEvecl(
      entrada(ensayoId, { id: fichaId, respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10, foto_path: null }] }),
      [],
      await anteriores(fichaId),
    );
    await guardarFichaEvecl(
      entrada(ensayoId, { id: fichaId, respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }] }),
      [{ descriptorId: firmeza().id, archivo: jpeg('nueva.jpg'), fotoPathAnterior: null }],
      await anteriores(fichaId),
    );
    expect(await existeObjeto(path)).toBe(true);
  });
});

describe('T07 — A1-G9-01: reemplazar una foto existente', () => {
  it.fails('A1-G9-01 — "Reemplazar foto" sobre un descriptor que ya tiene foto debería guardar la nueva (hoy falla: upsert sin policy UPDATE)', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-REEMPLAZO');
    const { fichaId, path } = await fichaConFoto(ensayoId);
    como(autor);
    const previas = await anteriores(fichaId);
    const resultado = guardarFichaEvecl(
      entrada(ensayoId, {
        id: fichaId,
        respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10, foto_path: path }],
      }),
      [{ descriptorId: firmeza().id, archivo: jpeg('reemplazo.jpg'), fotoPathAnterior: path }],
      previas,
    );
    // Hoy: rechaza con "No se pudo subir la foto comprimida. Revisa la conexión…" (mensaje engañoso: no es la conexión).
    await expect(resultado).resolves.toBe(fichaId);
  });

  it('A1-G9-01 — evidencia directa: ni el propio dueño puede sobrescribir su objeto (upsert:true → 403 RLS)', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-UPSERT');
    const { path } = await fichaConFoto(ensayoId);
    const { error } = await autor.client.storage.from(BUCKET).upload(path, jpeg('otra.jpg'), { contentType: 'image/jpeg', upsert: true });
    expect(error).not.toBeNull();
    expect((error as { statusCode?: string }).statusCode).toBe('403');
    expect(error?.message).toMatch(/row-level security/i);
  });
});

describe('T07 — A1-G9-01 (variante): un objeto propio huérfano bloquea la foto de ese descriptor para siempre', () => {
  it.fails('A1-G9-01 — si una subida anterior quedó sin fila (corte de señal entre el upload y la segunda RPC), agregar la foto después debería funcionar (hoy el objeto ocupa la ruta, el upsert falla y la UI no tiene a qué referencia borrarlo)', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-HUERFANO-PROPIO');
    como(autor);
    const fichaId = await guardarFichaEvecl(
      entrada(ensayoId, { respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }], idempotency_key: crypto.randomUUID() }),
      [],
      new Map(),
    );
    // Simula el corte: el archivo llegó a Storage pero la fila nunca recibió su foto_path.
    const path = `evecl/${ensayoId}/${fichaId}/${firmeza().id}.jpg`;
    ctx.registrarObjeto(BUCKET, path);
    const { error } = await autor.client.storage.from(BUCKET).upload(path, jpeg('huerfana.jpg'), { contentType: 'image/jpeg' });
    expect(error).toBeNull();
    expect((await filasRespuesta(fichaId))[0].foto_path).toBeNull();

    // El usuario vuelve a la ficha y agrega la foto.
    await expect(
      guardarFichaEvecl(
        entrada(ensayoId, { id: fichaId, respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }] }),
        [{ descriptorId: firmeza().id, archivo: jpeg('reintento.jpg'), fotoPathAnterior: null }],
        await anteriores(fichaId),
      ),
    ).resolves.toBe(fichaId);
  });
});

describe('T07 — A1-G9-02: guardar borra antes de validar', () => {
  it('A1-G9-02 — si la RPC falla (repetición ya usada), la respuesta quitada y su foto se conservan', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-ATOMICO');
    const { fichaId, path } = await fichaConFoto(ensayoId, 1);
    // Segunda ficha de la misma variedad que ocupa la repetición 2.
    como(autor);
    await guardarFichaEvecl(entrada(ensayoId, { numero_repeticion: 2, respuestas: [{ descriptor_id: dulzor().id, valor_numerico: 9 }] }), [], new Map());

    // El usuario quita Firmeza (con foto) y, por error, cambia la repetición a 2 (ocupada).
    const previas = await anteriores(fichaId);
    await expect(
      guardarFichaEvecl(
        entrada(ensayoId, { id: fichaId, numero_repeticion: 2, respuestas: [{ descriptor_id: dulzor().id, valor_numerico: 15 }] }),
        [],
        previas,
      ),
    ).rejects.toThrow();

    // Lo esperable en un guardado fallido: nada cambia.
    const filas = await filasRespuesta(fichaId);
    expect(filas.some((f) => f.descriptor_id === firmeza().id)).toBe(true);
    expect(await existeObjeto(path)).toBe(true);
  });

  it('A1-G9-02 — control: si el guardado sale bien, quitar una respuesta sí la borra junto con su foto', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-QUITAR-RESP');
    const { fichaId, path } = await fichaConFoto(ensayoId);
    como(autor);
    await guardarFichaEvecl(
      entrada(ensayoId, { id: fichaId, respuestas: [{ descriptor_id: dulzor().id, valor_numerico: 15 }] }),
      [],
      await anteriores(fichaId),
    );
    expect((await filasRespuesta(fichaId)).some((f) => f.descriptor_id === firmeza().id)).toBe(false);
    expect(await existeObjeto(path)).toBe(false);
  });
});

describe('T07 — A1-G9-03 / A1-G9-06: fallo parcial al crear con foto y reintento', () => {
  it('A1-G9-06 — cualquier autenticado puede ocupar la ruta de la foto de una ficha futura (id secuencial + policy INSERT abierta) y la subida legítima falla', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-SQUAT');
    // El atacante ocupa las rutas de las próximas 15 fichas (los ids son secuenciales; otros procesos pueden consumir algunos).
    const [primera, ultima] = await ocuparRutasFuturas(ensayoId, 15);

    como(autor);
    const llave = crypto.randomUUID();
    await expect(
      guardarFichaEvecl(
        entrada(ensayoId, { respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }], idempotency_key: llave }),
        [{ descriptorId: firmeza().id, archivo: jpeg('legitima.jpg'), fotoPathAnterior: null }],
        new Map(),
      ),
    ).rejects.toThrow(/No se pudo subir la foto/);

    // La ficha igual quedó creada (primera RPC) pero sin foto: el guardado quedó a medias.
    const { data } = await ctx.service.from('evecl_ficha').select('id, notas').eq('idempotency_key', llave).single();
    expect(data!.id).toBeGreaterThanOrEqual(primera);
    expect(data!.id).toBeLessThanOrEqual(ultima);
    const filas = await filasRespuesta(data!.id);
    expect(filas.find((f) => f.descriptor_id === firmeza().id)?.foto_path).toBeNull();
  });

  it.fails('A1-G9-03 — reintentar con la misma idempotency_key tras el fallo debería aplicar las ediciones (hoy devuelve la ficha vieja y las descarta sin avisar)', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-REINTENTO');

    // Primer intento: la ficha se crea (primera RPC) pero se corta la señal justo al subir la foto.
    comoCliente(conSubidaCaida(autor));
    const llave = crypto.randomUUID();
    const primero = entrada(ensayoId, { respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }], notas: 'primer intento', idempotency_key: llave });
    await expect(
      guardarFichaEvecl(primero, [{ descriptorId: firmeza().id, archivo: jpeg(), fotoPathAnterior: null }], new Map()),
    ).rejects.toThrow(/No se pudo subir la foto/);

    // Vuelve la señal. El usuario ve el error, descarta la foto, corrige la nota y guarda de nuevo (el formulario conserva la misma llave).
    como(autor);
    const segundo = entrada(ensayoId, { respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 12 }], notas: 'corregido', idempotency_key: llave });
    const id = await guardarFichaEvecl(segundo, [], new Map());
    const { data: unica } = await ctx.service.from('evecl_ficha').select('id').eq('idempotency_key', llave).single();
    expect(id).toBe(unica!.id);

    const { data } = await ctx.service.from('evecl_ficha').select('notas').eq('id', id).single();
    const filas = await ctx.service.from('evecl_respuesta').select('valor_numerico').eq('ficha_id', id).eq('descriptor_id', firmeza().id).single();
    expect(data?.notas).toBe('corregido');
    expect(Number(filas.data?.valor_numerico)).toBe(12);
  });
});

describe('T07 — A1-G9-04: descriptor desactivado', () => {
  it('A1-G9-04 — editar una ficha tras desactivar un descriptor conserva su respuesta y foto', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-INACTIVO');
    const descriptorX = await ctx.descriptorPropio('valor', 'inactivo');
    como(autor);
    const fichaId = await guardarFichaEvecl(
      entrada(ensayoId, { respuestas: [{ descriptor_id: descriptorX, valor_numerico: 5 }, { descriptor_id: dulzor().id, valor_numerico: 15 }], idempotency_key: crypto.randomUUID() }),
      [{ descriptorId: descriptorX, archivo: jpeg(), fotoPathAnterior: null }],
      new Map(),
    );
    const rutaRetirada = `evecl/${ensayoId}/${fichaId}/${descriptorX}.jpg`;
    ctx.registrarObjeto(BUCKET, rutaRetirada);
    // Un admin desactiva el descriptor (única forma de retirarlo hoy; sin pantalla).
    const { error } = await admin.client.from('evecl_descriptor').update({ activo: false }).eq('id', descriptorX);
    expect(error).toBeNull();

    // El formulario arma las respuestas SOLO con el catálogo activo, pero las "anteriores" vienen de la ficha completa.
    const catalogoActivo = await obtenerCatalogoEvecl();
    expect(catalogoActivo.some((d) => d.id === descriptorX)).toBe(false);
    const previas = await anteriores(fichaId);
    expect(previas.has(descriptorX)).toBe(true);
    await guardarFichaEvecl(
      entrada(ensayoId, { id: fichaId, respuestas: [{ descriptor_id: dulzor().id, valor_numerico: 16 }] }),
      [],
      previas,
    );
    const filas = await filasRespuesta(fichaId);
    expect(filas.some((f) => f.descriptor_id === descriptorX)).toBe(true);
    expect(filas.find((f) => f.descriptor_id === descriptorX)?.foto_path).toBe(rutaRetirada);
    expect(await existeObjeto(rutaRetirada)).toBe(true);
  });
});

describe('T07 — A1-G9-05: un admin edita la ficha de otro autor y quita su foto', () => {
  it.fails('A1-G9-05 — borrar la respuesta con foto ajena no debe dejar el objeto huérfano ni aparentar éxito (hoy remove() devuelve [] sin error)', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-ADMIN-FOTO');
    const { fichaId, path } = await fichaConFoto(ensayoId);
    como(admin);
    // La app llama exactamente a esto cuando el usuario pulsa "Borrar respuesta" y guarda.
    let fallo: unknown = null;
    try {
      await eliminarRespuestaEvecl(fichaId, firmeza().id, path);
    } catch (e) {
      fallo = e;
    }
    const filaSigue = (await filasRespuesta(fichaId)).some((f) => f.descriptor_id === firmeza().id);
    const objetoSigue = await existeObjeto(path);
    // Aceptable: error y todo intacto. Inaceptable: fila borrada con el objeto vivo (huérfano).
    expect(!filaSigue && objetoSigue).toBe(false);
    // Para que quede claro cuál de los dos caminos se tomó:
    expect(fallo !== null || !objetoSigue).toBe(true);
  });

  it('A1-G9-05 — evidencia de base: el admin tampoco puede borrar por la API un objeto ajeno (policy DELETE solo del dueño, sin excepción de admin)', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-ADMIN-BORRA');
    const { path } = await fichaConFoto(ensayoId);
    const { data, error } = await admin.client.storage.from(BUCKET).remove([path]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await existeObjeto(path)).toBe(true);
  });
});

describe('T07 — A1-G9-07: foto sin estado en un descriptor de tipo estado', () => {
  it.fails('A1-G9-07 — adjuntar solo una foto a un descriptor "estado" (sin elegir nota) debe guardar todo o no guardar nada; hoy la ficha queda creada y el guardado falla con un código opaco', async () => {
    const ensayoId = await ctx.ensayo(autor.client, 'API-FOTO-ESTADO');
    const vigor = upov(1);
    como(autor);
    const llave = crypto.randomUUID();
    // Lo que arma FichaForm cuando el usuario solo eligió un archivo para "Vigor": respuesta vacía + archivo pendiente.
    let rechazado = false;
    try {
      await guardarFichaEvecl(
        entrada(ensayoId, {
          respuestas: [{ descriptor_id: dulzor().id, valor_numerico: 15 }, { descriptor_id: vigor.id, nota: null, valor_numerico: null, valor_texto: null, foto_path: null }],
          idempotency_key: llave,
        }),
        [{ descriptorId: vigor.id, archivo: jpeg(), fotoPathAnterior: null }],
        new Map(),
      );
    } catch {
      rechazado = true;
    }
    const { data } = await ctx.service.from('evecl_ficha').select('id').eq('idempotency_key', llave).maybeSingle();
    // Hoy: rechazado = true y la ficha existe (la primera RPC ya se confirmó; la segunda, con la foto, la rechaza el trigger de coherencia).
    expect(rechazado ? data === null : true).toBe(true);
  });
});
