/**
 * Auditoría integral, Corrida 1, grupo G7: R01 predios y R02 sectores y sitios.
 *
 * Verifica permisos reales (RLS y grants), CHECK de coordenadas, duplicados,
 * borrado físico, auto-provisión del sector, desactivación de un predio con
 * individuos emplazados, reasignación de un sector a otro predio y auditoría.
 * Ninguna escritura de este archivo pone coordenadas válidas en un predio: el
 * trigger de clima lanzaría una llamada real a Open-Meteo (eso se prueba en
 * g7-clima.test.ts).
 *
 * Hallazgos: A1-G7-10 (un sector se puede mover entre predios y reescribe el
 * historial territorial), A1-G7-11 (predios con nombre duplicado o en blanco),
 * A1-G7-12 (los cambios de predio no se auditan), A1-G7-14 (el sitio por
 * defecto es frágil).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { borrarUsuariosG7, CONTENEDOR_DB, prepararEntornoG7, psql, type EntornoG7 } from './g7-helpers';

const R = Date.now();

let E: EntornoG7;
let cruceId: string;
let predioId: string; // predio con individuos emplazados
let sectorId: string; // su "Sector principal" auto-provisionado
let predioDestinoId: string;
let sectorDestinoId: string;
const individuos: string[] = [];
const prediosCreados: string[] = [];

async function crearPredio(nombre: string): Promise<{ id: string; sectorId: string }> {
  const { data, error } = await E.admin.from('predio').insert({ nombre }).select('id').single();
  if (error || !data) throw new Error(`setup predio: ${error?.message}`);
  prediosCreados.push(data.id as string);
  const sector = await E.service.from('sector').select('id').eq('predio_id', data.id).single();
  if (sector.error || !sector.data) throw new Error(`setup sector: ${sector.error?.message}`);
  return { id: data.id as string, sectorId: sector.data.id as string };
}

/** La consulta exacta de listarSectoresOperativos (frontend/src/api/emplazamientos.ts) ejecutada como operario. */
async function destinosVisiblesParaOperario(): Promise<string[]> {
  const { data, error } = await E.operario
    .from('sector')
    .select('id, nombre, predio_id, predio:predio_id!inner(nombre, activo, sitio:sitio_id!inner(nombre, activo))')
    .eq('activo', true)
    .eq('predio.activo', true)
    .eq('predio.sitio.activo', true)
    .order('nombre')
    .limit(5000);
  expect(error).toBeNull();
  return (data ?? []).map((f) => f.id as string);
}

beforeAll(async () => {
  E = await prepararEntornoG7('predios');
  const { data: cruce, error } = await E.service
    .from('plantas')
    .insert({ codigo_sistema: `AUD-G7-PRED-${R}`, especie_id: E.especieId, estado: 'traslado_destino', es_prueba: true })
    .select('id')
    .single();
  if (error || !cruce) throw new Error(`setup cruce: ${error?.message}`);
  cruceId = cruce.id as string;
  // N35 (v3 paso 8): los mapas excluyen los cruces de prueba. El escenario mide el mapa con el cruce como real y lo
  // vuelve a marcar de prueba en afterAll, antes de purgarlo (la purga dura solo acepta cruces de prueba).
  await E.service.from('plantas').update({ es_prueba: false }).eq('id', cruceId);

  ({ id: predioId, sectorId } = await crearPredio(`AUD-G7-PRED-${R}`));
  ({ id: predioDestinoId, sectorId: sectorDestinoId } = await crearPredio(`AUD-G7-PRED-destino-${R}`));

  for (let i = 0; i < 2; i += 1) {
    const { data, error: e } = await E.service.from('individuos').insert({ planta_id: cruceId, created_by: E.operarioId, codigo_display: '' }).select('id').single();
    if (e || !data) throw new Error(`setup individuo: ${e?.message}`);
    individuos.push(data.id as string);
    const traslado = await E.admin.rpc('registrar_traslado_individuo', { p_individuo_id: data.id, p_sector_id: sectorId, p_fecha_inicio: '2026-10-01' });
    if (traslado.error) throw new Error(`setup traslado: ${traslado.error.message}`);
  }
}, 120_000);

afterAll(async () => {
  const lista = prediosCreados.map((i) => `'${i}'`).join(',');
  psql(`
begin;
set local session_replication_role = replica;
delete from emplazamiento_individuo where individuo_id in (select id from individuos where planta_id = '${cruceId}');
delete from individuos where planta_id = '${cruceId}';
delete from sector where predio_id in (${lista});
delete from predio where id in (${lista});
commit;
`);
  await E.service.from('plantas').update({ es_prueba: true }).eq('id', cruceId);
  const { error } = await E.admin.rpc('borrar_cruzamiento', { p_planta_id: cruceId, p_tipo: 'hard' });
  if (error) console.warn(`afterAll: no se pudo borrar el cruce ${cruceId}: ${error.message}`);
  await borrarUsuariosG7(E);
}, 60_000);

describe('R01 permisos sobre predio', () => {
  it('el operario no puede crear (42501) ni modificar o borrar (0 filas por RLS) un predio; el anon no lo lee (42501)', async () => {
    const alta = await E.operario.from('predio').insert({ nombre: `AUD-G7-op-${R}` });
    expect(alta.error?.code).toBe('42501');
    const cambio = await E.operario.from('predio').update({ activo: false }).eq('id', predioId).select();
    expect(cambio.error).toBeNull();
    expect(cambio.data).toEqual([]);
    const baja = await E.operario.from('predio').delete().eq('id', predioId).select();
    expect(baja.error).toBeNull();
    expect(baja.data).toEqual([]);
    const { data } = await E.service.from('predio').select('activo').eq('id', predioId).single();
    expect(data?.activo).toBe(true);
    const lectura = await E.anon.from('predio').select('id').limit(1);
    expect(lectura.error?.code).toBe('42501');
  });

  it('las funciones de trigger de predio (DEFINER, con EXECUTE a anon/authenticated) no se pueden invocar por la API: PostgREST no las expone (PGRST202)', async () => {
    for (const nombre of ['trigger_sincronizar_clima_predio', 'auto_provisionar_sector_predio', 'completar_sitio_predio_legacy']) {
      for (const cliente of [E.anon, E.operario, E.admin]) {
        const { error } = await cliente.rpc(nombre as never, {} as never);
        expect(error?.code, nombre).toBe('PGRST202');
      }
    }
  });

  it('el operario sí lee los predios con sus coordenadas (decisión documentada: la coordenada del predio no es sensible)', async () => {
    const { data, error } = await E.operario.from('predio').select('id, nombre, latitud, longitud').eq('id', predioId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe('R01 alta de predio: sitio por defecto y sector auto-provisionado', () => {
  it('un predio nuevo queda en el sitio legado, con un "Sector principal" activo sin autor, y sin solicitud de clima (sin coordenadas)', async () => {
    const { data: predio } = await E.service.from('predio').select('sitio_id, activo, latitud').eq('id', predioId).single();
    const { data: sitio } = await E.service.from('sitio').select('nombre').eq('id', predio!.sitio_id).single();
    expect(sitio?.nombre).toBe('Sitio legado sin clasificar');
    const { data: sectores } = await E.service.from('sector').select('nombre, activo, created_by').eq('predio_id', predioId);
    expect(sectores).toEqual([{ nombre: 'Sector principal', activo: true, created_by: null }]);
    expect(psql(`select count(*) from predio_clima_sync_pendiente where predio_id = '${predioId}'`)).toBe('0');
  });

  it('el sector auto-provisionado es un destino utilizable: aparece en el desplegable del operario y el admin registra traslados en él', async () => {
    expect(await destinosVisiblesParaOperario()).toContain(sectorId);
    const { data: activos } = await E.service.from('emplazamiento_individuo').select('id').in('individuo_id', individuos).is('fecha_fin', null);
    expect(activos).toHaveLength(2);
  });
});

describe('R01 restricciones de datos del predio', () => {
  it('coordenadas fuera de rango o incompletas, y región inexistente, se rechazan en la base (23514 / 22P02)', async () => {
    const casos: Array<[Record<string, unknown>, string, string]> = [
      [{ latitud: 91, longitud: 0 }, '23514', 'predio_latitud_rango'],
      [{ latitud: -91, longitud: 0 }, '23514', 'predio_latitud_rango'],
      [{ latitud: 0, longitud: 181 }, '23514', 'predio_longitud_rango'],
      [{ latitud: 0, longitud: -181 }, '23514', 'predio_longitud_rango'],
      [{ latitud: -35.5 }, '23514', 'predio_coordenada_completa'],
      [{ longitud: -71.5 }, '23514', 'predio_coordenada_completa'],
    ];
    for (const [cambios, codigo, restriccion] of casos) {
      const { error } = await E.admin.from('predio').update(cambios).eq('id', predioId);
      expect(error?.code, JSON.stringify(cambios)).toBe(codigo);
      expect(error?.message, JSON.stringify(cambios)).toContain(restriccion);
    }
    const region = await E.admin.from('predio').update({ region: 'Atlántida' as never }).eq('id', predioId);
    expect(region.error?.code).toBe('22P02');
    const { data } = await E.service.from('predio').select('latitud, longitud, region').eq('id', predioId).single();
    expect(data).toEqual({ latitud: null, longitud: null, region: null });
  });

  // A1-G7-11: ni la base ni la UI impiden dos predios con el mismo nombre, ni un nombre en blanco.
  // PredioForm solo usa `required` (una cadena de espacios lo cumple) y luego envía nombre.trim() === ''.
  it.fails('A1-G7-11: no debería existir un segundo predio con el mismo nombre', async () => {
    const { data, error } = await E.admin.from('predio').insert({ nombre: `AUD-G7-PRED-${R}` }).select('id').single();
    if (data) prediosCreados.push(data.id as string);
    expect(error?.code).toBe('23505');
  });

  it.fails('A1-G7-11: no debería aceptarse un predio con nombre vacío', async () => {
    const { data, error } = await E.admin.from('predio').insert({ nombre: '' }).select('id').single();
    if (data) prediosCreados.push(data.id as string);
    expect(error?.code).toBe('23514');
  });
});

describe('R01 borrado físico de predio por el admin (grant DELETE sin pantalla)', () => {
  it('no se puede borrar ningún predio creado por la app: su sector auto-provisionado lo bloquea (FK restrictiva, 23503), y el admin no puede borrar sectores', async () => {
    const baja = await E.admin.from('predio').delete().eq('id', predioDestinoId).select();
    expect(baja.error?.code).toBe('23503');
    expect(baja.error?.message).toContain('sector_predio_id_fkey');
    const bajaSector = await E.admin.from('sector').delete().eq('id', sectorDestinoId).select();
    expect(bajaSector.error?.code).toBe('42501'); // sector no tiene grant DELETE para authenticated
    const { data } = await E.service.from('predio').select('id').eq('id', predioDestinoId);
    expect(data).toHaveLength(1);
  });
});

describe('R01 auditoría de cambios de predio (A1-G7-12)', () => {
  it('crear, renombrar y desactivar/activar predios no deja ninguna fila en audit_log para el admin autor', async () => {
    const { id } = await crearPredio(`AUD-G7-PRED-audit-${R}`);
    await E.admin.from('predio').update({ nombre: `AUD-G7-PRED-audit2-${R}` }).eq('id', id);
    await E.admin.from('predio').update({ activo: false }).eq('id', id);
    await E.admin.from('predio').update({ activo: true }).eq('id', id);
    const { count } = await E.service.from('audit_log').select('id', { count: 'exact', head: true }).eq('usuario_id', E.adminId).like('accion', '%predio%');
    expect(count).toBe(0);
  });

  it.fails('A1-G7-12: los cambios de nombre, estado y coordenadas de un predio deberían quedar en audit_log con autor, valor anterior y nuevo', async () => {
    const { id } = await crearPredio(`AUD-G7-PRED-audit3-${R}`);
    await E.admin.from('predio').update({ activo: false }).eq('id', id);
    const { data } = await E.service.from('audit_log').select('accion, detalle').eq('usuario_id', E.adminId);
    expect((data ?? []).filter((fila) => JSON.stringify(fila.detalle).includes(id)).length).toBeGreaterThan(0);
  });
});

describe('R01 desactivar un predio con individuos emplazados', () => {
  it('desactivar no tiene guarda: los individuos siguen emplazados y contados en los mapas, el sector sigue activo, y el predio deja de ser destino', async () => {
    const desactivar = await E.admin.from('predio').update({ activo: false }).eq('id', predioId);
    expect(desactivar.error).toBeNull();

    // Sigue en los mapas (no filtran por activo).
    const mapa = await E.operario.rpc('obtener_mapa_cruce', { p_planta_id: cruceId });
    expect((mapa.data as unknown as { total_individuos_emplazados: number }).total_individuos_emplazados).toBe(2);
    const resumen = await E.operario.rpc('obtener_resumen_mapa_territorial', { p_predio_id: predioId });
    expect((resumen.data as unknown as { total: number }).total).toBe(1);

    // El sector no se desactiva en cascada (deuda conocida: sectores activos en predios inactivos).
    const { data: sector } = await E.service.from('sector').select('activo').eq('id', sectorId).single();
    expect(sector?.activo).toBe(true);

    // Deja de aparecer como destino y la RPC lo rechaza con el mensaje de negocio.
    expect(await destinosVisiblesParaOperario()).not.toContain(sectorId);
    const traslado = await E.admin.rpc('registrar_traslado_individuo', { p_individuo_id: individuos[0], p_sector_id: sectorId, p_fecha_inicio: '2026-10-05' });
    expect(traslado.error?.code).toBe('23514');
    expect(traslado.error?.message).toMatch(/predio está inactivo/);

    // Reactivar lo devuelve a la lista.
    await E.admin.from('predio').update({ activo: true }).eq('id', predioId);
    expect(await destinosVisiblesParaOperario()).toContain(sectorId);
  });

  it('si el admin desactiva el "Sector principal" (por API: no hay pantalla), el predio sigue activo pero desaparece como destino, sin aviso y sin forma de repararlo desde la app', async () => {
    const { id, sectorId: sectorPrincipal } = await crearPredio(`AUD-G7-PRED-sinsector-${R}`);
    expect(await destinosVisiblesParaOperario()).toContain(sectorPrincipal);
    const { error } = await E.admin.from('sector').update({ activo: false }).eq('id', sectorPrincipal);
    expect(error).toBeNull();
    const { data: predio } = await E.service.from('predio').select('activo').eq('id', id).single();
    expect(predio?.activo).toBe(true);
    expect(await destinosVisiblesParaOperario()).not.toContain(sectorPrincipal);
    // Reactivar el predio (el toggle de la UI) no reactiva sus sectores.
    await E.admin.from('predio').update({ activo: false }).eq('id', id);
    await E.admin.from('predio').update({ activo: true }).eq('id', id);
    expect(await destinosVisiblesParaOperario()).not.toContain(sectorPrincipal);
  });
});

describe('R02 sectores y sitios (sin pantalla)', () => {
  it('el operario no puede insertar ni modificar sectores o sitios; el anon no los lee', async () => {
    expect((await E.operario.from('sector').insert({ predio_id: predioId, nombre: `AUD-G7-op-${R}` })).error?.code).toBe('42501');
    expect((await E.operario.from('sitio').insert({ nombre: `AUD-G7-sitio-op-${R}` })).error?.code).toBe('42501');
    const cambio = await E.operario.from('sector').update({ nombre: 'hackeado' }).eq('id', sectorId).select();
    expect(cambio.data).toEqual([]);
    const cambioSitio = await E.operario.from('sitio').update({ activo: false }).eq('nombre', 'Sitio legado sin clasificar').select();
    expect(cambioSitio.data).toEqual([]);
    expect((await E.anon.from('sector').select('id').limit(1)).error?.code).toBe('42501');
    expect((await E.anon.from('sitio').select('id').limit(1)).error?.code).toBe('42501');
  });

  it('sector: nombre en blanco (23514) y repetido dentro del mismo predio (23505) se rechazan; el mismo nombre en otro predio se acepta', async () => {
    expect((await E.admin.from('sector').insert({ predio_id: predioId, nombre: '   ' })).error?.code).toBe('23514');
    expect((await E.admin.from('sector').insert({ predio_id: predioId, nombre: 'Sector principal' })).error?.code).toBe('23505');
    const otro = await E.admin.from('sector').insert({ predio_id: predioDestinoId, nombre: `AUD-G7-sector-extra-${R}` }).select('id').single();
    expect(otro.error).toBeNull();
    const repetidoEnOtroPredio = await E.admin.from('sector').insert({ predio_id: predioId, nombre: `AUD-G7-sector-extra-${R}` });
    expect(repetidoEnOtroPredio.error).toBeNull();
  });

  // A1-G7-10: sector.predio_id se puede cambiar con un UPDATE directo. Los
  // emplazamientos (append-only) apuntan al sector, así que mover el sector
  // cambia en bloque el predio de TODOS los emplazamientos históricos y vigentes.
  it.fails('A1-G7-10: un sector con emplazamientos no debería poder cambiarse de predio', async () => {
    const { error } = await E.admin.from('sector').update({ predio_id: predioDestinoId, nombre: `AUD-G7-movido-${R}` }).eq('id', sectorId);
    // Si el cambio se aceptó, se revierte para no contaminar las demás pruebas (psql: sin trigger de por medio).
    if (!error) psql(`update sector set predio_id = '${predioId}', nombre = 'Sector principal' where id = '${sectorId}'`);
    expect(error).not.toBeNull();
  });

  it('consecuencia verificada: tras mover el sector, el mapa de los individuos pasa a otro predio sin tocar un solo emplazamiento', async () => {
    await E.admin.from('sector').update({ predio_id: predioDestinoId, nombre: `AUD-G7-movido2-${R}` }).eq('id', sectorId);
    try {
      const mapa = await E.operario.rpc('obtener_mapa_cruce', { p_planta_id: cruceId });
      const clusters = (mapa.data as unknown as { clusters: Array<{ predio_id: string }> }).clusters;
      expect(clusters.map((c) => c.predio_id)).toEqual([predioDestinoId]);
    } finally {
      psql(`update sector set predio_id = '${predioId}', nombre = 'Sector principal' where id = '${sectorId}'`);
    }
  });

  it.fails('A1-G7-10: sector.updated_at debería actualizarse al modificar el sector (no hay trigger)', async () => {
    const antes = await E.service.from('sector').select('updated_at').eq('id', sectorDestinoId).single();
    await new Promise((r) => setTimeout(r, 1100));
    await E.admin.from('sector').update({ nombre: `AUD-G7-renombrado-${R}` }).eq('id', sectorDestinoId);
    const despues = await E.service.from('sector').select('updated_at').eq('id', sectorDestinoId).single();
    expect(new Date(despues.data!.updated_at as string).getTime()).toBeGreaterThan(new Date(antes.data!.updated_at as string).getTime());
  });
});

describe('R02 fragilidad del sitio por defecto (A1-G7-14)', () => {
  /** Ejecuta SQL en una transacción que se descarta; devuelve la salida o el mensaje de error. Nadie más ve los cambios (MVCC). */
  function enTransaccionDescartada(sql: string): { ok: boolean; salida: string } {
    try {
      const salida = execFileSync('docker', ['exec', '-i', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
        encoding: 'utf8', input: `begin;\n${sql}\nrollback;\n`, stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { ok: true, salida };
    } catch (e) {
      const err = e as { stderr?: Buffer | string };
      return { ok: false, salida: String(err.stderr ?? e) };
    }
  }

  it('si el sitio "Sitio legado sin clasificar" se renombra, crear un predio falla con un error de columna nula', () => {
    const r = enTransaccionDescartada(`update sitio set nombre = 'Sitio legado sin clasificar (renombrado)' where nombre = 'Sitio legado sin clasificar';
insert into predio (nombre) values ('AUD-G7-SITIO-1-${R}');`);
    expect(r.ok).toBe(false);
    expect(r.salida).toMatch(/null value in column "sitio_id"/);
  });

  it('si ese sitio se desactiva, los predios nuevos nacen con un sitio inactivo y su sector nunca será destino de traslados', () => {
    const r = enTransaccionDescartada(`update sitio set activo = false where nombre = 'Sitio legado sin clasificar';
insert into predio (nombre) values ('AUD-G7-SITIO-2-${R}');
select (select count(*) from sector s join predio p on p.id = s.predio_id join sitio si on si.id = p.sitio_id where p.nombre = 'AUD-G7-SITIO-2-${R}' and s.activo and p.activo and si.activo) as destinos_validos, (select count(*) from sector s join predio p on p.id = s.predio_id where p.nombre = 'AUD-G7-SITIO-2-${R}') as sectores;`);
    expect(r.ok).toBe(true);
    expect(r.salida.split('\n').filter((l) => /^\d+\|\d+$/.test(l))).toEqual(['0|1']);
  });
});

describe('R01 el traslado a un destino inexistente o ajeno no depende del cliente (control cruzado con el desplegable)', () => {
  it('un sector inexistente se rechaza en la RPC aunque el cliente lo enviara', async () => {
    const { error } = await E.admin.rpc('registrar_traslado_individuo', { p_individuo_id: individuos[0], p_sector_id: randomUUID(), p_fecha_inicio: '2026-10-06' });
    expect(error?.code).toBe('P0002');
  });
});
