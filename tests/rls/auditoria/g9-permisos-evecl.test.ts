/**
 * G9 / T07 — matriz de permisos de EVECL: tabla × operación × rol
 * (anon, operario no autor, operario autor, admin), RPC de mutación,
 * atomicidad, idempotencia, concurrencia y aislamiento del núcleo.
 *
 * Los permisos se prueban SIEMPRE con clientes logueados con la clave anon
 * (sujetos al RLS). service_role solo prepara y limpia.
 *
 * Hallazgos (cada `it.fails` está escrito con lo que DEBERÍA pasar):
 *  - A1-G9-14  nadie puede archivar un ensayo (el soft delete por UPDATE choca con la policy SELECT)
 *  - A1-G9-15  cualquier autenticado inserta respuestas en la ficha de otro autor
 *  - A1-G9-16  la idempotency_key no está atada al usuario: otro usuario recibe el id de una ficha ajena
 *  - A1-G9-04  (parte base) completitud cuenta respuestas de descriptores inactivos
 */
import { guardarFichaEvecl } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoG9, psqlRoot, type DescriptorG9, type UsuarioG9 } from './g9-setup';

const ctx = new ContextoG9();
let admin: UsuarioG9;
let autor: UsuarioG9;
let otro: UsuarioG9;
let cat: DescriptorG9[];

const upov = (n: number) => cat.find((d) => d.codigo_upov === n)!;
const firmeza = () => upov(28);
const dulzor = () => upov(29);

async function fichaDe(u: UsuarioG9, ensayoId: number, variedad: string, rep = 1, extra: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await guardarFichaEvecl(u.client, {
    p_ensayo_id: ensayoId, p_variedad: variedad, p_numero_repeticion: rep, ...extra,
  });
  if (error) throw new Error(`ficha ${variedad}: ${error.message}`);
  return Number(data);
}

beforeAll(async () => {
  admin = await ctx.usuario('perm-admin', 'admin');
  autor = await ctx.usuario('perm-autor', 'operario');
  otro = await ctx.usuario('perm-otro', 'operario');
  cat = await ctx.catalogo(autor.client);
}, 60_000);

afterAll(async () => {
  await ctx.limpiar();
}, 60_000);

describe('T07 — evecl_ensayo: permisos directos por PostgREST', () => {
  it('anon no lee ni escribe; un autenticado lee todos los ensayos activos', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-ENS-LEE', { p_nombre_productor: 'Productor Ejemplo', p_direccion: 'Camino 1', p_latitud: -35.4, p_longitud: -71.6 });
    const a = await ctx.anon.from('evecl_ensayo').select('id').eq('id', e);
    expect(a.error?.code).toBe('42501');
    const o = await otro.client.from('evecl_ensayo').select('*').eq('id', e).single();
    expect(o.data?.nombre_productor).toBe('Productor Ejemplo');
    expect(o.data?.direccion).toBe('Camino 1');
    expect(Number(o.data?.latitud)).toBe(-35.4);
  });

  it('INSERT directo: solo a nombre propio; created_by de otro es rechazado', async () => {
    const ok = await autor.client.from('evecl_ensayo').insert({ codigo_parcela: ctx.codigo('PERM-INS-OK') }).select('id').single();
    expect(ok.error).toBeNull();
    ctx.registrarEnsayo(ok.data!.id as number);
    const falso = await autor.client.from('evecl_ensayo').insert({ codigo_parcela: ctx.codigo('PERM-INS-FALSO'), created_by: otro.userId });
    expect(falso.error?.code).toBe('42501');
  });

  it('UPDATE directo: el autor y el admin sí; otro operario no (0 filas, sin error)', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-ENS-UPD');
    const o = await otro.client.from('evecl_ensayo').update({ notas: 'otro' }).eq('id', e).select('id');
    expect(o.error).toBeNull();
    expect(o.data).toEqual([]);
    const a = await autor.client.from('evecl_ensayo').update({ notas: 'autor' }).eq('id', e).select('notas');
    expect(a.data?.[0]?.notas).toBe('autor');
    const ad = await admin.client.from('evecl_ensayo').update({ notas: 'admin' }).eq('id', e).select('notas');
    expect(ad.data?.[0]?.notas).toBe('admin');
  });

  it('DELETE directo: nadie (ni admin) tiene el privilegio', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-ENS-DEL');
    for (const u of [autor, admin, otro]) {
      const r = await u.client.from('evecl_ensayo').delete().eq('id', e);
      expect(r.error?.code).toBe('42501');
    }
  });

  it('RPC evecl_guardar_ensayo: otro operario no edita; el admin sí; el código de parcela es único sin importar mayúsculas ni espacios', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-ENS-RPC');
    const o = await otro.client.rpc('evecl_guardar_ensayo', { p_id: e, p_codigo_parcela: ctx.codigo('PERM-ENS-RPC'), p_notas: 'x' });
    expect(o.error?.code).toBe('42501');
    const ad = await admin.client.rpc('evecl_guardar_ensayo', { p_id: e, p_codigo_parcela: ctx.codigo('PERM-ENS-RPC'), p_notas: 'admin' });
    expect(ad.error).toBeNull();
    const dup = await otro.client.rpc('evecl_guardar_ensayo', { p_codigo_parcela: `  ${ctx.codigo('PERM-ENS-RPC').toLowerCase()} ` });
    expect(dup.error?.code).toBe('23505');
  });

  it('coordenadas: latitud y longitud fuera de rango o NaN son rechazadas', async () => {
    for (const [lat, lon] of [[91, 0], [-91, 0], [0, 181], [0, -181], ['NaN', 0], [0, 'NaN']] as const) {
      const r = await autor.client.rpc('evecl_guardar_ensayo', { p_codigo_parcela: ctx.codigo(`PERM-COORD-${lat}-${lon}`), p_latitud: lat, p_longitud: lon });
      expect(r.error, `${lat},${lon}`).not.toBeNull();
    }
  });
});

describe('T07 — A1-G9-14: archivar un ensayo', () => {
  it.fails('A1-G9-14 — el autor (o un admin) debería poder archivar su ensayo con UPDATE de eliminado_at, como dice el Maestro 9.3 (hoy: 403 porque la fila nueva ya no cumple la policy SELECT)', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-ARCHIVAR');
    const r = await autor.client.from('evecl_ensayo').update({ eliminado_at: new Date().toISOString() }).eq('id', e);
    expect(r.error).toBeNull();
  });

  it.fails('A1-G9-14 — tampoco el admin puede archivar un ensayo por la API', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-ARCHIVAR-ADMIN');
    const r = await admin.client.from('evecl_ensayo').update({ eliminado_at: new Date().toISOString() }).eq('id', e);
    expect(r.error).toBeNull();
  });

  it('el único camino de baja de una ficha es la RPC evecl_eliminar_ficha (autor o admin); el UPDATE directo de eliminado_at también choca con la policy SELECT', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-BAJA-FICHA');
    const f1 = await fichaDe(autor, e, 'AUD-G9-A', 1);
    const f2 = await fichaDe(autor, e, 'AUD-G9-A', 2);
    const f3 = await fichaDe(autor, e, 'AUD-G9-A', 3);
    const directo = await autor.client.from('evecl_ficha').update({ eliminado_at: new Date().toISOString() }).eq('id', f1);
    expect(directo.error?.code).toBe('42501');
    expect((await otro.client.rpc('evecl_eliminar_ficha', { p_ficha_id: f1 })).error?.code).toBe('42501');
    expect((await ctx.anon.rpc('evecl_eliminar_ficha', { p_ficha_id: f1 })).error?.code).toBe('42501');
    expect((await autor.client.rpc('evecl_eliminar_ficha', { p_ficha_id: f2 })).error).toBeNull();
    expect((await admin.client.rpc('evecl_eliminar_ficha', { p_ficha_id: f3 })).error).toBeNull();
    // Eliminada = invisible, y la repetición queda libre para volver a usarla.
    expect((await autor.client.rpc('evecl_obtener_ficha', { p_ficha_id: f2 })).error?.code).toBe('P0002');
    expect(await fichaDe(autor, e, 'AUD-G9-A', 2)).toBeGreaterThan(f3);
  });

  it('eliminar una ficha es soft: sus respuestas siguen en la tabla (invisibles por RLS) y su foto sigue en el bucket', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-BAJA-RESTOS');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1, { p_respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }] });
    await autor.client.rpc('evecl_eliminar_ficha', { p_ficha_id: f });
    const { count } = await ctx.service.from('evecl_respuesta').select('id', { count: 'exact', head: true }).eq('ficha_id', f);
    expect(count).toBe(1);
    const visibles = await autor.client.from('evecl_respuesta').select('id').eq('ficha_id', f);
    expect(visibles.data).toEqual([]);
  });
});

describe('T07 — evecl_ficha: permisos directos y RPC', () => {
  it('INSERT directo a nombre de otro es rechazado; UPDATE de otro operario no cambia nada; el admin sí edita', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-FICHA');
    const falso = await autor.client.from('evecl_ficha').insert({ ensayo_id: e, variedad: 'AUD-G9-X', numero_repeticion: 1, created_by: otro.userId });
    expect(falso.error?.code).toBe('42501');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1);
    const o = await otro.client.from('evecl_ficha').update({ notas: 'otro' }).eq('id', f).select('id');
    expect(o.data).toEqual([]);
    const ad = await admin.client.from('evecl_ficha').update({ notas: 'admin' }).eq('id', f).select('notas');
    expect(ad.data?.[0]?.notas).toBe('admin');
    const cambioAutor = await autor.client.from('evecl_ficha').update({ created_by: otro.userId }).eq('id', f).select('id');
    expect(cambioAutor.error?.code).toBe('42501');
  });

  it('RPC evecl_guardar_ficha: otro operario no edita (42501), el admin sí, una ficha eliminada no se edita (P0002)', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-FICHA-RPC');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1);
    expect((await guardarFichaEvecl(otro.client, { p_id: f, p_notas: 'x' })).error?.code).toBe('42501');
    expect((await guardarFichaEvecl(admin.client, { p_id: f, p_notas: 'admin' })).error).toBeNull();
    await autor.client.rpc('evecl_eliminar_ficha', { p_ficha_id: f });
    expect((await guardarFichaEvecl(autor.client, { p_id: f, p_notas: 'x' })).error?.code).toBe('P0002');
  });

  it('validaciones en el servidor: repetición 1-20, fecha no futura, repetición duplicada (sin distinguir mayúsculas ni espacios), variedad vacía', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-FICHA-VALID');
    const base = { p_ensayo_id: e, p_variedad: 'AUD-G9-V', p_numero_repeticion: 1 };
    expect((await guardarFichaEvecl(autor.client, { ...base, p_numero_repeticion: 0 })).error?.code).toBe('23514');
    expect((await guardarFichaEvecl(autor.client, { ...base, p_numero_repeticion: 21 })).error?.code).toBe('23514');
    expect((await guardarFichaEvecl(autor.client, { ...base, p_fecha_evaluacion: '2099-01-01' })).error?.code).toBe('23514');
    expect((await guardarFichaEvecl(autor.client, { ...base, p_variedad: '   ' })).error?.code).toBe('23514');
    await fichaDe(autor, e, 'AUD-G9-V', 1);
    expect((await guardarFichaEvecl(autor.client, { ...base, p_variedad: '  aud-g9-v ' })).error?.code).toBe('23505');
  });

  it('el índice único no incluye el tipo: una ficha testigo no puede reutilizar la repetición de una de evaluación de la misma variedad', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-TESTIGO');
    await fichaDe(autor, e, 'AUD-G9-V', 1);
    const r = await guardarFichaEvecl(autor.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-V', p_numero_repeticion: 1, p_tipo: 'testigo' });
    expect(r.error?.code).toBe('23505');
  });

  it('cualquier autenticado ve la ficha completa de otro autor, incluidos productor y empresa del ensayo (por diseño: "cualquiera")', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-VISIBLE', { p_nombre_productor: 'Productor Ejemplo', p_empresa: 'Empresa Ejemplo SpA' });
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1, { p_origen_cruza: 'Cruza X × Y' });
    const { data } = await otro.client.rpc('evecl_obtener_ficha', { p_ficha_id: f });
    expect(data.ensayo.nombre_productor).toBe('Productor Ejemplo');
    expect(data.ensayo.empresa).toBe('Empresa Ejemplo SpA');
    expect(data.origen_cruza).toBe('Cruza X × Y');
  });
});

describe('T07 — evecl_respuesta: permisos directos', () => {
  it('el autor de la ficha y el admin editan y borran respuestas; otro operario no (0 filas)', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-RESP');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1, { p_respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }] });
    const o1 = await otro.client.from('evecl_respuesta').update({ valor_numerico: 1 }).eq('ficha_id', f).select('id');
    expect(o1.data).toEqual([]);
    const o2 = await otro.client.from('evecl_respuesta').delete().eq('ficha_id', f).select('id');
    expect(o2.data).toEqual([]);
    const a = await autor.client.from('evecl_respuesta').update({ valor_numerico: 11 }).eq('ficha_id', f).select('valor_numerico');
    expect(Number(a.data?.[0]?.valor_numerico)).toBe(11);
    const ad = await admin.client.from('evecl_respuesta').update({ valor_numerico: 12 }).eq('ficha_id', f).select('valor_numerico');
    expect(Number(ad.data?.[0]?.valor_numerico)).toBe(12);
    const del = await admin.client.from('evecl_respuesta').delete().eq('ficha_id', f).select('id');
    expect(del.data).toHaveLength(1);
  });

  it('un UPSERT de otro operario sobre una respuesta existente es rechazado', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-RESP-UPSERT');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1, { p_respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }] });
    const r = await otro.client.from('evecl_respuesta').upsert({ ficha_id: f, descriptor_id: firmeza().id, valor_numerico: 5 }, { onConflict: 'ficha_id,descriptor_id' });
    expect(r.error?.code).toBe('42501');
  });

  it.fails('A1-G9-15 — un operario que NO es autor de la ficha no debería poder insertar respuestas en ella (hoy la policy INSERT solo exige que la ficha exista y sea visible)', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-RESP-INSERT');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1);
    const r = await otro.client.from('evecl_respuesta').insert({ ficha_id: f, descriptor_id: firmeza().id, valor_numerico: 999 });
    expect(r.error).not.toBeNull();
  });

  it('la RPC sí respeta la propiedad: otro operario no puede agregar respuestas por evecl_guardar_ficha (contraste con el INSERT directo)', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-RESP-RPC');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1);
    const r = await guardarFichaEvecl(otro.client, { p_id: f, p_respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 999 }] });
    expect(r.error?.code).toBe('42501');
  });

  it('foto_path es texto libre: una respuesta puede apuntar a la foto de otra ficha (no se valida el prefijo evecl/{ensayo}/{ficha}/)', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-FOTOPATH');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1);
    const ajena = 'evecl/1/1/1.jpg';
    const r = await guardarFichaEvecl(autor.client, { p_id: f, p_respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10, foto_path: ajena }] });
    expect(r.error).toBeNull();
    const { data } = await ctx.service.from('evecl_respuesta').select('foto_path').eq('ficha_id', f).single();
    expect(data?.foto_path).toBe(ajena);
  });
});

describe('T07 — catálogo de descriptores: solo el admin escribe, sin pantalla', () => {
  it('SELECT para autenticados; INSERT/UPDATE solo admin; DELETE nadie; anon nada', async () => {
    expect((await ctx.anon.from('evecl_descriptor').select('id').limit(1)).error?.code).toBe('42501');
    expect((await otro.client.from('evecl_descriptor').select('id').limit(1)).error).toBeNull();
    const ins = await otro.client.from('evecl_descriptor').insert({ nombre: `AUD-G9 operario ${ctx.sufijo}`, tipo: 'valor', eje: 'calidad', orden: 9999 });
    expect(ins.error?.code).toBe('42501');
    const upd = await otro.client.from('evecl_descriptor').update({ activo: false }).eq('id', firmeza().id).select('id');
    expect(upd.data).toEqual([]);
    const estIns = await otro.client.from('evecl_descriptor_estado').insert({ descriptor_id: upov(1).id, nota: 4, label: 'x', orden: 9 });
    expect(estIns.error?.code).toBe('42501');
    const del = await admin.client.from('evecl_descriptor').delete().eq('id', firmeza().id);
    expect(del.error?.code).toBe('42501');
  });

  it('el admin agrega un descriptor y sus estados directamente por la API (única vía hoy) y aparece solo en el catálogo del formulario', async () => {
    const id = await ctx.descriptorPropio('estado', 'catalogo-admin', [1, 2]);
    const { data } = await autor.client.rpc('evecl_obtener_catalogo');
    const d = (data as { id: number; estados: { nota: number }[] }[]).find((x) => x.id === id)!;
    expect(d.estados.map((s) => s.nota)).toEqual([1, 2]);
    // y el trigger de coherencia acepta solo esas notas
    const e = await ctx.ensayo(autor.client, 'PERM-CAT');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1);
    expect((await guardarFichaEvecl(autor.client, { p_id: f, p_respuestas: [{ descriptor_id: id, nota: 2 }] })).error).toBeNull();
    expect((await guardarFichaEvecl(autor.client, { p_id: f, p_respuestas: [{ descriptor_id: id, nota: 3 }] })).error).not.toBeNull();
  });

  it('A1-G9-04 — un descriptor rankeable desactivado desaparece del formulario pero sigue puntuando en evecl_comparar (la RPC no filtra por activo en los criterios)', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-INACTIVO-CMP');
    const x = await ctx.descriptorPropio('valor', 'rankeable-inactivo', [], true);
    await fichaDe(autor, e, 'AUD-G9-A', 1, { p_respuestas: [{ descriptor_id: x, valor_numerico: 10 }] });
    await fichaDe(autor, e, 'AUD-G9-B', 1, { p_respuestas: [{ descriptor_id: x, valor_numerico: 20 }] });
    await ctx.service.from('evecl_descriptor').update({ activo: false }).eq('id', x);
    const catalogo = await ctx.catalogo(autor.client);
    expect(catalogo.some((d) => d.id === x)).toBe(false);
    const { data } = await autor.client.rpc('evecl_comparar', { p_modo: 'entre_grupos', p_ensayo_id: e });
    const puntajes = (data.ranking_calidad as { variedad: string; puntaje: number }[]).map((i) => [i.variedad, Number(i.puntaje)]);
    expect(puntajes).toEqual([['AUD-G9-B', 100], ['AUD-G9-A', 0]]);
  });

  it('A1-G9-04 — la completitud de una ficha no cuenta respuestas de descriptores desactivados', async () => {
    const e = await ctx.ensayo(autor.client, 'PERM-COMPLETITUD');
    const x = await ctx.descriptorPropio('valor', 'completitud');
    await fichaDe(autor, e, 'AUD-G9-A', 1, { p_respuestas: [{ descriptor_id: x, valor_numerico: 5 }] });
    await ctx.service.from('evecl_descriptor').update({ activo: false }).eq('id', x);
    const { data } = await autor.client.rpc('evecl_obtener_fichas', { p_ensayo_id: e });
    expect(Number(data[0].respondidos)).toBe(0);
  });
});

describe('T07 — atomicidad, idempotencia y concurrencia de evecl_guardar_ficha', () => {
  it('es atómica en la base: si una respuesta es inválida no se crea la ficha ni las otras respuestas', async () => {
    const e = await ctx.ensayo(autor.client, 'ATOM-CREA');
    const llave = crypto.randomUUID();
    const r = await guardarFichaEvecl(autor.client, {
      p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1, p_idempotency_key: llave,
      p_respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }, { descriptor_id: upov(1).id, nota: 4 }],
    });
    expect(r.error).not.toBeNull();
    const { count } = await ctx.service.from('evecl_ficha').select('id', { count: 'exact', head: true }).eq('ensayo_id', e);
    expect(count).toBe(0);
  });

  it('en una edición, una respuesta inválida revierte también los cambios de la ficha', async () => {
    const e = await ctx.ensayo(autor.client, 'ATOM-EDITA');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1, { p_notas: 'original', p_respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }] });
    const r = await guardarFichaEvecl(autor.client, {
      p_id: f, p_notas: 'cambiada', p_respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 20 }, { descriptor_id: dulzor().id, valor_numerico: -1 }],
    });
    expect(r.error).not.toBeNull();
    const { data } = await ctx.service.from('evecl_ficha').select('notas').eq('id', f).single();
    expect(data?.notas).toBe('original');
    const resp = await ctx.service.from('evecl_respuesta').select('valor_numerico').eq('ficha_id', f).single();
    expect(Number(resp.data?.valor_numerico)).toBe(10);
  });

  it('la misma idempotency_key no duplica: dos envíos simultáneos devuelven el mismo id y queda una sola ficha', async () => {
    const e = await ctx.ensayo(autor.client, 'IDEMP-PARALELO');
    const llave = crypto.randomUUID();
    const args = { p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1, p_idempotency_key: llave, p_respuestas: [{ descriptor_id: firmeza().id, valor_numerico: 10 }] };
    const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => guardarFichaEvecl(autor.client, args)));
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    expect(r3.error).toBeNull();
    expect(new Set([r1.data, r2.data, r3.data]).size).toBe(1);
    const { count } = await ctx.service.from('evecl_ficha').select('id', { count: 'exact', head: true }).eq('ensayo_id', e);
    expect(count).toBe(1);
  });

  it('dos autores que crean la misma variedad y repetición a la vez: uno gana y el otro recibe duplicado (23505), sin filas dobles', async () => {
    const e = await ctx.ensayo(autor.client, 'IDEMP-CARRERA');
    const [a, b] = await Promise.all([
      guardarFichaEvecl(autor.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1, p_idempotency_key: crypto.randomUUID() }),
      guardarFichaEvecl(otro.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1, p_idempotency_key: crypto.randomUUID() }),
    ]);
    expect([a.error?.code ?? null, b.error?.code ?? null].sort()).toEqual(['23505', null].sort());
    const { count } = await ctx.service.from('evecl_ficha').select('id', { count: 'exact', head: true }).eq('ensayo_id', e);
    expect(count).toBe(1);
  });

  it('edición simultánea del autor y de un admin sobre la misma ficha: gana el último en escribir, sin aviso (por diseño: Maestro 9.1 excluye la resolución de conflictos)', async () => {
    const e = await ctx.ensayo(autor.client, 'CONC-EDICION');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1, { p_notas: 'base', p_codigo_planta: 'P1' });
    // Ambos "abrieron" la ficha con codigo_planta = P1. El autor corrige las notas; el admin, después, corrige el código de planta con su copia vieja.
    await guardarFichaEvecl(autor.client, { p_id: f, p_notas: 'nota del autor', p_codigo_planta: 'P1' });
    await guardarFichaEvecl(admin.client, { p_id: f, p_notas: 'base', p_codigo_planta: 'P2' });
    const { data } = await ctx.service.from('evecl_ficha').select('notas, codigo_planta').eq('id', f).single();
    expect(data).toEqual({ notas: 'base', codigo_planta: 'P2' }); // la nota del autor se perdió
  });

  // A1-G9-16 quedó corregido en la envoltura evecl_guardar_ficha_con_bajas (A1-011), que revalida la autoría incluso ante un retorno idempotente.
  // La firma vieja (ya cerrada a authenticated por el paso 39) todavía devolvería el id ajeno; la app y las pruebas usan la envoltura.
  it('A1-G9-16 — la idempotency_key de un usuario no devuelve la ficha de otro usuario: con la envoltura, otro operario con la misma llave recibe 42501', async () => {
    const e = await ctx.ensayo(autor.client, 'IDEMP-AJENA');
    const llave = crypto.randomUUID();
    const idAutor = await fichaDe(autor, e, 'AUD-G9-A', 1, { p_idempotency_key: llave });
    const r = await guardarFichaEvecl(otro.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-B', p_numero_repeticion: 1, p_idempotency_key: llave });
    expect(r.data).not.toBe(idAutor);
    expect(r.error?.code).toBe('42501');
  });

  it('la RPC permite mover una ficha a otro ensayo (p_ensayo_id en edición) y no deja rastro de auditoría', async () => {
    const e1 = await ctx.ensayo(autor.client, 'MOVER-1');
    const e2 = await ctx.ensayo(autor.client, 'MOVER-2');
    const f = await fichaDe(autor, e1, 'AUD-G9-A', 1);
    const r = await guardarFichaEvecl(autor.client, { p_id: f, p_ensayo_id: e2 });
    expect(r.error).toBeNull();
    const { data } = await ctx.service.from('evecl_ficha').select('ensayo_id').eq('id', f).single();
    expect(data?.ensayo_id).toBe(e2);
    const audit = psqlRoot(`select count(*) from audit_log where usuario_id in ('${autor.userId}', '${admin.userId}', '${otro.userId}') or accion ilike '%evecl%'`).trim();
    expect(audit).toBe('0');
  });
});

describe('T07 — aislamiento del núcleo genético (invariantes 1 y 3 del Maestro 9.1)', () => {
  it('ninguna tabla evecl_* tiene FK hacia el núcleo: solo hacia auth.users y entre sí', () => {
    const fks = psqlRoot(`
      select conrelid::regclass || ' -> ' || confrelid::regclass
      from pg_constraint
      where contype = 'f' and conrelid::regclass::text like 'evecl%'
      order by 1`).trim().split('\n');
    const permitidos = /^(evecl_\w+ -> (evecl_\w+|auth\.users))$/;
    for (const fk of fks) expect(fk, fk).toMatch(permitidos);
  });

  it('ninguna función evecl_* ni vista referencia plantas, individuos, variedades, evaluaciones o scoring', () => {
    const funciones = psqlRoot(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.proname like 'evecl%'
        and regexp_replace(pg_get_functiondef(p.oid), 'total_variedades', '', 'g') ~* '(\\mplantas\\M|\\mindividuos\\M|\\mvariedades\\M|\\mevaluaciones\\M|scoring_|ranking_snapshot|\\mpredio\\M)'`).trim();
    expect(funciones).toBe('');
    const inversas = psqlRoot(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.proname not like 'evecl%' and pg_get_functiondef(p.oid) ilike '%evecl_%'`).trim();
    expect(inversas).toBe('');
  });

  it('el nombre de la variedad EVECL es texto libre: no se valida contra el catálogo variedades ni se cruza con él', async () => {
    // Una variedad inexistente en el catálogo del núcleo se acepta; la tabla ni siquiera tiene una columna que apunte al catálogo.
    const e = await ctx.ensayo(autor.client, 'AISLA');
    expect(await fichaDe(autor, e, `AUD-G9-NOEXISTE-${ctx.sufijo}`, 1)).toBeGreaterThan(0);
    const cols = psqlRoot(`select column_name from information_schema.columns where table_name = 'evecl_ficha' and column_name ~ '^(variedad_id|planta_id|individuo_id)$'`).trim();
    expect(cols).toBe('');
  });

  it('el rol operario sin permiso de linaje lee origen_cruza y codigo_genotipo de EVECL: son texto libre sin ninguna protección de columna', async () => {
    const e = await ctx.ensayo(autor.client, 'AISLA-LINAJE');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1, { p_origen_cruza: 'Madre X × Padre Y', p_codigo_genotipo: 'G-001' });
    const { data } = await otro.client.from('evecl_ficha').select('origen_cruza, codigo_genotipo').eq('id', f).single();
    expect(data).toEqual({ origen_cruza: 'Madre X × Padre Y', codigo_genotipo: 'G-001' });
  });
});

describe('T07 — grants por tabla y rol (catálogo real)', () => {
  const ESPERADO: Record<string, string> = {
    evecl_descriptor: 'INSERT,SELECT,UPDATE',
    evecl_descriptor_estado: 'INSERT,SELECT,UPDATE',
    evecl_ensayo: 'INSERT,SELECT,UPDATE',
    evecl_ficha: 'INSERT,SELECT,UPDATE',
    evecl_respuesta: 'DELETE,INSERT,SELECT,UPDATE',
  };

  it('authenticated tiene exactamente los privilegios esperados (sin TRUNCATE, REFERENCES ni TRIGGER) y anon ninguno', () => {
    const filas = psqlRoot(`
      select table_name || '|' || grantee || '|' || string_agg(privilege_type, ',' order by privilege_type)
      from information_schema.role_table_grants
      where table_name like 'evecl\_%' and grantee in ('anon', 'authenticated')
      group by table_name, grantee order by 1`).trim().split('\n');
    expect(filas.filter((f) => f.includes('|anon|'))).toEqual([]);
    for (const [tabla, privilegios] of Object.entries(ESPERADO)) {
      expect(filas).toContain(`${tabla}|authenticated|${privilegios}`);
    }
  });

  it('todas las tablas evecl_* tienen RLS activado (relrowsecurity)', () => {
    const filas = psqlRoot(`select relname || '|' || relrowsecurity from pg_class where relname like 'evecl\_%' and relkind = 'r' order by 1`).trim().split('\n');
    expect(filas).toHaveLength(5);
    for (const f of filas) expect(f).toMatch(/\|true$/);
  });

  it('anon no puede leer ni escribir ninguna tabla evecl_* por PostgREST (42501)', async () => {
    for (const tabla of Object.keys(ESPERADO)) {
      expect((await ctx.anon.from(tabla).select('*').limit(1)).error?.code, `select ${tabla}`).toBe('42501');
      expect((await ctx.anon.from(tabla).insert({})).error?.code, `insert ${tabla}`).toBe('42501');
    }
  });
});

describe('T07 — fechas sin validar en el servidor', () => {
  it.fails('A1-G9-19 — fecha_observada futura debería ser rechazada como lo es fecha_evaluacion (hoy la RPC la acepta; solo la UI limita el máximo)', async () => {
    const e = await ctx.ensayo(autor.client, 'FECHAS');
    const f = await fichaDe(autor, e, 'AUD-G9-A', 1);
    const r = await guardarFichaEvecl(autor.client, { p_id: f, p_respuestas: [{ descriptor_id: upov(1).id, nota: 5, fecha_observada: '2099-01-01' }] });
    expect(r.error).not.toBeNull();
  });

  it('fecha_siembra posterior a la evaluación también se acepta (sin CHECK de orden)', async () => {
    const e = await ctx.ensayo(autor.client, 'FECHAS2');
    const r = await guardarFichaEvecl(autor.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1, p_fecha_siembra: '2026-10-20', p_fecha_evaluacion: '2026-01-01' });
    expect(r.error).toBeNull();
  });
});
