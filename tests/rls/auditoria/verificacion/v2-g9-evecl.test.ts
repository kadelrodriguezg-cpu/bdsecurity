/**
 * Verificación independiente de A1-G9-01, A1-G9-02, A1-G9-04 y A1-G9-10 (módulo EVECL).
 *
 * Se ejecuta el código REAL de la app (`frontend/src/api/evecl.ts`) contra la base local,
 * reemplazando solo `./client` por el cliente de cada usuario de prueba (sujeto a RLS).
 * Datos propios: ensayos `AUD-V2-...`, variedades `AUD-V2 ...`, descriptor propio para G9-04.
 */
import { guardarFichaEvecl as guardarFichaRpc } from '../../envolturas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ContextoV2, psql } from './v2-comun';

vi.mock('../../../../frontend/src/api/client', () => ({
  supabase: new Proxy({}, {
    get: (_t, prop) => (globalThis as unknown as { __v2: Record<string | symbol, unknown> }).__v2[prop],
  }),
  traducirError: (e: { message?: string } | null) => new Error(e?.message ?? 'error'),
}));

import {
  guardarFichaEvecl,
  obtenerCatalogoEvecl,
  obtenerFichaEvecl,
  subirFotoDescriptorEvecl,
  type EveclFichaEntrada,
  type EveclRespuesta,
} from '../../../../frontend/src/api/evecl';

const ctx = new ContextoV2('g9');
const BUCKET = 'evecl-fotos';
let admin: Awaited<ReturnType<ContextoV2['usuario']>>;
let autor: Awaited<ReturnType<ContextoV2['usuario']>>;
const ensayos: number[] = [];
const rutasStorage: string[] = [];
const descriptoresPropios: number[] = [];
let firmezaId: number;
let dulzorId: number;

const como = (c: SupabaseClient) => {
  (globalThis as unknown as { __v2: SupabaseClient }).__v2 = c;
};
const jpeg = (n = 'foto.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], n, { type: 'image/jpeg' });

async function nuevoEnsayo(tema: string): Promise<number> {
  const { data, error } = await autor.client.rpc('evecl_guardar_ensayo', { p_codigo_parcela: `AUD-V2-${tema}-${ctx.sufijo}` });
  if (error || data == null) throw new Error(`ensayo ${tema}: ${error?.message}`);
  ensayos.push(Number(data));
  return Number(data);
}

function entrada(ensayoId: number, variedad: string, repeticion: number, respuestas: EveclFichaEntrada['respuestas'], extra: Partial<EveclFichaEntrada> = {}): EveclFichaEntrada {
  return { ensayo_id: ensayoId, variedad, tipo: 'evaluacion', numero_repeticion: repeticion, fecha_evaluacion: '2026-10-01', respuestas, ...extra };
}

async function rpcFicha(ensayoId: number, variedad: string, repeticion: number, respuestas: unknown[] = []): Promise<number> {
  const { data, error } = await guardarFichaRpc(autor.client, {
    p_ensayo_id: ensayoId, p_variedad: variedad, p_numero_repeticion: repeticion, p_tipo: 'evaluacion',
    p_fecha_evaluacion: '2026-10-01', p_respuestas: respuestas,
  });
  if (error || data == null) throw new Error(`ficha ${variedad} r${repeticion}: ${error?.message}`);
  return Number(data);
}

const existeObjeto = async (path: string): Promise<boolean> => {
  const carpeta = path.split('/').slice(0, -1).join('/');
  const nombre = path.split('/').pop()!;
  const { data } = await ctx.service.storage.from(BUCKET).list(carpeta);
  return (data ?? []).some((o) => o.name === nombre);
};

const respuestasDe = (fichaId: number) =>
  psql(`select descriptor_id||':'||coalesce(foto_path,'-') from evecl_respuesta where ficha_id=${fichaId} order by descriptor_id`);

beforeAll(async () => {
  admin = await ctx.usuario('admin');
  autor = await ctx.usuario('operario', 'autor');
  como(autor.client);
  const cat = await obtenerCatalogoEvecl();
  firmezaId = cat.find((d) => d.codigo_upov === 28)!.id;
  dulzorId = cat.find((d) => d.codigo_upov === 29)!.id;
}, 90_000);

afterAll(async () => {
  if (rutasStorage.length) await ctx.service.storage.from(BUCKET).remove(rutasStorage);
  const lista = ensayos.join(',') || '0';
  const desc = descriptoresPropios.join(',') || '0';
  psql(`
    set session_replication_role = replica;
    delete from evecl_respuesta where ficha_id in (select id from evecl_ficha where ensayo_id in (${lista})) or descriptor_id in (${desc});
    delete from evecl_ficha where ensayo_id in (${lista});
    delete from evecl_ensayo where id in (${lista});
    delete from evecl_descriptor_estado where descriptor_id in (${desc});
    delete from evecl_descriptor where id in (${desc});
  `);
  const fallos = await ctx.borrarUsuarios();
  if (fallos.length) console.warn('[v2-g9] usuarios no borrados:', fallos);
}, 90_000);

describe('A1-G9-01 — «Reemplazar foto» nunca funciona (upsert sin policy UPDATE)', () => {
  it('storage: el mismo dueño sube una vez (INSERT) y el upsert posterior sobre la misma ruta falla', async () => {
    const ruta = `evecl/0/${ctx.sufijo}/probe.jpg`;
    rutasStorage.push(ruta);
    const primera = await autor.client.storage.from(BUCKET).upload(ruta, jpeg(), { contentType: 'image/jpeg', upsert: true });
    expect(primera.error).toBeNull(); // el primer upsert sí pasa: no hay conflicto, es un INSERT
    const segunda = await autor.client.storage.from(BUCKET).upload(ruta, jpeg('otra.jpg'), { contentType: 'image/jpeg', upsert: true });
    expect(segunda.error).not.toBeNull();
    expect(JSON.stringify(segunda.error)).toMatch(/row-level security|403|Unauthorized/i);
    const sinUpsert = await autor.client.storage.from(BUCKET).upload(ruta, jpeg(), { contentType: 'image/jpeg' });
    expect(sinUpsert.error).not.toBeNull(); // 409 Duplicate: tampoco hay otra forma de sobrescribir
    expect(psql(`select count(*) from pg_policies where schemaname='storage' and tablename='objects' and cmd='UPDATE' and qual ilike '%evecl-fotos%'`)).toBe('0');
  });

  it('flujo real de la app: guardar con foto, luego «Reemplazar foto» con otro archivo lanza el error que culpa a la conexión', async () => {
    como(autor.client);
    const ensayo = await nuevoEnsayo('G901');
    const fichaId = await guardarFichaEvecl(
      entrada(ensayo, 'AUD-V2 Reemplazo', 1, [{ descriptor_id: firmezaId, valor_numerico: 4 }]),
      [{ descriptorId: firmezaId, archivo: jpeg(), fotoPathAnterior: null }],
      new Map(),
    );
    const ruta = `evecl/${ensayo}/${fichaId}/${firmezaId}.jpg`;
    rutasStorage.push(ruta);
    expect(await existeObjeto(ruta)).toBe(true);
    expect(respuestasDe(fichaId)).toBe(`${firmezaId}:${ruta}`);

    const ficha = await obtenerFichaEvecl(fichaId);
    const anteriores = new Map<number, EveclRespuesta>(ficha.respuestas.map((r) => [r.descriptor_id, r]));
    await expect(
      guardarFichaEvecl(
        entrada(ensayo, 'AUD-V2 Reemplazo', 1, [{ descriptor_id: firmezaId, valor_numerico: 4, foto_path: ruta }], { id: fichaId }),
        [{ descriptorId: firmezaId, archivo: jpeg('nueva.jpg'), fotoPathAnterior: ruta }],
        anteriores,
      ),
    ).rejects.toThrow('No se pudo subir la foto comprimida. Revisa la conexión');
  });

  it('variante: un objeto que quedó sin fila (corte de señal entre subida y RPC) bloquea para siempre «Agregar foto» en esa ficha', async () => {
    como(autor.client);
    const ensayo = await nuevoEnsayo('G9012');
    const fichaId = await rpcFicha(ensayo, 'AUD-V2 Huerfano', 1, [{ descriptor_id: firmezaId, valor_numerico: 3 }]);
    const ruta = `evecl/${ensayo}/${fichaId}/${firmezaId}.jpg`;
    rutasStorage.push(ruta);
    // La primera subida llega a Storage; la segunda RPC no se ejecuta (se simula no llamándola).
    await subirFotoDescriptorEvecl(ensayo, fichaId, firmezaId, jpeg());
    expect(respuestasDe(fichaId)).toBe(`${firmezaId}:-`); // la fila no conoce la foto
    // El usuario vuelve a la ficha y pulsa «Agregar foto» de nuevo.
    await expect(subirFotoDescriptorEvecl(ensayo, fichaId, firmezaId, jpeg('reintento.jpg'))).rejects.toThrow('No se pudo subir la foto comprimida');
  });
});

describe('A1-G9-02 — guardarFichaEvecl conserva datos si falla la validación', () => {
  it('si la RPC falla (repetición ya usada), conserva respuesta y foto', async () => {
    como(autor.client);
    const ensayo = await nuevoEnsayo('G902');
    const variedad = 'AUD-V2 Perdida';
    const f1 = await guardarFichaEvecl(
      entrada(ensayo, variedad, 1, [{ descriptor_id: firmezaId, valor_numerico: 5 }, { descriptor_id: dulzorId, valor_numerico: 12 }]),
      [{ descriptorId: firmezaId, archivo: jpeg(), fotoPathAnterior: null }],
      new Map(),
    );
    await rpcFicha(ensayo, variedad, 2); // ocupa la repetición 2
    const ruta = `evecl/${ensayo}/${f1}/${firmezaId}.jpg`;
    rutasStorage.push(ruta);
    expect(await existeObjeto(ruta)).toBe(true);
    const ficha = await obtenerFichaEvecl(f1);
    const anteriores = new Map<number, EveclRespuesta>(ficha.respuestas.map((r) => [r.descriptor_id, r]));
    expect(anteriores.get(firmezaId)?.foto_path).toBe(ruta);

    // El usuario quita Firmeza y, por error, cambia la repetición a 2: la RPC dirá «duplicado».
    await expect(
      guardarFichaEvecl(
        entrada(ensayo, variedad, 2, [{ descriptor_id: dulzorId, valor_numerico: 12 }], { id: f1 }),
        [],
        anteriores,
      ),
    ).rejects.toThrow();

    // La ficha conserva la repetición 1 (el UPDATE falló)...
    expect(psql(`select numero_repeticion from evecl_ficha where id=${f1}`)).toBe('1');
    // Firmeza y su foto se conservan junto a Dulzor.
    expect(respuestasDe(f1)).toContain(`${firmezaId}:${ruta}`);
    expect(respuestasDe(f1)).toContain(`${dulzorId}:-`);
    expect(await existeObjeto(ruta)).toBe(true);
  });

  it('control: el mismo flujo con un guardado exitoso sí borra la respuesta (la baja es intencional cuando todo sale bien)', async () => {
    como(autor.client);
    const ensayo = await nuevoEnsayo('G9022');
    const f = await guardarFichaEvecl(
      entrada(ensayo, 'AUD-V2 Control', 1, [{ descriptor_id: firmezaId, valor_numerico: 5 }, { descriptor_id: dulzorId, valor_numerico: 12 }]),
      [],
      new Map(),
    );
    const ficha = await obtenerFichaEvecl(f);
    const anteriores = new Map<number, EveclRespuesta>(ficha.respuestas.map((r) => [r.descriptor_id, r]));
    await guardarFichaEvecl(entrada(ensayo, 'AUD-V2 Control', 1, [{ descriptor_id: dulzorId, valor_numerico: 12 }], { id: f }), [], anteriores);
    expect(respuestasDe(f)).toBe(`${dulzorId}:-`);
  });
});

describe('A1-G9-04 — editar conserva respuestas de descriptores retirados', () => {
  it('el formulario con catálogo activo conserva la respuesta del descriptor inactivo', async () => {
    const nuevo = await admin.client.from('evecl_descriptor').insert({
      nombre: `AUD-V2 descriptor ${ctx.sufijo}`, tipo: 'valor', eje: 'calidad', unidad: 'u', rankeable: true,
      direccion_ranking: 'mayor', orden: 9000 + Math.floor(Math.random() * 900), activo: true,
    }).select('id').single();
    expect(nuevo.error).toBeNull();
    const propio = Number(nuevo.data!.id);
    descriptoresPropios.push(propio);

    como(autor.client);
    const ensayo = await nuevoEnsayo('G904');
    const f = await rpcFicha(ensayo, 'AUD-V2 Retiro', 1, [
      { descriptor_id: propio, valor_numerico: 7, valor_texto: 'dato valioso' },
      { descriptor_id: dulzorId, valor_numerico: 11 },
    ]);
    expect(psql(`select count(*) from evecl_respuesta where ficha_id=${f}`)).toBe('2');

    // El admin retira el descriptor (mantenimiento previsto del catálogo).
    const off = await admin.client.from('evecl_descriptor').update({ activo: false }).eq('id', propio).select('id');
    expect(off.error).toBeNull();
    expect(off.data).toHaveLength(1);

    // Otro usuario abre la ficha: la API la devuelve con la respuesta del inactivo; el catálogo ya no lo trae.
    const catalogo = await obtenerCatalogoEvecl();
    expect(catalogo.some((d) => d.id === propio)).toBe(false);
    const ficha = await obtenerFichaEvecl(f);
    expect(ficha.respuestas.some((r) => r.descriptor_id === propio)).toBe(true);
    const anteriores = new Map<number, EveclRespuesta>(ficha.respuestas.map((r) => [r.descriptor_id, r]));

    // Lo que arma FichaForm.tsx:219-222: solo descriptores del catálogo (activo) con dato. Se cambia Dulzor.
    const respuestasEntrada = catalogo
      .filter((d) => d.id === dulzorId)
      .map((d) => ({ descriptor_id: d.id, valor_numerico: 13 }));
    await guardarFichaEvecl(entrada(ensayo, 'AUD-V2 Retiro', 1, respuestasEntrada, { id: f }), [], anteriores);

    expect(psql(`select count(*) from evecl_respuesta where ficha_id=${f} and descriptor_id=${propio}`)).toBe('1');
    expect(psql(`select valor_numerico || ':' || valor_texto from evecl_respuesta where ficha_id=${f} and descriptor_id=${propio}`)).toBe('7:dato valioso');
  });

  it('la completitud excluye retiradas y evecl_comparar sigue puntuando con ellas', async () => {
    const nuevo = await admin.client.from('evecl_descriptor').insert({
      nombre: `AUD-V2 descriptor B ${ctx.sufijo}`, tipo: 'valor', eje: 'calidad', unidad: 'u', rankeable: true,
      direccion_ranking: 'mayor', orden: 9000 + Math.floor(Math.random() * 900), activo: true,
    }).select('id').single();
    expect(nuevo.error).toBeNull();
    const propio = Number(nuevo.data!.id);
    descriptoresPropios.push(propio);

    como(autor.client);
    const ensayo = await nuevoEnsayo('G9042');
    const fa = await rpcFicha(ensayo, 'AUD-V2 A', 1, [{ descriptor_id: propio, valor_numerico: 1 }]);
    await rpcFicha(ensayo, 'AUD-V2 B', 1, [{ descriptor_id: propio, valor_numerico: 5 }]);

    const comparar = async () => {
      const { data, error } = await autor.client.rpc('evecl_comparar', { p_modo: 'entre_grupos', p_ensayo_id: ensayo, p_conjunto: 'todos' });
      expect(error).toBeNull();
      return (data as { ranking_calidad: Array<{ variedad: string; puntaje: number }> }).ranking_calidad;
    };
    const antes = await comparar();
    expect(antes.map((x) => x.variedad).sort()).toEqual(['AUD-V2 A', 'AUD-V2 B']);

    const off = await admin.client.from('evecl_descriptor').update({ activo: false }).eq('id', propio).select('id');
    expect(off.error).toBeNull();

    const despues = await comparar();
    expect(despues.map((x) => x.variedad).sort()).toEqual(['AUD-V2 A', 'AUD-V2 B']); // el inactivo sigue puntuando
    const fichas = await autor.client.rpc('evecl_obtener_fichas', { p_ensayo_id: ensayo, p_variedad: 'AUD-V2 A' });
    expect(fichas.error).toBeNull();
    const fila = (fichas.data as Array<Record<string, unknown>>).find((x) => Number(x.id) === fa)!;
    // La histórica sigue puntuando, pero no es un descriptor activo respondido.
    expect(Number(fila.respondidos)).toBe(0);
  });
});

describe('A1-G9-10 — comparación agrupa nombres equivalentes', () => {
  it('evecl_comparar une Duke/duke y calcula el puntaje con las tres repeticiones', async () => {
    como(autor.client);
    const ensayo = await nuevoEnsayo('G910');
    const firm = (v: number) => [{ descriptor_id: firmezaId, valor_numerico: v }];
    await rpcFicha(ensayo, 'AUD-V2 Duke', 1, firm(10));
    await rpcFicha(ensayo, 'AUD-V2 duke', 2, firm(2)); // el índice único normalizado lo permite: otra repetición
    await rpcFicha(ensayo, 'AUD-V2 Duke', 3, firm(10));
    await rpcFicha(ensayo, 'AUD-V2 Blue', 1, firm(6));

    // El propio sistema las trata como la misma variedad en otros lugares.
    const { data: lista } = await autor.client.rpc('evecl_obtener_ensayos');
    const miEnsayo = (lista as Array<Record<string, unknown>>).find((e) => Number(e.id) === ensayo)!;
    expect(Number(miEnsayo.total_variedades)).toBe(2);
    expect(Number(miEnsayo.total_fichas)).toBe(4);
    const unica = await guardarFichaRpc(autor.client, {
      p_ensayo_id: ensayo, p_variedad: 'aud-v2 DUKE', p_numero_repeticion: 1, p_tipo: 'evaluacion', p_fecha_evaluacion: '2026-10-01',
    });
    expect(unica.error?.code).toBe('23505'); // para la unicidad, «Duke» == «duke»

    const { data, error } = await autor.client.rpc('evecl_comparar', { p_modo: 'entre_grupos', p_ensayo_id: ensayo, p_conjunto: 'todos' });
    expect(error).toBeNull();
    const ranking = (data as { ranking_calidad: Array<{ variedad: string; puntaje: number; n_total: number }> }).ranking_calidad;
    const porVariedad = new Map(ranking.map((r) => [r.variedad.trim().toLowerCase(), r]));
    expect(ranking).toHaveLength(2);
    expect(porVariedad.size).toBe(2);
    expect(porVariedad.get('aud-v2 duke')?.n_total).toBe(3);
    // Duke = (10+2+10)/3 = 7,33; Blue = 6 es ahora el mínimo.
    expect(Number(porVariedad.get('aud-v2 blue')?.puntaje)).toBe(0);
    expect(Number(porVariedad.get('aud-v2 duke')?.puntaje)).toBe(100);
  });
});
