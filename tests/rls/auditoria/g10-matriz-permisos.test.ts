/**
 * G10 — Matriz de permisos automática (auditoría integral, Corrida 1).
 *
 * Para cada tabla × operación × rol (SELECT/INSERT/UPDATE/DELETE por PostgREST
 * con la clave anon) y cada RPC pública × rol, compara el resultado REAL contra
 * la matriz ESPERADA de `g10-matriz-esperada.ts`, con usuarios reales:
 *
 *   anon (sin login), operario, autor (creó las filas), linaje (operario con
 *   puede_ver_linaje) y admin.
 *
 * Además comprueba:
 *   - que toda tabla/vista/RPC del catálogo real esté clasificada en la matriz
 *     (lo no clasificado es un hallazgo) y que los grants de `anon` y
 *     `authenticated` coincidan con el modelo;
 *   - variantes por columna (linaje denegado con select=*, embeds, filtros y
 *     orden; columnas no actualizables de plantas; identidad de individuos;
 *     rol/permiso de perfiles; soft delete de bitácora);
 *   - Storage (`media-plantas` y `evecl-fotos`).
 *
 * Cómo funciona: un único `beforeAll` prepara datos con service_role (cruces
 * `es_prueba = true` con código `AUD-G10-...`, individuos, rondas, evaluaciones,
 * etc.), ejecuta TODAS las sondas con los clientes logueados (sujetos al RLS) y
 * guarda el resultado de cada celda; después hay un `it` por celda que lo
 * afirma. Las diferencias ya documentadas están en `DESVIACIONES_CONOCIDAS`
 * (con ID de hallazgo): la prueba exige que sigan siendo exactamente esa
 * desviación, así que si alguien corrige el problema el `it` avisa para
 * retirarla de la tabla.
 *
 * Reglas: nada de producción (solo la base local en Docker); service_role solo
 * para preparar y limpiar, nunca para "probar" permisos; usuarios propios
 * `aud-g10-*@test.local`; efectos irreversibles (borrado físico, bajas en lote,
 * activar scoring, importación, llamadas a Internet) se prueban únicamente con
 * los roles que deben ser rechazados.
 *
 * Variables de entorno opcionales (solo desarrollo; por defecto la prueba no las usa):
 *   G10_VOLCAR=ruta.json   escribe todas las celdas (esperado/real/desviación) a un JSON.
 *   G10_IMPRIMIR=1         imprime las celdas cuyo resultado real difiere del esperado.
 *   G10_SOLO=t1,t2,rpc     ejecuta solo esas tablas/RPC (modo exploración, sin afirmaciones fiables).
 *
 * Duración típica: ~30 s contra la base local. Las filas de audit_log que generan
 * las sondas quedan (la tabla es append-only por diseño).
 */
import { guardarFichaEvecl } from '../envolturas';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds, type LocalCreds } from '../helpers';
import {
  DESVIACIONES_CONOCIDAS,
  OPS,
  ROLES,
  RPC,
  TABLAS,
  VISTAS,
  esperado,
  grantEsperado,
  type Op,
  type Real,
  type Rol,
  type RpcResultado,
} from './g10-matriz-esperada';

// ============================================================================
// Infraestructura
// ============================================================================

const DB = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_dbsecurity-frutales';
const S = Date.now();
const ZERO = '00000000-0000-0000-0000-000000000000';
const PASSWORD = 'test-password-123';

function sql(q: string): string {
  return execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', q], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}
function sqlJson<T = Record<string, unknown>>(q: string): T[] {
  const out = sql(`select coalesce(json_agg(q_), '[]'::json) from (${q}) q_`);
  return JSON.parse(out) as T[];
}

type Filtro = Record<string, string | number | boolean>;
type Fila = Record<string, unknown>;

interface Medicion {
  real: string;
  codigo?: string;
  mensaje?: string;
}

interface Ctx {
  creds: LocalCreds;
  svc: SupabaseClient;
  cli: Record<Rol, SupabaseClient>;
  uid: Record<Rol, string>;
  especieId: string;
  // cruces
  cruce: string; // cruce principal (evaluacion_anual)
  cruceTras: string; // en trasplante (individualizar_plantas)
  cruceMulti: string; // en traslado_destino (rondas multisitio)
  cruceInd: string; // destino de los INSERT directos de individuos
  individuo: string;
  rondaFx: string;
  evalFx: string;
  indRol: Record<string, string>;
  rondaRol: Record<string, string>;
  indRondaIns: Record<string, string>;
  // satélites
  canalFx: string;
  msgFx: string;
  versionActiva: string;
  svFx: string;
  svVacia: string;
  predioFx: string;
  snapFx: string;
  ensayoFx: number;
  fichaFx: number;
  loteFx: string;
  procFx: string;
  registroFx: string;
}

let C: Ctx;
const resultados = new Map<string, Medicion>();
const cleanups: Array<() => Promise<void>> = [];
const crucesCreados: string[] = [];
const usuariosCreados: string[] = [];
const DESARROLLO = !!process.env.G10_SOLO;
const SOLO = new Set((process.env.G10_SOLO ?? '').split(',').filter(Boolean));

const tag = (rol: string, extra = ''): string => `AUD-G10-${S}-${rol}${extra}`;
/** Suscripciones push de prueba: endpoint con forma válida (FCM) que nunca se usa para enviar. */
const PUSH_EP = `https://fcm.googleapis.com/fcm/send/aud-g10-${S}-`;
const PUSH_P256DH = 'B'.repeat(87);
const PUSH_AUTH = 'A'.repeat(22);
const ins = (rol: string): string => `AUD-G10-${S}-ins-${rol}`;

function registrar(id: string, m: Medicion): void {
  resultados.set(id, m);
}

async function crearOrThrow<T = Fila>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, ctx: string): Promise<T> {
  const { data, error } = await p;
  if (error || data === null) throw new Error(`fixture ${ctx}: ${error?.message ?? 'sin datos'}`);
  return data;
}

async function svcIns(tabla: string, fila: Fila, cols = 'id'): Promise<Fila> {
  return crearOrThrow<Fila>(C.svc.from(tabla).insert(fila).select(cols).single() as never, tabla);
}

async function mkCruce(nombre: string, estado: string, extra: Fila = {}): Promise<string> {
  const f = await svcIns('plantas', {
    codigo_sistema: `AUD-G10-${S}-${nombre}`,
    especie_id: C.especieId,
    estado,
    es_prueba: true,
    ...extra,
  });
  crucesCreados.push(f.id as string);
  return f.id as string;
}
async function mkInd(planta: string, creadoPor: string): Promise<string> {
  const f = await svcIns('individuos', { planta_id: planta, codigo_display: '', created_by: creadoPor });
  return f.id as string;
}
async function mkRonda(individuo: string, numero = 1, creadoPor?: string): Promise<string> {
  const f = await svcIns('ronda_evaluacion_anual', {
    individuo_id: individuo,
    tipo_ronda: 'anual',
    numero_ronda: numero,
    anio: 2026,
    fecha_inicio: '2026-01-15',
    created_by: creadoPor ?? C.uid.autor,
  });
  return f.id as string;
}

/** Usuario de Auth (con el perfil que crea handle_new_user, o sin él). */
async function mkUsuarioAuth(nombre: string, conPerfil: boolean): Promise<string> {
  const email = `aud-g10-${nombre}-${S}@test.local`;
  const { data, error } = await C.svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`fixture usuario ${nombre}: ${error?.message}`);
  const id = data.user.id;
  usuariosCreados.push(id);
  if (conPerfil) {
    await C.svc.from('perfiles').upsert({ id, nombre: email, rol: 'operario', puede_ver_linaje: false });
  } else {
    await C.svc.from('perfiles').delete().eq('id', id);
  }
  return id;
}

// ============================================================================
// Sondas
// ============================================================================

function errMed(error: { code?: string; message: string }, denegados: string[]): Medicion {
  if (denegados.includes(error.code ?? '')) return { real: 'denegado', codigo: error.code, mensaje: error.message };
  return { real: 'indeterminado', codigo: error.code, mensaje: error.message };
}

async function sondaSelect(cli: SupabaseClient, tabla: string, cols: string, filtro?: Filtro): Promise<Medicion> {
  let q = cli.from(tabla).select(cols).limit(1);
  if (filtro) q = q.match(filtro);
  const { data, error } = await q;
  // En lecturas cualquier error equivale a "no pude leer": se registra como denegado.
  if (error) return { real: 'denegado', codigo: error.code, mensaje: error.message };
  return { real: (data as unknown[]).length > 0 ? 'permitido' : 'permitido_sin_efecto' };
}

async function sondaInsert(cli: SupabaseClient, tabla: string, payload: Fila, denegados = ['42501']): Promise<Medicion> {
  const { error } = await cli.from(tabla).insert(payload);
  if (!error) return { real: 'permitido' };
  return errMed(error, denegados);
}

async function sondaUpdate(cli: SupabaseClient, tabla: string, payload: Fila, filtro: Filtro, denegados = ['42501']): Promise<Medicion> {
  const { count, error } = await cli.from(tabla).update(payload, { count: 'exact' }).match(filtro);
  if (error) return errMed(error, denegados);
  if (count === null) return { real: 'indeterminado', mensaje: 'sin Content-Range' };
  return { real: count > 0 ? 'permitido' : 'permitido_sin_efecto' };
}

async function sondaDelete(cli: SupabaseClient, tabla: string, filtro: Filtro, denegados = ['42501']): Promise<Medicion> {
  const { count, error } = await cli.from(tabla).delete({ count: 'exact' }).match(filtro);
  if (error) return errMed(error, denegados);
  if (count === null) return { real: 'indeterminado', mensaje: 'sin Content-Range' };
  return { real: count > 0 ? 'permitido' : 'permitido_sin_efecto' };
}

// ============================================================================
// Especificación de sondas por tabla
// ============================================================================

interface SpecTabla {
  /** Columnas del SELECT (nunca linaje). */
  cols: string;
  /** Filtro del SELECT (si el resultado depende de la fila). */
  selFiltro?: () => Filtro | undefined;
  /** Payload de INSERT por rol (las tablas sin INSERT esperado reciben un payload plausible igualmente). */
  insert?: (rol: Rol) => Fila | Promise<Fila>;
  /** Limpieza de lo insertado por las sondas de INSERT. */
  limpiaInsert?: () => Promise<void>;
  /** Payload de UPDATE sin cambio real y su fila objetivo. */
  update?: Fila;
  updFiltro?: () => Filtro;
  /** Fila desechable (la crea service_role) para la sonda de DELETE de cada rol. */
  fresh?: (rol: Rol) => Promise<Filtro>;
  /** Fila para DELETE cuando no hay `fresh` (solo se usan filas propias). */
  delFiltro?: () => Filtro;
  /** Códigos de error que significan "denegado" (además de 42501). */
  denegados?: string[];
}

const BOGUS = (col = 'id'): Filtro => ({ [col]: ZERO });

function crearSpecs(): Record<string, SpecTabla> {
  const u = (rol: Rol): string => (rol === 'anon' ? ZERO : C.uid[rol]);
  const borraPorNombre = (tabla: string, col = 'nombre') => async () => {
    await C.svc.from(tabla).delete().like(col, `AUD-G10-${S}-ins-%`);
  };
  const catalogoSimple = (tabla: string, extra: Fila = {}): SpecTabla => {
    let fx = '';
    return {
      cols: 'id,nombre',
      selFiltro: () => ({ id: fx }),
      insert: (rol) => ({ nombre: ins(rol), ...extra }),
      limpiaInsert: borraPorNombre(tabla),
      update: { nombre: tag('fx', `-${tabla}`) },
      updFiltro: () => ({ id: fx }),
      fresh: async (rol) => ({ id: (await svcIns(tabla, { nombre: tag(rol, `-del-${tabla}`), ...extra })).id as string }),
      delFiltro: () => ({ id: fx }),
      // el fixture se crea de forma perezosa en preparar()
      ...({ __setFx: (v: string) => (fx = v) } as object),
    };
  };

  const specs: Record<string, SpecTabla> = {};

  // ---- Auditoría / bajas ------------------------------------------------------
  specs.audit_log = {
    cols: 'id',
    selFiltro: () => ({ id: Number(fixtures.audit) }),
    insert: () => ({ accion: 'aud_g10_ins', planta_id: C.cruce }),
    update: { accion: 'aud_g10_fixture' },
    updFiltro: () => ({ id: Number(fixtures.audit) }),
    delFiltro: () => ({ id: Number(fixtures.audit) }),
  };
  specs.baja_motivo = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.baja }),
    insert: (rol) => ({ individuo_id: fixtures.indBaja, criterio: 'sanidad', created_by: u(rol) }),
    update: { nota: null },
    updFiltro: () => ({ id: fixtures.baja }),
    delFiltro: () => ({ id: fixtures.baja }),
  };
  specs.individuos = {
    cols: 'id,codigo_display,estado_vital',
    selFiltro: () => ({ id: C.individuo }),
    insert: (rol) => ({ planta_id: C.cruceInd, codigo_display: '', created_by: u(rol) }),
    limpiaInsert: async () => {
      await C.svc.from('individuos').delete().eq('planta_id', C.cruceInd);
    },
    update: { updated_at: '2026-10-01T00:00:00Z' },
    updFiltro: () => ({ id: C.individuo }),
    fresh: async () => ({ id: await mkInd(C.cruceInd, C.uid.autor) }),
    delFiltro: () => ({ id: C.individuo }),
    denegados: ['42501', '23514'],
  };

  // ---- Cruces y satélites ---------------------------------------------------------
  specs.plantas = {
    cols: 'id,codigo_sistema,estado',
    selFiltro: () => ({ id: C.cruce }),
    insert: (rol) => ({ codigo_sistema: ins(rol), especie_id: C.especieId, es_prueba: true }),
    limpiaInsert: async () => {
      await C.svc.from('plantas').delete().like('codigo_sistema', `AUD-G10-${S}-ins-%`);
    },
    update: { n_semillas: null },
    updFiltro: () => ({ id: C.cruce }),
    fresh: async (rol) => ({
      id: (await svcIns('plantas', { codigo_sistema: `AUD-G10-${S}-del-${rol}`, especie_id: C.especieId, es_prueba: true })).id as string,
    }),
  };
  specs.plantas_insumo = {
    cols: 'planta_id,insumo_id',
    selFiltro: () => ({ planta_id: C.cruce }),
    insert: (rol) => ({ planta_id: C.cruce, insumo_id: fixtures.insumoRol[rol] }),
    limpiaInsert: async () => {
      await C.svc.from('plantas_insumo').delete().eq('planta_id', C.cruce).in('insumo_id', Object.values(fixtures.insumoRol));
    },
    update: { insumo_id: ZERO },
    updFiltro: () => ({ planta_id: C.cruce }),
    fresh: async (rol) => {
      const insumo = (await svcIns('insumo', { nombre: tag(rol, '-del-pi'), tipo: 'otro' })).id as string;
      await C.svc.from('plantas_insumo').insert({ planta_id: C.cruce, insumo_id: insumo });
      return { planta_id: C.cruce, insumo_id: insumo };
    },
  };
  specs.plantas_sustrato = {
    cols: 'planta_id,sustrato_id',
    selFiltro: () => ({ planta_id: C.cruce }),
    insert: (rol) => ({ planta_id: C.cruce, sustrato_id: fixtures.sustratoRol[rol], porcentaje: 10 }),
    limpiaInsert: async () => {
      await C.svc.from('plantas_sustrato').delete().eq('planta_id', C.cruce).in('sustrato_id', Object.values(fixtures.sustratoRol));
    },
    update: { porcentaje: 10 },
    updFiltro: () => ({ planta_id: C.cruce }),
    fresh: async (rol) => {
      const sustrato = (await svcIns('sustrato', { nombre: tag(rol, '-del-ps') })).id as string;
      await C.svc.from('plantas_sustrato').insert({ planta_id: C.cruce, sustrato_id: sustrato, porcentaje: 10 });
      return { planta_id: C.cruce, sustrato_id: sustrato };
    },
  };
  // Los INSERT de las sondas se borran todos (salvo el fixture): cosecha_fruto numera con
  // count(*)+1 y un hueco haría chocar los INSERT siguientes (A1-G2-07).
  const hijoCruce = (tabla: string, fila: (rol: Rol, cruce: string) => Fila, upd: Fila): SpecTabla => ({
    cols: 'id',
    selFiltro: () => ({ id: fixtures[`fx_${tabla}`] as string }),
    insert: (rol) => fila(rol, C.cruce),
    limpiaInsert: async () => {
      await C.svc.from(tabla).delete().eq('planta_id', C.cruce).neq('id', fixtures[`fx_${tabla}`] as string);
    },
    update: upd,
    updFiltro: () => ({ id: fixtures[`fx_${tabla}`] as string }),
    fresh: async () => {
      const cruce = tabla === 'cosecha_fruto' ? await mkCruce(`F${randomUUID().slice(0, 6)}`, 'cosecha') : C.cruce;
      return { id: (await svcIns(tabla, { ...fila('autor', cruce), created_by: C.uid.autor })).id as string };
    },
    delFiltro: () => ({ id: fixtures[`fx_${tabla}`] as string }),
  });
  specs.polinizacion_evento = hijoCruce(
    'polinizacion_evento',
    (rol, c) => ({ planta_id: c, fecha: '2026-10-01', n_flores_cruzadas: 1, created_by: u(rol) }),
    { n_flores_cruzadas: 1 },
  );
  specs.cosecha_fruto = hijoCruce(
    'cosecha_fruto',
    (rol, c) => ({ planta_id: c, cantidad_semillas: 5, created_by: u(rol) }),
    { cantidad_semillas: 5 },
  );
  specs.germinacion_evento = hijoCruce(
    'germinacion_evento',
    (rol, c) => ({ planta_id: c, fecha: '2026-10-01', cantidad_nueva: 1, created_by: u(rol) }),
    { cantidad_nueva: 1 },
  );
  specs.registros_evento = hijoCruce(
    'registros_evento',
    (rol, c) => ({ planta_id: c, tipo_evento: 'otro', notas: ins(rol), created_by: u(rol) }),
    { notas: 'AUD-G10 fx' },
  );
  specs.registros_evento.limpiaInsert = async () => {
    await C.svc.from('registros_evento').delete().like('notas', `AUD-G10-${S}-ins-%`);
  };
  specs.evento_archivos = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.archivo }),
    insert: (rol) => ({ registro_id: C.registroFx, storage_path: `${ins(rol)}.jpg`, tipo: 'foto', created_by: u(rol) }),
    limpiaInsert: async () => {
      await C.svc.from('evento_archivos').delete().like('storage_path', `AUD-G10-${S}-ins-%`);
    },
    update: { tipo: 'foto' },
    updFiltro: () => ({ id: fixtures.archivo }),
    fresh: async (rol) => ({
      id: (await svcIns('evento_archivos', { registro_id: C.registroFx, storage_path: `${tag(rol, '-del')}.jpg`, tipo: 'foto', created_by: C.uid.autor })).id as string,
    }),
    delFiltro: () => ({ id: fixtures.archivo }),
  };

  // ---- Evaluación anual -----------------------------------------------------------------
  specs.ronda_evaluacion_anual = {
    cols: 'id',
    selFiltro: () => ({ id: C.rondaFx }),
    insert: (rol) => ({ individuo_id: C.indRondaIns[rol], tipo_ronda: 'anual', numero_ronda: 1, anio: 2026, fecha_inicio: '2026-01-15', created_by: u(rol) }),
    limpiaInsert: async () => {
      await C.svc.from('ronda_evaluacion_anual').delete().in('individuo_id', Object.values(C.indRondaIns));
    },
    update: { anio: 2026 },
    updFiltro: () => ({ id: C.rondaFx }),
    delFiltro: () => ({ id: C.rondaFx }),
  };
  specs.evaluaciones = {
    cols: 'id',
    selFiltro: () => ({ id: C.evalFx }),
    insert: (rol) => ({ ronda_id: C.rondaRol[rol], fecha: '2026-10-01', created_by: u(rol), estado: 'borrador' }),
    limpiaInsert: async () => {
      await C.svc.from('evaluaciones').delete().in('ronda_id', Object.values(C.rondaRol)).neq('id', C.evalFx);
    },
    update: { observaciones: null },
    updFiltro: () => ({ id: C.evalFx }),
    delFiltro: () => ({ id: C.evalFx }),
    denegados: ['42501'],
  };
  specs.evaluacion_reducida = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.eRed }),
    insert: (rol) => ({ individuo_id: C.individuo, fase: 'trasplante', created_by: u(rol) }),
    limpiaInsert: async () => {
      await C.svc.from('evaluacion_reducida').delete().eq('individuo_id', C.individuo).neq('id', fixtures.eRed);
    },
    update: { observaciones: null },
    updFiltro: () => ({ id: fixtures.eRed }),
    delFiltro: () => ({ id: fixtures.eRed }),
  };
  specs.pcr_analisis = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.pcr }),
    insert: (rol) => ({ ronda_id: C.rondaRol[rol], realizado: false, created_by: u(rol) }),
    limpiaInsert: async () => {
      await C.svc.from('pcr_analisis').delete().in('ronda_id', Object.values(C.rondaRol)).neq('id', fixtures.pcr);
    },
    update: { realizado: false },
    updFiltro: () => ({ id: fixtures.pcr }),
    delFiltro: () => ({ id: fixtures.pcr }),
  };
  specs.multisitio = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.multisitio }),
    insert: (rol) => ({ individuo_id: C.individuo, created_by: u(rol) }),
    update: { observaciones: null },
    updFiltro: () => ({ id: fixtures.multisitio }),
    delFiltro: () => ({ id: fixtures.multisitio }),
  };
  specs.procedimiento_cultivo = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.pcult }),
    insert: (rol) => ({ planta_id: C.cruce, tipo: 'poda', fecha: '2026-10-01', created_by: u(rol) }),
    update: { notas: null },
    updFiltro: () => ({ id: fixtures.pcult }),
    delFiltro: () => ({ id: fixtures.pcult }),
  };

  // ---- Scoring -------------------------------------------------------------------------------
  specs.scoring_version = {
    cols: 'id',
    selFiltro: () => ({ id: C.svFx }),
    insert: (rol) => ({ nombre: ins(rol), vigente_desde: '2030-01-01' }),
    limpiaInsert: borraPorNombre('scoring_version'),
    update: { nota: 'AUD-G10' },
    updFiltro: () => ({ id: C.svFx }),
    delFiltro: () => ({ id: C.svFx }),
  };
  specs.scoring_metrica = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.smetrica }),
    insert: (rol) => ({
      scoring_version_id: C.svFx,
      metrica: 'calibre_mm',
      peso: 1,
      metodo_normalizacion: 'escala',
      minimo_normalizacion: 0,
      maximo_normalizacion: 30,
      orden: 10 + ROLES.indexOf(rol),
      categoria: 'fruto_calidad',
    }),
    limpiaInsert: async () => {
      await C.svc.from('scoring_metrica').delete().eq('scoring_version_id', C.svFx).neq('id', fixtures.smetrica);
    },
    update: { peso: 1 },
    updFiltro: () => ({ id: fixtures.smetrica }),
    delFiltro: () => ({ id: fixtures.smetrica }),
  };
  specs.scoring_categoria_peso = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.scat }),
    insert: () => ({ scoring_version_id: C.svFx, categoria: 'produccion', peso: 0 }),
    limpiaInsert: async () => {
      await C.svc.from('scoring_categoria_peso').delete().eq('scoring_version_id', C.svFx).neq('id', fixtures.scat);
    },
    update: { peso: 1 },
    updFiltro: () => ({ id: fixtures.scat }),
    delFiltro: () => ({ id: fixtures.scat }),
  };
  // Fase 2: esquema de fase. Solo SELECT para autenticados; sin grants de escritura.
  specs.esquema_fase_seccion = {
    cols: 'fase,id',
    selFiltro: () => ({ fase: 'evaluacion_anual', id: 'fenologia' }),
    insert: () => ({ fase: 'evaluacion_anual', id: 'aud_g10', etiqueta: 'AUD-G10', orden: 99 }),
    update: { etiqueta: 'Fenología' },
    updFiltro: () => ({ fase: 'evaluacion_anual', id: 'fenologia' }),
    delFiltro: () => ({ fase: 'evaluacion_anual', id: 'fenologia' }),
  };
  specs.esquema_fase_campo = {
    cols: 'fase,clave',
    selFiltro: () => ({ fase: 'evaluacion_anual', clave: 'brotacion' }),
    insert: () => ({ fase: 'evaluacion_anual', clave: 'aud_g10', seccion: 'fenologia', etiqueta: 'AUD-G10', orden: 99, rol: 'descriptor', tipo: 'numero' }),
    update: { etiqueta: 'Brotación' },
    updFiltro: () => ({ fase: 'evaluacion_anual', clave: 'brotacion' }),
    delFiltro: () => ({ fase: 'evaluacion_anual', clave: 'brotacion' }),
  };
  // Fase 4: descriptores por especie (fila fija de la especie de la prueba; el alta usa otra clave y se limpia).
  specs.esquema_campo_especie = {
    cols: 'fase,clave,especie_id',
    selFiltro: () => ({ fase: 'evaluacion_anual', clave: 'bloom', especie_id: C.especieId }),
    insert: () => ({ fase: 'evaluacion_anual', clave: 'golpe_sol', especie_id: C.especieId, activo: false }),
    limpiaInsert: async () => {
      await C.cli.admin.from('esquema_campo_especie').delete().eq('especie_id', C.especieId).eq('clave', 'golpe_sol');
    },
    update: { activo: false },
    updFiltro: () => ({ fase: 'evaluacion_anual', clave: 'bloom', especie_id: C.especieId }),
    delFiltro: () => ({ fase: 'evaluacion_anual', clave: 'bloom', especie_id: C.especieId }),
  };
  // Fase 5 (G4): historial de reactivaciones; nadie escribe directo (ni service_role).
  specs.reactivacion_individuo = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.reactivacion }),
    insert: () => ({ individuo_id: C.individuo, estado_anterior: 'muerto', motivo: 'AUD-G10' }),
    update: { motivo: 'AUD-G10' },
    updFiltro: () => ({ id: fixtures.reactivacion }),
    delFiltro: () => ({ id: fixtures.reactivacion }),
  };
  // Fase 5 (G15): pedidos de corrección; nadie escribe directo (ni service_role).
  specs.pedido_correccion = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.pedidoCorreccion }),
    insert: () => ({ evaluacion_id: fixtures.evalPedido, planta_id: C.cruce, individuo_id: fixtures.indPedido, nota: 'AUD-G10' }),
    update: { nota: 'AUD-G10' },
    updFiltro: () => ({ id: fixtures.pedidoCorreccion }),
    delFiltro: () => ({ id: fixtures.pedidoCorreccion }),
  };
  // Fase 5 (G6): rangos por edad; nadie escribe directo (ni service_role). Se lee el de la v3 que trae la migración.
  specs.scoring_metrica_rango_edad = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.rangoEdad }),
    insert: () => ({ scoring_metrica_id: fixtures.smetrica, edad_desde: 9, minimo: 0, maximo: 1 }),
    update: { nota: 'AUD-G10' },
    updFiltro: () => ({ id: fixtures.rangoEdad }),
    delFiltro: () => ({ id: fixtures.rangoEdad }),
  };
  specs.protocolo_ronda = {
    cols: 'id',
    // Protocolo propio (fixture): la lectura no depende de lo que dejen otras pruebas.
    selFiltro: () => ({ id: fixtures.protocolo }),
    insert: () => ({ planta_id: C.cruce, tipo_ronda: 'anual', numero_ronda: 3, version: 99, nombre: 'AUD-G10', descriptores: { brotacion: 'opcional' }, created_by: ZERO }),
    update: { nombre: 'AUD-G10' },
    updFiltro: () => BOGUS(),
    delFiltro: () => BOGUS(),
  };
  specs.configuracion_ranking = {
    cols: 'id',
    selFiltro: () => ({ id: 1 }),
    insert: () => ({ id: 1 }),
    update: { minimo_evaluaciones_grupo: 5 },
    updFiltro: () => ({ id: 1 }),
    delFiltro: () => ({ id: 1 }),
  };
  specs.rango_referencia = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.rango }),
    insert: (rol) => ({ metrica: 'brix', vigente_desde: '2031-01-01', activo: false, nota: ins(rol) }),
    limpiaInsert: async () => {
      await C.svc.from('rango_referencia').delete().like('nota', `AUD-G10-${S}-ins-%`);
    },
    update: { nota: tag('fx', '-rango') },
    updFiltro: () => ({ id: fixtures.rango }),
    delFiltro: () => ({ id: fixtures.rango }),
  };
  specs.ranking_snapshot = {
    cols: 'id',
    selFiltro: () => ({ id: C.snapFx }),
    insert: (rol) => ({
      nombre: ins(rol), alcance: 'cruzamiento', scoring_version_id: C.versionActiva, especie_id: C.especieId,
      planta_id: C.cruce, poblacion_comparada: 1, criterios: {}, created_by: u(rol),
    }),
    limpiaInsert: borraPorNombre('ranking_snapshot'),
    update: { nombre: tag('fx', '-snap') },
    updFiltro: () => ({ id: C.snapFx }),
    delFiltro: () => ({ id: C.snapFx }),
  };
  specs.ranking_snapshot_resultado = {
    cols: 'snapshot_id',
    selFiltro: () => ({ snapshot_id: C.snapFx }),
    insert: () => ({ snapshot_id: C.snapFx, individuo_id: C.individuo, codigo_display: 'x', evaluacion_id: C.evalFx, posicion: 9, puntaje: 1, detalle: {} }),
    update: { puntaje: 1 },
    updFiltro: () => ({ snapshot_id: C.snapFx }),
    delFiltro: () => ({ snapshot_id: C.snapFx }),
  };

  // ---- Territorio y clima ----------------------------------------------------------------------------
  specs.predio = {
    cols: 'id,nombre',
    selFiltro: () => ({ id: C.predioFx }),
    insert: (rol) => ({ nombre: ins(rol) }),
    limpiaInsert: async () => {
      const { data } = await C.svc.from('predio').select('id').like('nombre', `AUD-G10-${S}-ins-%`);
      const ids = (data ?? []).map((f) => f.id as string);
      if (ids.length) {
        await C.svc.from('sector').delete().in('predio_id', ids);
        await C.svc.from('predio').delete().in('id', ids);
      }
    },
    update: { nombre: tag('fx', '-predio') },
    updFiltro: () => ({ id: C.predioFx }),
    fresh: async (rol) => {
      const p = (await svcIns('predio', { nombre: tag(rol, '-del-predio') })).id as string;
      await C.svc.from('sector').delete().eq('predio_id', p);
      return { id: p };
    },
  };
  specs.sector = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.sector }),
    insert: (rol) => ({ predio_id: C.predioFx, nombre: ins(rol) }),
    limpiaInsert: borraPorNombre('sector'),
    update: { nombre: tag('fx', '-sector') },
    updFiltro: () => ({ id: fixtures.sector }),
    delFiltro: () => ({ id: fixtures.sector }),
  };
  specs.sitio = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.sitio }),
    insert: (rol) => ({ nombre: ins(rol) }),
    limpiaInsert: borraPorNombre('sitio'),
    update: { nombre: tag('fx', '-sitio') },
    updFiltro: () => ({ id: fixtures.sitio }),
    delFiltro: () => ({ id: fixtures.sitio }),
  };
  specs.emplazamiento_individuo = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.emplazamiento }),
    insert: () => ({ individuo_id: C.individuo, sector_id: fixtures.sector, fecha_inicio: '2026-10-01' }),
    update: { fecha_fin: null },
    updFiltro: () => BOGUS(),
    delFiltro: () => BOGUS(),
  };
  specs.emplazamiento_coordenada = {
    cols: 'emplazamiento_id',
    selFiltro: () => ({ emplazamiento_id: fixtures.emplazamiento }),
    insert: () => ({ emplazamiento_id: ZERO, latitud: 0, longitud: 0 }),
    update: { latitud: 0 },
    updFiltro: () => BOGUS('emplazamiento_id'),
    delFiltro: () => BOGUS('emplazamiento_id'),
  };
  specs.predio_clima_mensual = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.clima }),
    insert: () => ({ predio_id: C.predioFx, anio: 2026, mes: 1 }),
    update: { dias_helada: 0 },
    updFiltro: () => BOGUS(),
    delFiltro: () => BOGUS(),
  };
  specs.predio_clima_sync_pendiente = {
    cols: 'request_id',
    insert: () => ({ request_id: 987000000 + (S % 100000), predio_id: C.predioFx, fecha_desde: '2026-01-01', fecha_hasta: '2026-02-01' }),
    update: { intentos: 0 },
    updFiltro: () => BOGUS('predio_id'),
    delFiltro: () => BOGUS('predio_id'),
  };

  // ---- Procedimientos ---------------------------------------------------------------------------------------
  specs.procedimientos = {
    cols: 'id',
    selFiltro: () => ({ id: C.procFx }),
    insert: (rol) => ({ nombre: ins(rol), tipo: 'poda', fecha_inicio: '2026-11-01', responsable_id: u(rol), created_by: u(rol) }),
    update: { notas: null },
    updFiltro: () => ({ id: C.procFx }),
    delFiltro: () => ({ id: C.procFx }),
  };
  specs.procedimiento_objetivos = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.pobj }),
    insert: () => ({ procedimiento_id: C.procFx, tipo: 'cruzamiento', planta_id: C.cruce }),
    update: { nota: null },
    updFiltro: () => ({ id: fixtures.pobj }),
    delFiltro: () => ({ id: fixtures.pobj }),
  };
  specs.procedimiento_insumos = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.pins }),
    insert: () => ({ procedimiento_id: C.procFx, insumo_id: fixtures.insumoRol.autor, cantidad: 1 }),
    update: { cantidad: 1 },
    updFiltro: () => ({ id: fixtures.pins }),
    delFiltro: () => ({ id: fixtures.pins }),
  };
  specs.procedimiento_reasignaciones = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.preasig }),
    insert: (rol) => ({ procedimiento_id: C.procFx, responsable_anterior_id: C.uid.autor, responsable_nuevo_id: C.uid.operario, reasignado_por_id: u(rol) }),
    update: { motivo: null },
    updFiltro: () => ({ id: fixtures.preasig }),
    delFiltro: () => ({ id: fixtures.preasig }),
  };

  // ---- Catálogos ------------------------------------------------------------------------------------------------
  specs.especies = catalogoSimple('especies');
  specs.contenedor = catalogoSimple('contenedor');
  specs.insumo = catalogoSimple('insumo', { tipo: 'otro' });
  specs.sustrato = catalogoSimple('sustrato');
  specs.variedades = {
    cols: 'id,nombre',
    selFiltro: () => ({ id: fixtures.variedad }),
    insert: (rol) => ({ especie_id: C.especieId, nombre: ins(rol), created_by: u(rol) }),
    limpiaInsert: borraPorNombre('variedades'),
    update: { nombre: tag('fx', '-variedad') },
    updFiltro: () => ({ id: fixtures.variedad }),
    delFiltro: () => ({ id: fixtures.variedad }),
  };

  // ---- Usuarios ----------------------------------------------------------------------------------------------------
  specs.perfiles = {
    cols: 'id,nombre',
    selFiltro: () => ({ id: C.uid.autor }),
    insert: async (rol) => ({ id: await fixtures.huerfano(rol), nombre: ins(rol), rol: 'admin', puede_ver_linaje: true }),
    update: { nombre: `aud-g10-autor-${S}@test.local` },
    updFiltro: () => ({ id: C.uid.autor }),
    fresh: async (rol) => ({ id: await mkUsuarioAuth(`del-${rol}`, true) }),
  };

  // ---- Chat ----------------------------------------------------------------------------------------------------------
  specs.chat_canales = {
    cols: 'id',
    selFiltro: () => ({ id: C.canalFx }),
    insert: () => ({ tipo: 'libre', entidad_nombre: ins('chat') }),
    update: { entidad_nombre: tag('fx', '-chat') },
    updFiltro: () => ({ id: C.canalFx }),
    delFiltro: () => ({ id: C.canalFx }),
  };
  specs.chat_canal_participantes = {
    cols: 'canal_id',
    selFiltro: () => ({ canal_id: C.canalFx }),
    insert: (rol) => ({ canal_id: C.canalFx, usuario_id: u(rol) }),
    update: { agregado_por: null },
    updFiltro: () => ({ canal_id: C.canalFx }),
    delFiltro: () => ({ canal_id: C.canalFx, usuario_id: C.uid.autor }),
  };
  specs.chat_mensajes = {
    cols: 'id',
    selFiltro: () => ({ id: C.msgFx }),
    insert: () => ({ canal_id: C.canalFx, posicion: 9999, autor_nombre: 'x', contenido: 'x', clave_envio: randomUUID() }),
    update: { contenido: 'AUD-G10' },
    updFiltro: () => ({ id: C.msgFx }),
    delFiltro: () => ({ id: C.msgFx }),
  };
  specs.chat_lecturas = {
    cols: 'canal_id',
    selFiltro: () => ({ canal_id: C.canalFx }),
    insert: (rol) => ({ canal_id: C.canalFx, usuario_id: u(rol), ultima_posicion: 0 }),
    update: { ultima_posicion: 0 },
    updFiltro: () => ({ canal_id: C.canalFx }),
    delFiltro: () => ({ canal_id: C.canalFx }),
  };
  specs.chat_menciones = {
    cols: 'mensaje_id',
    selFiltro: () => ({ usuario_id: C.uid.autor }),
    insert: (rol) => ({ mensaje_id: C.msgFx, usuario_id: u(rol), tipo: 'directa' }),
    update: { leida_at: null },
    updFiltro: () => ({ usuario_id: C.uid.autor }),
    delFiltro: () => ({ usuario_id: C.uid.autor }),
  };

  // ---- Notificaciones push --------------------------------------------------------------------------------------------
  specs.push_suscripcion = {
    cols: 'id',
    selFiltro: () => ({ usuario_id: C.uid.autor }),
    insert: (rol) => ({ usuario_id: u(rol), endpoint: `${PUSH_EP}ins-${rol}`, p256dh: PUSH_P256DH, auth: PUSH_AUTH }),
    update: { user_agent: 'AUD-G10' },
    updFiltro: () => ({ usuario_id: C.uid.autor }),
    fresh: async (rol) => ({ id: (await svcIns('push_suscripcion', { usuario_id: C.uid.autor, endpoint: `${PUSH_EP}del-${rol}`, p256dh: PUSH_P256DH, auth: PUSH_AUTH })).id as string }),
  };
  specs.push_envio = {
    cols: 'id',
    selFiltro: () => ({ usuario_id: C.uid.autor }),
    insert: (rol) => ({ mensaje_id: C.msgFx, usuario_id: u(rol) }),
    update: { ultimo_error: null },
    updFiltro: () => ({ usuario_id: C.uid.autor }),
    delFiltro: () => ({ usuario_id: C.uid.autor }),
  };

  // ---- EVECL -----------------------------------------------------------------------------------------------------------------
  specs.evecl_descriptor = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.edesc }),
    insert: (rol) => ({ nombre: ins(rol), tipo: 'valor', eje: 'calidad', orden: 999, activo: false }),
    limpiaInsert: borraPorNombre('evecl_descriptor'),
    update: { nombre: tag('fx', '-edesc') },
    updFiltro: () => ({ id: fixtures.edesc }),
    delFiltro: () => ({ id: fixtures.edesc }),
  };
  specs.evecl_descriptor_estado = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.edest }),
    insert: (rol) => ({ descriptor_id: fixtures.edescEstado, nota: 10 + ROLES.indexOf(rol), label: ins(rol), orden: 10 + ROLES.indexOf(rol) }),
    limpiaInsert: async () => {
      await C.svc.from('evecl_descriptor_estado').delete().like('label', `AUD-G10-${S}-ins-%`);
    },
    update: { label: tag('fx', '-edest') },
    updFiltro: () => ({ id: fixtures.edest }),
    delFiltro: () => ({ id: fixtures.edest }),
  };
  specs.evecl_ensayo = {
    cols: 'id',
    selFiltro: () => ({ id: C.ensayoFx }),
    insert: (rol) => ({ codigo_parcela: ins(rol), created_by: u(rol) }),
    limpiaInsert: async () => {
      await C.svc.from('evecl_ensayo').delete().like('codigo_parcela', `AUD-G10-${S}-ins-%`);
    },
    update: { notas: null },
    updFiltro: () => ({ id: C.ensayoFx }),
    delFiltro: () => ({ id: C.ensayoFx }),
  };
  specs.evecl_ficha = {
    cols: 'id',
    selFiltro: () => ({ id: C.fichaFx }),
    insert: (rol) => ({ ensayo_id: C.ensayoFx, variedad: ins(rol), numero_repeticion: 2 + ROLES.indexOf(rol), created_by: u(rol) }),
    limpiaInsert: async () => {
      await C.svc.from('evecl_ficha').delete().like('variedad', `AUD-G10-${S}-ins-%`);
    },
    update: { notas: null },
    updFiltro: () => ({ id: C.fichaFx }),
    delFiltro: () => ({ id: C.fichaFx }),
  };
  specs.evecl_respuesta = {
    cols: 'id',
    selFiltro: () => ({ id: fixtures.eresp }),
    insert: (rol) => ({ ficha_id: fixtures.fichaIns[rol], descriptor_id: fixtures.descValor, valor_numerico: 7 }),
    limpiaInsert: async () => {
      await C.svc.from('evecl_respuesta').delete().in('ficha_id', Object.values(fixtures.fichaIns));
    },
    update: { foto_path: null },
    updFiltro: () => ({ id: fixtures.eresp }),
    fresh: async (rol) => {
      const f = (await svcIns('evecl_ficha', { ensayo_id: C.ensayoFx, variedad: tag(rol, '-delresp'), numero_repeticion: 2 + ROLES.indexOf(rol), created_by: C.uid.autor })).id as number;
      const r = (await svcIns('evecl_respuesta', { ficha_id: f, descriptor_id: fixtures.descValor, valor_numerico: 7 })).id as number;
      return { id: r };
    },
  };

  // ---- Importador y vista -------------------------------------------------------------------------------------------------------
  specs.importacion_lote = {
    cols: 'id',
    selFiltro: () => ({ id: C.loteFx }),
    insert: (rol) => ({ created_by: u(rol), archivo_nombre: ins(rol), filas: [], filas_total: 0 }),
    update: { archivo_nombre: tag('fx', '-lote') },
    updFiltro: () => ({ id: C.loteFx }),
    delFiltro: () => ({ id: C.loteFx }),
  };
  specs.plantas_operativas = {
    cols: 'id,codigo_sistema',
    selFiltro: () => ({ id: C.cruce }),
    insert: (rol) => ({ codigo_sistema: ins(rol), especie_id: C.especieId }),
    update: { estado: 'evaluacion_anual' },
    updFiltro: () => ({ id: C.cruce }),
    delFiltro: () => ({ id: C.cruce }),
    denegados: ['42501', '55000'], // la vista no es auto-actualizable: 55000 "cannot insert into view"
  };

  return specs;
}

// ----------------------------------------------------------------------------
// Fixtures compartidos (se llenan en preparar())
// ----------------------------------------------------------------------------

interface Fixtures {
  audit: string | number;
  /** Fase 5: fila fija del historial de reactivaciones (la crea el admin por la RPC). */
  reactivacion: string;
  baja: string;
  indBaja: string;
  eRed: string;
  pcr: string;
  multisitio: string;
  pcult: string;
  smetrica: string;
  scat: string;
  rango: string;
  sector: string;
  sitio: string;
  indEmplazado: string;
  emplazamiento: string;
  clima: string;
  pobj: string;
  pins: string;
  preasig: string;
  variedad: string;
  archivo: string;
  edesc: number;
  edescEstado: number;
  edest: number;
  eresp: number;
  descValor: number;
  fichaIns: Record<string, number>;
  insumoRol: Record<string, string>;
  sustratoRol: Record<string, string>;
  tokensLinaje: string[];
  huerfano: (rol: string) => Promise<string>;
  [clave: string]: unknown;
}
const fixtures = {} as Fixtures;

let SPECS: Record<string, SpecTabla> = {};

// ============================================================================
// Preparación de datos
// ============================================================================

async function preparar(): Promise<void> {
  const creds = getLocalCreds();
  const svc = createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(creds.url, creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const mk = (nombre: string, rol: 'admin' | 'operario', linaje = false) =>
    crearUsuarioDePrueba(creds, svc, { email: `aud-g10-${nombre}-${S}@test.local`, rol, puedeVerLinaje: linaje });
  const [ad, op, au, li] = await Promise.all([mk('admin', 'admin'), mk('operario', 'operario'), mk('autor', 'operario'), mk('linaje', 'operario', true)]);
  usuariosCreados.push(ad.userId, op.userId, au.userId, li.userId);

  const { data: esp } = await svc.from('especies').select('id').eq('nombre', 'Arándano').single();
  const { data: ver } = await svc.from('scoring_version').select('id').eq('estado', 'activa').limit(1).single();

  C = {
    creds,
    svc,
    cli: { anon, operario: op.client, autor: au.client, linaje: li.client, admin: ad.client },
    uid: { anon: ZERO, operario: op.userId, autor: au.userId, linaje: li.userId, admin: ad.userId },
    especieId: esp!.id as string,
    versionActiva: ver!.id as string,
  } as Ctx;

  const autor = C.uid.autor;
  const r4 = ['operario', 'autor', 'linaje', 'admin'] as const;

  // cruces
  C.cruce = await mkCruce('A', 'evaluacion_anual');
  C.cruceTras = await mkCruce('T', 'trasplante');
  C.cruceMulti = await mkCruce('M', 'traslado_destino');
  C.cruceInd = await mkCruce('I', 'trasplante');
  C.individuo = await mkInd(C.cruce, autor);
  C.rondaFx = await mkRonda(C.individuo, 1);
  C.evalFx = (await svcIns('evaluaciones', { ronda_id: C.rondaFx, fecha: '2026-10-01', created_by: autor, estado: 'borrador' })).id as string;

  C.indRol = {};
  C.rondaRol = {};
  C.indRondaIns = {};
  for (const r of r4) {
    C.indRol[r] = await mkInd(C.cruce, autor);
    C.rondaRol[r] = await mkRonda(C.indRol[r], 1);
    C.indRondaIns[r] = await mkInd(C.cruce, autor);
  }

  // Linaje con marcas reconocibles: se escribe por el camino legítimo (RPC del admin) y los textos
  // congelados (mama/papa) con service_role. Sirve para el escáner de fugas de linaje.
  {
    const vm = (await svcIns('variedades', { especie_id: C.especieId, nombre: tag('fx', '-varmama'), created_by: autor })).id as string;
    const vp = (await svcIns('variedades', { especie_id: C.especieId, nombre: tag('fx', '-varpapa'), created_by: autor })).id as string;
    // [0..2] textos del cruce; [3..4] ids de variedad; [5..6] nombres de variedad (los dos últimos grupos aparecen legítimamente en el catálogo `variedades`)
    fixtures.tokensLinaje = [`AUD-G10-LINAJE-${S}`, `AUD-G10-MAMA-${S}`, `AUD-G10-PAPA-${S}`, vm, vp, tag('fx', '-varmama'), tag('fx', '-varpapa')];
    const w = await C.cli.admin.rpc('actualizar_linaje', { p_planta_id: C.cruce, p_cruzamiento: fixtures.tokensLinaje[0], p_mama_id: vm, p_papa_id: vp });
    if (w.error) throw new Error(`fixture linaje: ${w.error.message}`);
    await C.svc.from('plantas').update({ mama: fixtures.tokensLinaje[1], papa: fixtures.tokensLinaje[2] }).eq('id', C.cruce);
  }
  fixtures.audit = (await svcIns('audit_log', { accion: 'aud_g10_fixture', planta_id: C.cruce })).id as number;
  fixtures.indBaja = await mkInd(C.cruce, autor);
  fixtures.baja = (await svcIns('baja_motivo', { individuo_id: fixtures.indBaja, criterio: 'sanidad', created_by: autor })).id as string;
  fixtures.eRed = (await svcIns('evaluacion_reducida', { individuo_id: C.individuo, fase: 'trasplante', created_by: autor })).id as string;
  fixtures.pcr = (await svcIns('pcr_analisis', { ronda_id: C.rondaFx, realizado: false, created_by: autor })).id as string;
  fixtures.multisitio = (await svcIns('multisitio', { individuo_id: C.individuo, created_by: autor })).id as string;
  fixtures.pcult = (await svcIns('procedimiento_cultivo', { planta_id: C.cruce, tipo: 'poda', fecha: '2026-10-01', created_by: autor })).id as string;

  // hijos del cruce con created_by = autor
  fixtures.fx_polinizacion_evento = (await svcIns('polinizacion_evento', { planta_id: C.cruce, fecha: '2026-10-01', n_flores_cruzadas: 1, created_by: autor })).id;
  fixtures.fx_cosecha_fruto = (await svcIns('cosecha_fruto', { planta_id: C.cruce, cantidad_semillas: 5, created_by: autor })).id;
  fixtures.fx_germinacion_evento = (await svcIns('germinacion_evento', { planta_id: C.cruce, fecha: '2026-10-01', cantidad_nueva: 1, created_by: autor })).id;
  fixtures.fx_registros_evento = (await svcIns('registros_evento', { planta_id: C.cruce, tipo_evento: 'otro', notas: 'AUD-G10 fx', created_by: autor })).id;
  C.registroFx = fixtures.fx_registros_evento as string;
  fixtures.archivo = (await svcIns('evento_archivos', { registro_id: C.registroFx, storage_path: `aud-g10-${S}/fx.jpg`, tipo: 'foto', created_by: autor })).id as string;

  // catálogos
  fixtures.insumoRol = {};
  fixtures.sustratoRol = {};
  for (const r of ROLES) {
    fixtures.insumoRol[r] = (await svcIns('insumo', { nombre: tag(r, '-insumo'), tipo: 'otro' })).id as string;
    fixtures.sustratoRol[r] = (await svcIns('sustrato', { nombre: tag(r, '-sustrato') })).id as string;
  }
  await C.svc.from('plantas_insumo').insert({ planta_id: C.cruce, insumo_id: fixtures.insumoRol.anon });
  await C.svc.from('plantas_sustrato').insert({ planta_id: C.cruce, sustrato_id: fixtures.sustratoRol.anon, porcentaje: 10 });
  fixtures.variedad = (await svcIns('variedades', { especie_id: C.especieId, nombre: tag('fx', '-variedad'), created_by: autor })).id as string;
  // fixtures de catálogos simples: se asignan por el setter oculto de catalogoSimple
  SPECS = crearSpecs();
  for (const t of ['especies', 'contenedor', 'insumo', 'sustrato']) {
    const extra = t === 'insumo' ? { tipo: 'otro' } : {};
    const id = (await svcIns(t, { nombre: tag('fx', `-${t}`), ...extra })).id as string;
    (SPECS[t] as unknown as { __setFx: (v: string) => void }).__setFx(id);
  }

  // territorio
  C.predioFx = (await svcIns('predio', { nombre: tag('fx', '-predio') })).id as string;
  fixtures.sector = ((await C.svc.from('sector').select('id').eq('predio_id', C.predioFx).limit(1).single()).data as Fila).id as string;
  fixtures.sitio = (await svcIns('sitio', { nombre: tag('fx', '-sitio') })).id as string;
  // Las sondas de lectura de emplazamiento_individuo, emplazamiento_coordenada y predio_clima_mensual
  // esperan ver una fila: la base recién reiniciada no trae ninguna, así que se crean aquí. Se usa un
  // individuo aparte (con un emplazamiento vigente) para no interferir con las sondas de INSERT.
  fixtures.indEmplazado = await mkInd(C.cruce, autor);
  fixtures.emplazamiento = (await svcIns('emplazamiento_individuo', {
    individuo_id: fixtures.indEmplazado, sector_id: fixtures.sector, fecha_inicio: '2026-09-01', created_by: autor,
  })).id as string;
  await svcIns('emplazamiento_coordenada', { emplazamiento_id: fixtures.emplazamiento, latitud: -35.4, longitud: -71.6, created_by: autor }, 'emplazamiento_id');
  fixtures.clima = (await svcIns('predio_clima_mensual', { predio_id: C.predioFx, anio: 2026, mes: 6 })).id as string;

  // scoring
  C.svFx = (await svcIns('scoring_version', { nombre: tag('fx', '-sv'), vigente_desde: '2030-01-01' })).id as string;
  // versión SIN métricas: si activar_version_scoring no validara el rol, fallaría por "sin métricas" en vez de activar algo
  C.svVacia = (await svcIns('scoring_version', { nombre: tag('fx', '-svvacia'), vigente_desde: '2030-01-01' })).id as string;
  fixtures.smetrica = (await svcIns('scoring_metrica', {
    scoring_version_id: C.svFx, metrica: 'brix', peso: 1, metodo_normalizacion: 'escala', minimo_normalizacion: 0, maximo_normalizacion: 30, orden: 1, categoria: 'fruto_calidad',
  })).id as string;
  fixtures.scat = (await svcIns('scoring_categoria_peso', { scoring_version_id: C.svFx, categoria: 'fruto_calidad', peso: 1 })).id as string;
  // esquema_campo_especie no da escritura a service_role (como las demás tablas recientes): la fila fija la crea el admin.
  { const { error: eCampo } = await C.cli.admin.from('esquema_campo_especie').insert({ fase: 'evaluacion_anual', clave: 'bloom', especie_id: C.especieId, activo: false }); if (eCampo) throw new Error(`fixture esquema_campo_especie: ${eCampo.message}`); }
  // Fase 5 (G4): una planta dada de baja y reactivada por el admin (única vía de escritura del historial).
  {
    const indReactivado = await mkInd(C.cruce, autor);
    const { error: eBaja } = await C.svc.from('individuos').update({ estado_vital: 'muerto', fecha_baja: '2026-10-01' }).eq('id', indReactivado);
    if (eBaja) throw new Error(`fixture baja para reactivar: ${eBaja.message}`);
    const { error: eReact } = await C.cli.admin.rpc('reactivar_individuo', { p_individuo_id: indReactivado, p_motivo: tag('fx', '-reactivacion') });
    if (eReact) throw new Error(`fixture reactivar_individuo: ${eReact.message}`);
    const { data: fila } = await C.cli.admin.from('reactivacion_individuo').select('id').eq('individuo_id', indReactivado).single();
    fixtures.reactivacion = (fila as Fila).id as string;
  }
  // Fase 5 (G15): una evaluación cerrada del autor y su pedido de corrección (única vía: la RPC, como autor).
  {
    fixtures.indPedido = await mkInd(C.cruce, autor);
    const ronda = await mkRonda(fixtures.indPedido, 1);
    fixtures.evalPedido = (await svcIns('evaluaciones', { ronda_id: ronda, fecha: '2026-10-01', created_by: autor, estado: 'completa', cantidad_frutos: 10, peso_total_g: 120 })).id as string;
    const { data: pedido, error: ePedido } = await C.cli.autor.rpc('pedir_correccion', { p_evaluacion_id: fixtures.evalPedido, p_nota: tag('fx', '-pedido') });
    if (ePedido || !pedido) throw new Error(`fixture pedir_correccion: ${ePedido?.message}`);
    fixtures.pedidoCorreccion = pedido as string;
  }
  {
    const { data: fila, error: eEdad } = await C.cli.admin.from('scoring_metrica_rango_edad').select('id').order('edad_desde').limit(1).single();
    if (eEdad || !fila) throw new Error(`fixture scoring_metrica_rango_edad: ${eEdad?.message}`);
    fixtures.rangoEdad = (fila as Fila).id as string;
  }
  fixtures.rango = (await svcIns('rango_referencia', { metrica: 'brix', vigente_desde: '2030-01-01', activo: false, nota: tag('fx', '-rango') })).id as string;
  C.snapFx = (await svcIns('ranking_snapshot', {
    nombre: tag('fx', '-snap'), alcance: 'cruzamiento', scoring_version_id: C.versionActiva, especie_id: C.especieId,
    planta_id: C.cruce, poblacion_comparada: 1, criterios: {}, created_by: C.uid.admin,
  })).id as string;
  // Fase 2: protocolo de la ronda 2 del cruce fixture, por la única vía permitida (RPC de admin).
  const { data: protocolo, error: eProtocolo } = await C.cli.admin.rpc('definir_protocolo_ronda', {
    p_planta_id: C.cruce, p_tipo_ronda: 'anual', p_numero_ronda: 2, p_nombre: tag('fx', '-protocolo'), p_descriptores: { brotacion: 'opcional' },
  });
  if (eProtocolo) throw eProtocolo;
  fixtures.protocolo = protocolo as string;
  await svcIns('ranking_snapshot_resultado', { snapshot_id: C.snapFx, individuo_id: C.individuo, codigo_display: 'x', evaluacion_id: C.evalFx, posicion: 1, puntaje: 1, detalle: {} }, 'snapshot_id');

  // procedimientos
  C.procFx = (await svcIns('procedimientos', { nombre: tag('fx', '-proc'), tipo: 'poda', fecha_inicio: '2026-11-01', responsable_id: autor, created_by: autor })).id as string;
  fixtures.pobj = (await svcIns('procedimiento_objetivos', { procedimiento_id: C.procFx, tipo: 'cruzamiento', planta_id: C.cruce })).id as string;
  fixtures.pins = (await svcIns('procedimiento_insumos', { procedimiento_id: C.procFx, insumo_id: fixtures.insumoRol.autor, cantidad: 1 })).id as string;
  fixtures.preasig = (await svcIns('procedimiento_reasignaciones', {
    procedimiento_id: C.procFx, responsable_anterior_id: autor, responsable_nuevo_id: C.uid.operario, reasignado_por_id: C.uid.admin,
  })).id as string;

  // importador
  C.loteFx = (await svcIns('importacion_lote', { created_by: C.uid.admin, archivo_nombre: tag('fx', '-lote'), filas: [], filas_total: 0 })).id as string;

  // perfiles huérfanos para las sondas de INSERT
  const huerfanos: Record<string, string> = {};
  fixtures.huerfano = async (rol: string) => (huerfanos[rol] ??= await mkUsuarioAuth(`huerfano-${rol}`, false));

  // chat: canal libre del admin con el autor como participante, un mensaje del autor,
  // una mención al autor (mensaje del admin) y lecturas de ambos
  {
    const { data: canal, error } = await C.cli.admin.rpc('crear_canal_libre', { p_nombre: tag('fx', '-chat'), p_participantes: [autor] });
    if (error) throw new Error(`fixture canal: ${error.message}`);
    C.canalFx = canal as string;
    const m1 = await C.cli.autor.rpc('enviar_mensaje_chat', { p_canal_id: C.canalFx, p_contenido: 'AUD-G10 fx', p_clave_envio: randomUUID(), p_mencionados: [], p_mencionar_todos: false });
    if (m1.error) throw new Error(`fixture mensaje: ${m1.error.message}`);
    C.msgFx = (m1.data as { id: string }).id;
    const m2 = await C.cli.admin.rpc('enviar_mensaje_chat', { p_canal_id: C.canalFx, p_contenido: 'AUD-G10 menciona', p_clave_envio: randomUUID(), p_mencionados: [autor], p_mencionar_todos: false });
    if (m2.error) throw new Error(`fixture mensaje 2: ${m2.error.message}`);
    await C.cli.autor.rpc('marcar_chat_leido', { p_canal_id: C.canalFx, p_posicion: 1 });
    await C.cli.admin.rpc('marcar_chat_leido', { p_canal_id: C.canalFx, p_posicion: 1 });
    // push: la mención de arriba dejó el push_envio del autor; acá su suscripción (después, para no despachar nada)
    await svcIns('push_suscripcion', { usuario_id: autor, endpoint: `${PUSH_EP}fx`, p256dh: PUSH_P256DH, auth: PUSH_AUTH });
  }

  // EVECL
  {
    const e = await C.cli.autor.rpc('evecl_guardar_ensayo', { p_codigo_parcela: tag('fx', '-ensayo') });
    if (e.error) throw new Error(`fixture ensayo: ${e.error.message}`);
    C.ensayoFx = e.data as number;
    const { data: cat } = await C.cli.autor.rpc('evecl_obtener_catalogo');
    const desc = (cat as Array<{ id: number; codigo_upov: number | null; tipo: string }>) ?? [];
    fixtures.descValor = desc.find((d) => d.tipo === 'valor')!.id;
    const f = await guardarFichaEvecl(C.cli.autor, { p_ensayo_id: C.ensayoFx, p_variedad: tag('fx', '-ficha'), p_numero_repeticion: 1, p_respuestas: [{ descriptor_id: fixtures.descValor, valor_numerico: 7 }] });
    if (f.error) throw new Error(`fixture ficha: ${f.error.message}`);
    C.fichaFx = f.data as number;
    fixtures.eresp = ((await C.svc.from('evecl_respuesta').select('id').eq('ficha_id', C.fichaFx).limit(1).single()).data as Fila).id as number;
    fixtures.edesc = (await svcIns('evecl_descriptor', { nombre: tag('fx', '-edesc'), tipo: 'valor', eje: 'calidad', orden: 999, activo: false })).id as number;
    fixtures.edescEstado = (await svcIns('evecl_descriptor', { nombre: tag('fx', '-edescE'), tipo: 'estado', eje: 'calidad', orden: 998, activo: false })).id as number;
    fixtures.edest = (await svcIns('evecl_descriptor_estado', { descriptor_id: fixtures.edescEstado, nota: 1, label: tag('fx', '-edest'), orden: 1 })).id as number;
    fixtures.fichaIns = {};
    for (const r of ROLES) {
      fixtures.fichaIns[r] = (await svcIns('evecl_ficha', { ensayo_id: C.ensayoFx, variedad: tag(r, '-ficharesp'), numero_repeticion: 2 + ROLES.indexOf(r), created_by: autor })).id as number;
    }
  }
}

// ============================================================================
// Ejecución de la matriz de tablas
// ============================================================================


async function ejecutarTablas(): Promise<void> {
  const tablas = Object.keys(TABLAS).filter((t) => !DESARROLLO || SOLO.has(t) || SOLO.has('tablas'));
  for (const tabla of tablas) {
    const spec = SPECS[tabla];
    if (!spec) throw new Error(`sin especificación de sondas para ${tabla}`);
    const deneg = spec.denegados ?? ['42501'];
    // SELECT
    for (const rol of ROLES) {
      const m = await sondaSelect(C.cli[rol], tabla, spec.cols, spec.selFiltro?.());
      registrar(`${tabla}.select.${rol}`, m);
    }
    // INSERT
    for (const rol of ROLES) {
      let m: Medicion;
      try {
        const payload = spec.insert ? await spec.insert(rol) : {};
        m = await sondaInsert(C.cli[rol], tabla, payload, deneg);
      } catch (e) {
        m = { real: 'indeterminado', mensaje: String(e) };
      }
      registrar(`${tabla}.insert.${rol}`, m);
    }
    if (spec.limpiaInsert) await spec.limpiaInsert().catch(() => undefined);
    // UPDATE
    for (const rol of ROLES) {
      const m = spec.update
        ? await sondaUpdate(C.cli[rol], tabla, spec.update, spec.updFiltro!(), deneg)
        : ({ real: 'indeterminado', mensaje: 'sin sonda' } as Medicion);
      registrar(`${tabla}.update.${rol}`, m);
    }
    // DELETE
    const frescas: Filtro[] = [];
    for (const rol of ROLES) {
      let filtro: Filtro;
      try {
        filtro = spec.fresh ? await spec.fresh(rol) : spec.delFiltro!();
      } catch (e) {
        registrar(`${tabla}.delete.${rol}`, { real: 'indeterminado', mensaje: `fixture: ${String(e)}` });
        continue;
      }
      if (spec.fresh) frescas.push(filtro);
      registrar(`${tabla}.delete.${rol}`, await sondaDelete(C.cli[rol], tabla, filtro, deneg));
    }
    for (const f of frescas) await C.svc.from(tabla).delete().match(f);
  }
}

// ============================================================================
// Catálogo real
// ============================================================================

interface TablaCat {
  tabla: string;
  tipo: string;
  rls: boolean;
  anon: { select: boolean; insert: boolean; update: boolean; delete: boolean };
  auth: { select: boolean; insert: boolean; update: boolean; delete: boolean };
}
interface FuncionCat {
  nombre: string;
  args: string;
  definer: boolean;
  anon: boolean;
  auth: boolean;
  svc: boolean;
}
let catTablas: TablaCat[] = [];
let catFunciones: FuncionCat[] = [];
let catBuckets: Array<{ id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null }> = [];

function leerCatalogo(): void {
  const filas = sqlJson<{
    tabla: string; tipo: string; rls: boolean;
    a_s: boolean; a_i: boolean; a_u: boolean; a_d: boolean;
    u_s: boolean; u_i: boolean; u_u: boolean; u_d: boolean;
  }>(`select c.relname as tabla, c.relkind as tipo, c.relrowsecurity as rls,
        has_any_column_privilege('anon', c.oid, 'SELECT') a_s, has_any_column_privilege('anon', c.oid, 'INSERT') a_i,
        has_any_column_privilege('anon', c.oid, 'UPDATE') a_u, has_table_privilege('anon', c.oid, 'DELETE') a_d,
        has_any_column_privilege('authenticated', c.oid, 'SELECT') u_s, has_any_column_privilege('authenticated', c.oid, 'INSERT') u_i,
        has_any_column_privilege('authenticated', c.oid, 'UPDATE') u_u, has_table_privilege('authenticated', c.oid, 'DELETE') u_d
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','v','m','p','f') order by 1`);
  catTablas = filas.map((f) => ({
    tabla: f.tabla,
    tipo: f.tipo,
    rls: f.rls,
    anon: { select: f.a_s, insert: f.a_i, update: f.a_u, delete: f.a_d },
    auth: { select: f.u_s, insert: f.u_i, update: f.u_u, delete: f.u_d },
  }));
  catFunciones = sqlJson<{ nombre: string; args: string; definer: boolean; anon: boolean; auth: boolean; svc: boolean }>(
    `select p.proname as nombre, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and p.prorettype <> 'trigger'::regtype
      order by 1, 2`,
  );
  catBuckets = sqlJson(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`);
}

// ============================================================================
// Variantes (columnas, identidad, embeds, soft delete)
// ============================================================================

interface Variante {
  id: string;
  descripcion: string;
  esperado: Record<Rol, Real>;
  ejecutar: (rol: Rol) => Promise<Medicion>;
  /** Si se indica, la variante solo se ejecuta (y solo tiene `it`) para esos roles. */
  soloRoles?: readonly Rol[];
}
const todos = (r: Real): Record<Rol, Real> => ({ anon: r, operario: r, autor: r, linaje: r, admin: r });
const porRol = (e: Partial<Record<Rol, Real>>, base: Real = 'denegado'): Record<Rol, Real> => ({ ...todos(base), ...e });
/** Permitido a los 4 autenticados; anon denegado. */
const soloAut = (): Record<Rol, Real> => ({ anon: 'denegado', operario: 'permitido', autor: 'permitido', linaje: 'permitido', admin: 'permitido' });

const COLS_LINAJE = ['cruzamiento', 'mama', 'papa', 'mama_id', 'papa_id'];
const COLS_PLANTAS_NO_ACTUALIZABLES: Array<[string, unknown]> = [
  ['es_prueba', true], ['cruzamiento', null], ['mama', null], ['papa', null], ['mama_id', null], ['papa_id', null],
  ['codigo_sistema', 'X'], ['especie_id', ZERO], ['eliminado_at', null], ['id', ZERO], ['created_at', '2026-01-01T00:00:00Z'],
  ['updated_at', '2026-01-01T00:00:00Z'], ['genetica_a', null], ['genetica_b', null], ['numero_notion_legacy', null],
  ['fecha_cambio_estado', null], ['lote_importacion_id', null],
];
const COLS_PLANTAS_ACTUALIZABLES: Array<[string, unknown]> = [
  ['contenedor_id', null], ['escarificacion_duracion_dias', null], ['escarificacion_subtipo', null], ['estado', 'evaluacion_anual'],
  ['fecha_cosecha', null], ['fecha_polinizacion', null], ['n_flores_cruzadas', null], ['n_semillas', null], ['predio_id', null], ['semillas_sembradas', null],
];

function crearVariantes(): Variante[] {
  const v: Variante[] = [];
  const u = (rol: Rol): string => (rol === 'anon' ? ZERO : C.uid[rol]);

  // ---- plantas: linaje denegado por columna, select=*, embeds, filtros y orden -------------------
  for (const col of COLS_LINAJE) {
    v.push({
      id: `plantas.select_${col}`,
      descripcion: `select=${col} (columna revocada)`,
      esperado: todos('denegado'),
      ejecutar: (rol) => sondaSelect(C.cli[rol], 'plantas', `id,${col}`, { id: C.cruce }),
    });
  }
  v.push({
    id: 'plantas.select_estrella',
    descripcion: 'select=* expande a las columnas revocadas',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaSelect(C.cli[rol], 'plantas', '*', { id: C.cruce }),
  });
  v.push({
    id: 'plantas.embed_desde_polinizacion',
    descripcion: 'polinizacion_evento?select=*,plantas(*)',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaSelect(C.cli[rol], 'polinizacion_evento', '*,plantas(*)', { planta_id: C.cruce }),
  });
  v.push({
    id: 'plantas.embed_desde_individuos',
    descripcion: 'individuos?select=id,plantas(cruzamiento,mama,papa)',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaSelect(C.cli[rol], 'individuos', 'id,plantas(cruzamiento,mama,papa)', { id: C.individuo }),
  });
  v.push({
    id: 'plantas.embed_desde_registros',
    descripcion: 'registros_evento?select=id,plantas(*)',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaSelect(C.cli[rol], 'registros_evento', 'id,plantas(*)', { planta_id: C.cruce }),
  });
  v.push({
    id: 'plantas.embed_desde_evaluaciones_anidado',
    descripcion: 'ronda_evaluacion_anual?select=id,individuos(planta_id,plantas(mama_id,papa_id))',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaSelect(C.cli[rol], 'ronda_evaluacion_anual', 'id,individuos(planta_id,plantas(mama_id,papa_id))', { id: C.rondaFx }),
  });
  for (const col of ['cruzamiento', 'mama_id', 'papa']) {
    v.push({
      id: `plantas.filtro_${col}`,
      descripcion: `filtrar por ${col} (oráculo de existencia)`,
      esperado: todos('denegado'),
      ejecutar: async (rol) => {
        const { data, error } = await C.cli[rol].from('plantas').select('id').not(col, 'is', null).limit(1);
        if (error) return { real: 'denegado', codigo: error.code, mensaje: error.message };
        return { real: (data ?? []).length > 0 ? 'permitido' : 'permitido_sin_efecto' };
      },
    });
    v.push({
      id: `plantas.orden_${col}`,
      descripcion: `ordenar por ${col} (oráculo de orden)`,
      esperado: todos('denegado'),
      ejecutar: async (rol) => {
        const { data, error } = await C.cli[rol].from('plantas').select('id').order(col).limit(1);
        if (error) return { real: 'denegado', codigo: error.code, mensaje: error.message };
        return { real: (data ?? []).length > 0 ? 'permitido' : 'permitido_sin_efecto' };
      },
    });
  }
  v.push({
    id: 'plantas_operativas.select_estrella_sin_linaje',
    descripcion: 'la vista plantas_operativas devuelve filas pero ninguna columna de linaje',
    esperado: soloAut(),
    ejecutar: async (rol) => {
      const { data, error } = await C.cli[rol].from('plantas_operativas').select('*').eq('id', C.cruce).limit(1);
      if (error) return { real: 'denegado', codigo: error.code, mensaje: error.message };
      const fila = (data ?? [])[0] as Fila | undefined;
      if (!fila) return { real: 'permitido_sin_efecto' };
      const fuga = COLS_LINAJE.filter((c) => c in fila);
      return fuga.length ? { real: 'permitido', mensaje: `FUGA: ${fuga.join(',')}` } : { real: 'permitido' };
    },
  });
  v.push({
    id: 'plantas_operativas.select_cruzamiento',
    descripcion: 'plantas_operativas?select=cruzamiento (la columna no existe en la vista)',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaSelect(C.cli[rol], 'plantas_operativas', 'id,cruzamiento', { id: C.cruce }),
  });

  // ---- plantas: UPDATE por columna ----------------------------------------------------------------------------
  for (const [col, valor] of COLS_PLANTAS_NO_ACTUALIZABLES) {
    v.push({
      id: `plantas.update_${col}`,
      descripcion: `UPDATE de ${col} (sin grant de columna)`,
      esperado: todos('denegado'),
      ejecutar: (rol) => sondaUpdate(C.cli[rol], 'plantas', { [col]: valor }, { id: C.cruce }),
    });
  }
  for (const [col, valor] of COLS_PLANTAS_ACTUALIZABLES) {
    v.push({
      id: `plantas.update_${col}_ok`,
      descripcion: `UPDATE de ${col} (columna de fase, sin cambio real)`,
      esperado: soloAut(),
      ejecutar: (rol) => sondaUpdate(C.cli[rol], 'plantas', { [col]: valor }, { id: C.cruce }),
    });
  }
  v.push({
    id: 'plantas.insert_con_linaje_y_es_prueba_falsa',
    descripcion: 'INSERT de un cruce con linaje en texto y es_prueba=false',
    esperado: porRol({ admin: 'permitido' }),
    ejecutar: async (rol) => {
      const m = await sondaInsert(C.cli[rol], 'plantas', {
        codigo_sistema: `AUD-G10-${S}-ins-v-${rol}`, especie_id: C.especieId, es_prueba: false, cruzamiento: 'A x B', mama: 'A', papa: 'B',
      });
      await C.svc.from('plantas').delete().eq('codigo_sistema', `AUD-G10-${S}-ins-v-${rol}`);
      return m;
    },
  });

  // ---- individuos: identidad inmutable, baja solo por RPC -----------------------------------------------------------
  const ident = (col: string, valor: () => unknown): Variante => ({
    id: `individuos.update_${col}`,
    descripcion: `UPDATE de ${col} (identidad del individuo)`,
    // autor/admin pasan RLS y el trigger proteger_identidad_individuo lo niega; el resto no ve la fila.
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto' }),
    ejecutar: (rol) => sondaUpdate(C.cli[rol], 'individuos', { [col]: valor() }, { id: C.individuo }, ['42501', '23514']),
  });
  v.push(ident('id', () => randomUUID()));
  v.push(ident('planta_id', () => C.cruceInd));
  v.push(ident('codigo_display', () => 'AUD-G10-X'));
  v.push(ident('fecha_individualizacion', () => '2020-01-01'));
  v.push({
    id: 'individuos.update_clon_de_id',
    descripcion: 'UPDATE de clon_de_id después del alta (A1-G4-06: debería ser inmutable)',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto' }),
    ejecutar: async (rol) => {
      const otro = await mkInd(C.cruce, C.uid.autor);
      const m = await sondaUpdate(C.cli[rol], 'individuos', { clon_de_id: otro }, { id: C.individuo }, ['42501', '23514']);
      await C.svc.from('individuos').update({ clon_de_id: null }).eq('id', C.individuo);
      return m;
    },
  });
  v.push({
    id: 'individuos.update_created_by',
    descripcion: 'UPDATE de created_by (traspasar la autoría)',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto' }),
    ejecutar: async (rol) => {
      const m = await sondaUpdate(C.cli[rol], 'individuos', { created_by: C.uid.operario }, { id: C.individuo }, ['42501', '23514']);
      await C.svc.from('individuos').update({ created_by: C.uid.autor }).eq('id', C.individuo);
      return m;
    },
  });
  v.push({
    id: 'individuos.update_created_at',
    descripcion: 'UPDATE de created_at (A1-G4-06: debería ser inmutable)',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto' }),
    ejecutar: async (rol) => {
      const antes = ((await C.svc.from('individuos').select('created_at').eq('id', C.individuo).single()).data as Fila).created_at as string;
      const m = await sondaUpdate(C.cli[rol], 'individuos', { created_at: '2020-01-01T00:00:00Z' }, { id: C.individuo }, ['42501', '23514']);
      await C.svc.from('individuos').update({ created_at: antes }).eq('id', C.individuo);
      return m;
    },
  });
  for (const col of ['estado_vital', 'fecha_baja']) {
    v.push({
      id: `individuos.update_${col}`,
      descripcion: `UPDATE directo de ${col}: la baja solo existe por RPC`,
      esperado: todos('denegado'),
      ejecutar: (rol) => sondaUpdate(C.cli[rol], 'individuos', { [col]: col === 'estado_vital' ? 'muerto' : '2026-10-01' }, { id: C.individuo }),
    });
  }
  v.push({
    id: 'individuos.insert_created_by_ajeno',
    descripcion: 'INSERT a nombre de otro usuario (created_by distinto de auth.uid())',
    esperado: todos('denegado'),
    ejecutar: async (rol) => {
      const ajeno = rol === 'admin' ? C.uid.autor : C.uid.admin;
      const m = await sondaInsert(C.cli[rol], 'individuos', { planta_id: C.cruceInd, codigo_display: '', created_by: ajeno }, ['42501']);
      if (m.real === 'permitido') await C.svc.from('individuos').delete().eq('planta_id', C.cruceInd);
      return m;
    },
  });
  v.push({
    id: 'individuos.insert_estado_vital_muerto',
    descripcion: 'INSERT de un individuo ya muerto (estado_vital no está en el grant de INSERT)',
    esperado: todos('denegado'),
    ejecutar: async (rol) => {
      const m = await sondaInsert(C.cli[rol], 'individuos', { planta_id: C.cruceInd, codigo_display: '', created_by: u(rol), estado_vital: 'muerto', fecha_baja: '2026-10-01' }, ['42501']);
      if (m.real === 'permitido') await C.svc.from('individuos').delete().eq('planta_id', C.cruceInd);
      return m;
    },
  });

  // ---- emplazamiento_individuo: referencia_operativa solo por RPC -----------------------------------------------------
  v.push({
    id: 'emplazamiento_individuo.select_referencia_operativa',
    descripcion: 'select de referencia_operativa (columna sin grant, ni siquiera admin)',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaSelect(C.cli[rol], 'emplazamiento_individuo', 'id,referencia_operativa'),
  });
  v.push({
    id: 'emplazamiento_individuo.select_estrella',
    descripcion: 'select=* incluye la columna sin grant',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaSelect(C.cli[rol], 'emplazamiento_individuo', '*'),
  });

  // ---- perfiles: rol, permiso de linaje, id ------------------------------------------------------------------------------
  v.push({
    id: 'perfiles.update_propio_rol_admin',
    descripcion: 'cada uno intenta ponerse rol=admin en su propio perfil (para admin es un no-op)',
    esperado: porRol({ admin: 'permitido' }),
    ejecutar: (rol) => sondaUpdate(C.cli[rol], 'perfiles', { rol: 'admin' }, { id: u(rol) }),
  });
  v.push({
    id: 'perfiles.update_propio_puede_ver_linaje',
    descripcion: 'cada uno intenta ponerse puede_ver_linaje=true (linaje ya lo tiene: no-op; admin sí puede)',
    esperado: porRol({ linaje: 'permitido', admin: 'permitido' }),
    ejecutar: async (rol) => {
      const m = await sondaUpdate(C.cli[rol], 'perfiles', { puede_ver_linaje: true }, { id: u(rol) });
      if (rol === 'admin') await C.svc.from('perfiles').update({ puede_ver_linaje: false }).eq('id', C.uid.admin);
      return m;
    },
  });
  v.push({
    id: 'perfiles.update_ajeno_rol',
    descripcion: 'UPDATE de rol=operario sobre el perfil del autor (para el autor y el admin es un no-op)',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto', autor: 'permitido', admin: 'permitido' }),
    ejecutar: (rol) => sondaUpdate(C.cli[rol], 'perfiles', { rol: 'operario' }, { id: C.uid.autor }),
  });
  v.push({
    id: 'perfiles.update_propio_id',
    descripcion: 'cambiar el id del propio perfil',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaUpdate(C.cli[rol], 'perfiles', { id: randomUUID() }, { id: u(rol) }, ['42501', '23503', '23505']),
  });
  v.push({
    id: 'perfiles.select_todos_listado',
    descripcion: 'listar perfiles: un operario solo ve el propio; el admin ve todos (más de una fila)',
    esperado: porRol({ operario: 'permitido_sin_efecto', autor: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto', admin: 'permitido' }),
    ejecutar: async (rol) => {
      const { data, error } = await C.cli[rol].from('perfiles').select('id').limit(5);
      if (error) return { real: 'denegado', codigo: error.code, mensaje: error.message };
      // "sin efecto" = solo ve el propio perfil
      return { real: (data ?? []).length > 1 ? 'permitido' : 'permitido_sin_efecto', mensaje: `${(data ?? []).length} filas` };
    },
  });

  // ---- registros_evento: soft delete solo admin ---------------------------------------------------------------------------------
  v.push({
    id: 'registros_evento.update_eliminado_at',
    descripcion: 'soft delete (eliminado_at) de un evento propio: el trigger lo reserva al admin',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto', autor: 'denegado', admin: 'permitido' }),
    ejecutar: async (rol) => {
      const f = (await svcIns('registros_evento', { planta_id: C.cruce, tipo_evento: 'otro', notas: tag(rol, '-soft'), created_by: C.uid.autor })).id as string;
      const m = await sondaUpdate(C.cli[rol], 'registros_evento', { eliminado_at: new Date().toISOString() }, { id: f }, ['42501']);
      await C.svc.from('registros_evento').delete().eq('id', f);
      return m;
    },
  });
  v.push({
    id: 'registros_evento.update_planta_id',
    descripcion: 'mover un evento de bitácora a OTRO cruce (UPDATE de planta_id): no es una función de la app',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto' }),
    ejecutar: async (rol) => {
      const f = (await svcIns('registros_evento', { planta_id: C.cruce, tipo_evento: 'otro', notas: tag(rol, '-mover'), created_by: C.uid.autor })).id as string;
      const m = await sondaUpdate(C.cli[rol], 'registros_evento', { planta_id: C.cruceTras }, { id: f }, ['42501', '23514', 'P0001']);
      await C.svc.from('registros_evento').delete().eq('id', f);
      return m;
    },
  });
  v.push({
    id: 'registros_evento.update_created_at',
    descripcion: 'cambiar la fecha de creación (created_at) de un evento propio',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto' }),
    ejecutar: async (rol) => {
      const f = (await svcIns('registros_evento', { planta_id: C.cruce, tipo_evento: 'otro', notas: tag(rol, '-creado'), created_by: C.uid.autor })).id as string;
      const m = await sondaUpdate(C.cli[rol], 'registros_evento', { created_at: '2020-01-01T00:00:00Z' }, { id: f }, ['42501', '23514', 'P0001']);
      await C.svc.from('registros_evento').delete().eq('id', f);
      return m;
    },
  });
  v.push({
    id: 'registros_evento.select_eliminados',
    descripcion: 'leer un evento ya eliminado (soft delete): solo admin',
    esperado: porRol({ operario: 'permitido_sin_efecto', autor: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto', admin: 'permitido' }),
    ejecutar: async (rol) => {
      const f = (await svcIns('registros_evento', { planta_id: C.cruce, tipo_evento: 'otro', notas: tag(rol, '-elim'), created_by: C.uid.autor, eliminado_at: new Date().toISOString() })).id as string;
      const m = await sondaSelect(C.cli[rol], 'registros_evento', 'id', { id: f });
      await C.svc.from('registros_evento').delete().eq('id', f);
      return m;
    },
  });

  // ---- evaluaciones: cerrada solo admin -------------------------------------------------------------------------------------------------
  v.push({
    id: 'evaluaciones.update_cerrada',
    descripcion: 'UPDATE de una evaluación ya cerrada (completa): el autor ya no puede, el admin sí',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto', autor: 'permitido_sin_efecto', admin: 'permitido' }),
    ejecutar: async (rol) => {
      const ind = await mkInd(C.cruce, C.uid.autor);
      const ronda = await mkRonda(ind, 1);
      const ev = (await svcIns('evaluaciones', { ronda_id: ronda, fecha: '2026-10-01', created_by: C.uid.autor, estado: 'completa', cantidad_frutos: 10, peso_total_g: 120 })).id as string;
      return sondaUpdate(C.cli[rol], 'evaluaciones', { observaciones: 'AUD-G10' }, { id: ev }, ['42501', '23514', 'P0001']);
    },
  });
  v.push({
    id: 'evaluaciones.update_ronda_id',
    descripcion: 'reasignar un borrador a la ronda de OTRO individuo (UPDATE de ronda_id)',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto' }),
    ejecutar: async (rol) => {
      const ind = await mkInd(C.cruce, C.uid.autor);
      const ronda = await mkRonda(ind, 1);
      const ev = (await svcIns('evaluaciones', { ronda_id: ronda, fecha: '2026-10-01', created_by: C.uid.autor, estado: 'borrador' })).id as string;
      const destino = await mkRonda(await mkInd(C.cruce, C.uid.autor), 1); // ronda sin borrador, de otro individuo
      return sondaUpdate(C.cli[rol], 'evaluaciones', { ronda_id: destino }, { id: ev }, ['42501', '23514', 'P0001']);
    },
  });
  v.push({
    id: 'evaluaciones.insert_created_by_ajeno',
    descripcion: 'INSERT de una evaluación a nombre de otro usuario',
    esperado: todos('denegado'),
    ejecutar: (rol) =>
      sondaInsert(C.cli[rol], 'evaluaciones', { ronda_id: C.rondaRol.operario, fecha: '2026-10-02', created_by: rol === 'admin' ? C.uid.autor : C.uid.admin, estado: 'borrador' }),
  });
  v.push({
    id: 'evaluaciones.insert_ya_completa',
    descripcion: 'INSERT directo de una evaluación ya completa: es el camino de la UI (crearEvaluacion acepta estado), así que se espera permitido',
    esperado: soloAut(),
    ejecutar: async (rol) => {
      const ind = await mkInd(C.cruce, C.uid.autor);
      const ronda = await mkRonda(ind, 1);
      return sondaInsert(C.cli[rol], 'evaluaciones', { ronda_id: ronda, fecha: '2026-10-02', created_by: u(rol), estado: 'completa', cantidad_frutos: 10, peso_total_g: 120 }, ['42501', '23514', 'P0001']);
    },
  });

  // ---- Auth: registro abierto (T04: las cuentas las da el admin) ---------------------------------------
  let sesionAutoregistrada: SupabaseClient | undefined;
  v.push({
    id: 'auth.registro_propio',
    descripcion: 'cualquiera con la clave anon se registra solo con correo y contraseña (signUp) y obtiene sesión',
    esperado: { anon: 'denegado', operario: 'denegado', autor: 'denegado', linaje: 'denegado', admin: 'denegado' },
    soloRoles: ['anon'],
    ejecutar: async () => {
      const cli = createClient(C.creds.url, C.creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const email = `aud-g10-signup-${S}@test.local`;
      const { data, error } = await cli.auth.signUp({ email, password: PASSWORD });
      if (data.user?.id) usuariosCreados.push(data.user.id);
      if (error || !data.session) return { real: 'denegado', mensaje: error?.message ?? 'sin sesión (requiere confirmación)' };
      sesionAutoregistrada = cli;
      return { real: 'permitido', mensaje: 'signUp devolvió sesión' };
    },
  });
  v.push({
    id: 'auth.registro_con_metadata_privilegiada',
    descripcion: 'signUp con data = { rol: admin, puede_ver_linaje: true }: handle_new_user solo debe leer el nombre',
    esperado: todos('denegado'),
    soloRoles: ['anon'],
    ejecutar: async () => {
      const cli = createClient(C.creds.url, C.creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await cli.auth.signUp({
        email: `aud-g10-signup2-${S}@test.local`,
        password: PASSWORD,
        options: { data: { rol: 'admin', puede_ver_linaje: true, role: 'service_role', nombre: 'AUD-G10 meta' } },
      });
      if (data.user?.id) usuariosCreados.push(data.user.id);
      if (error || !data.user) return { real: 'denegado', mensaje: error?.message ?? 'sin usuario' };
      const { data: perfil } = await C.svc.from('perfiles').select('rol, puede_ver_linaje').eq('id', data.user.id).single();
      const escalo = perfil?.rol === 'admin' || perfil?.puede_ver_linaje === true;
      return { real: escalo ? 'permitido' : 'denegado', mensaje: `perfil creado: rol=${perfil?.rol}, puede_ver_linaje=${perfil?.puede_ver_linaje}` };
    },
  });
  v.push({
    id: 'auth.updateUser_metadata_privilegiada',
    descripcion: 'un operario autenticado se escribe user_metadata = { rol: admin, puede_ver_linaje: true } y refresca la sesión: no debe ganar privilegios',
    esperado: todos('denegado'),
    soloRoles: ['operario'],
    ejecutar: async () => {
      const nombre = 'meta-propia';
      await mkUsuarioAuth(nombre, true);
      const cli = createClient(C.creds.url, C.creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      await cli.auth.signInWithPassword({ email: `aud-g10-${nombre}-${S}@test.local`, password: PASSWORD });
      const up = await cli.auth.updateUser({ data: { rol: 'admin', puede_ver_linaje: true, is_admin: true } });
      if (up.error) return { real: 'denegado', mensaje: up.error.message };
      await cli.auth.refreshSession();
      const adm = await cli.rpc('es_admin');
      const ficha = await cli.rpc('obtener_planta', { p_planta_id: C.cruce });
      const ve = ficha.data && typeof ficha.data === 'object' && 'cruzamiento' in (ficha.data as object);
      return { real: adm.data === true || ve ? 'permitido' : 'denegado', mensaje: `es_admin=${String(adm.data)}, linaje visible=${String(ve)}` };
    },
  });
  v.push({
    id: 'auth.lectura_con_cuenta_autoregistrada',
    descripcion: 'la cuenta autoregistrada (perfil operario creado por handle_new_user) lee cruces',
    esperado: todos('denegado'),
    soloRoles: ['anon'],
    ejecutar: async () => {
      if (!sesionAutoregistrada) return { real: 'denegado', mensaje: 'sin sesión autoregistrada' };
      return sondaSelect(sesionAutoregistrada, 'plantas', 'id,codigo_sistema', { id: C.cruce });
    },
  });
  v.push({
    id: 'auth.linaje_con_cuenta_autoregistrada',
    descripcion: 'la cuenta autoregistrada intenta leer el linaje por la columna',
    esperado: todos('denegado'),
    soloRoles: ['anon'],
    ejecutar: async () => {
      if (!sesionAutoregistrada) return { real: 'denegado', mensaje: 'sin sesión autoregistrada' };
      return sondaSelect(sesionAutoregistrada, 'plantas', 'id,cruzamiento', { id: C.cruce });
    },
  });

  v.push({
    id: 'evaluaciones.insert_estado_corregida',
    descripcion: 'INSERT directo de una evaluación ya en estado corregida (la corrección es un flujo de admin sobre una evaluación cerrada)',
    esperado: todos('denegado'),
    soloRoles: ['anon', 'operario', 'autor', 'linaje'],
    ejecutar: async (rol) => {
      const ind = await mkInd(C.cruce, C.uid.autor);
      const ronda = await mkRonda(ind, 1);
      return sondaInsert(C.cli[rol], 'evaluaciones', { ronda_id: ronda, fecha: '2026-10-02', created_by: u(rol), estado: 'corregida', motivo_cambio: 'AUD-G10', cantidad_frutos: 10, peso_total_g: 120 }, ['42501', '23514', 'P0001']);
    },
  });
  v.push({
    id: 'storage_rest.insert_objeto_con_owner_ajeno',
    descripcion: 'INSERT directo en storage.objects (perfil de PostgREST "storage") atribuido a otro usuario (owner distinto de auth.uid())',
    esperado: todos('denegado'),
    ejecutar: async (rol) => {
      const ajeno = rol === 'admin' ? C.uid.autor : C.uid.admin;
      const nombre = `aud-g10-${S}/rest/${rol}.txt`;
      const { error } = await C.cli[rol].schema('storage').from('objects').insert({ bucket_id: 'media-plantas', name: nombre, owner: ajeno, owner_id: ajeno });
      // storage.objects tiene un trigger que prohíbe el DELETE directo (incluso a service_role): se borra por la API.
      cleanups.push(async () => {
        await C.svc.storage.from('media-plantas').remove([nombre]);
      });
      return error ? { real: 'denegado', codigo: error.code, mensaje: error.message } : { real: 'permitido' };
    },
  });

  // ---- Embeds de PostgREST: no deben saltarse el RLS de la tabla embebida ------------------------------------
  v.push({
    id: 'embeds.perfil_del_autor_desde_individuos',
    descripcion: 'individuos?select=id,perfiles(*): el perfil embebido del autor solo lo ve él mismo y el admin',
    esperado: porRol({ operario: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto', autor: 'permitido', admin: 'permitido' }),
    ejecutar: async (rol) => {
      const { data, error } = await C.cli[rol].from('individuos').select('id,perfiles(id,nombre,rol,puede_ver_linaje)').eq('id', C.individuo).limit(1);
      if (error) return { real: 'denegado', codigo: error.code, mensaje: error.message };
      const fila = (data ?? [])[0] as unknown as { perfiles: unknown } | undefined;
      return { real: fila?.perfiles ? 'permitido' : 'permitido_sin_efecto' };
    },
  });
  v.push({
    id: 'embeds.audit_log_desde_plantas',
    descripcion: 'plantas?select=id,audit_log(*): la auditoría embebida solo la ve el admin',
    esperado: porRol({ operario: 'permitido_sin_efecto', autor: 'permitido_sin_efecto', linaje: 'permitido_sin_efecto', admin: 'permitido' }),
    ejecutar: async (rol) => {
      const { data, error } = await C.cli[rol].from('plantas').select('id,audit_log(id,accion,detalle)').eq('id', C.cruce).limit(1);
      if (error) return { real: 'denegado', codigo: error.code, mensaje: error.message };
      const fila = (data ?? [])[0] as unknown as { audit_log: unknown[] } | undefined;
      return { real: (fila?.audit_log ?? []).length > 0 ? 'permitido' : 'permitido_sin_efecto' };
    },
  });
  v.push({
    id: 'embeds.importacion_lote_desde_plantas',
    descripcion: 'plantas?select=id,importacion_lote(*): el lote de importación (trae el linaje en texto) es solo del admin',
    esperado: todos('denegado'),
    ejecutar: async (rol) => {
      const { data, error } = await C.cli[rol].from('plantas').select('id,importacion_lote(filas)').eq('id', C.cruce).limit(1);
      if (error) return { real: 'denegado', codigo: error.code, mensaje: error.message };
      return { real: (data ?? []).length > 0 ? 'permitido' : 'permitido_sin_efecto' };
    },
  });

  // ---- chat: una conversación ajena no se puede leer ---------------------------------------------------------------------------------------------------
  v.push({
    id: 'chat_mensajes.insert_directo_como_participante',
    descripcion: 'INSERT directo en chat_mensajes por un participante (solo existe enviar_mensaje_chat)',
    esperado: todos('denegado'),
    ejecutar: (rol) => sondaInsert(C.cli[rol], 'chat_mensajes', { canal_id: C.canalFx, posicion: 5000, autor_id: u(rol), autor_nombre: 'x', contenido: 'x', clave_envio: randomUUID() }),
  });

  return v;
}

// ============================================================================
// Storage
// ============================================================================

const BUCKETS = ['media-plantas', 'evecl-fotos'] as const;
const ACCIONES_STORAGE = ['subir', 'leer', 'firmar_ajeno', 'copiar_ajeno', 'mover_ajeno', 'listar', 'listar_raiz', 'borrar_ajeno', 'sobrescribir'] as const;

function esperadoStorage(accion: (typeof ACCIONES_STORAGE)[number], rol: Rol): Real {
  if (rol === 'anon') {
    // La API de Storage no da error al listar/borrar sin permiso: devuelve lista vacía (el RLS filtra).
    return accion === 'listar' || accion === 'listar_raiz' || accion === 'borrar_ajeno' ? 'permitido_sin_efecto' : 'denegado';
  }
  switch (accion) {
    case 'subir':
    case 'leer':
    case 'firmar_ajeno':
    case 'copiar_ajeno':
    case 'listar':
    case 'listar_raiz':
      return 'permitido';
    case 'mover_ajeno':
      // mover exige UPDATE sobre el objeto original: no hay policy de UPDATE
      return 'denegado';
    case 'borrar_ajeno':
      // solo el dueño (owner) borra; admin tampoco borra objetos ajenos (policy storage_*_delete_propietario)
      return rol === 'autor' ? 'permitido' : 'permitido_sin_efecto';
    case 'sobrescribir':
      // no hay policy de UPDATE: nadie (ni el dueño) puede reemplazar un objeto existente
      return 'denegado';
  }
}

async function ejecutarStorage(): Promise<void> {
  for (const bucket of BUCKETS) {
    const base = `aud-g10-${S}/${bucket}`;
    const archivoAutor = `${base}/autor-fx.txt`;
    const cuerpo = (t: string) => new Blob([t], { type: 'text/plain' });
    const up = await C.cli.autor.storage.from(bucket).upload(archivoAutor, cuerpo('fx'));
    if (up.error) throw new Error(`fixture storage ${bucket}: ${up.error.message}`);
    cleanups.push(async () => {
      await C.svc.storage.from(bucket).remove([archivoAutor]);
    });
    for (const rol of ROLES) {
      const cli = C.cli[rol];
      const k = (a: string) => `sto.${bucket}.${a}.${rol}`;
      // subir un archivo nuevo
      const ruta = `${base}/subida-${rol}.txt`;
      const r1 = await cli.storage.from(bucket).upload(ruta, cuerpo(rol));
      registrar(k('subir'), r1.error ? { real: 'denegado', mensaje: r1.error.message } : { real: 'permitido' });
      cleanups.push(async () => {
        await C.svc.storage.from(bucket).remove([ruta]);
      });
      // leer el archivo del autor
      const r2 = await cli.storage.from(bucket).download(archivoAutor);
      registrar(k('leer'), r2.error ? { real: 'denegado', mensaje: r2.error.message } : { real: 'permitido' });
      // URL firmada de un archivo ajeno (basta con poder leerlo)
      const rf = await cli.storage.from(bucket).createSignedUrl(archivoAutor, 60);
      registrar(k('firmar_ajeno'), rf.error ? { real: 'denegado', mensaje: rf.error.message } : { real: 'permitido' });
      // copiar un archivo ajeno a una ruta propia (SELECT del origen + INSERT del destino)
      const destinoCopia = `${base}/copia-${rol}.txt`;
      const rc = await cli.storage.from(bucket).copy(archivoAutor, destinoCopia);
      registrar(k('copiar_ajeno'), rc.error ? { real: 'denegado', mensaje: rc.error.message } : { real: 'permitido' });
      cleanups.push(async () => {
        await C.svc.storage.from(bucket).remove([destinoCopia]);
      });
      // mover (renombrar) un archivo ajeno: exige UPDATE
      const origenMover = `${base}/mover-origen-${rol}.txt`;
      const subeMover = await C.cli.autor.storage.from(bucket).upload(origenMover, cuerpo('m'));
      if (subeMover.error) {
        registrar(k('mover_ajeno'), { real: 'indeterminado', mensaje: `fixture: ${subeMover.error.message}` });
      } else {
        const destinoMover = `${base}/mover-destino-${rol}.txt`;
        const rm = await cli.storage.from(bucket).move(origenMover, destinoMover);
        registrar(k('mover_ajeno'), rm.error ? { real: 'denegado', mensaje: rm.error.message } : { real: 'permitido' });
        await C.svc.storage.from(bucket).remove([origenMover, destinoMover]);
      }
      // listar la raíz del bucket completo (enumeración de carpetas de otros)
      const rr = await cli.storage.from(bucket).list('');
      registrar(k('listar_raiz'), rr.error ? { real: 'denegado', mensaje: rr.error.message } : { real: (rr.data ?? []).length > 0 ? 'permitido' : 'permitido_sin_efecto' });
      // listar la carpeta completa del bucket
      const r3 = await cli.storage.from(bucket).list(base);
      registrar(k('listar'), r3.error ? { real: 'denegado', mensaje: r3.error.message } : { real: (r3.data ?? []).length > 0 ? 'permitido' : 'permitido_sin_efecto' });
      // borrar un archivo del autor (uno nuevo por rol)
      const ajeno = `${base}/borrar-${rol}.txt`;
      const subeAutor = await C.cli.autor.storage.from(bucket).upload(ajeno, cuerpo('x'));
      if (subeAutor.error) {
        registrar(k('borrar_ajeno'), { real: 'indeterminado', mensaje: `fixture: ${subeAutor.error.message}` });
      } else {
        const r4 = await cli.storage.from(bucket).remove([ajeno]);
        if (r4.error) registrar(k('borrar_ajeno'), { real: 'denegado', mensaje: r4.error.message });
        else registrar(k('borrar_ajeno'), { real: (r4.data ?? []).length > 0 ? 'permitido' : 'permitido_sin_efecto' });
        await C.svc.storage.from(bucket).remove([ajeno]);
      }
      // sobrescribir (upsert) el archivo del autor
      const r5 = await cli.storage.from(bucket).upload(archivoAutor, cuerpo(`pisado-por-${rol}`), { upsert: true });
      registrar(k('sobrescribir'), r5.error ? { real: 'denegado', mensaje: r5.error.message } : { real: 'permitido' });
    }
  }
}

// ============================================================================
// RPC
// ============================================================================

interface SondaRpc {
  args: (rol: Rol) => Promise<Fila> | Fila;
  /** Códigos de error de negocio que se aceptan como "la función corrió". */
  tolerar?: string[];
}

const RE_ROL = /admin|administrador|autor|creador|gestionar|acceso|participante|permiso|perfil|autentic|responsable|solo|no puedes|no tienes/i;

function clasificarRpc(error: { code?: string; message: string } | null, tolerar: string[], esperadoR: RpcResultado): Medicion {
  if (!error) return { real: 'ejecuta' };
  const code = error.code ?? '';
  const msg = error.message;
  if (/permission denied for function/i.test(msg)) return { real: 'no_concedida', codigo: code, mensaje: msg };
  if (code === 'PGRST202' || code === 'PGRST203') return { real: 'error_inesperado', codigo: code, mensaje: msg };
  if ((code === '42501' || code === '28000') && RE_ROL.test(msg)) return { real: 'rechaza_por_rol', codigo: code, mensaje: msg };
  if (tolerar.includes(code)) return { real: 'ejecuta', codigo: code, mensaje: msg };
  // Llegó al cuerpo de la función y falló por negocio: para una función que no debía
  // ser ejecutable eso significa que SÍ tiene EXECUTE.
  if (esperadoR === 'no_concedida') return { real: 'ejecuta', codigo: code, mensaje: `(error de negocio tras pasar el permiso) ${msg}` };
  return { real: 'error_inesperado', codigo: code, mensaje: msg };
}

let SONDAS_RPC: Record<string, SondaRpc> = {};

function esperadoRpc(nombre: string, rol: Rol): RpcResultado {
  const e = RPC[nombre];
  if (e.internaSinEjecutar) return 'no_concedida';
  if (e.quien.includes(rol)) return 'ejecuta';
  if (rol === 'anon') return 'no_concedida';
  return 'rechaza_por_rol';
}

function crearSondasRpc(): Record<string, SondaRpc> {
  const u = (rol: Rol): string => (rol === 'anon' ? ZERO : C.uid[rol]);
  const cruceDesechable = async (estado = 'evaluacion_anual', nombre = `RPC-${randomUUID().slice(0, 8)}`) => mkCruce(nombre, estado);
  const bajaArgs = (ids: string[]) => ({
    p_ids: ids, p_estado: 'muerto', p_criterios: ['muerte_natural'], p_nota: null, p_fecha: '2026-10-01', p_idempotency_key: randomUUID(),
  });
  const canalDesechable = async (): Promise<string> => {
    const { data, error } = await C.cli.admin.rpc('crear_canal_libre', { p_nombre: `AUD-G10 ${randomUUID().slice(0, 6)}`, p_participantes: [C.uid.autor] });
    if (error) throw new Error(`canal desechable: ${error.message}`);
    return data as string;
  };
  const indPara = async (): Promise<string> => mkInd(C.cruce, C.uid.autor);
  const evalRow = async (): Promise<Fila> => {
    const { data } = await C.svc.from('evaluaciones').select('*').eq('id', C.evalFx).single();
    return data as Fila;
  };
  const sinArgs = (): Fila => ({});
  const dummy = (a: Fila) => (): Fila => a;

  const s: Record<string, SondaRpc> = {
    activar_version_scoring: { args: () => ({ p_version_id: C.svVacia }), tolerar: ['23514'] },
    actualizar_linaje: { args: async () => ({ p_planta_id: await cruceDesechable(), p_cruzamiento: 'AUD-G10 x AUD-G10', p_mama_id: null, p_papa_id: null }) },
    actualizar_participantes_canal_libre: { args: () => ({ p_canal_id: C.canalFx, p_participantes: [C.uid.autor] }) },
    actualizar_procedimiento: {
      args: async (rol) => {
        const resp = rol === 'anon' ? C.uid.autor : u(rol);
        const p = (await svcIns('procedimientos', { nombre: tag(rol, '-up'), tipo: 'poda', fecha_inicio: '2026-11-01', responsable_id: resp, created_by: resp })).id as string;
        return { p_procedimiento_id: p, p_nombre: 'AUD-G10 edit', p_tipo: 'poda', p_estado: 'planificado', p_fecha_inicio: '2026-11-02', p_objetivos: [{ tipo: 'cruzamiento', id: C.cruce }], p_insumos: [] };
      },
    },
    aplicar_baja_individuos: { args: async () => bajaArgs([await indPara()]) },
    archivar_canal_libre: { args: async () => ({ p_canal_id: await canalDesechable() }) },
    borrar_cruzamiento: {
      args: async (rol) => ({ p_planta_id: await cruceDesechable(), p_tipo: rol === 'admin' ? 'soft' : 'hard' }),
    },
    calcular_categorias_evaluacion: { args: async () => ({ p_evaluacion: await evalRow(), p_scoring_version_id: C.versionActiva }), tolerar: ['22P02', '42883', '42804'] },
    calcular_metricas_evaluacion: { args: async () => ({ p_evaluacion: await evalRow(), p_scoring_version_id: C.versionActiva }), tolerar: ['22P02', '42883', '42804'] },
    calcular_ranking_operativo: { args: () => ({ p_scoring_version_id: C.versionActiva, p_planta_id: C.cruce, p_especie_id: null, p_por_ronda: false }) },
    clave_nombre_variedad: { args: dummy({ p_nombre: 'abc' }) },
    codigo_display_numero: { args: dummy({ p_codigo_display: '01-001-P1' }) },
    comparar_snapshot_vivo: { args: () => ({ p_snapshot_id: C.snapFx }) },
    confirmar_importacion_cruces: { args: () => ({ p_lote_id: C.loteFx, p_crear_variedades: false, p_idempotency_key: randomUUID() }) },
    descartar_importacion_cruces: { args: dummy({ p_lote_id: '00000000-0000-0000-0000-000000000000' }) },
    caducar_importaciones_cruces: { args: sinArgs },
    redactar_texto_linaje: { args: dummy({ p_dato: {} }) },
    congelar_ranking: { args: () => ({ p_nombre: 'AUD-G10', p_planta_id: C.cruce, p_especie_id: null }), tolerar: ['23514'] },
    definir_protocolo_ronda: { args: () => ({ p_planta_id: C.cruce, p_tipo_ronda: 'anual', p_numero_ronda: 3, p_nombre: 'AUD-G10', p_descriptores: { brotacion: 'opcional' } }) },
    obtener_planilla_ronda: { args: () => ({ p_planta_id: C.cruce }) },
    obtener_estados_evaluacion: { args: async () => ({ p_evaluacion_id: (await evalRow()).id }), tolerar: ['P0002'] },
    estados_descriptores: { args: async () => ({ p_evaluacion: await evalRow() }), tolerar: ['22P02', '42883', '42804'] },
    descriptores_fuera_de_revision: { args: async () => ({ p_evaluacion: await evalRow() }), tolerar: ['22P02', '42883', '42804'] },
    validar_descriptores_protocolo: { args: () => ({ p_descriptores: { brotacion: 'opcional' } }) },
    congelar_ranking_grupos: { args: () => ({ p_nombre: 'AUD-G10-grupos', p_planta_id: C.cruce, p_especie_id: null }), tolerar: ['23514'] },
    obtener_ranking_por_grupos: { args: () => ({ p_planta_id: C.cruce }) },
    calcular_ranking_grupos: { args: () => ({ p_scoring_version_id: C.versionActiva, p_planta_id: C.cruce }) },
    calcular_ranking_base: { args: () => ({ p_scoring_version_id: C.versionActiva, p_planta_id: C.cruce }) },
    calcular_ranking_nucleo: { args: () => ({ p_scoring_version_id: C.versionActiva, p_planta_id: C.cruce }) },
    consultar_mapa_viewport: { args: dummy({ p_latitud_minima: -90, p_latitud_maxima: 90, p_longitud_minima: -180, p_longitud_maxima: 180 }) },
    conteo_cruces_por_estado: { args: sinArgs },
    crear_canal_libre: { args: (rol) => ({ p_nombre: `AUD-G10 crear ${rol} ${randomUUID().slice(0, 4)}`, p_participantes: [] }) },
    crear_procedimiento: { args: (rol) => ({ p_nombre: `AUD-G10 proc ${rol}`, p_tipo: 'poda', p_fecha_inicio: '2026-11-01', p_objetivos: [{ tipo: 'cruzamiento', id: C.cruce }], p_insumos: [] }) },
    dar_baja_individuos: { args: async () => bajaArgs([await indPara()]) },
    enviar_mensaje_chat: { args: () => ({ p_canal_id: C.canalFx, p_contenido: 'AUD-G10 rpc', p_clave_envio: randomUUID(), p_mencionados: [], p_mencionar_todos: false }) },
    es_admin: { args: sinArgs },
    es_participante_chat: { args: () => ({ p_canal_id: C.canalFx, p_usuario_id: C.uid.autor }) },
    etiquetar_delta: { args: dummy({ p_delta: 1, p_umbral_leve: 1, p_umbral_marcado: 2 }) },
    evaluacion_tiene_descriptores_completos: { args: async () => ({ p: await evalRow() }), tolerar: ['22P02', '42883', '42804'] },
    evaluacion_exige_muestra: { args: async () => ({ p_evaluacion: await evalRow() }), tolerar: ['22P02', '42883', '42804'] },
    evaluar_baja_individuos: { args: async () => ({ p_ids: [await indPara()] }) },
    evecl_comparar: { args: () => ({ p_modo: 'entre_fichas', p_ensayo_id: C.ensayoFx, p_variedad: tag('fx', '-ficha') }) },
    evecl_eliminar_ficha: {
      args: async (rol) => ({ p_ficha_id: (await svcIns('evecl_ficha', { ensayo_id: C.ensayoFx, variedad: tag(rol, '-elim'), numero_repeticion: 2 + ROLES.indexOf(rol), created_by: C.uid.autor })).id as number }),
    },
    evecl_guardar_ensayo: { args: (rol) => ({ p_codigo_parcela: ins(`rpc-${rol}`) }) },
    evecl_guardar_ficha: { args: (rol) => ({ p_ensayo_id: C.ensayoFx, p_variedad: ins(`rpc-${rol}`), p_numero_repeticion: 2 + ROLES.indexOf(rol) }) },
    evecl_guardar_ficha_con_bajas: { args: (rol) => ({ p_entrada: {
      p_ensayo_id: C.ensayoFx, p_variedad: ins(`rpc-bajas-${rol}`), p_numero_repeticion: 2 + ROLES.indexOf(rol),
    }, p_descriptores_eliminar: [] }) },
    evecl_obtener_catalogo: { args: sinArgs },
    guardar_siembra: { args: () => ({ p_planta_id: C.cruce, p_cambios: {}, p_insumo_ids: [], p_sustratos: [], p_nota: '', p_fecha: '2026-10-22' }) },
    guardar_cosecha: { args: () => ({ p_planta_id: C.cruce, p_cambios: {}, p_fecha_historial: '2026-10-22' }) },
    evecl_obtener_ensayos: { args: sinArgs },
    evecl_obtener_ficha: { args: () => ({ p_ficha_id: C.fichaFx }) },
    evecl_obtener_fichas: { args: () => ({ p_ensayo_id: C.ensayoFx }) },
    extraer_metrica_evaluacion: { args: async () => ({ p_evaluacion: await evalRow(), p_metrica: 'brix' }), tolerar: ['22P02', '42883', '42804'] },
    individualizar_plantas: { args: () => ({ p_planta_id: C.cruceTras, p_cantidad: 1 }) },
    individualizar_plantas_una_vez: { args: () => ({ p_planta_id: C.cruceTras, p_cantidad: 1, p_clave: randomUUID() }) },
    individuo_esta_vivo: { args: () => ({ p_individuo_id: C.individuo }) },
    iniciar_ronda_evaluacion: { args: async () => ({ p_individuo_id: await indPara() }) },
    iniciar_ronda_esperada: { args: async () => ({ p_individuo_id: await indPara(), p_tipo: 'anual', p_numero_esperado: 1 }) },
    iniciar_ronda_multisitio: { args: async () => ({ p_individuo_id: await mkInd(C.cruceMulti, C.uid.autor), p_predio_id: null }) },
    limite_baja_en_lote: { args: sinArgs },
    limpiar_canal_chat: { args: () => ({ p_canal_id: C.canalFx }) },
    listar_canales_chat: { args: sinArgs },
    listar_cruces_analiticos: { args: dummy({ p_limite: 5 }) },
    panorama_especies: { args: () => ({ p_especie_id: C.especieId }) },
    estado_operativo_cruce: { args: () => ({ p_planta_id: C.cruce }) },
    ultima_accion_auditada_cruce: { args: () => ({ p_planta_id: C.cruce }) },
    descriptor_activo_en_especie: { args: () => ({ p_fase: 'evaluacion_anual', p_clave: 'brix', p_especie_id: C.especieId }) },
    contar_valores_descriptor: { args: () => ({ p_especie_id: C.especieId, p_clave: 'brix' }) },
    anio_temporada: { args: () => ({ p_especie_id: C.especieId, p_numero_ronda: 1 }) },
    cerrar_temporada_ranking: { args: () => ({ p_especie_id: C.especieId, p_numero_ronda: 1 }), tolerar: ['23514', '23505'] },
    // Fase 5: con ids inexistentes el admin llega a la búsqueda (P0002) sin cambiar nada; los demás se rechazan antes por rol.
    retroceder_fase_cruce: { args: () => ({ p_planta_id: randomUUID(), p_estado_actual: 'cosecha', p_motivo: 'AUD-G10' }), tolerar: ['P0002'] },
    poscosecha_incompleta_cruce: { args: () => ({ p_planta_id: C.cruce }) },
    etiqueta_temporada: { args: dummy({ p_fecha: '2026-07-01' }) },
    temporada_sugerida: { args: () => ({ p_especie_id: C.especieId, p_numero_ronda: 1 }) },
    temporadas_especie: { args: () => ({ p_especie_id: C.especieId }) },
    marcar_ronda_no_evaluada: { args: () => ({ p_ronda_id: randomUUID(), p_motivo: 'sin_fruto' }), tolerar: ['P0002'] },
    quitar_ronda_no_evaluada: { args: () => ({ p_ronda_id: randomUUID() }), tolerar: ['P0002'] },
    reactivar_individuo: { args: () => ({ p_individuo_id: randomUUID(), p_motivo: 'AUD-G10' }), tolerar: ['P0002'] },
    // Fase 5 (G15): sobre la evaluación del autor, que ya tiene un pedido abierto: el autor llega al duplicado (23505) sin crear
    // nada; los demás se rechazan por autoría.
    pedir_correccion: { args: () => ({ p_evaluacion_id: fixtures.evalPedido, p_nota: 'AUD-G10' }), tolerar: ['23505'] },
    listar_correcciones_pedidas: { args: sinArgs },
    codigo_natural: { args: dummy({ p_codigo: '02-10' }) },
    pedidos_correccion_evaluacion: { args: () => ({ p_evaluacion_id: fixtures.evalPedido }) },
    listar_individuos_procedimiento_predio: { args: () => ({ p_procedimiento_id: C.procFx, p_predio_id: C.predioFx }) },
    listar_notificaciones_chat: { args: sinArgs },
    listar_participantes_chat: { args: () => ({ p_canal_id: C.canalFx }) },
    nombres_de_usuarios: { args: () => ({ p_ids: [C.uid.admin, C.uid.autor] }) },
    obtener_correcciones_individuo: { args: () => ({ p_individuo_id: C.individuo }) },
    listar_predios_activos_cruzamiento: { args: () => ({ p_planta_id: C.cruce }) },
    listar_snapshots_ranking: { args: () => ({ p_planta_id: C.cruce }) },
    marcar_baja_individuo: { args: async () => ({ p_individuo_id: await indPara(), p_estado: 'muerto', p_criterios: ['muerte_natural'], p_nota: null, p_fecha: '2026-10-01', p_idempotency_key: randomUUID() }) },
    marcar_chat_leido: { args: () => ({ p_canal_id: C.canalFx, p_posicion: 0 }) },
    marcar_notificacion_chat_leida: { args: () => ({ p_mensaje_id: C.msgFx }) },
    marcar_todas_notificaciones_chat_leidas: { args: sinArgs },
    registrar_suscripcion_push: { args: (rol) => ({ p_endpoint: `${PUSH_EP}rpc-${rol}`, p_p256dh: PUSH_P256DH, p_auth: PUSH_AUTH, p_user_agent: 'AUD-G10' }) },
    eliminar_suscripcion_push: { args: (rol) => ({ p_endpoint: `${PUSH_EP}rpc-${rol}` }) },
    despachar_push_envio: { args: dummy({ p_envio_id: 0 }) },
    programar_reintento_push: { args: dummy({ p_envio_id: 0, p_error: 'AUD-G10' }) },
    recoger_respuestas_push: { args: sinArgs },
    limpiar_push_envio: { args: sinArgs },
    normalizar_metrica_scoring: { args: dummy({ p_valor: 1, p_minimo: 0, p_maximo: 2, p_direccion: 'mayor' }) },
    nueva_version_scoring: { args: (rol) => ({ p_version_base_id: C.svFx, p_nombre: ins(`nv-${rol}`), p_vigente_desde: '2031-01-01', p_nota: null }) },
    obtener_canal_chat: { args: () => ({ p_tipo: 'cruce', p_entidad_id: C.cruce }) },
    obtener_clima_predio: { args: () => ({ p_predio_id: C.predioFx, p_planta_id: null }) },
    obtener_comparacion_rondas: { args: () => ({ p_individuo_id: C.individuo, p_planta_id: null }) },
    obtener_dashboard_cientifico: { args: () => ({ p_especie_id: C.especieId, p_limite: 3 }) },
    obtener_detalle_snapshot: { args: () => ({ p_snapshot_id: C.snapFx }) },
    obtener_mapa_cruce: { args: () => ({ p_planta_id: C.cruce }) },
    obtener_planta: { args: () => ({ p_planta_id: C.cruce }) },
    obtener_procedencia_calidad_ronda: { args: () => ({ p_ronda_id: C.rondaFx }) },
    obtener_ranking_global_filtrado: { args: () => ({ p_especie_id: C.especieId, p_limite: 3 }) },
    obtener_ranking_operativo: { args: () => ({ p_planta_id: C.cruce, p_limite: 3 }) },
    obtener_ranking_polinizacion_varietal: { args: () => ({ p_especie_id: C.especieId, p_rol: 'ambos' }) },
    obtener_referencias_evaluacion: { args: () => ({ p_ronda_id: C.rondaFx }) },
    obtener_resumen_individuos: { args: () => ({ p_planta_id: C.cruce }) },
    obtener_resumen_mapa_territorial: { args: dummy({ p_limite: 5 }) },
    obtener_scoring_planta: { args: () => ({ p_planta_id: C.cruce }) },
    obtener_series_historicas_cientificas: { args: () => ({ p_especie_id: C.especieId }) },
    previsualizar_baja_individuos: { args: async () => ({ p_ids: [await indPara()] }) },
    previsualizar_importacion_cruces: { args: (rol) => ({ p_filas: [{ codigo_sistema: `AUD-G10-${S}-imp-${rol}`, especie: 'Arándano' }], p_archivo_nombre: ins(`imp-${rol}`) }), tolerar: ['22023'] },
    procedimiento_planta_auditable: { args: () => ({ p_procedimiento_id: C.procFx }) },
    procesar_respuesta_clima_predio: { args: () => ({ p_predio_id: C.predioFx, p_body: {} }) },
    captura_tiene_respaldo: { args: () => ({ p_planta: C.cruce, p_etapa: 'polinizacion' }) },
    puede_acceder_chat: { args: () => ({ p_canal_id: C.canalFx }) },
    puede_acceder_entidad_chat: { args: () => ({ p_tipo: 'general', p_entidad_id: null }) },
    puede_gestionar_canal_libre: { args: () => ({ p_canal_id: C.canalFx }) },
    puede_ver_linaje_actual: { args: sinArgs },
    reasignar_procedimiento: {
      args: async () => {
        const p = (await svcIns('procedimientos', { nombre: tag('r', `-reas-${randomUUID().slice(0, 4)}`), tipo: 'poda', fecha_inicio: '2026-11-01', responsable_id: C.uid.autor, created_by: C.uid.autor })).id as string;
        return { p_procedimiento_id: p, p_responsable_nuevo_id: C.uid.operario, p_motivo: 'AUD-G10' };
      },
    },
    recolectar_clima_pendiente: { args: sinArgs },
    refrescar_clima_predios: { args: sinArgs },
    reemplazar_insumos_procedimiento: { args: () => ({ p_procedimiento_id: C.procFx, p_insumos: [] }) },
    reemplazar_objetivos_procedimiento: { args: () => ({ p_procedimiento_id: C.procFx, p_objetivos: [{ tipo: 'cruzamiento', id: C.cruce }] }) },
    registrar_traslado_individuo: { args: async () => ({ p_individuo_id: await indPara(), p_sector_id: fixtures.sector, p_fecha_inicio: '2026-10-01' }) },
    reiniciar_cruzamiento: { args: async () => ({ p_planta_id: await cruceDesechable() }) },
    resolver_scoring_version: { args: () => ({ p_especie_id: C.especieId }) },
    restaurar_cruzamiento: {
      args: async () => {
        const id = await cruceDesechable();
        await C.svc.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', id);
        return { p_planta_id: id };
      },
    },
    resumen_individuos_cruce: { args: () => ({ p_planta_id: C.cruce }) },
    revertir_importacion: { args: () => ({ p_lote_id: C.loteFx }) },
    ronda_contiene_metrica_marcada: { args: () => ({ p_ronda_id: C.rondaFx, p_scoring_version_id: C.versionActiva }) },
    ronda_individuo_esta_vivo: { args: () => ({ p_ronda_id: C.rondaFx }) },
    scoring_version_en_uso: { args: () => ({ p_version_id: C.svFx }) },
    // Se llama con un predio SIN coordenadas: si el rol pasa el permiso, la función se
    // detiene en "El predio no tiene coordenadas" (22023) antes de la llamada HTTP a Open-Meteo.
    sincronizar_clima_predio: { args: () => ({ p_predio_id: C.predioFx, p_meses_atras: 1 }), tolerar: ['22023'] },
    sitio_predeterminado_legacy: { args: sinArgs },
    unificar_evaluacion_ronda: { args: () => ({ p_ronda_id: C.rondaFx }) },
    validar_filas_importacion_cruces: { args: dummy({ p_filas: [] }) },
    validar_parametros_baja: { args: dummy({ p_estado: 'muerto', p_criterios: ['muerte_natural'], p_fecha: '2026-10-01' }) },
  };
  return s;
}

/** Funciones de cron/servicio con efectos: si por error tuvieran EXECUTE, no se invocan, se informa por catálogo. */
const NO_LLAMAR_SI_EXPUESTA = new Set([
  'recolectar_clima_pendiente', 'refrescar_clima_predios', 'procesar_respuesta_clima_predio', 'aplicar_baja_individuos',
  'reemplazar_insumos_procedimiento', 'reemplazar_objetivos_procedimiento',
  'despachar_push_envio', 'programar_reintento_push', 'recoger_respuestas_push', 'limpiar_push_envio',
]);

/** ¿La respuesta contiene alguna de las marcas del linaje del cruce principal? ('permitido' = linaje visible). */
function escanearLinaje(data: unknown, soloTexto = false): Medicion {
  const texto = JSON.stringify(data ?? null);
  // En tablas se buscan solo los textos: los ids de variedad aparecen legítimamente en el catálogo `variedades`.
  const vistas = (soloTexto ? fixtures.tokensLinaje.slice(0, 3) : fixtures.tokensLinaje).filter((t) => texto.includes(t));
  return vistas.length ? { real: 'permitido', mensaje: `linaje visible (${vistas.length} marcas)` } : { real: 'permitido_sin_efecto' };
}

async function ejecutarLinajeTablas(): Promise<void> {
  // Control positivo: audit_log guarda el linaje en el detalle de escritura_linaje y el admin SÍ puede leerlo.
  {
    const r = await C.cli.admin.from('audit_log').select('*').eq('planta_id', C.cruce).limit(1000);
    registrar('linaje.tabla.audit_log.admin', r.error ? { real: 'indeterminado', mensaje: r.error.message } : escanearLinaje(r.data, true));
  }
  for (const tabla of Object.keys(TABLAS)) {
    const spec = SPECS[tabla];
    for (const rol of ['operario', 'autor', 'linaje'] as const) {
      let r = await C.cli[rol].from(tabla).select('*').limit(1000);
      if (r.error) r = await C.cli[rol].from(tabla).select(spec.cols).limit(1000);
      registrar(`linaje.tabla.${tabla}.${rol}`, r.error ? { real: 'permitido_sin_efecto', mensaje: `sin lectura: ${r.error.message}` } : escanearLinaje(r.data, true));
    }
  }
}

const RPC_ORDEN_ROLES: readonly Rol[] = ['anon', 'operario', 'linaje', 'autor', 'admin'];

async function ejecutarRpc(): Promise<void> {
  const nombres = Object.keys(RPC).filter((n) => !DESARROLLO || SOLO.has(n) || SOLO.has('rpc'));
  for (const nombre of nombres) {
    const sonda = SONDAS_RPC[nombre];
    if (!sonda) throw new Error(`sin sonda RPC para ${nombre}`);
    for (const rol of RPC_ORDEN_ROLES) {
      const id = `rpc.${nombre}.${rol}`;
      if (RPC[nombre].noProbar?.includes(rol)) {
        registrar(id, { real: 'no_probado', mensaje: 'efecto irreversible o llamada externa: no se ejecuta con este rol' });
        continue;
      }
      const esp = esperadoRpc(nombre, rol);
      if (NO_LLAMAR_SI_EXPUESTA.has(nombre)) {
        const cat = catFunciones.find((f) => f.nombre === nombre);
        if (cat && (rol === 'anon' ? cat.anon : cat.auth)) {
          registrar(id, { real: 'ejecuta', mensaje: 'EXECUTE concedido según el catálogo (no se invoca: función de cron/servicio con efectos)' });
          continue;
        }
      }
      try {
        const args = await sonda.args(rol);
        const { data, error } = await C.cli[rol].rpc(nombre, args);
        registrar(id, clasificarRpc(error, sonda.tolerar ?? [], esp));
        if (!error && rol !== 'anon') {
          registrar(`linaje.rpc.${nombre}.${rol}`, escanearLinaje(data));
        }
      } catch (e) {
        registrar(id, { real: 'error_inesperado', mensaje: `sonda: ${String(e)}` });
      }
    }
  }
}

// ============================================================================
// Limpieza
// ============================================================================

async function limpiar(): Promise<void> {
  const svc = C.svc;
  const quiet = async (p: PromiseLike<unknown>): Promise<void> => {
    try {
      await p;
    } catch {
      /* limpieza best-effort */
    }
  };
  for (const f of cleanups.reverse()) await quiet(f());

  // Procedimientos, canales, snapshots, versiones y catálogos creados por RPC o sondas.
  const { data: procs } = await svc.from('procedimientos').select('id').like('nombre', `AUD-G10%`);
  const procIds = (procs ?? []).map((p) => p.id as string);
  if (procIds.length) {
    await quiet(svc.from('procedimiento_reasignaciones').delete().in('procedimiento_id', procIds));
    await quiet(svc.from('procedimiento_objetivos').delete().in('procedimiento_id', procIds));
    await quiet(svc.from('procedimiento_insumos').delete().in('procedimiento_id', procIds));
    await quiet(svc.from('procedimientos').delete().in('id', procIds));
  }
  const { data: procsAudNombre } = await svc.from('procedimientos').select('id').in('created_by', Object.values(C.uid));
  const procs2 = (procsAudNombre ?? []).map((p) => p.id as string);
  if (procs2.length) {
    await quiet(svc.from('procedimiento_reasignaciones').delete().in('procedimiento_id', procs2));
    await quiet(svc.from('procedimiento_objetivos').delete().in('procedimiento_id', procs2));
    await quiet(svc.from('procedimiento_insumos').delete().in('procedimiento_id', procs2));
    await quiet(svc.from('procedimientos').delete().in('id', procs2));
  }
  {
    const { data: cs1 } = await svc.from('chat_canales').select('id').like('entidad_nombre', 'AUD-G10%');
    const { data: cs2 } = await svc.from('chat_canales').select('id').in('entidad_id', crucesCreados);
    const ci = [...(cs1 ?? []), ...(cs2 ?? [])].map((c) => c.id as string);
    if (ci.length) {
      const { data: ms } = await svc.from('chat_mensajes').select('id').in('canal_id', ci);
      const mi = (ms ?? []).map((m) => m.id as string);
      if (mi.length) await quiet(svc.from('chat_menciones').delete().in('mensaje_id', mi));
      await quiet(svc.from('chat_lecturas').delete().in('canal_id', ci));
      await quiet(svc.from('chat_mensajes').delete().in('canal_id', ci));
      await quiet(svc.from('chat_canal_participantes').delete().in('canal_id', ci));
      await quiet(svc.from('chat_canales').delete().in('id', ci));
    }
    // push_envio cae en cascada con chat_menciones
    await quiet(svc.from('push_suscripcion').delete().like('endpoint', `${PUSH_EP}%`));
  }
  const { data: snaps } = await svc.from('ranking_snapshot').select('id').like('nombre', 'AUD-G10%');
  const snapIds = (snaps ?? []).map((x) => x.id as string);
  if (snapIds.length) {
    await quiet(svc.from('ranking_snapshot_resultado').delete().in('snapshot_id', snapIds));
    await quiet(svc.from('ranking_snapshot').delete().in('id', snapIds));
  }
  const { data: vers } = await svc.from('scoring_version').select('id').like('nombre', 'AUD-G10%');
  for (const v of vers ?? []) {
    await quiet(svc.from('scoring_metrica').delete().eq('scoring_version_id', v.id));
    await quiet(svc.from('scoring_categoria_peso').delete().eq('scoring_version_id', v.id));
    await quiet(svc.from('scoring_version').delete().eq('id', v.id));
  }
  await quiet(svc.from('rango_referencia').delete().like('nota', 'AUD-G10%'));
  const { data: ens } = await svc.from('evecl_ensayo').select('id').like('codigo_parcela', 'AUD-G10%');
  const ensIds = (ens ?? []).map((e) => e.id as number);
  if (ensIds.length) {
    const { data: fs } = await svc.from('evecl_ficha').select('id').in('ensayo_id', ensIds);
    const fIds = (fs ?? []).map((f) => f.id as number);
    if (fIds.length) await quiet(svc.from('evecl_respuesta').delete().in('ficha_id', fIds));
    await quiet(svc.from('evecl_ficha').delete().in('ensayo_id', ensIds));
    await quiet(svc.from('evecl_ensayo').delete().in('id', ensIds));
  }
  await quiet(svc.from('evecl_descriptor_estado').delete().like('label', 'AUD-G10%'));
  await quiet(svc.from('evecl_descriptor').delete().like('nombre', 'AUD-G10%'));
  await quiet(svc.from('importacion_lote').delete().like('archivo_nombre', 'AUD-G10%'));
  await quiet(svc.from('audit_log').delete().eq('accion', 'aud_g10_fixture'));
  await quiet(svc.from('audit_log').delete().eq('accion', 'aud_g10_ins'));

  // Satélites que borrar_cruzamiento(hard) no cubre.
  for (const c of crucesCreados) {
    await quiet(svc.from('registros_evento').delete().eq('planta_id', c));
    await quiet(svc.from('plantas_insumo').delete().eq('planta_id', c));
    await quiet(svc.from('plantas_sustrato').delete().eq('planta_id', c));
  }
  // Emplazamientos de los individuos de estos cruces (los del fixture y los que crea la sonda de
  // registrar_traslado_individuo) y protocolos de ronda del fixture: el trigger bloquea el borrado
  // incluso a service_role y las FK son RESTRICT (impiden purgar el cruce y borrar al admin), de modo
  // que se borran con session_replication_role = replica, solo los propios.
  if (crucesCreados.length) {
    const lista = crucesCreados.map((c) => `'${c}'`).join(',');
    try {
      sql(`set session_replication_role = replica;
        delete from emplazamiento_coordenada where emplazamiento_id in (select e.id from emplazamiento_individuo e join individuos i on i.id = e.individuo_id where i.planta_id in (${lista}));
        delete from emplazamiento_individuo where individuo_id in (select id from individuos where planta_id in (${lista}));
        update evaluaciones set protocolo_id = null where protocolo_id in (select id from protocolo_ronda where planta_id in (${lista}));
        delete from protocolo_ronda where planta_id in (${lista});`);
    } catch {
      /* limpieza best-effort */
    }
  }
  // Cruces: borrar_cruzamiento(hard) del admin (borra individuos, rondas, evaluaciones no cerradas, etc.).
  for (const c of crucesCreados) {
    const { data: inds } = await svc.from('individuos').select('id').eq('planta_id', c);
    const indIds = (inds ?? []).map((i) => i.id as string);
    if (indIds.length) {
      const { data: rs } = await svc.from('ronda_evaluacion_anual').select('id').in('individuo_id', indIds);
      const rIds = (rs ?? []).map((r) => r.id as string);
      if (rIds.length) {
        await quiet(svc.from('evaluaciones').delete().in('ronda_id', rIds));
        await quiet(svc.from('pcr_analisis').delete().in('ronda_id', rIds));
      }
    }
    const { error } = await C.cli.admin.rpc('borrar_cruzamiento', { p_planta_id: c, p_tipo: 'hard' });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`[g10] no se pudo purgar el cruce ${c}: ${error.message}`);
      await quiet(svc.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', c));
    }
  }
  // Catálogos y territorio de las sondas.
  const { data: pr } = await svc.from('predio').select('id').like('nombre', `AUD-G10-${S}%`);
  const prIds = (pr ?? []).map((p) => p.id as string);
  if (prIds.length) {
    await quiet(svc.from('predio_clima_mensual').delete().in('predio_id', prIds));
    await quiet(svc.from('predio_clima_sync_pendiente').delete().in('predio_id', prIds));
    await quiet(svc.from('sector').delete().in('predio_id', prIds));
    await quiet(svc.from('predio').delete().in('id', prIds));
  }
  for (const t of ['sitio', 'variedades', 'especies', 'contenedor', 'insumo', 'sustrato']) {
    await quiet(svc.from(t).delete().like('nombre', `AUD-G10-${S}%`));
  }
  // Usuarios.
  for (const id of usuariosCreados) await quiet(svc.auth.admin.deleteUser(id));
}

// ============================================================================
// Volcado opcional para el informe
// ============================================================================

function volcar(): void {
  const ruta = process.env.G10_VOLCAR;
  if (!ruta) return;
  const filas: Array<Record<string, unknown>> = [];
  for (const [id, m] of resultados) {
    const v = id.startsWith('var.') ? VARIANTES.find((x) => id.startsWith(`var.${x.id}.`) && id.slice(`var.${x.id}.`.length) in x.esperado) : undefined;
    filas.push({ id, esperado: esperadoDe(id) ?? null, ...m, desviacion: DESVIACIONES_CONOCIDAS[id]?.hallazgo ?? null, descripcion: v?.descripcion });
  }
  writeFileSync(ruta, JSON.stringify(filas, null, 1));
}

// ============================================================================
// Suite
// ============================================================================

let VARIANTES: Variante[] = [];

function afirmar(id: string, esp: string): void {
  const m = resultados.get(id);
  expect(m, `sin medición para ${id}`).toBeDefined();
  const desv = DESVIACIONES_CONOCIDAS[id];
  const detalle = `${id}: esperado ${esp}, real ${m!.real}${m!.codigo ? ` [${m!.codigo}]` : ''}${m!.mensaje ? ` — ${m!.mensaje}` : ''}`;
  if (desv) {
    // Desviación conocida: debe seguir siendo exactamente la documentada y distinta de lo esperado.
    expect(esp, `${desv.hallazgo} ya no es una desviación: retírala de DESVIACIONES_CONOCIDAS`).not.toBe(desv.real);
    expect(m!.real, `${desv.hallazgo} cambió: ${detalle}`).toBe(desv.real);
  } else {
    expect(m!.real, detalle).toBe(esp);
  }
}

beforeAll(async () => {
  leerCatalogo();
  await preparar();
  VARIANTES = crearVariantes();
  SONDAS_RPC = crearSondasRpc();
  const t0 = Date.now();
  await ejecutarTablas();
  const t1 = Date.now();
  if (!DESARROLLO) {
    for (const v of VARIANTES) {
      for (const rol of v.soloRoles ?? ROLES) {
        try {
          registrar(`var.${v.id}.${rol}`, await v.ejecutar(rol));
        } catch (e) {
          registrar(`var.${v.id}.${rol}`, { real: 'indeterminado', mensaje: String(e) });
        }
      }
    }
    await ejecutarStorage();
  } else {
    for (const v of VARIANTES.filter((x) => SOLO.has('variantes') || SOLO.has(x.id.split('.')[0]))) {
      for (const rol of v.soloRoles ?? ROLES) {
        try {
          registrar(`var.${v.id}.${rol}`, await v.ejecutar(rol));
        } catch (e) {
          registrar(`var.${v.id}.${rol}`, { real: 'indeterminado', mensaje: String(e) });
        }
      }
    }
    if (SOLO.has('storage')) await ejecutarStorage();
  }
  const t2 = Date.now();
  await ejecutarRpc();
  if (!DESARROLLO) await ejecutarLinajeTablas();
  // eslint-disable-next-line no-console
  console.log(`[g10] tablas ${(t1 - t0) / 1000}s, variantes+storage ${(t2 - t1) / 1000}s, rpc ${(Date.now() - t2) / 1000}s`);
  volcar();
  if (DESARROLLO || process.env.G10_IMPRIMIR) imprimirDiferencias();
}, 280_000);

/** Resultado esperado de cualquier celda registrada (undefined si la celda no tiene expectativa). */
function esperadoDe(id: string): string | undefined {
  const p = id.split('.');
  if (id.startsWith('linaje.')) {
    if (id.startsWith('linaje.tabla.audit_log.admin')) return 'permitido_sin_efecto';
    if (id.startsWith('linaje.rpc.')) {
      if (p[2] === 'obtener_planta' && ['linaje', 'admin'].includes(p[3])) return 'permitido';
      return ['operario', 'autor'].includes(p[3]) ? 'permitido_sin_efecto' : undefined;
    }
    return 'permitido_sin_efecto';
  }
  if (id.startsWith('rpc.')) return esperadoRpc(p[1], p[2] as Rol);
  if (id.startsWith('var.')) {
    const v = VARIANTES.find((x) => id.startsWith(`var.${x.id}.`) && id.slice(`var.${x.id}.`.length) in x.esperado);
    return v?.esperado[p[p.length - 1] as Rol];
  }
  if (id.startsWith('sto.')) return esperadoStorage(p[2] as (typeof ACCIONES_STORAGE)[number], p[3] as Rol);
  if (p[0] in TABLAS) return esperado(p[0], p[1] as Op, p[2] as Rol);
  return undefined;
}

/** Ayuda de desarrollo: imprime las celdas cuyo resultado real difiere del esperado. */
function imprimirDiferencias(): void {
  const lineas: string[] = [];
  for (const [id, m] of resultados) {
    const esp = esperadoDe(id);
    if (esp !== undefined && m.real !== esp) lineas.push(`${id} esperado=${esp} real=${m.real}${m.codigo ? ` [${m.codigo}]` : ''} ${m.mensaje ?? ''}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[g10] ${lineas.length} diferencias de ${resultados.size} celdas`, lineas);
}

afterAll(async () => {
  if (C) await limpiar();
}, 180_000);

describe('G10 catálogo: todo lo que existe está clasificado en la matriz', () => {
  it('toda tabla o vista de public está en TABLAS (lo no clasificado es un hallazgo)', () => {
    const noClasificadas = catTablas.map((t) => t.tabla).filter((t) => !(t in TABLAS));
    expect(noClasificadas, `tablas/vistas sin clasificar: ${noClasificadas.join(', ')}`).toEqual([]);
  });
  it('toda entrada de TABLAS existe en la base (la matriz no inventa tablas)', () => {
    const existentes = new Set(catTablas.map((t) => t.tabla));
    const fantasma = Object.keys(TABLAS).filter((t) => !existentes.has(t));
    expect(fantasma).toEqual([]);
  });
  it('toda función no-trigger de public está en RPC (lo no clasificado es un hallazgo)', () => {
    const noClasificadas = [...new Set(catFunciones.map((f) => f.nombre))].filter((n) => !(n in RPC));
    expect(noClasificadas, `RPC sin clasificar: ${noClasificadas.join(', ')}`).toEqual([]);
  });
  it('toda entrada de RPC existe en la base', () => {
    const existentes = new Set(catFunciones.map((f) => f.nombre));
    const fantasma = Object.keys(RPC).filter((n) => !existentes.has(n));
    expect(fantasma).toEqual([]);
  });
  it('no hay sobrecargas ambiguas: cada nombre de RPC aparece una sola vez', () => {
    const cuenta = new Map<string, number>();
    for (const f of catFunciones) cuenta.set(f.nombre, (cuenta.get(f.nombre) ?? 0) + 1);
    expect([...cuenta].filter(([, n]) => n > 1).map(([nombre]) => nombre)).toEqual([]);
  });
  it('RLS activado en toda tabla (CLAUDE.md 4.2); la única excepción es la vista', () => {
    const sinRls = catTablas.filter((t) => t.tipo === 'r' && !t.rls).map((t) => t.tabla);
    expect(sinRls).toEqual([]);
    expect(catTablas.filter((t) => t.tipo !== 'r').map((t) => t.tabla).sort()).toEqual([...VISTAS].sort());
  });
});

describe('G10 catálogo: grants reales contra el modelo', () => {
  it('anon no tiene ningún privilegio de tabla (ni de columna) en ninguna tabla de public', () => {
    const con = catTablas.filter((t) => Object.values(t.anon).some(Boolean)).map((t) => `${t.tabla}:${Object.entries(t.anon).filter(([, v]) => v).map(([k]) => k).join('+')}`);
    expect(con).toEqual([]);
  });
  for (const op of OPS) {
    it(`grants de ${op.toUpperCase()} para authenticated coinciden con el modelo (tabla × ${op})`, () => {
      const dif: string[] = [];
      for (const t of catTablas) {
        if (!(t.tabla in TABLAS)) continue;
        const tiene = t.auth[op];
        const debe = grantEsperado(t.tabla, op);
        if (tiene !== debe) dif.push(`${t.tabla}: ${tiene ? 'tiene' : 'no tiene'} grant de ${op}, el modelo esperaba ${debe ? 'tenerlo' : 'no tenerlo'}`);
      }
      const conocidas = dif.filter((d) => DESVIACIONES_CONOCIDAS[`grant.${d.split(':')[0]}.${op}`]);
      expect(dif.filter((d) => !conocidas.includes(d)), `grants no esperados: ${dif.join(' | ')}`).toEqual([]);
    });
  }
  it('hecho: las únicas funciones de public con ACL por defecto (proacl NULL = EXECUTE para PUBLIC y por tanto anon) son tres helpers puros creados el 21-10', () => {
    const sinAcl = sqlJson<{ proname: string }>(
      `select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and p.prorettype <> 'trigger'::regtype and p.proacl is null order by 1`,
    ).map((f) => f.proname);
    expect(sinAcl).toEqual(['clave_nombre_variedad', 'limite_baja_en_lote', 'validar_parametros_baja']);
  });
  it.fails('A1-G10-01: toda función de public debería nacer con ACL explícita (el ALTER DEFAULT PRIVILEGES por esquema de 20261004130000 no quita el EXECUTE de PUBLIC)', () => {
    const sinAcl = sqlJson<{ proname: string }>(
      `select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and p.prorettype <> 'trigger'::regtype and p.proacl is null order by 1`,
    ).map((f) => f.proname);
    expect(sinAcl).toEqual([]);
  });
  it('toda función SECURITY DEFINER fija su search_path (anti-secuestro de esquema)', () => {
    const sinFijar = sqlJson<{ proname: string }>(
      `select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
          and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) order by 1`,
    ).map((f) => f.proname);
    expect(sinFijar).toEqual([]);
  });
  it('anon y authenticated no pueden crear objetos en el esquema public', () => {
    const r = sqlJson<{ a: boolean; u: boolean }>(`select has_schema_privilege('anon','public','CREATE') a, has_schema_privilege('authenticated','public','CREATE') u`)[0];
    expect(r).toEqual({ a: false, u: false });
  });
  it('la vista plantas_operativas es security_invoker (si no, saltaría el RLS de plantas)', () => {
    const r = sqlJson<{ opts: string[] | null }>(`select c.reloptions as opts from pg_class c where c.relname = 'plantas_operativas' and c.relnamespace = 'public'::regnamespace`)[0];
    expect(r.opts).toContain('security_invoker=on');
  });
  it('solo las tablas de chat están en la publicación de Realtime (Realtime no respeta los permisos por columna)', () => {
    const t = sqlJson<{ tabla: string }>(`select tablename as tabla from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1`).map((x) => x.tabla);
    expect(t).toEqual(['chat_canales', 'chat_lecturas', 'chat_menciones', 'chat_mensajes']);
  });
  it('hecho: los buckets no tienen límite de tamaño ni lista de tipos MIME propios', () => {
    for (const b of catBuckets) {
      expect(b.file_size_limit, `${b.id} file_size_limit`).toBeNull();
      expect(b.allowed_mime_types, `${b.id} allowed_mime_types`).toBeNull();
    }
  });
  it.fails('A1-G3-23: cada bucket debería limitar tipos MIME (foto/video/PDF) y tamaño por archivo', () => {
    for (const b of catBuckets) {
      expect(b.allowed_mime_types, `${b.id} allowed_mime_types`).not.toBeNull();
      expect(b.file_size_limit, `${b.id} file_size_limit`).not.toBeNull();
    }
  });
  it('los buckets de Storage son privados', () => {
    expect(catBuckets.filter((b) => b.public).map((b) => b.id)).toEqual([]);
    expect(catBuckets.map((b) => b.id).sort()).toEqual([...BUCKETS].sort());
  });
  it('funciones: anon solo puede ejecutar lo que el modelo permite (nada)', () => {
    const dif = catFunciones.filter((f) => f.anon).map((f) => f.nombre);
    const conocidas = dif.filter((n) => DESVIACIONES_CONOCIDAS[`rpc.${n}.anon`]);
    expect(dif.filter((n) => !conocidas.includes(n)), `anon ejecuta: ${dif.join(', ')}`).toEqual([]);
  });
  it('funciones: authenticated tiene EXECUTE exactamente en las que el modelo expone', () => {
    const dif: string[] = [];
    for (const f of catFunciones) {
      const e = RPC[f.nombre];
      if (!e) continue;
      const debe = !e.internaSinEjecutar;
      if (f.auth !== debe) dif.push(`${f.nombre}: ${f.auth ? 'tiene' : 'no tiene'} EXECUTE, el modelo esperaba ${debe ? 'tenerlo' : 'no tenerlo'}`);
    }
    const conocidas = dif.filter((d) => DESVIACIONES_CONOCIDAS[`rpc.${d.split(':')[0]}.operario`]);
    expect(dif.filter((d) => !conocidas.includes(d)), `EXECUTE no esperado: ${dif.join(' | ')}`).toEqual([]);
  });
});

describe('G10 matriz de tablas: tabla × operación × rol', () => {
  for (const tabla of Object.keys(TABLAS)) {
    describe(tabla, () => {
      for (const op of OPS) {
        for (const rol of ROLES) {
          const id = `${tabla}.${op}.${rol}`;
          it(id, () => afirmar(id, esperado(tabla, op, rol)));
        }
      }
    });
  }
});

describe('G10 variantes por columna e integridad', () => {
  const variantes = crearVariantesEstaticas();
  for (const v of variantes) {
    describe(`${v.id} — ${v.descripcion}`, () => {
      for (const rol of v.soloRoles ?? ROLES) {
        const id = `var.${v.id}.${rol}`;
        it(id, () => afirmar(id, v.esperado[rol]));
      }
    });
  }
});

describe('G10 Storage', () => {
  for (const bucket of BUCKETS) {
    for (const accion of ACCIONES_STORAGE) {
      for (const rol of ROLES) {
        const id = `sto.${bucket}.${accion}.${rol}`;
        it(id, () => afirmar(id, esperadoStorage(accion, rol)));
      }
    }
  }
});

describe('G10 escáner de linaje: ninguna RPC ni tabla lo entrega a quien no corresponde', () => {
  for (const nombre of Object.keys(RPC)) {
    const e = RPC[nombre];
    if (e.internaSinEjecutar || !e.quien.includes('operario')) continue;
    for (const rol of ['operario', 'autor'] as const) {
      const id = `linaje.rpc.${nombre}.${rol}`;
      it(id, () => afirmar(id, 'permitido_sin_efecto'));
    }
  }
  for (const rol of ['linaje', 'admin'] as const) {
    const id = `linaje.rpc.obtener_planta.${rol}`;
    it(`${id} (control positivo: el escáner sí detecta el linaje cuando corresponde)`, () => afirmar(id, 'permitido'));
  }
  for (const tabla of Object.keys(TABLAS)) {
    for (const rol of ['operario', 'autor', 'linaje'] as const) {
      const id = `linaje.tabla.${tabla}.${rol}`;
      it(id, () => afirmar(id, 'permitido_sin_efecto'));
    }
  }
  it('linaje.tabla.audit_log.admin (A1-004: no hay texto sensible en la auditoría)', () =>
    afirmar('linaje.tabla.audit_log.admin', 'permitido_sin_efecto'));
});

describe('G10 matriz de RPC: función × rol', () => {
  for (const nombre of Object.keys(RPC)) {
    describe(nombre, () => {
      for (const rol of ROLES) {
        const id = `rpc.${nombre}.${rol}`;
        it(id, () => {
          if (RPC[nombre].noProbar?.includes(rol)) {
            expect(resultados.get(id)?.real).toBe('no_probado');
            return;
          }
          afirmar(id, esperadoRpc(nombre, rol));
        });
      }
    });
  }
});

/**
 * Las variantes se definen con `crearVariantes()` (necesita el contexto C para
 * ejecutar), pero sus ids y resultados esperados no dependen de él: para
 * registrar los `it` en tiempo de colección se construye una lista estática.
 */
function crearVariantesEstaticas(): Array<Pick<Variante, 'id' | 'descripcion' | 'esperado' | 'soloRoles'>> {
  const guardado = C;
  // crearVariantes solo captura C dentro de los closures `ejecutar`, que aquí no se invocan.
  C = undefined as unknown as Ctx;
  try {
    return crearVariantes().map(({ id, descripcion, esperado: e, soloRoles }) => ({ id, descripcion, esperado: e, soloRoles }));
  } finally {
    C = guardado;
  }
}

// ============================================================================
// Integridad de la auditoría y de los caminos directos (hallazgos con prueba)
// ============================================================================
//
// Patrón: un `it` normal fija los HECHOS observados (precondición) y un
// `it.fails` afirma lo que DEBERÍA pasar. Así un error de preparación no se
// esconde detrás del `it.fails`.

async function loginComo(nombre: string): Promise<SupabaseClient> {
  const cli = createClient(C.creds.url, C.creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await cli.auth.signInWithPassword({ email: `aud-g10-${nombre}-${S}@test.local`, password: PASSWORD });
  if (error) throw new Error(`login ${nombre}: ${error.message}`);
  return cli;
}

describe('G10 el rastro de auditoría sobrevive al borrado de un perfil (A1-G8-02)', () => {
  const hechos: Record<string, { filas: number; anonimizadas: number; conIdentidad: number; borrado: string }> = {};

  async function escenario(clave: string, borrar: (id: string) => Promise<string>): Promise<void> {
    const nombre = `rastro-${clave}`;
    const id = await mkUsuarioAuth(nombre, true);
    const cli = await loginComo(nombre);
    const lectura = await cli.rpc('obtener_planta', { p_planta_id: C.cruce });
    if (lectura.error) throw new Error(`obtener_planta como ${nombre}: ${lectura.error.message}`);
    const { data: antes } = await C.svc.from('audit_log').select('id').eq('usuario_id', id);
    const ids = (antes ?? []).map((f) => f.id as number);
    const borrado = await borrar(id);
    const { data: despues } = await C.svc.from('audit_log').select('id, usuario_id, detalle').in('id', ids);
    hechos[clave] = { filas: ids.length, anonimizadas: (despues ?? []).filter((f) => f.usuario_id === null).length,
      conIdentidad: (despues ?? []).filter(f => f.usuario_id === id || (f.detalle?.usuario_eliminado?.id === id &&
        f.detalle.usuario_eliminado.correo && f.detalle.usuario_eliminado.nombre)).length, borrado };
  }

  beforeAll(async () => {
    // (a) el admin borra el perfil por la API (perfiles_admin_todo incluye DELETE)
    await escenario('api', async (id) => {
      const m = await sondaDelete(C.cli.admin, 'perfiles', { id });
      return m.real;
    });
    // (b) baja de la cuenta en el panel de Auth (cascada auth.users -> perfiles)
    await escenario('auth', async (id) => {
      const { error } = await C.svc.auth.admin.deleteUser(id);
      return error ? `error: ${error.message}` : 'permitido';
    });
  }, 60_000);

  it('A1-003 rechaza borrar perfil por API y A1-008 conserva identidad tras la baja Auth, sin cambiar SET NULL', () => {
    expect(hechos.api.borrado).toBe('denegado');
    expect(hechos.api.filas).toBeGreaterThan(0);
    expect(hechos.auth.borrado).toBe('permitido');
    expect(hechos.auth.filas).toBeGreaterThan(0);
    // Documentado: audit_log.usuario_id -> perfiles es ON DELETE SET NULL, así que el «append-only» se rompe por la FK.
    expect(hechos.api.anonimizadas).toBe(0);
    expect(hechos.auth.anonimizadas).toBe(hechos.auth.filas);
    expect(hechos.auth.conIdentidad).toBe(hechos.auth.filas);
  });
  it('A1-G8-02 (API): borrar el perfil de un usuario NO debería borrar el autor de sus filas de audit_log', () => {
    expect(hechos.api.anonimizadas).toBe(0);
  });
  it('A1-G8-02 (Auth): dar de baja la cuenta conserva correo/nombre/id en sus filas de audit_log', () => {
    expect(hechos.auth.conIdentidad).toBe(hechos.auth.filas);
  });
});

describe('G10 un cambio de rol o de puede_ver_linaje queda auditado (A1-G8-03)', () => {
  let filasNuevas = -1;
  let cambioPermitido = '';

  beforeAll(async () => {
    const objetivo = await mkUsuarioAuth('objetivo-rol', true);
    const t0 = new Date().toISOString();
    const a = await sondaUpdate(C.cli.admin, 'perfiles', { puede_ver_linaje: true, rol: 'admin' }, { id: objetivo });
    const b = await sondaUpdate(C.cli.admin, 'perfiles', { puede_ver_linaje: false, rol: 'operario' }, { id: objetivo });
    cambioPermitido = `${a.real}/${b.real}`;
    const { data } = await C.svc.from('audit_log').select('id, accion, detalle, usuario_id').gte('ocurrido_en', t0);
    filasNuevas = (data ?? []).filter((f) => JSON.stringify(f.detalle ?? {}).includes(objetivo)).length;
  }, 60_000);

  it('hecho: el admin puede ascender a otro usuario a admin y darle permiso de linaje por la API', () => {
    expect(cambioPermitido).toBe('permitido/permitido');
  });
  it('A1-G8-03: ascender a admin / dar puede_ver_linaje deja una fila en audit_log con autor, usuario afectado y valores', () => {
    expect(filasNuevas).toBeGreaterThan(0);
  });
});

describe('G10 el DELETE directo de un cruce no pasa por borrar_cruzamiento (A1-G1-02)', () => {
  let resultado: Medicion = { real: 'indeterminado' };
  let existeDespues = true;
  let bitacoraDespues = -1;
  let auditorias = -1;

  beforeAll(async () => {
    const codigo = `AUD-G10-${S}-REAL`;
    const { data: cruce } = await C.svc.from('plantas').insert({ codigo_sistema: codigo, especie_id: C.especieId, estado: 'sin_empezar', es_prueba: false }).select('id').single();
    const id = cruce!.id as string;
    await C.svc.from('registros_evento').insert({ planta_id: id, tipo_evento: 'otro', notas: 'AUD-G10 bitácora de un cruce real', created_by: C.uid.autor });
    resultado = await sondaDelete(C.cli.admin, 'plantas', { id });
    existeDespues = (await C.svc.from('plantas').select('id').eq('id', id)).data!.length > 0;
    bitacoraDespues = (await C.svc.from('registros_evento').select('id').eq('planta_id', id)).data!.length;
    const { data: aud } = await C.svc.from('audit_log').select('id').like('accion', 'borrado_cruzamiento%').contains('detalle', { codigo_sistema: codigo });
    auditorias = (aud ?? []).length;
    if (existeDespues) await C.svc.from('plantas').delete().eq('id', id);
  }, 60_000);

  it('A1-003: DELETE por PostgREST rechaza al admin y conserva cruce real y bitácora', () => {
    expect(resultado.real).toBe('denegado');
    expect(existeDespues).toBe(true);
    expect(bitacoraDespues).toBe(1);
    expect(auditorias).toBe(0);
  });
  it('A1-G1-02: el borrado físico de un cruce real solo debería existir dentro de borrar_cruzamiento (que lo rechaza si no es de prueba)', () => {
    expect(existeDespues).toBe(true);
  });
});
