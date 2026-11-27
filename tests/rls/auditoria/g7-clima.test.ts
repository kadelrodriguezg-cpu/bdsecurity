/**
 * Auditoría integral, Corrida 1, grupo G7: R04 clima por predio.
 *
 * Cadena: trigger trg_sincronizar_clima_predio → sincronizar_clima_predio
 * [DEFINER, EXECUTE a authenticated] → pg_net → Open-Meteo →
 * predio_clima_sync_pendiente → recolectar_clima_pendiente (pg_cron, cada 5 min) →
 * procesar_respuesta_clima_predio → predio_clima_mensual →
 * obtener_clima_predio [DEFINER].
 *
 * LLAMADAS REALES: este archivo hace pocas llamadas reales a Open-Meteo
 * (archive-api.open-meteo.com) a través de pg_net del contenedor local: una por
 * `sincronizar_clima_predio` con coordenadas y una por el trigger de primera
 * geolocalización (unas 5 por corrida, rangos pequeños salvo un pedido
 * absurdo de 1200 meses que Open-Meteo rechaza). Los predios que solo
 * necesitan existir se crean por psql con session_replication_role=replica
 * para que el trigger no dispare nada. No se llama a refrescar_clima_predios
 * (recorrería todos los predios de la base).
 *
 * Hallazgos: A1-G7-01 (cualquier autenticado puede disparar llamadas
 * salientes sin límite), A1-G7-02 (fallo sin reintento ni estado visible),
 * A1-G7-03 (mover un predio no recalcula su clima), A1-G7-04 (mes parcial).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { borrarUsuariosG7, esperarLejosDelCron, prepararEntornoG7, psql, type EntornoG7 } from './g7-helpers';

const R = Date.now();
const COORD_A = { latitud: -45.8, longitud: -72.3 };
const COORD_B = { latitud: -33.4, longitud: -70.6 };
const SENTINELA = 99.9;

let E: EntornoG7;
let predioX: string; // con coordenadas y datos sembrados
let predioZ: string; // con coordenadas, sin datos (para cuerpos sintéticos)
let predioN: string; // sin coordenadas (primera geolocalización)
let predioSin: string; // sin coordenadas, nunca se geolocaliza
const idsSolicitud: number[] = [];
const idsRespuestaFalsa: number[] = [];

function filas(sql: string): string[][] {
  return psql(sql).split('\n').filter((l) => l.length > 0).map((l) => l.split('|'));
}

function pendientes(predioId: string): string[][] {
  return filas(`select request_id, fecha_desde, fecha_hasta, intentos from predio_clima_sync_pendiente where predio_id = '${predioId}' order by request_id`);
}

function mesesDe(predioId: string): Array<{ anio: number; mes: number; tmax: number | null; sol: number | null; sincronizado: string }> {
  return filas(`select anio, mes, temp_max_promedio, horas_sol_acumuladas, sincronizado_at from predio_clima_mensual where predio_id = '${predioId}' order by anio, mes`)
    .map(([anio, mes, tmax, sol, sincronizado]) => ({ anio: Number(anio), mes: Number(mes), tmax: tmax === '' ? null : Number(tmax), sol: sol === '' ? null : Number(sol), sincronizado }));
}

async function esperarRespuestas(ids: number[], maxSegundos = 40): Promise<Map<number, { status: string; timedOut: string; error: string }>> {
  const limite = Date.now() + maxSegundos * 1000;
  for (;;) {
    const r = filas(`select id, coalesce(status_code::text, ''), coalesce(timed_out::text, ''), coalesce(error_msg, '') from net._http_response where id in (${ids.join(',')})`);
    if (r.length >= ids.length || Date.now() > limite) {
      return new Map(r.map(([id, status, timedOut, error]) => [Number(id), { status, timedOut, error }]));
    }
    await new Promise((resolver) => setTimeout(resolver, 1000));
  }
}

/** Mes (anio, mes) desplazado respecto del mes actual de la base. */
function mesRelativo(desplazamiento: number): { anio: number; mes: number } {
  const [anio, mes] = psql(`select extract(year from date_trunc('month', current_date) - interval '${-desplazamiento} months')::int, extract(month from date_trunc('month', current_date) - interval '${-desplazamiento} months')::int`).split('|').map(Number);
  return { anio, mes };
}

beforeAll(async () => {
  E = await prepararEntornoG7('clima');

  const salida = psql(`
begin;
set local session_replication_role = replica;
with x as (insert into predio (nombre, latitud, longitud) values ('AUD-G7-CLIMA-X-${R}', ${COORD_A.latitud}, ${COORD_A.longitud}) returning id),
z as (insert into predio (nombre, latitud, longitud) values ('AUD-G7-CLIMA-Z-${R}', ${COORD_A.latitud}, ${COORD_A.longitud}) returning id),
s as (insert into sector (predio_id, nombre) select id, 'Sector principal' from x union all select id, 'Sector principal' from z returning id)
select (select id from x) || '|' || (select id from z);
commit;
`);
  const linea = salida.split('\n').find((l) => /^[0-9a-f-]{36}\|[0-9a-f-]{36}$/.test(l));
  if (!linea) throw new Error(`setup predios: ${salida}`);
  [predioX, predioZ] = linea.split('|');

  // Datos sembrados con un valor imposible (99.9) para ver qué ventana pisa una sincronización.
  const actual = mesRelativo(0);
  const previo = mesRelativo(-1);
  const lejano = mesRelativo(-5);
  psql(`
insert into predio_clima_mensual (predio_id, anio, mes, temp_max_promedio, temp_min_promedio, horas_sol_acumuladas, precipitacion_mm, dias_helada)
values ('${predioX}', ${actual.anio}, ${actual.mes}, ${SENTINELA}, 0, ${SENTINELA}, 0, 0),
       ('${predioX}', ${previo.anio}, ${previo.mes}, ${SENTINELA}, 0, ${SENTINELA}, 0, 0),
       ('${predioX}', ${lejano.anio}, ${lejano.mes}, ${SENTINELA}, 0, ${SENTINELA}, 0, 0);
`);

  const n = await E.service.from('predio').insert({ nombre: `AUD-G7-CLIMA-N-${R}` }).select('id').single();
  const sin = await E.service.from('predio').insert({ nombre: `AUD-G7-CLIMA-SIN-${R}` }).select('id').single();
  if (n.error || sin.error) throw new Error(`setup predios sin coordenadas: ${n.error?.message ?? sin.error?.message}`);
  predioN = n.data!.id as string;
  predioSin = sin.data!.id as string;
}, 120_000);

afterAll(async () => {
  const ids = [predioX, predioZ, predioN, predioSin].filter(Boolean).map((i) => `'${i}'`).join(',');
  if (ids) {
    psql(`
begin;
set local session_replication_role = replica;
delete from predio_clima_sync_pendiente where predio_id in (${ids});
delete from predio_clima_mensual where predio_id in (${ids});
delete from sector where predio_id in (${ids});
delete from predio where id in (${ids});
${idsRespuestaFalsa.length ? `delete from net._http_response where id in (${idsRespuestaFalsa.join(',')});` : ''}
commit;
`);
  }
  await borrarUsuariosG7(E);
}, 60_000);

describe('R04 permisos sobre la cadena de clima', () => {
  it('solo sincronizar_clima_predio y obtener_clima_predio son ejecutables por authenticated; el resto de la cadena es solo postgres', async () => {
    for (const cliente of [E.operario, E.admin]) {
      for (const [nombre, args] of [
        ['recolectar_clima_pendiente', {}],
        ['refrescar_clima_predios', {}],
        ['procesar_respuesta_clima_predio', { p_predio_id: predioX, p_body: {} }],
      ] as const) {
        const { error } = await cliente.rpc(nombre as never, args as never);
        expect(error?.code, nombre).toBe('42501');
      }
    }
  });

  it('predio_clima_sync_pendiente no se lee ni con select ni con insert/delete (RLS sin policies y sin grants)', async () => {
    for (const cliente of [E.operario, E.admin, E.anon]) {
      const lectura = await cliente.from('predio_clima_sync_pendiente').select('*');
      expect(lectura.error?.code).toBe('42501');
      const alta = await cliente.from('predio_clima_sync_pendiente').insert({ request_id: 1, predio_id: predioX, fecha_desde: '2026-01-01', fecha_hasta: '2026-01-02' });
      expect(alta.error?.code).toBe('42501');
    }
  });

  it('predio_clima_mensual es de solo lectura para authenticated: ni el admin puede escribir (el caché lo escriben solo las funciones DEFINER)', async () => {
    const lectura = await E.operario.from('predio_clima_mensual').select('anio, mes').eq('predio_id', predioX);
    expect(lectura.error).toBeNull();
    expect(lectura.data!.length).toBe(3);
    for (const cliente of [E.operario, E.admin]) {
      const alta = await cliente.from('predio_clima_mensual').insert({ predio_id: predioX, anio: 2001, mes: 1 });
      expect(alta.error?.code).toBe('42501');
      const baja = await cliente.from('predio_clima_mensual').delete().eq('predio_id', predioX);
      expect(baja.error?.code).toBe('42501');
    }
  });

  it('el esquema net (pg_net) no es alcanzable por la API: anon y authenticated reciben PGRST106 aunque tengan EXECUTE en net.http_get', async () => {
    for (const cliente of [E.anon, E.operario, E.admin]) {
      const r = await cliente.schema('net' as never).rpc('http_get' as never, { url: 'http://127.0.0.1:1/' } as never);
      expect((r as { error?: { code?: string } }).error?.code).toBe('PGRST106');
    }
  });

  it('anon no ejecuta sincronizar_clima_predio ni obtener_clima_predio', async () => {
    expect((await E.anon.rpc('sincronizar_clima_predio', { p_predio_id: predioX, p_meses_atras: 0 })).error?.code).toBe('42501');
    expect((await E.anon.rpc('obtener_clima_predio', { p_predio_id: predioX })).error?.code).toBe('42501');
  });
});

describe('R04 sincronizar_clima_predio llamada por un operario (A1-G7-01)', () => {
  // A1-G7-01: ni la UI ni ninguna otra parte del frontend llama a esta función
  // (solo el trigger y pg_cron, que corren como dueño), pero el grant a
  // authenticated permite que cualquier usuario la use. Esta llamada es además
  // un pedido absurdo (1200 meses = desde 1926, Open-Meteo solo tiene desde
  // 1940): la función no valida el parámetro y lo manda igual.
  it.fails('A1-G7-01: un operario no debería poder lanzar la sincronización de clima (hoy la lanza)', async () => {
    await esperarLejosDelCron(35);
    const { data, error } = await E.operario.rpc('sincronizar_clima_predio', { p_predio_id: predioX, p_meses_atras: 1200 });
    if (!error) idsSolicitud.push(Number(data));
    expect(error?.code).toBe('42501');
  }, 90_000);

  it('sin idempotencia ni tope: llamadas repetidas del operario crean un request y una fila pendiente cada una', async () => {
    const ids: number[] = [...idsSolicitud];
    for (let i = 0; i < 2; i += 1) {
      const { data, error } = await E.operario.rpc('sincronizar_clima_predio', { p_predio_id: predioX, p_meses_atras: 0 });
      expect(error).toBeNull();
      ids.push(Number(data));
      idsSolicitud.push(Number(data));
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(3);
    // Las tres solicitudes quedan en la tabla pendiente (el cron aún no pasó: esperarLejosDelCron).
    const filasPendientes = pendientes(predioX);
    expect(filasPendientes.map((f) => Number(f[0]))).toEqual(expect.arrayContaining(ids));
    expect(filasPendientes.every((f) => f[3] === '0')).toBe(true); // `intentos` nunca se usa
  });

  it('parámetros inválidos (NULL, 100000 meses) fallan con error crudo de Postgres y sin crear solicitudes', async () => {
    const antes = pendientes(predioX).length;
    const nulo = await E.operario.rpc('sincronizar_clima_predio', { p_predio_id: predioX, p_meses_atras: null as never });
    expect(nulo.error).not.toBeNull();
    const enorme = await E.operario.rpc('sincronizar_clima_predio', { p_predio_id: predioX, p_meses_atras: 100000 });
    expect(enorme.error).not.toBeNull();
    expect(pendientes(predioX).length).toBe(antes);
  });

  it('un predio sin coordenadas se rechaza con mensaje de negocio (22023) y sin solicitud; un predio inexistente da P0002', async () => {
    const sin = await E.operario.rpc('sincronizar_clima_predio', { p_predio_id: predioSin, p_meses_atras: 0 });
    expect(sin.error?.code).toBe('22023');
    expect(sin.error?.message).toMatch(/no tiene coordenadas/);
    expect(pendientes(predioSin)).toHaveLength(0);
    const inexistente = await E.operario.rpc('sincronizar_clima_predio', { p_predio_id: '00000000-0000-0000-0000-000000000000', p_meses_atras: 0 });
    expect(inexistente.error?.code).toBe('P0002');
  });
});

describe('R04 recolección de respuestas (cron) y respuestas fallidas (A1-G7-02)', () => {
  it('una respuesta fallida (400 por rango imposible) se descarta sin reintento ni rastro; las válidas pisan solo su ventana', async () => {
    expect(idsSolicitud.length).toBe(3);
    const respuestas = await esperarRespuestas(idsSolicitud);
    for (const [id, r] of respuestas) console.info(`[G7] request ${id}: status=${r.status} timed_out=${r.timedOut} error="${r.error}"`);

    // Procesa igual que el cron (el cron corre cada 5 min; si ya pasó, no queda nada que procesar).
    psql('select recolectar_clima_pendiente()');
    expect(pendientes(predioX)).toHaveLength(0);

    const meses = mesesDe(predioX);
    const previo = mesRelativo(-1);
    const lejano = mesRelativo(-5);
    // Fuera de la ventana de la sincronización, los meses viejos NO se tocan.
    expect(meses.find((m) => m.anio === previo.anio && m.mes === previo.mes)?.tmax).toBe(SENTINELA);
    expect(meses.find((m) => m.anio === lejano.anio && m.mes === lejano.mes)?.tmax).toBe(SENTINELA);
    // El pedido de 1200 meses, si Open-Meteo lo rechazó, no dejó ningún dato nuevo.
    expect(meses.some((m) => m.anio < lejano.anio || (m.anio === lejano.anio && m.mes < lejano.mes))).toBe(false);

    // Con internet y fuera del día 1, las dos solicitudes válidas reemplazan el mes en curso.
    const huboExito = [...respuestas.values()].some((r) => r.status === '200');
    const hoy = psql('select extract(day from current_date)::int');
    if (huboExito && hoy !== '1') {
      const actual = mesRelativo(0);
      expect(meses.find((m) => m.anio === actual.anio && m.mes === actual.mes)?.tmax).not.toBe(SENTINELA);
    }
  }, 90_000);

  it('el estado "sin datos y sin pendientes" es idéntico al de "recién geolocalizado": obtener_clima_predio no los distingue y la UI muestra «Sincronizando…» para siempre', async () => {
    const { data, error } = await E.operario.rpc('obtener_clima_predio', { p_predio_id: predioZ });
    expect(error).toBeNull();
    const d = data as unknown as { predios: Array<{ tiene_coordenada: boolean; sincronizando: boolean; meses: unknown[] }> };
    expect(d.predios).toHaveLength(1);
    expect(d.predios[0]).toMatchObject({ tiene_coordenada: true, sincronizando: false, meses: [] });
    // ClimaPredioBloque.tsx: `if (clima.sincronizando || clima.meses.length === 0)` → spinner con
    // «Sincronizando datos climáticos…»; no hay botón de reintento ni llamada a sincronizar en el frontend.
  });

  it('recolectar_clima_pendiente: sin respuesta tras 1 h se abandona; con respuesta 500 se descarta; con respuesta reciente pendiente se conserva; `intentos` no se usa', async () => {
    const base = 900_000_000 + (R % 1_000_000);
    const [viejoSinRespuesta, recienteSinRespuesta, conError] = [base, base + 1, base + 2];
    idsRespuestaFalsa.push(conError);
    psql(`
insert into predio_clima_sync_pendiente (request_id, predio_id, fecha_desde, fecha_hasta, created_at) values
  (${viejoSinRespuesta}, '${predioZ}', '2026-01-01', '2026-01-31', now() - interval '2 hours'),
  (${recienteSinRespuesta}, '${predioZ}', '2026-01-01', '2026-01-31', now() - interval '10 minutes'),
  (${conError}, '${predioZ}', '2026-01-01', '2026-01-31', now());
insert into net._http_response (id, status_code, content, timed_out, error_msg) values (${conError}, 500, 'error', false, null);
select recolectar_clima_pendiente();
`);
    const quedan = pendientes(predioZ).map((f) => Number(f[0]));
    expect(quedan).toContain(recienteSinRespuesta);
    expect(quedan).not.toContain(viejoSinRespuesta);
    expect(quedan).not.toContain(conError);
    expect(mesesDe(predioZ)).toHaveLength(0);
    psql(`delete from predio_clima_sync_pendiente where request_id = ${recienteSinRespuesta}`);
  });
});

describe('R04 cuerpos de respuesta parciales o raros (A1-G7-02 y A1-G7-04)', () => {
  const procesar = (cuerpo: unknown) => psql(`select procesar_respuesta_clima_predio('${predioZ}', '${JSON.stringify(cuerpo)}'::jsonb)`);
  const limpiar = () => psql(`delete from predio_clima_mensual where predio_id = '${predioZ}'`);

  it('un cuerpo 200 sin "daily" no produce error ni datos: la solicitud se da por buena y no queda rastro', () => {
    limpiar();
    procesar({ latitude: 1, longitude: 2 });
    procesar({ error: true, reason: 'Parameter out of range' });
    expect(mesesDe(predioZ)).toHaveLength(0);
  });

  it('arreglos de distinto largo: se agrega solo el tramo común, en silencio', () => {
    limpiar();
    procesar({
      daily: {
        time: ['2025-03-01', '2025-03-02', '2025-03-03', '2025-03-04'],
        temperature_2m_max: [20, 22, 24, 26],
        temperature_2m_min: [10, 11],
        sunshine_duration: [36000, 36000, 36000, 36000],
        precipitation_sum: [0, 0, 0, 0],
      },
    });
    const [marzo] = mesesDe(predioZ);
    expect(marzo).toMatchObject({ anio: 2025, mes: 3, tmax: 21 }); // promedio de 2 días (20 y 22), no de 4
    expect(marzo.sol).toBe(20); // 2 días × 10 h
  });

  it('valores null (días sin dato): no cuentan en promedios ni en días de helada; si todo el mes es null el resultado es null', () => {
    limpiar();
    procesar({
      daily: {
        time: ['2025-04-01', '2025-04-02', '2025-05-01'],
        temperature_2m_max: [20, null, 18],
        temperature_2m_min: [-1, null, 3],
        sunshine_duration: [18000, null, null],
        precipitation_sum: [1, null, null],
      },
    });
    const filasMes = filas(`select mes, temp_max_promedio, horas_sol_acumuladas, precipitacion_mm, dias_helada from predio_clima_mensual where predio_id = '${predioZ}' order by mes`);
    expect(filasMes[0]).toEqual(['4', '20.0', '5.0', '1.0', '1']);
    expect(filasMes[1]).toEqual(['5', '18.0', '', '', '0']);
  });

  it('un mes con pocos días se guarda como si fuera un mes completo: la tabla no registra cuántos días respaldan cada fila (A1-G7-04)', () => {
    limpiar();
    procesar({
      daily: {
        time: ['2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05'],
        temperature_2m_max: [20, 20, 20, 20, 20],
        temperature_2m_min: [5, 5, 5, 5, 5],
        sunshine_duration: [36000, 36000, 36000, 36000, 36000],
        precipitation_sum: [2, 2, 2, 2, 2],
      },
    });
    const [octubre] = mesesDe(predioZ);
    expect(octubre.sol).toBe(50); // 5 días de 31 presentados como "horas de sol acumuladas de octubre"
    const columnas = psql(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'predio_clima_mensual'`);
    expect(columnas).not.toMatch(/dias_con|dias_dato|cobertura|parcial|completo/);
  });
});

describe('R04 geolocalización, movimiento de coordenadas y reasignación (A1-G7-03)', () => {
  it('la PRIMERA geolocalización de un predio dispara un único backfill de 24 meses hasta ayer', async () => {
    await esperarLejosDelCron(40);
    expect(pendientes(predioN)).toHaveLength(0);
    const { error } = await E.admin.from('predio').update(COORD_A).eq('id', predioN);
    expect(error).toBeNull();
    const p = pendientes(predioN);
    expect(p).toHaveLength(1);
    const esperado = psql(`select (date_trunc('month', current_date) - interval '24 months')::date || '|' || (current_date - 1)`).split('|');
    expect(p[0].slice(1, 3)).toEqual(esperado);
  }, 90_000);

  // A1-G7-03: el trigger solo actúa cuando las coordenadas antiguas eran NULL
  // (`old.latitud is null or old.longitud is null`). Si el admin corrige o
  // mueve el predio, no se recalcula nada: el histórico sigue siendo el de la
  // ubicación anterior y el refresco mensual solo pisa los últimos meses.
  it.fails('A1-G7-03: mover un predio a otras coordenadas debería re-sincronizar (o invalidar) su clima', async () => {
    const antesFilas = mesesDe(predioX);
    expect(antesFilas.length).toBeGreaterThan(0);
    const { error } = await E.admin.from('predio').update(COORD_B).eq('id', predioX);
    expect(error).toBeNull();
    const despuesPendientes = pendientes(predioX);
    const despuesFilas = mesesDe(predioX);
    const resincronizo = despuesPendientes.length > 0;
    const invalido = despuesFilas.length === 0;
    expect(resincronizo || invalido).toBe(true);
  });

  it('tras el movimiento, el clima de la ubicación antigua sigue expuesto sin ninguna marca de desactualizado', async () => {
    const { data, error } = await E.operario.rpc('obtener_clima_predio', { p_predio_id: predioX });
    expect(error).toBeNull();
    const d = data as unknown as { predios: Array<{ sincronizando: boolean; meses: unknown[]; [clave: string]: unknown }> };
    expect(d.predios[0].meses.length).toBeGreaterThan(0);
    expect(Object.keys(d.predios[0]).sort()).toEqual(['meses', 'predio_id', 'predio_nombre', 'sincronizando', 'tiene_coordenada']);
  });

  it('obtener_clima_predio no devuelve coordenadas (solo un booleano) y valida exactamente un identificador', async () => {
    const { data } = await E.operario.rpc('obtener_clima_predio', { p_predio_id: predioX });
    const texto = JSON.stringify(data);
    expect(texto).not.toMatch(/latitud|longitud/);
    expect(texto).not.toContain(String(COORD_A.latitud));
    expect(texto).not.toContain(String(COORD_B.latitud));
    expect((await E.operario.rpc('obtener_clima_predio', {})).error?.code).toBe('22023');
    expect((await E.operario.rpc('obtener_clima_predio', { p_predio_id: predioX, p_planta_id: '00000000-0000-0000-0000-000000000000' })).error?.code).toBe('22023');
    expect((await E.operario.rpc('obtener_clima_predio', { p_predio_id: '00000000-0000-0000-0000-000000000000' })).error?.code).toBe('P0002');
  });

  it('refrescar_clima_predios recorre todos los predios con coordenadas, activos o no (no se ejecuta: se lee la definición)', () => {
    const definicion = psql(`select pg_get_functiondef('public.refrescar_clima_predios'::regproc)`);
    expect(definicion).toMatch(/from predio where latitud is not null and longitud is not null/);
    expect(definicion).not.toMatch(/activo/);
  });

  it('limpieza: se procesan las solicitudes pendientes del predio N para no dejar filas huérfanas', async () => {
    const pend = pendientes(predioN);
    if (pend.length) await esperarRespuestas(pend.map((f) => Number(f[0])), 30);
    psql('select recolectar_clima_pendiente()');
    expect(pendientes(predioN)).toHaveLength(0);
  }, 60_000);
});
