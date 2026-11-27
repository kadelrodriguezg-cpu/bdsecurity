/**
 * Auditoría integral, Corrida 1, grupo G7: R05 mapas con 1000 emplazamientos.
 *
 * obtener_resumen_mapa_territorial (operario), consultar_mapa_viewport (admin)
 * y obtener_mapa_cruce con el volumen real esperado (hoy hay 1313 individuos;
 * el territorio aún no se usa). El volumen se prepara por psql con
 * session_replication_role=replica para no disparar el trigger que lanza
 * llamadas HTTP reales a Open-Meteo ni hacer 1000 llamadas a la API. Todo lo
 * creado se borra en afterAll (solo filas del cruce y los predios propios).
 *
 * Hallazgos que ilustra: A1-G7-05 (ORDER BY sin desempate: las páginas se
 * solapan o pierden filas), A1-G7-06 (p_limite NULL salta el tope de 500) y
 * A1-G7-07 (la interfaz descarta `total` y pinta solo la primera página).
 *
 * Datos: predio A con 105 sectores y 400 individuos; predio B con su único
 * "Sector principal" (el que auto-provisiona el trigger) y 600 individuos;
 * ocho predios con el mismo nombre para la paginación del resumen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { borrarUsuariosG7, prepararEntornoG7, psql, type EntornoG7 } from './g7-helpers';

const R = Date.now();
const SECTORES = 105;
const INDIVIDUOS = 1000;
const EN_PREDIO_A = 400;
const LAT = -45.5;
const LON = -72.0;
const VIEWPORT = { p_latitud_minima: -45.6, p_latitud_maxima: -45.4, p_longitud_minima: -72.1, p_longitud_maxima: -71.9 };
const NOMBRE_REPETIDO = `AUD-G7-ESC-igual-${R}`;

let E: EntornoG7;
let cruceId: string;
let cruceDupId: string;
let predioId: string; // predio A (105 sectores)
let predioBId: string; // predio B (un solo "Sector principal")

interface Punto { emplazamiento_id: string; sector_id: string; codigo_sistema: string }
interface RespuestaViewport { total: number; limite: number | null; offset: number; puntos: Punto[] }
interface RespuestaResumen { total: number; limite: number | null; offset: number; clusters: Array<{ sector_id: string; sector_nombre: string; individuos: number }> }

async function viewport(extra: Record<string, unknown> = {}): Promise<RespuestaViewport> {
  const { data, error } = await E.admin.rpc('consultar_mapa_viewport', { ...VIEWPORT, ...extra } as never);
  expect(error).toBeNull();
  return data as unknown as RespuestaViewport;
}

async function resumen(extra: Record<string, unknown> = {}): Promise<RespuestaResumen> {
  const { data, error } = await E.operario.rpc('obtener_resumen_mapa_territorial', { p_predio_id: predioId, ...extra } as never);
  expect(error).toBeNull();
  return data as unknown as RespuestaResumen;
}

async function crearCruce(codigo: string): Promise<string> {
  const { data, error } = await E.service
    .from('plantas')
    .insert({ codigo_sistema: codigo, especie_id: E.especieId, estado: 'traslado_destino', es_prueba: true })
    .select('id')
    .single();
  if (error || !data) throw new Error(`setup cruce: ${error?.message}`);
  return data.id as string;
}

beforeAll(async () => {
  E = await prepararEntornoG7('escala');
  cruceId = await crearCruce(`AUD-G7-ESC-${R}`);
  cruceDupId = await crearCruce(`AUD-G7-ESCD-${R}`);
  // N35 (v3 paso 8): los mapas excluyen los cruces de prueba. El escenario mide el mapa con el cruce como real y lo
  // vuelve a marcar de prueba en afterAll, antes de purgarlo (la purga dura solo acepta cruces de prueba).
  await E.service.from('plantas').update({ es_prueba: false }).in('id', [cruceId, cruceDupId]);

  const salida = psql(`
begin;
set local session_replication_role = replica;
with pa as (
  insert into predio (nombre, latitud, longitud) values ('AUD-G7-ESC-predio-A-${R}', ${LAT}, ${LON}) returning id
), pb as (
  insert into predio (nombre, latitud, longitud) values ('AUD-G7-ESC-predio-B-${R}', ${LAT + 0.05}, ${LON - 0.05}) returning id
), sa as (
  insert into sector (predio_id, nombre)
  select pa.id, 'AUD-G7-sector-' || lpad(g::text, 3, '0') from pa, generate_series(1, ${SECTORES}) g
  returning id, nombre
), sb as (
  insert into sector (predio_id, nombre) select id, 'Sector principal' from pb returning id
), i as (
  insert into individuos (planta_id, codigo_display, created_by)
  select '${cruceId}', 'AUD-G7-ESC-${R}-P' || lpad(g::text, 4, '0'), '${E.operarioId}' from generate_series(1, ${INDIVIDUOS}) g
  returning id, codigo_display
), numerados_s as (
  select id, row_number() over (order by nombre) - 1 as n from sa
), numerados_i as (
  select id, row_number() over (order by codigo_display) - 1 as n from i
), e as (
  insert into emplazamiento_individuo (individuo_id, sector_id, fecha_inicio, created_by)
  select ni.id, case when ni.n < ${EN_PREDIO_A} then ns.id else (select id from sb) end, date '2026-10-01', '${E.adminId}'
  from numerados_i ni left join numerados_s ns on ns.n = ni.n % ${SECTORES}
  returning 1
)
select (select id from pa) || '|' || (select id from pb) || '|' || (select count(*) from e);
commit;

-- Ocho predios con el MISMO nombre (la base lo permite), cada uno con su "Sector principal".
begin;
set local session_replication_role = replica;
with p as (insert into predio (nombre) select '${NOMBRE_REPETIDO}' from generate_series(1, 8) returning id),
s as (insert into sector (predio_id, nombre) select id, 'Sector principal' from p returning id),
i as (insert into individuos (planta_id, codigo_display, created_by) select '${cruceDupId}', 'AUD-G7-ESCD-${R}-P' || g, '${E.operarioId}' from generate_series(1, 40) g returning id, codigo_display),
ns as (select id, row_number() over (order by id) - 1 as n from s),
ni as (select id, row_number() over (order by codigo_display) - 1 as n from i)
insert into emplazamiento_individuo (individuo_id, sector_id, fecha_inicio, created_by) select ni.id, ns.id, date '2026-10-01', '${E.adminId}' from ni join ns on ns.n = ni.n % 8;
commit;
`);
  const linea = salida.split('\n').find((l) => /^[0-9a-f-]{36}\|[0-9a-f-]{36}\|\d+$/.test(l));
  if (!linea) throw new Error(`setup territorio: salida inesperada ${salida}`);
  [predioId, predioBId] = linea.split('|');
}, 120_000);

afterAll(async () => {
  psql(`
begin;
set local session_replication_role = replica;
delete from emplazamiento_individuo where individuo_id in (select id from individuos where planta_id in ('${cruceId}', '${cruceDupId}'));
delete from individuos where planta_id in ('${cruceId}', '${cruceDupId}');
delete from sector where predio_id in ('${predioId}', '${predioBId}') or predio_id in (select id from predio where nombre = '${NOMBRE_REPETIDO}');
delete from predio where id in ('${predioId}', '${predioBId}') or nombre = '${NOMBRE_REPETIDO}';
commit;
`);
  await E.service.from('plantas').update({ es_prueba: true }).in('id', [cruceId, cruceDupId]);
  for (const id of [cruceId, cruceDupId]) {
    const { error } = await E.admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
    if (error) console.warn(`afterAll: no se pudo borrar el cruce ${id}: ${error.message}`);
  }
  await borrarUsuariosG7(E);
}, 60_000);

describe('R05 consultar_mapa_viewport con 1000 emplazamientos (admin)', () => {
  it('el volumen preparado es el esperado y la primera página trae 250 de 1000 (límite por defecto de la UI)', async () => {
    const d = await viewport();
    expect(d.total).toBe(INDIVIDUOS);
    expect(d.limite).toBe(250);
    expect(d.puntos).toHaveLength(250);
    // A1-G7-07: TerritorialMap llama con el límite por defecto y no pagina:
    // pinta 250 de 1000 y el pie dice "1000 emplazamientos en el área visible".
  });

  it('responde en un tiempo razonable con 1000 emplazamientos y la página máxima (500)', async () => {
    const t0 = performance.now();
    const d = await viewport({ p_limite: 500 });
    const ms = performance.now() - t0;
    console.info(`[G7] consultar_mapa_viewport 1000 emplazamientos, página de 500: ${ms.toFixed(0)} ms`);
    expect(d.puntos).toHaveLength(500);
    expect(ms).toBeLessThan(5000);
  });

  // A1-G7-05: el ORDER BY (sitio, predio, sector, latitud, longitud) no es único
  // (todos los individuos de un sector comparten la coordenada del predio y,
  // con el "Sector principal" auto-provisionado, un predio entero es un solo
  // sector): paginar con LIMIT/OFFSET repite filas y pierde otras.
  it.fails('A1-G7-05: recorrer todas las páginas devuelve cada emplazamiento exactamente una vez', async () => {
    for (const tamano of [33, 97, 250]) {
      const vistos = new Map<string, number>();
      for (let offset = 0; offset < INDIVIDUOS; offset += tamano) {
        const d = await viewport({ p_limite: tamano, p_offset: offset });
        for (const p of d.puntos) vistos.set(p.emplazamiento_id, (vistos.get(p.emplazamiento_id) ?? 0) + 1);
      }
      const repetidos = [...vistos.values()].filter((n) => n > 1).length;
      expect(repetidos, `repetidos con páginas de ${tamano}`).toBe(0);
      expect(vistos.size, `distintos con páginas de ${tamano}`).toBe(INDIVIDUOS);
    }
  });

  // A1-G7-06: la validación `p_limite < 1 or p_limite > 500` no atrapa NULL
  // (NULL < 1 es NULL, no verdadero) y `limit NULL` significa sin límite.
  it.fails('A1-G7-06: p_limite NULL se rechaza igual que 0 o 501 (hoy devuelve todo)', async () => {
    const { error } = await E.admin.rpc('consultar_mapa_viewport', { ...VIEWPORT, p_limite: null } as never);
    expect(error?.code).toBe('22023');
  });

  it('p_limite 0, negativo o 501 se rechaza con 22023', async () => {
    for (const p_limite of [0, -1, 501, 100000]) {
      const { error } = await E.admin.rpc('consultar_mapa_viewport', { ...VIEWPORT, p_limite } as never);
      expect(error?.code, `p_limite=${p_limite}`).toBe('22023');
    }
    const { error } = await E.admin.rpc('consultar_mapa_viewport', { ...VIEWPORT, p_offset: -1 } as never);
    expect(error?.code).toBe('22023');
  });
});

describe('R05 obtener_resumen_mapa_territorial con 105 sectores en el predio A (operario)', () => {
  it('con el límite por defecto de la UI (100) devuelve 100 de 105 sectores y total = 105', async () => {
    const d = await resumen();
    expect(d.total).toBe(SECTORES);
    expect(d.limite).toBe(100);
    expect(d.clusters).toHaveLength(100);
    // A1-G7-07: la UI del operario no muestra `total` ni ofrece "ver más":
    // los 5 sectores restantes no se ven.
  });

  it('el último tramo existe con offset (la API sí permite verlo)', async () => {
    const d = await resumen({ p_limite: 100, p_offset: 100 });
    expect(d.clusters).toHaveLength(SECTORES - 100);
  });

  it('con 1000 emplazamientos agregados responde en un tiempo razonable', async () => {
    const t0 = performance.now();
    const d = await resumen({ p_limite: 500 });
    const ms = performance.now() - t0;
    console.info(`[G7] obtener_resumen_mapa_territorial 105 sectores / 400 emplazamientos: ${ms.toFixed(0)} ms`);
    expect(d.clusters).toHaveLength(SECTORES);
    expect(d.clusters.reduce((suma, c) => suma + c.individuos, 0)).toBe(EN_PREDIO_A);
    expect(ms).toBeLessThan(5000);
  });

  it.fails('A1-G7-06: p_limite NULL se rechaza igual que 0 o 501 (hoy devuelve todos los clusters)', async () => {
    const { error } = await E.operario.rpc('obtener_resumen_mapa_territorial', { p_predio_id: predioId, p_limite: null } as never);
    expect(error?.code).toBe('22023');
  });

  it('p_limite 0, negativo, 501 y p_offset negativo se rechazan con 22023', async () => {
    for (const p_limite of [0, -1, 501]) {
      const { error } = await E.operario.rpc('obtener_resumen_mapa_territorial', { p_predio_id: predioId, p_limite } as never);
      expect(error?.code, `p_limite=${p_limite}`).toBe('22023');
    }
    const { error } = await E.operario.rpc('obtener_resumen_mapa_territorial', { p_predio_id: predioId, p_offset: -1 } as never);
    expect(error?.code).toBe('22023');
  });

  // A1-G7-05 (variante del resumen): el ORDER BY es (sitio, predio, sector) por
  // NOMBRE; la base permite predios con el mismo nombre y todos tienen un
  // "Sector principal", así que hay empates y la paginación pierde o repite.
  it.fails('A1-G7-05: paginar el resumen devuelve cada sector exactamente una vez aunque haya predios con el mismo nombre', async () => {
    const { data } = await E.operario.rpc('obtener_resumen_mapa_territorial', { p_limite: 1 } as never);
    const total = (data as unknown as RespuestaResumen).total;
    for (const tamano of [1, 2, 3]) {
      const vistos = new Map<string, number>();
      for (let offset = 0; offset < total; offset += tamano) {
        const { data: pagina } = await E.operario.rpc('obtener_resumen_mapa_territorial', { p_limite: tamano, p_offset: offset } as never);
        for (const c of (pagina as unknown as RespuestaResumen).clusters) vistos.set(c.sector_id, (vistos.get(c.sector_id) ?? 0) + 1);
      }
      expect([...vistos.values()].filter((n) => n > 1).length, `repetidos con páginas de ${tamano}`).toBe(0);
      expect(vistos.size, `distintos con páginas de ${tamano}`).toBe(total);
    }
  });
});

describe('R05 obtener_mapa_cruce con 1000 individuos en un cruce', () => {
  it('devuelve un cluster por predio con los 1000 códigos (la RPC devuelve un solo jsonb: el tope de 1000 filas de PostgREST no la corta)', async () => {
    const t0 = performance.now();
    const { data, error } = await E.operario.rpc('obtener_mapa_cruce', { p_planta_id: cruceId });
    const ms = performance.now() - t0;
    console.info(`[G7] obtener_mapa_cruce 1000 individuos en 2 predios: ${ms.toFixed(0)} ms`);
    expect(error).toBeNull();
    const d = data as unknown as { total_individuos_emplazados: number; clusters: Array<{ individuos: number; codigos_individuos: unknown[] }> };
    expect(d.total_individuos_emplazados).toBe(INDIVIDUOS);
    expect(d.clusters).toHaveLength(2);
    expect(d.clusters.reduce((suma, c) => suma + c.individuos, 0)).toBe(INDIVIDUOS);
    expect(d.clusters.reduce((suma, c) => suma + c.codigos_individuos.length, 0)).toBe(INDIVIDUOS);
    expect(ms).toBeLessThan(5000);
  });
});
