/**
 * Auditoría integral, Corrida 1, grupo G11: LA TEMPORADA SIMULADA DE PUNTA A PUNTA.
 *
 * Prueba permanente. Recorre una temporada completa con las mismas llamadas que
 * hace el frontend (réplica en `g11-api.ts`), con tres usuarios reales (un admin
 * y dos operarios propios `aud-g11-...@test.local`), una especie propia y datos
 * `es_prueba = true` con código `AUD-G11-...`. Lo que importa es lo que aparece
 * ENTRE pasos, cuando el resultado de un flujo alimenta al siguiente.
 *
 * Secuencia (cada `describe` es un paso; comparten estado, así que se ejecutan
 * en orden):
 *
 *  P0  preparación (usuarios, especie, V1 activa de la especie, catálogos)
 *  P1  crear cruces (admin, con linaje) + el operario intenta lo del admin
 *  P2  polinizar: dos operarios sobre el mismo cruce
 *  P3  cosecha (frutos), siembra (insumos y sustratos), germinación
 *  P4  individuos: individualizar, clonar, etiquetas con id resoluble
 *  P5  rondas y evaluaciones (parciales, tipeos, borradores) y su cierre
 *  P6  corregir y anular (admin)
 *  P7  rankear (obtener_ranking_operativo / obtener_scoring_planta), a mano
 *  P8  congelar el ranking
 *  P9  un cruce se archiva a mitad de temporada y se restaura
 *  P10 versión nueva de scoring: crear, activar, rankear de nuevo
 *  P11 comparar snapshot con el vivo, comparar rondas, series y dashboard
 *  P12 traslado a un predio (crear predio)
 *  P13 bajas: individual y en lote
 *  P14 PCR
 *  P15 proceso finalizado y barrido final (linaje, autores, cadena de estados)
 *  P16 coda: una versión nueva que agrega una métrica (lo que B6 protege y lo que no)
 *  Cierre: la versión global (la real) no se tocó
 *
 * Reglas del archivo:
 *  - lo que no se cumple es un hallazgo `A1-G11-NN` y queda como `it.fails`;
 *  - si otro grupo ya lo reportó, el `it.fails` lleva su ID (A1-G2-..., A1-G4-...,
 *    A1-G5-..., A1-G6-...) en vez de abrir uno nuevo;
 *  - la preparación y la limpieza usan service_role; los permisos se prueban con
 *    clientes logueados;
 *  - la versión de scoring global (la real) no se toca: la temporada usa una
 *    especie propia con su propia V1 y V2.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  auditDesde, auditDeCruce, BASE_COMPLETA, casiIgual, completa, CONFIG_V1, CONFIG_V2, contenidoQrIndividuo,
  crearVersionV1, interpretarQR, limpiarTemporada, maxAuditId, metricasDeCaptura, prepararContexto,
  puntajeIndependiente, unificarModelo, type ContextoG11, type EstadoLimpieza, type VisitaModelo,
} from './g11-helpers';
import { puntajeEsperado } from '../scoring-esperado';
import * as api from './g11-api';

let ctx: ContextoG11;

/** Todo lo que crea la temporada, para limpiarlo aunque la prueba falle a medias. */
const limp: EstadoLimpieza = {
  plantaIds: [], snapshotIds: [], versionIds: [], predioIds: [],
  catalogo: { insumos: [], sustratos: [], contenedores: [] },
  variedadIds: [], storagePaths: [], usuarioIds: [], especieId: null,
};

/** Estado compartido entre pasos. */
const S: {
  mama1?: string; papa1?: string; papa2?: string;
  nombreMama1?: string; nombrePapa1?: string; nombrePapa2?: string; textoCruza?: string;
  CA?: string; CC?: string; CD?: string;
  codCA?: string; codCC?: string; codCD?: string;
  v1?: string; v2?: string; v3?: string;
  insumos: string[]; sustratos: string[]; contenedor?: string;
} = { insumos: [], sustratos: [] };

/** Todo lo que un operario recibió por RPC/SELECT durante la temporada, para el barrido de linaje del final. */
const recibidoPorOperario: Array<{ etiqueta: string; json: string }> = [];
const registrarLectura = (etiqueta: string, valor: unknown) => recibidoPorOperario.push({ etiqueta, json: JSON.stringify(valor) });

const usuarios = () => [ctx.adminId, ctx.opAId, ctx.opBId];
const noSeRepite = <T>(arr: T[]) => new Set(arr).size === arr.length;

/**
 * Desde 20261024090000 (v3) la lista de cruces y el panel excluyen los cruces de prueba, y los
 * de la temporada lo son. Para ver lo que vería el usuario con cruces reales, la lectura se hace
 * con los cruces de la especie de la corrida marcados como reales y se restaura la marca al terminar.
 */
async function comoReales<T>(leer: () => Promise<T>): Promise<T> {
  const { data } = await ctx.service.from('plantas').update({ es_prueba: false }).eq('especie_id', ctx.especieId).eq('es_prueba', true).select('id');
  const ids = (data ?? []).map((f) => f.id as string);
  try {
    return await leer();
  } finally {
    if (ids.length) await ctx.service.from('plantas').update({ es_prueba: true }).in('id', ids);
  }
}

beforeAll(async () => {
  ctx = await prepararContexto();
  limp.especieId = ctx.especieId;
  limp.usuarioIds.push(ctx.adminId, ctx.opAId, ctx.opBId);
}, 120_000);

afterAll(async () => {
  // audit_log es append-only: se cuenta lo que esta corrida deja de forma permanente antes de borrar a sus autores.
  const { count: filasAudit } = await ctx.service.from('audit_log').select('id', { count: 'exact', head: true }).in('usuario_id', usuarios());
  const r = await limpiarTemporada(ctx, limp);
  // eslint-disable-next-line no-console
  console.log(`[g11] limpieza: avisos=${JSON.stringify(r.avisos)} restos=${JSON.stringify(r.restos)} filas_audit_de_la_corrida=${filasAudit}`);
}, 120_000);

// ===========================================================================
// P0 · Preparación
// ===========================================================================

describe('P0 · preparación: versión vigente de la especie y catálogos de siembra', () => {
  it('la V1 de la especie queda activa y es la que resuelve la base hoy (no la global)', async () => {
    S.v1 = await crearVersionV1(ctx, `AUD-G11 V1 ${ctx.R}`);
    limp.versionIds.push(S.v1);
    const { data, error } = await ctx.service.rpc('resolver_scoring_version', { p_especie_id: ctx.especieId, p_fase: 'evaluacion_anual', p_fecha: ctx.hoy });
    expect(error).toBeNull();
    expect(data).toBe(S.v1);
  });

  it('la especie tiene sus propios rangos de revisión (calibre: bandera desde 40 mm; brix: sin bandera, como el global), para que la temporada no dependa de los rangos que otros cambien', async () => {
    const base = { especie_id: ctx.especieId, fase: 'evaluacion_anual', vigente_desde: '2020-01-01', activo: true, created_by: ctx.adminId };
    const { error } = await ctx.service.from('rango_referencia').insert([
      { ...base, metrica: 'calibre_mm', minimo_esperado: 14, maximo_esperado: 24, limite_revision_superior: 40 },
      { ...base, metrica: 'brix', minimo_esperado: 10, maximo_esperado: 18 },
    ]);
    expect(error).toBeNull();
  });

  it('el admin crea los catálogos de siembra (contenedor, 2 insumos, 2 sustratos) con las llamadas de /catalogos', async () => {
    const cont = await api.crearContenedor(ctx.admin, { nombre: `AUD-G11 contenedor ${ctx.R}`, capacidad_litros: 3 });
    const i1 = await api.crearInsumo(ctx.admin, { nombre: `AUD-G11 fungicida ${ctx.R}`, tipo: 'fungicida' });
    const i2 = await api.crearInsumo(ctx.admin, { nombre: `AUD-G11 escarificante ${ctx.R}`, tipo: 'escarificante' });
    const s1 = await api.crearSustrato(ctx.admin, { nombre: `AUD-G11 turba ${ctx.R}` });
    const s2 = await api.crearSustrato(ctx.admin, { nombre: `AUD-G11 perlita ${ctx.R}` });
    S.contenedor = cont.id;
    S.insumos = [i1.id, i2.id];
    S.sustratos = [s1.id, s2.id];
    limp.catalogo.contenedores.push(cont.id);
    limp.catalogo.insumos.push(i1.id, i2.id);
    limp.catalogo.sustratos.push(s1.id, s2.id);
    // Un operario no puede tocar los catálogos.
    expect((await api.falla(() => api.crearInsumo(ctx.opA, { nombre: `AUD-G11 intruso ${ctx.R}`, tipo: 'otro' })))?.code).toBe('42501');
  });
});

// ===========================================================================
// P1 · Crear cruces (admin, con linaje)
// ===========================================================================

describe('P1 · crear cruces (admin, con linaje) y lo que el operario no puede', () => {
  it('el admin crea variedades de mamá y papá; un operario también puede crear una (T05, a su nombre)', async () => {
    S.nombreMama1 = `AUDG11MAMA${ctx.R}`;
    S.nombrePapa1 = `AUDG11PAPAUNO${ctx.R}`;
    S.nombrePapa2 = `AUDG11PAPADOS${ctx.R}`;
    const m1 = await api.crearVariedad(ctx.admin, ctx.adminId, ctx.especieId, S.nombreMama1);
    const p1 = await api.crearVariedad(ctx.admin, ctx.adminId, ctx.especieId, S.nombrePapa1);
    const p2 = await api.crearVariedad(ctx.opA, ctx.opAId, ctx.especieId, S.nombrePapa2);
    S.mama1 = m1.id; S.papa1 = p1.id; S.papa2 = p2.id;
    limp.variedadIds.push(m1.id, p1.id, p2.id);
    const { data } = await ctx.service.from('variedades').select('id, created_by').eq('id', p2.id).single();
    expect(data?.created_by).toBe(ctx.opAId);
  });

  it('el admin crea tres cruces con linaje: quedan `es_prueba`, sin_empezar, y audit_log registra alta_cruce con autor y linaje', async () => {
    S.textoCruza = `AUDG11CRUZA${ctx.R}`;
    const marca = await maxAuditId(ctx);
    S.codCA = `AUD-G11-01-${ctx.R}`; S.codCC = `AUD-G11-02-${ctx.R}`; S.codCD = `AUD-G11-03-${ctx.R}`;
    const a = await api.crearPlanta(ctx.admin, { codigo_sistema: S.codCA, especie_id: ctx.especieId, cruzamiento: `${S.textoCruza}-A`, mamaId: S.mama1, papaId: S.papa1, esPrueba: true });
    const c = await api.crearPlanta(ctx.admin, { codigo_sistema: S.codCC, especie_id: ctx.especieId, cruzamiento: `${S.textoCruza}-C`, mamaId: S.papa2, papaId: S.mama1, esPrueba: true });
    const d = await api.crearPlanta(ctx.admin, { codigo_sistema: S.codCD, especie_id: ctx.especieId, cruzamiento: `${S.textoCruza}-D`, mamaId: S.mama1, papaId: S.papa2, esPrueba: true });
    S.CA = a.id; S.CC = c.id; S.CD = d.id;
    limp.plantaIds.push(a.id, c.id, d.id);

    const { data: filas } = await ctx.service.from('plantas').select('id, estado, es_prueba, eliminado_at, mama_id, papa_id, cruzamiento').in('id', [a.id, c.id, d.id]);
    expect(filas).toHaveLength(3);
    for (const f of filas!) {
      expect(f.estado).toBe('sin_empezar');
      expect(f.es_prueba).toBe(true);
      expect(f.eliminado_at).toBeNull();
    }
    const altas = await auditDesde(ctx, marca, { accion: 'alta_cruce' });
    expect(altas).toHaveLength(3);
    for (const fila of altas) {
      expect(fila.usuario_id).toBe(ctx.adminId);
      expect(fila.campos_expuestos).toEqual(['cruzamiento', 'mama_id', 'papa_id']);
    }
    const altaA = altas.find((f) => f.planta_id === a.id)!;
    expect(altaA.detalle.codigo_sistema).toBe(S.codCA);
    expect(altaA.detalle.es_prueba).toBe(true);
    expect(altaA.detalle.nuevo).toMatchObject({ mama_id: S.mama1, papa_id: S.papa1 });
    expect(altaA.detalle.nuevo).not.toHaveProperty('cruzamiento');
  });

  it('mala señal: repetir el alta del mismo cruce falla con 23505, no duplica y no genera una segunda alta_cruce', async () => {
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.crearPlanta(ctx.admin, { codigo_sistema: S.codCA!, especie_id: ctx.especieId, cruzamiento: `${S.textoCruza}-A`, mamaId: S.mama1, papaId: S.papa1, esPrueba: true }));
    expect(err?.code).toBe('23505');
    const { count } = await ctx.service.from('plantas').select('id', { count: 'exact', head: true }).eq('codigo_sistema', S.codCA!);
    expect(count).toBe(1);
    expect(await auditDesde(ctx, marca, { accion: 'alta_cruce' })).toHaveLength(0);
  });

  it('el operario intenta crear un cruce, cambiar linaje, leer el linaje por SELECT y archivar: todo falla y no deja rastro', async () => {
    const marca = await maxAuditId(ctx);
    const codigoIntruso = `AUD-G11-INTRUSO-${ctx.R}`;
    expect((await api.falla(() => api.crearPlanta(ctx.opA, { codigo_sistema: codigoIntruso, especie_id: ctx.especieId, esPrueba: true })))?.code).toBe('42501');
    expect((await api.falla(() => api.actualizarLinaje(ctx.opA, { plantaId: S.CA!, cruzamiento: 'X', mamaId: S.papa1!, papaId: S.mama1! })))?.code).toBe('42501');
    const { error: errSelect } = await ctx.opA.from('plantas').select('id, cruzamiento, mama_id, papa_id').eq('id', S.CA!);
    expect(errSelect?.code).toBe('42501');
    expect((await api.falla(() => api.borrarCruzamiento(ctx.opA, S.CA!, 'soft')))?.code).toBe('42501');
    const { error: errArch } = await ctx.opA.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', S.CA!);
    expect(errArch?.code).toBe('42501');

    const { count } = await ctx.service.from('plantas').select('id', { count: 'exact', head: true }).eq('codigo_sistema', codigoIntruso);
    expect(count).toBe(0);
    const { data: ca } = await ctx.service.from('plantas').select('cruzamiento, mama_id, papa_id, eliminado_at').eq('id', S.CA!).single();
    expect(ca).toMatchObject({ cruzamiento: `${S.textoCruza}-A`, mama_id: S.mama1, papa_id: S.papa1, eliminado_at: null });
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opAId] })).toHaveLength(0);
  });

  it('ficha: el admin ve el linaje y queda lectura_linaje; el operario recibe la ficha SIN linaje y queda lectura_ficha sin esos campos', async () => {
    const marca = await maxAuditId(ctx);
    const fichaAdmin = await api.obtenerFicha(ctx.admin, S.CA!);
    expect(fichaAdmin.cruzamiento).toBe(`${S.textoCruza}-A`);
    expect(fichaAdmin.mama_nombre).toBe(S.nombreMama1);
    expect(fichaAdmin.papa_nombre).toBe(S.nombrePapa1);

    const fichaOp = await api.obtenerFicha(ctx.opB, S.CA!);
    registrarLectura('obtener_planta (operario)', fichaOp);
    for (const k of ['cruzamiento', 'mama', 'papa', 'mama_id', 'papa_id', 'mama_nombre', 'papa_nombre']) expect(fichaOp).not.toHaveProperty(k);

    const lecturas = await auditDesde(ctx, marca);
    const delAdmin = lecturas.find((f) => f.usuario_id === ctx.adminId && f.accion === 'lectura_linaje');
    const delOp = lecturas.find((f) => f.usuario_id === ctx.opBId && f.accion === 'lectura_ficha');
    expect(delAdmin?.planta_id).toBe(S.CA);
    expect(delAdmin?.campos_expuestos).toEqual(expect.arrayContaining(['cruzamiento', 'mama', 'papa']));
    expect(delOp?.planta_id).toBe(S.CA);
    expect(delOp?.campos_expuestos).toEqual(['codigo_sistema', 'especie_id', 'estado']);
  });

  it('el admin edita el linaje de CD por la RPC: queda escritura_linaje con anterior y nuevo; repetir la misma llamada es inofensivo', async () => {
    const marca = await maxAuditId(ctx);
    const nuevo = { plantaId: S.CD!, cruzamiento: `${S.textoCruza}-D2`, mamaId: S.papa2!, papaId: S.papa1! };
    await api.actualizarLinaje(ctx.admin, nuevo);
    await api.actualizarLinaje(ctx.admin, nuevo); // mala señal: la respuesta se pierde y la app reintenta
    const filas = await auditDesde(ctx, marca, { accion: 'escritura_linaje' });
    expect(filas).toHaveLength(2);
    expect(filas[0].usuario_id).toBe(ctx.adminId);
    expect(filas[0].detalle.anterior).toMatchObject({ mama_id: S.mama1, papa_id: S.papa2 });
    expect(filas[0].detalle.nuevo).toMatchObject({ mama_id: S.papa2, papa_id: S.papa1 });
    expect(JSON.stringify(filas[0].detalle)).not.toContain(S.textoCruza!);
    // El segundo registro es un no-op auditado: anterior == nuevo.
    expect(filas[1].detalle.anterior).toMatchObject(filas[1].detalle.nuevo);
    const { data } = await ctx.service.from('plantas').select('cruzamiento, mama_id, papa_id').eq('id', S.CD!).single();
    expect(data).toMatchObject({ cruzamiento: `${S.textoCruza}-D2`, mama_id: S.papa2, papa_id: S.papa1 });
  });
});

// ===========================================================================
// P2 · Polinizar: dos operarios sobre el mismo cruce
// ===========================================================================

describe('P2 · polinizar: varias sesiones, dos operarios sobre el mismo cruce', () => {
  it('avanzar a polinización lo hace el admin (U-03), deja cambio_estado con su autor, y repetir el mismo avance no hace nada', async () => {
    const marca = await maxAuditId(ctx);
    await api.actualizarEstado(ctx.admin, S.CA!, 'polinizacion');
    await api.actualizarEstado(ctx.admin, S.CC!, 'polinizacion');
    await api.actualizarEstado(ctx.admin, S.CD!, 'polinizacion');
    // Mala señal: el mismo avance otra vez (mismo estado destino) es un no-op sin ruido.
    await api.actualizarEstado(ctx.admin, S.CA!, 'polinizacion');
    const cambios = await auditDesde(ctx, marca, { accion: 'cambio_estado' });
    expect(cambios).toHaveLength(3);
    const deCA = cambios.find((f) => f.planta_id === S.CA)!;
    expect(deCA.usuario_id).toBe(ctx.adminId);
    expect(deCA.detalle).toMatchObject({ estado_anterior: 'sin_empezar', estado_nuevo: 'polinizacion' });
    expect(cambios.find((f) => f.planta_id === S.CC)!.usuario_id).toBe(ctx.adminId);
  });

  it('el operario no puede cambiar la fase (U-03): 42501 y el cruce no cambia', async () => {
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.actualizarEstado(ctx.opB, S.CA!, 'siembra_semilla'));
    expect(err?.code).toBe('42501');
    expect((await api.falla(() => api.actualizarEstado(ctx.opB, S.CA!, 'cosecha')))?.message).toBe('Solo un admin puede cambiar la fase de un cruce.');
    const { data } = await ctx.service.from('plantas').select('estado').eq('id', S.CA!).single();
    expect(data?.estado).toBe('polinizacion');
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opBId] })).toHaveLength(0);
  });

  it('tres sesiones de dos operarios (A, B, A): el total es 100, la legacy refleja la ÚLTIMA sesión y audit_log registra a cada autor', async () => {
    const marca = await maxAuditId(ctx);
    await api.agregarPolinizacionEvento(ctx.opA, ctx.opAId, S.CA!, { fecha: ctx.d(-150), n_flores_cruzadas: 40 });
    await api.agregarPolinizacionEvento(ctx.opB, ctx.opBId, S.CA!, { fecha: ctx.d(-148), n_flores_cruzadas: 35 });
    await api.agregarPolinizacionEvento(ctx.opA, ctx.opAId, S.CA!, { fecha: ctx.d(-145), n_flores_cruzadas: 25, notas: 'tercera sesión' });

    const sesiones = await api.listarPolinizacionEventos(ctx.opB, S.CA!);
    expect(sesiones.map((s) => s.n_flores_cruzadas)).toEqual([40, 35, 25]);
    expect(sesiones.reduce((t, s) => t + s.n_flores_cruzadas, 0)).toBe(100);

    const { data: planta } = await ctx.service.from('plantas').select('fecha_polinizacion, n_flores_cruzadas').eq('id', S.CA!).single();
    expect(planta).toEqual({ fecha_polinizacion: ctx.d(-145), n_flores_cruzadas: 25 });

    const altas = await auditDesde(ctx, marca, { accion: 'creacion_polinizacion_evento', plantaId: S.CA });
    expect(altas.map((f) => f.usuario_id)).toEqual([ctx.opAId, ctx.opBId, ctx.opAId]);

    const { count: historial } = await ctx.service.from('registros_evento').select('id', { count: 'exact', head: true }).eq('planta_id', S.CA!).eq('tipo_evento', 'polinizacion');
    expect(historial).toBe(3);
  });

  it('«Quitar última» respeta autoría: B no puede quitar la de A (la API no avisa), A sí, y la sesión se puede volver a cargar', async () => {
    // La última por fecha es de A (25). B intenta quitarla: RLS la deja en 0 filas, sin error (A1-G2-04, ya reportado).
    const marca = await maxAuditId(ctx);
    await api.quitarUltimoPolinizacionEvento(ctx.opB, S.CA!);
    expect(await api.listarPolinizacionEventos(ctx.opB, S.CA!)).toHaveLength(3);
    expect(await auditDesde(ctx, marca, { accion: 'eliminacion_polinizacion_evento' })).toHaveLength(0);

    const quitada = await api.quitarUltimoPolinizacionEvento(ctx.opA, S.CA!);
    expect(quitada.n_flores_cruzadas).toBe(25);
    const elim = await auditDesde(ctx, marca, { accion: 'eliminacion_polinizacion_evento' });
    expect(elim).toHaveLength(1);
    expect(elim[0].usuario_id).toBe(ctx.opAId);
    const { data: planta } = await ctx.service.from('plantas').select('fecha_polinizacion, n_flores_cruzadas').eq('id', S.CA!).single();
    expect(planta).toEqual({ fecha_polinizacion: ctx.d(-148), n_flores_cruzadas: 35 }); // la legacy vuelve a la anterior

    await api.agregarPolinizacionEvento(ctx.opA, ctx.opAId, S.CA!, { fecha: ctx.d(-145), n_flores_cruzadas: 25 });
    const sesiones = await api.listarPolinizacionEventos(ctx.opA, S.CA!);
    expect(sesiones.reduce((t, s) => t + s.n_flores_cruzadas, 0)).toBe(100);
  });

  it('linaje → polinización → ranking varietal: las flores de CA cuentan para su mamá y papá; al corregir el papá por la RPC, el total se MUEVE de variedad (retroactivo) y queda escritura_linaje', async () => {
    const antes = await api.obtenerRankingPolinizacionVarietal(ctx.admin, ctx.especieId, 'ambos');
    const fila = (id: string) => antes.filas.find((f) => f.variedad_id === id);
    expect(fila(S.papa1!)).toMatchObject({ flores_totales: 100, sesiones_polinizacion: 3 });
    expect(fila(S.mama1!)).toMatchObject({ flores_totales: 100, sesiones_polinizacion: 3 });
    expect(antes.floresReales).toBe(100);

    const marca = await maxAuditId(ctx);
    await api.actualizarLinaje(ctx.admin, { plantaId: S.CA!, cruzamiento: `${S.textoCruza}-A`, mamaId: S.mama1!, papaId: S.papa2! });
    const despues = await api.obtenerRankingPolinizacionVarietal(ctx.admin, ctx.especieId, 'papa');
    expect(despues.filas.find((f) => f.variedad_id === S.papa2)).toMatchObject({ flores_totales: 100, sesiones_polinizacion: 3 });
    expect(despues.filas.find((f) => f.variedad_id === S.papa1)?.flores_totales ?? 0).toBe(0);
    expect(despues.floresReales).toBe(100); // el total real no cambia, solo a quién se atribuye

    const aud = await auditDesde(ctx, marca, { accion: 'escritura_linaje', plantaId: S.CA });
    expect(aud).toHaveLength(1);
    expect(aud[0].detalle.anterior).toMatchObject({ mama_id: S.mama1, papa_id: S.papa1 });
    expect(aud[0].detalle.nuevo).toMatchObject({ mama_id: S.mama1, papa_id: S.papa2 });
    // Cada consulta del ranking varietal deja su fila de lectura con el autor.
    const lecturas = await auditDesde(ctx, marca, { accion: 'lectura_ranking_polinizacion_varietal' });
    expect(lecturas).toHaveLength(1);
    expect(lecturas[0].usuario_id).toBe(ctx.adminId);
    // El operario no puede consultar el ranking varietal (linaje agregado): 42501 y sin rastro.
    const marca2 = await maxAuditId(ctx);
    expect((await api.falla(() => api.obtenerRankingPolinizacionVarietal(ctx.opA, ctx.especieId)))?.code).toBe('42501');
    expect(await auditDesde(ctx, marca2, { usuarioIds: [ctx.opAId] })).toHaveLength(0);
  });

  // A1-G2-06 (ya reportado): quitar la sesión no toca la bitácora narrativa.
  it.fails('la bitácora refleja las sesiones vigentes: una sesión quitada y vuelta a cargar no deja una fila fantasma (A1-G2-06)', async () => {
    const { count: sesiones } = await ctx.service.from('polinizacion_evento').select('id', { count: 'exact', head: true }).eq('planta_id', S.CA!);
    const { count: historial } = await ctx.service.from('registros_evento').select('id', { count: 'exact', head: true }).eq('planta_id', S.CA!).eq('tipo_evento', 'polinizacion').is('eliminado_at', null);
    expect(historial).toBe(sesiones);
  });

  // A1-G2-05 (ya reportado): sin clave de idempotencia, el doble toque duplica la sesión.
  it.fails('mala señal: el mismo envío de una sesión repetido dos veces no duplica la sesión ni el total (A1-G2-05)', async () => {
    const antes = (await api.listarPolinizacionEventos(ctx.opB, S.CD!)).length;
    const envio = { fecha: ctx.d(-140), n_flores_cruzadas: 10 };
    await Promise.all([
      api.agregarPolinizacionEvento(ctx.opB, ctx.opBId, S.CD!, envio),
      api.agregarPolinizacionEvento(ctx.opB, ctx.opBId, S.CD!, envio),
    ]);
    const despues = (await api.listarPolinizacionEventos(ctx.opB, S.CD!)).length;
    expect(despues - antes).toBe(1);
  });
});

// ===========================================================================
// P3 · Cosecha, siembra y germinación
// ===========================================================================

const ORDEN_FASES = [
  'sin_empezar', 'polinizacion', 'cosecha', 'siembra_semilla', 'germinacion', 'trasplante',
  'crecimiento', 'evaluacion_anual', 'traslado_destino', 'proceso_finalizado',
] as const;

/** Avanza de a una fase, como hace el botón «Avanzar» de la ficha. */
async function avanzarHasta(cliente: typeof ctx.opA, plantaId: string, destino: (typeof ORDEN_FASES)[number]) {
  const { data } = await ctx.service.from('plantas').select('estado').eq('id', plantaId).single();
  let i = ORDEN_FASES.indexOf(data!.estado as (typeof ORDEN_FASES)[number]);
  const meta = ORDEN_FASES.indexOf(destino);
  while (i < meta) {
    i += 1;
    await api.actualizarEstado(cliente, plantaId, ORDEN_FASES[i]);
  }
}

describe('P3 · cosecha con frutos, siembra con insumos y sustratos, germinación', () => {
  it('cosecha: A avanza y registra la fecha y el total; A y B agregan frutos; el correlativo del trigger y las auditorías cuadran', async () => {
    await api.actualizarEstado(ctx.admin, S.CA!, 'cosecha');
    const marca = await maxAuditId(ctx);
    await api.actualizarCosecha(ctx.opA, ctx.opAId, S.CA!, { fecha_cosecha: ctx.d(-120), n_semillas: 36, hoy: ctx.hoy });
    const f1 = await api.agregarCosechaFruto(ctx.opA, ctx.opAId, S.CA!, 12);
    const f2 = await api.agregarCosechaFruto(ctx.opB, ctx.opBId, S.CA!, 15);
    const f3 = await api.agregarCosechaFruto(ctx.opA, ctx.opAId, S.CA!, 9);
    expect([f1.numero_fruto, f2.numero_fruto, f3.numero_fruto]).toEqual([1, 2, 3]);

    const frutos = await api.listarCosechaFrutos(ctx.opB, S.CA!);
    expect(frutos.reduce((t, f) => t + f.cantidad_semillas, 0)).toBe(36); // coincide con n_semillas tipeado

    const creaciones = await auditDesde(ctx, marca, { accion: 'creacion_cosecha_fruto', plantaId: S.CA });
    expect(creaciones.map((f) => [f.usuario_id, f.detalle.numero_fruto, f.detalle.cantidad_semillas])).toEqual([
      [ctx.opAId, 1, 12], [ctx.opBId, 2, 15], [ctx.opAId, 3, 9],
    ]);
    const fase = (await auditDesde(ctx, marca, { accion: 'escritura_fase', plantaId: S.CA })).find((f) => f.detalle.nuevo.n_semillas === 36);
    expect(fase?.usuario_id).toBe(ctx.opAId);
    expect(fase?.detalle.anterior).toMatchObject({ fecha_cosecha: null, n_semillas: null });
    expect(fase?.detalle.nuevo).toMatchObject({ fecha_cosecha: ctx.d(-120), n_semillas: 36 });
  });

  it('mala señal: guardar la cosecha dos veces con el mismo contenido no cambia la ficha ni genera una segunda escritura_fase', async () => {
    const marca = await maxAuditId(ctx);
    await api.actualizarCosecha(ctx.opA, ctx.opAId, S.CA!, { fecha_cosecha: ctx.d(-120), n_semillas: 36, hoy: ctx.hoy });
    const { data } = await ctx.service.from('plantas').select('fecha_cosecha, n_semillas').eq('id', S.CA!).single();
    expect(data).toEqual({ fecha_cosecha: ctx.d(-120), n_semillas: 36 });
    expect(await auditDesde(ctx, marca, { accion: 'escritura_fase', plantaId: S.CA })).toHaveLength(0);
  });

  it('el operario intenta quitar la marca de prueba, renombrar el código y archivar el cruce por PATCH directo: todo falla (sin grant de columna) y no deja rastro', async () => {
    const marca = await maxAuditId(ctx);
    const r1 = await ctx.opB.from('plantas').update({ es_prueba: false }).eq('id', S.CA!);
    const r2 = await ctx.opB.from('plantas').update({ codigo_sistema: `AUD-G11-HACK-${ctx.R}` }).eq('id', S.CA!);
    const r3 = await ctx.opB.from('plantas').update({ eliminado_at: new Date().toISOString() }).eq('id', S.CA!);
    const r4 = await ctx.opB.from('plantas').update({ mama_id: S.papa2 }).eq('id', S.CA!);
    expect([r1.error?.code, r2.error?.code, r3.error?.code, r4.error?.code]).toEqual(['42501', '42501', '42501', '42501']);
    const { data } = await ctx.service.from('plantas').select('es_prueba, codigo_sistema, eliminado_at, mama_id').eq('id', S.CA!).single();
    expect(data).toEqual({ es_prueba: true, codigo_sistema: S.codCA, eliminado_at: null, mama_id: S.mama1 });
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opBId] })).toHaveLength(0);
  });

  it('siembra: A avanza y siembra con 2 insumos y 2 sustratos (60/40); la ficha, las junctions y la auditoría coinciden', async () => {
    await api.actualizarEstado(ctx.admin, S.CA!, 'siembra_semilla');
    const marca = await maxAuditId(ctx);
    await api.actualizarSiembra(ctx.opA, ctx.opAId, S.CA!, {
      escarificacion_subtipo: 'estratificacion', escarificacion_duracion_dias: 30, contenedor_id: S.contenedor,
      insumo_ids: S.insumos, sustratos: [{ sustrato_id: S.sustratos[0], porcentaje: 60 }, { sustrato_id: S.sustratos[1], porcentaje: 40 }],
      semillas_sembradas: 36, protocoloEscarificacion: 'Estratificación en frío', hoy: ctx.hoy,
    });
    const { data: planta } = await ctx.service.from('plantas').select('escarificacion_subtipo, escarificacion_duracion_dias, contenedor_id, semillas_sembradas').eq('id', S.CA!).single();
    expect(planta).toEqual({ escarificacion_subtipo: 'estratificacion', escarificacion_duracion_dias: 30, contenedor_id: S.contenedor, semillas_sembradas: 36 });
    expect((await api.listarInsumoIdsDePlanta(ctx.opB, S.CA!)).sort()).toEqual([...S.insumos].sort());
    const sustratos = await api.listarSustratosDePlanta(ctx.opB, S.CA!);
    expect(sustratos.reduce((t, s) => t + Number(s.porcentaje), 0)).toBe(100);

    const fase = await auditDesde(ctx, marca, { accion: 'escritura_fase', plantaId: S.CA });
    expect(fase).toHaveLength(1);
    expect(fase[0].usuario_id).toBe(ctx.opAId);
    expect(fase[0].detalle.nuevo).toMatchObject({ escarificacion_subtipo: 'estratificacion', escarificacion_duracion_dias: 30, contenedor_id: S.contenedor, semillas_sembradas: 36 });
    const { data: bitacora } = await ctx.service.from('registros_evento').select('notas, datos').eq('planta_id', S.CA!).eq('tipo_evento', 'siembra_semilla');
    expect(bitacora).toHaveLength(1);
    expect(bitacora![0].notas).toBe('Estratificación en frío');
    expect(bitacora![0].datos.insumo_ids).toHaveLength(2);
  });

  it('mala señal: reenviar la misma siembra deja el mismo set de insumos y sustratos (reemplazo, no acumulación)', async () => {
    const marca = await maxAuditId(ctx);
    const envio = {
      escarificacion_subtipo: 'estratificacion', escarificacion_duracion_dias: 30, contenedor_id: S.contenedor,
      insumo_ids: S.insumos, sustratos: [{ sustrato_id: S.sustratos[0], porcentaje: 60 }, { sustrato_id: S.sustratos[1], porcentaje: 40 }],
      semillas_sembradas: 36, protocoloEscarificacion: 'Estratificación en frío', hoy: ctx.hoy,
    };
    await api.actualizarSiembra(ctx.opA, ctx.opAId, S.CA!, envio);
    expect(await api.listarInsumoIdsDePlanta(ctx.opB, S.CA!)).toHaveLength(2);
    expect(await api.listarSustratosDePlanta(ctx.opB, S.CA!)).toHaveLength(2);
    expect(await auditDesde(ctx, marca, { accion: 'escritura_fase', plantaId: S.CA })).toHaveLength(0);
  });

  it('B corrige la siembra (1 insumo, 1 sustrato al 100 %, 34 semillas): se reemplaza el set completo y escritura_fase guarda 36 → 34 con su autor', async () => {
    const marca = await maxAuditId(ctx);
    await api.actualizarSiembra(ctx.opB, ctx.opBId, S.CA!, {
      escarificacion_subtipo: 'quimica', contenedor_id: S.contenedor, insumo_ids: [S.insumos[0]],
      sustratos: [{ sustrato_id: S.sustratos[0], porcentaje: 100 }], semillas_sembradas: 34, hoy: ctx.hoy,
    });
    expect(await api.listarInsumoIdsDePlanta(ctx.opA, S.CA!)).toEqual([S.insumos[0]]);
    expect(await api.listarSustratosDePlanta(ctx.opA, S.CA!)).toEqual([{ sustrato_id: S.sustratos[0], porcentaje: 100 }]);
    const fase = await auditDesde(ctx, marca, { accion: 'escritura_fase', plantaId: S.CA });
    expect(fase).toHaveLength(1);
    expect(fase[0].usuario_id).toBe(ctx.opBId);
    expect(fase[0].detalle.anterior).toMatchObject({ semillas_sembradas: 36, escarificacion_subtipo: 'estratificacion', escarificacion_duracion_dias: 30 });
    expect(fase[0].detalle.nuevo).toMatchObject({ semillas_sembradas: 34, escarificacion_subtipo: 'quimica', escarificacion_duracion_dias: null });
  });

  // A1-022: ambas junctions comparten una acción con tabla y valores.
  it('el cambio de insumos y sustratos de la resiembra deja rastro en audit_log con el set anterior y el nuevo (A1-G2-09)', async () => {
    const { data } = await ctx.service.from('audit_log').select('usuario_id, detalle').eq('planta_id', S.CA!).eq('accion', 'cambio_material_siembra');
    expect((data ?? []).length).toBeGreaterThan(0);
    expect(data!.some(f => f.usuario_id === ctx.opBId && f.detalle.tabla === 'plantas_insumo' && f.detalle.operacion === 'DELETE' && f.detalle.anterior)).toBe(true);
    expect(data!.some(f => f.usuario_id === ctx.opBId && f.detalle.tabla === 'plantas_sustrato' && f.detalle.operacion === 'INSERT' && f.detalle.nuevo)).toBe(true);
  });

  // A1-189: las RPC devuelven el evento previo si no hay cambios reales.
  it('mala señal: reenviar la cosecha o la siembra no agrega filas idénticas a la bitácora de la ficha (A1-G11-01)', async () => {
    const { count: cosecha } = await ctx.service.from('registros_evento').select('id', { count: 'exact', head: true }).eq('planta_id', S.CA!).eq('tipo_evento', 'cosecha');
    const { count: siembra } = await ctx.service.from('registros_evento').select('id', { count: 'exact', head: true }).eq('planta_id', S.CA!).eq('tipo_evento', 'siembra_semilla');
    // Se guardó la cosecha 2 veces (la segunda idéntica) y la siembra 3 veces (una idéntica): una fila por cambio real sería 1 y 2.
    expect([cosecha, siembra]).toEqual([1, 2]);
  });

  it('germinación: A avanza; A y B registran 3 eventos (10, 8, 6); el total es 24 de 34 sembradas y cada evento tiene su autor', async () => {
    await api.actualizarEstado(ctx.admin, S.CA!, 'germinacion');
    const marca = await maxAuditId(ctx);
    await api.crearGerminacionEvento(ctx.opA, ctx.opAId, { planta_id: S.CA!, fecha: ctx.d(-100), cantidad_nueva: 10 });
    await api.crearGerminacionEvento(ctx.opB, ctx.opBId, { planta_id: S.CA!, fecha: ctx.d(-95), cantidad_nueva: 8 });
    await api.crearGerminacionEvento(ctx.opA, ctx.opAId, { planta_id: S.CA!, fecha: ctx.d(-90), cantidad_nueva: 6 });
    const eventos = await api.listarGerminacionEventos(ctx.opB, S.CA!);
    const total = eventos.reduce((t, e) => t + e.cantidad_nueva, 0);
    expect(total).toBe(24);
    const { data: planta } = await ctx.service.from('plantas').select('semillas_sembradas').eq('id', S.CA!).single();
    expect(Math.round((total / planta!.semillas_sembradas) * 1000) / 10).toBe(70.6);
    const audit = await auditDesde(ctx, marca, { accion: 'creacion_evento_germinacion', plantaId: S.CA });
    expect(audit.map((f) => [f.usuario_id, f.detalle.cantidad_nueva])).toEqual([[ctx.opAId, 10], [ctx.opBId, 8], [ctx.opAId, 6]]);
  });

  // A1-G11-03 (nuevo): ningún paso compara su cantidad con la del paso anterior.
  it.fails('el embudo de cantidades es coherente entre fases: no se registran más plántulas germinadas que semillas sembradas (A1-G11-03)', async () => {
    // CA sembró 34 y ya lleva 24 germinadas; un tipeo de 50 plántulas nuevas (74 en total, 217 %) se acepta sin aviso.
    const err = await api.falla(() => api.crearGerminacionEvento(ctx.opB, ctx.opBId, { planta_id: S.CA!, fecha: ctx.d(-85), cantidad_nueva: 50 }));
    expect(err).not.toBeNull();
  });

  // A1-G11-03 (nuevo): la cronología entre fases tampoco se valida.
  it.fails('la cronología entre fases es coherente: la cosecha no puede fecharse antes de la última polinización (A1-G11-03)', async () => {
    // CD tiene sesiones de polinización del d(-140); una cosecha del d(-200) se acepta.
    // Se avanza antes a cosecha: en polinización A1-028 rechazaría la captura por anticipada, no por la cronología.
    await api.actualizarEstado(ctx.admin, S.CD!, 'cosecha');
    const { error } = await ctx.opB.from('plantas').update({ fecha_cosecha: ctx.d(-200), n_semillas: 5 }).eq('id', S.CD!);
    expect(error).not.toBeNull();
  });

  it('un evento de germinación no se puede corregir ni borrar (ni el autor ni el admin): el error de tipeo es permanente (A1-G2-11, ya reportado)', async () => {
    const [primero] = await api.listarGerminacionEventos(ctx.opA, S.CA!);
    const marca = await maxAuditId(ctx);
    const rA = await ctx.opA.from('germinacion_evento').update({ cantidad_nueva: 99 }).eq('id', primero.id);
    const rAdmin = await ctx.admin.from('germinacion_evento').delete().eq('id', primero.id);
    expect(rA.error?.code).toBe('42501');
    expect(rAdmin.error?.code).toBe('42501');
    expect((await api.listarGerminacionEventos(ctx.opA, S.CA!)).find((e) => e.id === primero.id)?.cantidad_nueva).toBe(10);
    expect(await auditDesde(ctx, marca)).toHaveLength(0);
  });

  it('datos incompletos: CC avanza por todas las fases sin cargar polinización, cosecha, siembra ni germinación (la base lo permite) y cada cambio queda auditado', async () => {
    const marca = await maxAuditId(ctx);
    await avanzarHasta(ctx.admin, S.CC!, 'trasplante');
    const cambios = await auditDesde(ctx, marca, { accion: 'cambio_estado', plantaId: S.CC });
    expect(cambios.map((f) => f.detalle.estado_nuevo)).toEqual(['cosecha', 'siembra_semilla', 'germinacion', 'trasplante']);
    expect(cambios.every((f) => f.usuario_id === ctx.adminId)).toBe(true); // U-03: solo el admin cambia la fase
    const { count: eventos } = await ctx.service.from('polinizacion_evento').select('id', { count: 'exact', head: true }).eq('planta_id', S.CC!);
    const { count: frutos } = await ctx.service.from('cosecha_fruto').select('id', { count: 'exact', head: true }).eq('planta_id', S.CC!);
    expect([eventos, frutos]).toEqual([0, 0]);
    const { data: planta } = await ctx.service.from('plantas').select('fecha_cosecha, n_semillas, semillas_sembradas, contenedor_id').eq('id', S.CC!).single();
    expect(planta).toEqual({ fecha_cosecha: null, n_semillas: null, semillas_sembradas: null, contenedor_id: null });
  });

  it('CD (cruce de «mala señal») llega a trasplante con la misma cadena de avances', async () => {
    await avanzarHasta(ctx.admin, S.CD!, 'trasplante');
    const { data } = await ctx.service.from('plantas').select('estado').eq('id', S.CD!).single();
    expect(data?.estado).toBe('trasplante');
  });

  // A1-G2-05 (ya reportado): doble toque en «Agregar fruto» y en «Registrar germinación».
  it.fails('mala señal: el doble toque en «Agregar fruto» y en «Registrar germinación» no duplica el registro (A1-G2-05)', async () => {
    const fruto = () => api.agregarCosechaFruto(ctx.opB, ctx.opBId, S.CD!, 7);
    await Promise.all([fruto(), fruto()]);
    const frutos = await api.listarCosechaFrutos(ctx.opB, S.CD!);
    expect(frutos).toHaveLength(1);
  });
});

// ===========================================================================
// P4 · Individuos: individualizar, clonar, etiquetas
// ===========================================================================

const S4: { ids: string[]; codigos: string[]; clon?: string; idsCC: string[]; idsCD: string[] } = { ids: [], codigos: [], idsCC: [], idsCD: [] };

describe('P4 · crear individuos (individualizar y clonar) y etiquetas con id resoluble', () => {
  it('A individualiza 9 plantas de CA: 9 individuos con código correlativo único, una fila `individualizacion` y 9 `creacion_individuo` con su autor', async () => {
    await api.actualizarEstado(ctx.admin, S.CA!, 'trasplante');
    const marca = await maxAuditId(ctx);
    const r = await api.individualizarPlantas(ctx.opA, S.CA!, 9);
    expect(r.cantidad).toBe(9);
    expect(r.codigos).toHaveLength(9);
    expect(noSeRepite(r.codigos)).toBe(true);
    const lista = await api.listarIndividuosDePlanta(ctx.opB, S.CA!);
    expect(lista).toHaveLength(9);
    expect(lista.every((i) => i.estado_vital === 'vivo' && i.fecha_baja === null && i.clon_de_id === null)).toBe(true);
    S4.ids = r.codigos.map((c) => lista.find((i) => i.codigo_display === c)!.id);
    S4.codigos = r.codigos;

    const ind = await auditDesde(ctx, marca, { accion: 'individualizacion', plantaId: S.CA });
    expect(ind).toHaveLength(1);
    expect(ind[0].usuario_id).toBe(ctx.opAId);
    expect(ind[0].detalle).toMatchObject({ cantidad: 9, codigos: r.codigos });
    const creaciones = await auditDesde(ctx, marca, { accion: 'creacion_individuo', plantaId: S.CA });
    expect(creaciones).toHaveLength(9);
    expect(creaciones.every((f) => f.usuario_id === ctx.opAId)).toBe(true);
  });

  it('individualizar solo funciona en trasplante: CC (otra fase) lo rechaza con 42501 y no crea nada; luego CC y CD se individualizan en su fase', async () => {
    const { data } = await ctx.service.from('plantas').select('estado').eq('id', S.CC!).single();
    expect(data?.estado).toBe('trasplante'); // CC ya llegó
    // CA está en trasplante; probamos con un cruce fuera de fase: uno recién creado en sin_empezar.
    const fuera = await api.crearPlanta(ctx.admin, { codigo_sistema: `AUD-G11-04-${ctx.R}`, especie_id: ctx.especieId, esPrueba: true });
    limp.plantaIds.push(fuera.id);
    const err = await api.falla(() => api.individualizarPlantas(ctx.opA, fuera.id, 2));
    expect(err?.code).toBe('42501');
    const { count } = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).eq('planta_id', fuera.id);
    expect(count).toBe(0);

    const rc = await api.individualizarPlantas(ctx.opB, S.CC!, 3);
    S4.idsCC = (await api.listarIndividuosDePlanta(ctx.opB, S.CC!)).sort((a, b) => a.codigo_display.localeCompare(b.codigo_display, undefined, { numeric: true })).map((i) => i.id);
    expect(rc.codigos).toHaveLength(3);
    expect(S4.idsCC).toHaveLength(3);
  });

  it('B clona el individuo 1: el clon queda en CA con clon_de_id y código nuevo, y la auditoría guarda el origen', async () => {
    const marca = await maxAuditId(ctx);
    const clon = await api.clonarIndividuo(ctx.opB, ctx.opBId, S4.ids[0], S.CA!);
    S4.clon = clon.id;
    expect(clon.clon_de_id).toBe(S4.ids[0]);
    expect(clon.estado_vital).toBe('vivo');
    expect(S4.codigos).not.toContain(clon.codigo_display);
    const aud = await auditDesde(ctx, marca, { accion: 'creacion_individuo', plantaId: S.CA });
    expect(aud).toHaveLength(1);
    expect(aud[0].usuario_id).toBe(ctx.opBId);
    expect(aud[0].detalle).toMatchObject({ individuo_id: clon.id, clon_de_id: S4.ids[0], codigo_display: clon.codigo_display });
    expect(await api.listarIndividuosDePlanta(ctx.opA, S.CA!)).toHaveLength(10);
  });

  // A1-G4-03 (ya reportado): sin clave de idempotencia, el reintento crea otro lote y otro clon.
  it.fails('mala señal: dos llamadas simultáneas a individualizar la misma cantidad no crean el doble de individuos (A1-G4-03)', async () => {
    await Promise.all([api.individualizarPlantas(ctx.opA, S.CD!, 2), api.individualizarPlantas(ctx.opA, S.CD!, 2)]);
    expect(await api.listarIndividuosDePlanta(ctx.opA, S.CD!)).toHaveLength(2);
  });

  it('el operario no puede retroceder ni saltar fases (U-03: 42501); el admin sí puede retroceder y queda auditado', async () => {
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.actualizarEstado(ctx.opB, S.CA!, 'germinacion'));
    expect(err?.code).toBe('42501');
    expect(err?.message).toBe('Solo un admin puede cambiar la fase de un cruce.');
    expect((await api.falla(() => api.actualizarEstado(ctx.opB, S.CA!, 'evaluacion_anual')))?.code).toBe('42501');
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opBId] })).toHaveLength(0);

    // El admin retrocede y vuelve a avanzar (queda auditado con su autoría).
    await api.actualizarEstado(ctx.admin, S.CD!, 'germinacion');
    await api.actualizarEstado(ctx.admin, S.CD!, 'trasplante');
    const rev = await auditDesde(ctx, marca, { usuarioIds: [ctx.adminId], accion: 'cambio_estado', plantaId: S.CD });
    expect(rev.map((f) => f.detalle.estado_nuevo)).toEqual(['germinacion', 'trasplante']);
  });

  it('etiquetas: el QR de cada individuo (pequeña y grande) es `/individuo/<uuid>`, el escáner lo interpreta como individuo y resolverIndividuo lo lleva a su cruce', async () => {
    const todos = [
      ...(await api.listarIndividuosDePlanta(ctx.opA, S.CA!)).map((i) => ({ ...i, cruce: S.CA! })),
      ...(await api.listarIndividuosDePlanta(ctx.opA, S.CC!)).map((i) => ({ ...i, cruce: S.CC! })),
    ];
    expect(todos).toHaveLength(13);
    expect(noSeRepite(todos.map((i) => i.id))).toBe(true);
    expect(noSeRepite(todos.map((i) => contenidoQrIndividuo(i.id, true)))).toBe(true); // no hay dos etiquetas con el mismo QR
    for (const i of todos) {
      for (const corto of [true, false]) {
        const qr = contenidoQrIndividuo(i.id, corto);
        expect(interpretarQR(qr)).toEqual({ tipo: 'individuo', valor: i.id });
      }
      const resuelto = await api.resolverIndividuo(ctx.opB, i.id);
      expect(resuelto).toEqual({ id: i.id, planta_id: i.cruce, codigo_display: i.codigo_display, estado_vital: 'vivo' });
    }
    // Un UUID pelado significa «cruce»: nunca debe coincidir con el de un individuo.
    expect(interpretarQR(S.CA!)).toEqual({ tipo: 'id', valor: S.CA });
    expect(await api.resolverIndividuo(ctx.opB, S.CA!)).toBeNull();
    expect(await api.resolverIndividuo(ctx.opB, randomUUID())).toBeNull();
    registrarLectura('resolverIndividuo (operario)', await api.resolverIndividuo(ctx.opB, todos[0].id));
  });
});

// ===========================================================================
// P5 · Rondas y evaluaciones (visitas parciales, tipeos, borradores)
// ===========================================================================

/** Atajos: I(1) … I(9) son los individuos de CA; I10 es el clon de I(1). */
const I = (n: number) => (n === 10 ? S4.clon! : S4.ids[n - 1]);
const rondaDe = new Map<string, string>(); // individuo → id de su ronda 1
const codigoDe = new Map<string, string>(); // individuo → codigo_display
/** Visitas cerradas (completa/corregida) de cada individuo, tal como las entiende el modelo independiente. */
const modelo = new Map<string, VisitaModelo[]>();
/** Evaluaciones creadas, en orden de inserción, por individuo. */
const evalsDe = new Map<string, Array<{ id: string; fecha: string }>>();
const excluidos = new Map<string, string>(); // individuo → motivo esperado (requiere_revision, anulada…)
let tick = 0;
const S5: { borradorCerradoI7?: string } = {};
/** Visitas de la ronda 1 de los individuos que después tienen ronda 2 (el ranking mira solo la ronda más reciente). */
const ronda1De = new Map<string, VisitaModelo[]>();


function anotarVisita(ind: string, fecha: string, captura: Record<string, number | null | undefined>, evaluacionId: string) {
  modelo.set(ind, [...(modelo.get(ind) ?? []), { fecha, orden: ++tick, captura }]);
  evalsDe.set(ind, [...(evalsDe.get(ind) ?? []), { id: evaluacionId, fecha }]);
}

/** Cierra una evaluación como lo hace «Finalizar evaluación» del formulario (INSERT con clave de idempotencia). */
async function cerrar(
  cliente: typeof ctx.opA, userId: string, ind: string, fecha: string,
  captura: Record<string, number | boolean | string>, opciones: { rondaId?: string; clave?: string } = {},
): Promise<string> {
  const { id } = await api.crearEvaluacion(
    cliente, userId,
    { ronda_id: opciones.rondaId ?? rondaDe.get(ind)!, fecha, estado: 'completa', ...captura },
    opciones.clave ?? randomUUID(),
  );
  const numerica = Object.fromEntries(Object.entries(captura).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
  anotarVisita(ind, fecha, numerica, id);
  return id;
}

const SIN_MUESTRA = { sin_muestra: true };

/** Ranking de la especie (hasta 100 filas) como lo pide la pantalla /ranking. */
async function rankingEspecie(cliente = ctx.opA) {
  const r = await api.obtenerRanking(cliente, { especieId: ctx.especieId, limite: 100 });
  const filas = new Map<string, Record<string, any>>(r.items.map((it) => [it.individuo_id as string, it]));
  return { r, filas };
}

const numeroDeCodigo = (codigo: string) => Number(codigo.match(/(\d+)$/)?.[1] ?? Number.NaN);

/** Compara una fila del ranking contra el modelo independiente. */
function esperarFila(fila: Record<string, any> | undefined, ind: string, cfg = CONFIG_V1) {
  expect(fila, `el individuo ${codigoDe.get(ind)} debe estar en el ranking`).toBeDefined();
  const visitas = modelo.get(ind);
  const forzado = excluidos.get(ind);
  if (!visitas || visitas.length === 0) return;
  const esp = puntajeIndependiente(unificarModelo(visitas), cfg);
  const debeSerElegible = esp.elegible && !forzado;
  expect(fila!.elegible, `elegibilidad de ${codigoDe.get(ind)}`).toBe(debeSerElegible);
  if (debeSerElegible) {
    expect(casiIgual(fila!.puntaje_ponderado, esp.puntaje), `puntaje de ${codigoDe.get(ind)}: motor ${fila!.puntaje_ponderado} vs esperado ${esp.puntaje}`).toBe(true);
    expect(fila!.motivo_exclusion).toBeNull();
  } else {
    expect(fila!.puntaje_ponderado).toBeNull();
    expect(fila!.motivo_exclusion).toBe(forzado ?? 'evaluacion_parcial_en_curso');
  }
}

describe('P5 · rondas y evaluaciones: visitas parciales que se unifican, tipeos, borradores', () => {
  it('CA, CC y CD avanzan hasta evaluación anual; antes de eso el operario no puede iniciar una ronda (42501) y no queda nada', async () => {
    // CD sigue en trasplante: iniciar ronda sobre uno de sus individuos debe rechazarse.
    const [primeroCD] = await api.listarIndividuosDePlanta(ctx.opA, S.CD!);
    S4.idsCD = (await api.listarIndividuosDePlanta(ctx.opA, S.CD!)).map((i) => i.id);
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.iniciarRonda(ctx.opA, primeroCD.id));
    expect(err?.code).toBe('42501');
    expect(err?.message).toMatch(/Evaluación anual/);
    expect(await api.listarRondas(ctx.opA, primeroCD.id)).toHaveLength(0);
    expect(await auditDesde(ctx, marca)).toHaveLength(0);

    await avanzarHasta(ctx.admin, S.CA!, 'evaluacion_anual');
    await avanzarHasta(ctx.admin, S.CC!, 'evaluacion_anual');
    await avanzarHasta(ctx.admin, S.CD!, 'evaluacion_anual');
    const { data } = await ctx.service.from('plantas').select('id, estado').in('id', [S.CA!, S.CC!, S.CD!]);
    expect(data!.every((p) => p.estado === 'evaluacion_anual')).toBe(true);
  });

  it('los operarios inician la ronda 1 de cada individuo de CA (A: 1-6, B: 7-10) y de CC (C1, C2): numero_ronda 1, año actual, auditoría con autor', async () => {
    const marca = await maxAuditId(ctx);
    for (let n = 1; n <= 10; n += 1) {
      const cliente = n <= 6 ? ctx.opA : ctx.opB;
      const r = await api.iniciarRonda(cliente, I(n));
      expect(r.numero_ronda).toBe(1);
      rondaDe.set(I(n), r.ronda_id);
    }
    for (const [i, id] of S4.idsCC.slice(0, 2).entries()) {
      const r = await api.iniciarRonda(i === 0 ? ctx.opB : ctx.opA, id);
      rondaDe.set(id, r.ronda_id);
    }
    for (const fila of await api.listarIndividuosDePlanta(ctx.opA, S.CA!)) codigoDe.set(fila.id, fila.codigo_display);
    for (const fila of await api.listarIndividuosDePlanta(ctx.opA, S.CC!)) codigoDe.set(fila.id, fila.codigo_display);

    const aud = await auditDesde(ctx, marca, { accion: 'creacion_ronda_evaluacion_anual' });
    expect(aud).toHaveLength(12);
    const deCA = aud.filter((f) => f.planta_id === S.CA);
    expect(deCA.map((f) => f.usuario_id)).toEqual([...Array(6).fill(ctx.opAId), ...Array(4).fill(ctx.opBId)]);
    expect(deCA.every((f) => f.detalle.numero_ronda === 1 && f.detalle.anio === Number(ctx.hoy.slice(0, 4)) && f.detalle.tipo_ronda === 'anual')).toBe(true);
    // Las rondas todavía no están ligadas a ninguna versión de scoring (se ligan al cerrar la primera evaluación).
    const rondas = await Promise.all([...rondaDe.values()].map((id) => ctx.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', id).single()));
    expect(rondas.every((r) => r.data?.scoring_version_id === null)).toBe(true);
  });

  // A1-G5-08: un toque doble de «Iniciar ronda» consumía cupo de forma irreversible con la firma vieja. La app usa
  // iniciar_ronda_esperada (A1-063): dos pedidos del mismo número esperado devuelven la misma ronda (la firma vieja ya
  // está cerrada a authenticated por el paso 39, así que el hallazgo queda corregido por el único camino que existe).
  it('dos llamadas a iniciar ronda para el mismo individuo no crean dos rondas (A1-G5-08, corregido por iniciar_ronda_esperada)', async () => {
    const id = S4.idsCD[0];
    await Promise.all([api.iniciarRonda(ctx.opA, id), api.iniciarRonda(ctx.opA, id)]);
    expect(await api.listarRondas(ctx.opA, id)).toHaveLength(1);
  });

  it('I1 (la estrella): una visita completa con las 20 métricas; el puntaje se calcula a mano con scoring-esperado.ts = 0,573 y la ronda queda ligada a V1', async () => {
    const estrella = {
      brotacion: 5, floracion: 1, cuaja: 5, concentracion_cosecha: 3, presencia_yemas_florales: 5, precocidad: 3,
      firmeza: 1, calibre_mm: 24, brix: 18, bloom: 5,
      rend_kg_planta: 5, rend_t_ha: 1, pct_fruta_exportable: 50,
      n_varas_basales: 10, n_varas_con_flor: 5, n_flores_varas_basales: 20, n_frutos_varas_basales: 10,
      dano_calor: 1, golpe_sol: 3, caida_fruto: 5, vigor_vegetativo: 3, color_follaje: 3,
      cantidad_frutos: 10, peso_total_g: 100,
    };
    // A mano (dominios de V1): brotación 5→1, floración 1→0, cuaja 5→1, concentración 3→0,5, yemas 5→1, precocidad 3→0,5;
    // firmeza 1→0, calibre 24→1, brix 18→1, bloom 5→1; rend_kg 5→1, rend_t_ha 1→0, exportable 50→0,5, pct_flores 50→0,5, pct_frutos 50→0,5;
    // daño 1 (menor)→1, golpe 3→0,5, caída 5 (menor)→0, vigor 3→0,5, color follaje 3→0,5.
    const aMano = puntajeEsperado({
      brotacion: 1, floracion: 0, cuaja: 1, concentracion_cosecha: 0.5, presencia_yemas_florales: 1, precocidad: 0.5,
      firmeza: 0, calibre_mm: 1, brix: 1, bloom: 1,
      rend_kg_planta: 1, rend_t_ha: 0, pct_fruta_exportable: 0.5, pct_flores: 0.5, pct_frutos: 0.5,
      dano_calor: 1, golpe_sol: 0.5, caida_fruto: 0, vigor_vegetativo: 0.5, color_follaje: 0.5,
    });
    expect(aMano).toBe(0.573);
    expect(puntajeIndependiente(metricasDeCaptura(estrella), CONFIG_V1).puntaje).toBe(0.573); // el modelo coincide con la cuenta a mano

    const marca = await maxAuditId(ctx);
    const clave = randomUUID();
    const id = await cerrar(ctx.opA, ctx.opAId, I(1), ctx.d(-60), estrella, { clave });
    // Mala señal: el cliente pierde la respuesta y reenvía el mismo guardado con la misma clave: se recupera la fila vieja.
    const otra = await api.crearEvaluacion(ctx.opA, ctx.opAId, { ronda_id: rondaDe.get(I(1))!, fecha: ctx.d(-60), estado: 'completa', ...estrella }, clave);
    expect(otra.id).toBe(id);
    const { count } = await ctx.service.from('evaluaciones').select('id', { count: 'exact', head: true }).eq('ronda_id', rondaDe.get(I(1))!);
    expect(count).toBe(1);

    const { data: ev } = await ctx.service.from('evaluaciones').select('estado, anio, requiere_revision, no_comparable, created_by, pct_flores, pct_frutos').eq('id', id).single();
    expect(ev).toMatchObject({ estado: 'completa', anio: Number(ctx.d(-60).slice(0, 4)), requiere_revision: false, no_comparable: false, created_by: ctx.opAId });
    expect([Number(ev!.pct_flores), Number(ev!.pct_frutos)]).toEqual([50, 50]);
    const aud = await auditDesde(ctx, marca, { accion: 'creacion_evaluacion' });
    expect(aud).toHaveLength(1); // el reintento con la misma clave no genera otra fila
    expect(aud[0]).toMatchObject({ usuario_id: ctx.opAId, planta_id: S.CA });
    expect(aud[0].detalle).toMatchObject({ evaluacion_id: id, ronda_id: rondaDe.get(I(1)), individuo_id: I(1), fecha: ctx.d(-60) });
    // Cross-step: cerrar la primera evaluación liga la ronda a la versión vigente de la especie en esa fecha.
    const { data: ronda } = await ctx.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', rondaDe.get(I(1))!).single();
    expect(ronda?.scoring_version_id).toBe(S.v1);
  });

  it('I2: tres visitas parciales de la misma ronda; mientras faltan métricas NO puntúa (evaluacion_parcial_en_curso) y al llegar la tercera sí, con el resultado de la unificación', async () => {
    const r = rondaDe.get(I(2))!;
    await cerrar(ctx.opA, ctx.opAId, I(2), ctx.d(-70), { ...SIN_MUESTRA, brotacion: 4, floracion: 3, cuaja: 4, concentracion_cosecha: 4, presencia_yemas_florales: 4, precocidad: 3 });
    let { filas } = await rankingEspecie();
    expect(filas.get(I(2))).toMatchObject({ elegible: false, puntaje_ponderado: null, motivo_exclusion: 'evaluacion_parcial_en_curso', numero_ronda: 1 });

    await cerrar(ctx.opA, ctx.opAId, I(2), ctx.d(-65), { firmeza: 4, calibre_mm: 20, brix: 16, bloom: 4, cantidad_frutos: 12, peso_total_g: 150 });
    ({ filas } = await rankingEspecie());
    expect(filas.get(I(2))).toMatchObject({ elegible: false, puntaje_ponderado: null, motivo_exclusion: 'evaluacion_parcial_en_curso' });
    // La métrica ya cargada se ve en el detalle aunque no puntúe.
    expect(filas.get(I(2))!.detalle_metricas.firmeza).toMatchObject({ valor: 4, normalizado: 0.75 });

    await cerrar(ctx.opA, ctx.opAId, I(2), ctx.d(-60), {
      ...SIN_MUESTRA, rend_kg_planta: 4, rend_t_ha: 3, pct_fruta_exportable: 70,
      n_varas_basales: 10, n_varas_con_flor: 7, n_flores_varas_basales: 20, n_frutos_varas_basales: 12,
      dano_calor: 2, golpe_sol: 2, caida_fruto: 2, vigor_vegetativo: 4, color_follaje: 4,
    });
    ({ filas } = await rankingEspecie());
    esperarFila(filas.get(I(2)), I(2));
    expect(filas.get(I(2))!.elegible).toBe(true);
    expect(filas.get(I(2))!.scoring_version_id).toBe(S.v1);
    // Procedencia: la unificación toma la visita más reciente de cada descriptor.
    expect(filas.get(I(2))!.fecha_evaluacion).toBe(ctx.d(-60));
    expect(r).toBeTruthy();
  });

  it('I3: dos visitas el MISMO día (la segunda solo mide firmeza 5) y un tipeo de Brix 140: la base lo acepta, la unificación toma firmeza 5 y el Brix absurdo infla el puntaje', async () => {
    await cerrar(ctx.opB, ctx.opBId, I(3), ctx.d(-55), { ...BASE_COMPLETA, brix: 140, firmeza: 3 });
    await cerrar(ctx.opB, ctx.opBId, I(3), ctx.d(-55), { ...SIN_MUESTRA, firmeza: 5 });
    const { filas } = await rankingEspecie();
    esperarFila(filas.get(I(3)), I(3));
    const det = filas.get(I(3))!.detalle_metricas;
    expect(det.brix).toMatchObject({ valor: 140, normalizado: 1 }); // saturado: A1-G5-15 (ya reportado)
    expect(det.firmeza).toMatchObject({ valor: 5, normalizado: 1 });
    expect(filas.get(I(3))!.requiere_revision).toBe(false); // el tipeo de Brix no activa ninguna bandera
  });

  it('I4: calibre 45 mm (tipeo) activa requiere_revision y lo saca del ranking con su motivo; I5 con descriptores incompletos queda como parcial', async () => {
    const id4 = await cerrar(ctx.opB, ctx.opBId, I(4), ctx.d(-54), { ...BASE_COMPLETA, calibre_mm: 45 });
    excluidos.set(I(4), 'requiere_revision');
    const { data } = await ctx.service.from('evaluaciones').select('requiere_revision').eq('id', id4).single();
    expect(data?.requiere_revision).toBe(true);
    await cerrar(ctx.opA, ctx.opAId, I(5), ctx.d(-50), { ...SIN_MUESTRA, brotacion: 3, floracion: 4, cuaja: 3, concentracion_cosecha: 3, dano_calor: 2, golpe_sol: 2, caida_fruto: 3 });
    const { filas } = await rankingEspecie();
    expect(filas.get(I(4))).toMatchObject({ elegible: false, puntaje_ponderado: null, motivo_exclusion: 'requiere_revision', requiere_revision: true });
    expect(filas.get(I(5))).toMatchObject({ elegible: false, puntaje_ponderado: null, motivo_exclusion: 'evaluacion_parcial_en_curso' });
  });

  it('I6, I8, I9 y los de CC quedan con una visita completa cada uno (valores distintos, sin empates)', async () => {
    await cerrar(ctx.opA, ctx.opAId, I(6), ctx.d(-52), completa({ firmeza: 2 }));
    await cerrar(ctx.opA, ctx.opAId, I(8), ctx.d(-57), completa({ rend_kg_planta: 5, rend_t_ha: 4 }));
    await cerrar(ctx.opB, ctx.opBId, I(9), ctx.d(-56), completa({ vigor_vegetativo: 5, color_follaje: 4 }));
    await cerrar(ctx.opB, ctx.opBId, S4.idsCC[0], ctx.d(-54), completa({ firmeza: 4, brix: 15 }));
    await cerrar(ctx.opA, ctx.opAId, S4.idsCC[1], ctx.d(-53), completa({ firmeza: 1, brix: 11, calibre_mm: 16 }));
    const { filas } = await rankingEspecie();
    for (const ind of [I(6), I(8), I(9), S4.idsCC[0], S4.idsCC[1]]) esperarFila(filas.get(ind), ind);
  });

  it('concurrencia: A y B cierran a la vez, sobre la misma ronda de I9, dos visitas con descriptores distintos: las dos persisten y ambas valores entran a la unificación', async () => {
    await Promise.all([
      cerrar(ctx.opA, ctx.opAId, I(9), ctx.d(-56), { ...SIN_MUESTRA, golpe_sol: 2 }),
      cerrar(ctx.opB, ctx.opBId, I(9), ctx.d(-56), { ...SIN_MUESTRA, dano_calor: 2 }),
    ]);
    const cerradas = await api.listarEvaluacionesDeRonda(ctx.opA, rondaDe.get(I(9))!);
    expect(cerradas).toHaveLength(3);
    expect(new Set(cerradas.map((c) => c.created_by))).toEqual(new Set([ctx.opAId, ctx.opBId]));
    const { filas } = await rankingEspecie();
    esperarFila(filas.get(I(9)), I(9));
    expect(filas.get(I(9))!.detalle_metricas.golpe_sol.valor).toBe(2);
    expect(filas.get(I(9))!.detalle_metricas.dano_calor.valor).toBe(2);
  });

  it('errores de tipeo y datos incompletos: lo imposible por escala (firmeza 6, brix negativo, exportable 150 %) y cerrar sin muestra se rechazan sin dejar filas; el rechazo no deja rastro', async () => {
    const r = rondaDe.get(I(5))!;
    const marca = await maxAuditId(ctx);
    const intento = (extra: Record<string, unknown>, estado = 'completa') =>
      api.falla(() => api.crearEvaluacion(ctx.opA, ctx.opAId, { ronda_id: r, fecha: ctx.d(-49), estado, ...extra }, randomUUID()));
    expect((await intento({ ...SIN_MUESTRA, firmeza: 6 }))?.code).toBe('23514');
    expect((await intento({ ...SIN_MUESTRA, brix: -1 }))?.code).toBe('23514');
    expect((await intento({ ...SIN_MUESTRA, pct_fruta_exportable: 150 }))?.code).toBe('23514');
    // Cerrar sin la muestra (sin_muestra = false) exige cantidad de frutos y peso mayores que cero.
    const sinMuestra = await intento({ brix: 15 });
    expect(sinMuestra?.code).toBe('23514');
    // Mensaje de la regla de frutos de la Fase 2 (con datos de fruta).
    expect(sinMuestra?.message).toMatch(/cantidad de frutos/i);
    const sinPeso = await intento({ brix: 15, cantidad_frutos: 8, peso_total_g: 0 });
    expect(sinPeso?.message).toMatch(/peso total/i);
    const { count } = await ctx.service.from('evaluaciones').select('id', { count: 'exact', head: true }).eq('ronda_id', r);
    expect(count).toBe(1); // solo la visita parcial de antes
    expect(await auditDesde(ctx, marca)).toHaveLength(0);
  });

  // A1-G5-15 (ya reportado): los tipeos que no rompen una escala se aceptan sin bandera.
  it.fails('una captura imposible por lógica (más varas con flor que varas basales: 1000 % de cobertura floral) se rechaza o se marca para revisión (A1-G5-15)', async () => {
    const r = rondaDe.get(I(5))!;
    const { id } = await api.crearEvaluacion(ctx.opA, ctx.opAId, {
      ronda_id: r, fecha: ctx.d(-48), estado: 'borrador', sin_muestra: true, n_varas_basales: 4, n_varas_con_flor: 40,
    }, randomUUID());
    try {
      const { data } = await ctx.service.from('evaluaciones').select('pct_flores, requiere_revision').eq('id', id).single();
      expect(Number(data!.pct_flores) <= 100 || data!.requiere_revision).toBe(true);
    } finally {
      await api.actualizarEvaluacion(ctx.opA, id, { estado: 'anulada', motivo_cambio: 'prueba de tipeo A1-G5-15' });
    }
  });

  // A1-G5-12 (ya reportado): sin cota de fecha. Esta temporada retrodata evaluaciones respecto de la individualización y del inicio de la ronda
  // (para simular un año en segundos); la base lo acepta, y ese mismo hueco acepta un año mal tipeado.
  it.fails('una evaluación no puede fecharse antes de que exista el individuo ni antes del inicio de su ronda (A1-G5-12)', async () => {
    const r = rondaDe.get(I(5))!;
    let id: string | null = null;
    const err = await api.falla(async () => {
      id = (await api.crearEvaluacion(ctx.opA, ctx.opAId, { ronda_id: r, fecha: '2019-03-01', estado: 'borrador', sin_muestra: true, brix: 15 }, randomUUID())).id;
    });
    if (id) await api.actualizarEvaluacion(ctx.opA, id, { estado: 'anulada', motivo_cambio: 'prueba de fecha A1-G5-12' });
    expect(err).not.toBeNull();
  });

  it('I7: B guarda una visita completa y un borrador; A no puede tomar ni cerrar el borrador de B; el borrador no puntúa; al cerrarlo cambia el puntaje', async () => {
    await cerrar(ctx.opB, ctx.opBId, I(7), ctx.d(-58), completa({ firmeza: 4, bloom: 4, brix: 12 }));
    let { filas } = await rankingEspecie();
    esperarFila(filas.get(I(7)), I(7));
    const antes = Number(filas.get(I(7))!.puntaje_ponderado);

    const claveBorrador = randomUUID();
    const { id: borradorId } = await api.crearEvaluacion(ctx.opB, ctx.opBId, { ronda_id: rondaDe.get(I(7))!, fecha: ctx.d(-40), estado: 'borrador', sin_muestra: true, brix: 17 }, claveBorrador);
    ({ filas } = await rankingEspecie());
    expect(Number(filas.get(I(7))!.puntaje_ponderado)).toBe(antes); // el borrador no entra en el cálculo

    // A intenta cerrar el borrador de B: la política lo deja en 0 filas (PGRST116 en la app), sin cambios ni rastro.
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.actualizarEvaluacion(ctx.opA, borradorId, { estado: 'completa', brix: 9 }));
    expect(err?.code).toBe('PGRST116');
    const { data: sinCambios } = await ctx.service.from('evaluaciones').select('estado, brix').eq('id', borradorId).single();
    expect(sinCambios).toMatchObject({ estado: 'borrador', brix: 17 });
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opAId] })).toHaveLength(0);
    // A tampoco puede abrir su propio borrador sobre la misma ronda (índice de borrador único: 23505 → «continúa o descarta»).
    expect((await api.falla(() => api.crearEvaluacion(ctx.opA, ctx.opAId, { ronda_id: rondaDe.get(I(7))!, fecha: ctx.d(-39), estado: 'borrador', sin_muestra: true }, randomUUID())))?.code).toBe('23505');

    // B continúa el borrador y lo cierra («Finalizar evaluación»): UPDATE del mismo registro.
    const cerrado = await api.actualizarEvaluacion(ctx.opB, borradorId, { estado: 'completa', sin_muestra: true, brix: 17 });
    expect(cerrado.estado).toBe('completa');
    anotarVisita(I(7), ctx.d(-40), { brix: 17 }, borradorId);
    ({ filas } = await rankingEspecie());
    esperarFila(filas.get(I(7)), I(7));
    expect(Number(filas.get(I(7))!.puntaje_ponderado)).toBeGreaterThan(antes); // brix 17 > 12
    S5.borradorCerradoI7 = borradorId;
  });

  // A1-G5-18 (ya reportado como baja, variante «reintento tras señal perdida», que el diseño dice cubrir): el reintento de «Finalizar evaluación» sobre un borrador ya cerrado.
  it.fails('mala señal: reenviar «Finalizar evaluación» de un borrador que ya quedó cerrado no devuelve error (A1-G5-18)', async () => {
    const marca = await maxAuditId(ctx);
    const fila = await api.actualizarEvaluacion(ctx.opB, S5.borradorCerradoI7!, { estado: 'completa', sin_muestra: true, brix: 17 });
    expect(fila.estado).toBe('completa');
    expect(await auditDesde(ctx, marca, { accion: 'cambio_estado_evaluacion' })).toHaveLength(0);
  });

  it('todas las rondas con una visita cerrada quedan ligadas a V1; la de I10 (sin evaluación) sigue sin versión', async () => {
    for (const [ind, rondaId] of rondaDe) {
      const { data } = await ctx.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', rondaId).single();
      const tieneCerradas = (modelo.get(ind) ?? []).length > 0;
      expect(data?.scoring_version_id, `ronda de ${codigoDe.get(ind)}`).toBe(tieneCerradas ? S.v1 : null);
    }
    expect(rondaDe.has(I(10))).toBe(true);
    expect(modelo.has(I(10))).toBe(false);
  });

  it('el operario intenta cerrar como «corregida», corregir una cerrada ajena y anular: nada cambia y no deja rastro', async () => {
    const marca = await maxAuditId(ctx);
    const idI6 = evalsDe.get(I(6))![0].id;
    const idI3 = evalsDe.get(I(3))![0].id;
    // Crear directamente una «corrección» (INSERT con estado corregida): el trigger exige admin.
    const e1 = await api.falla(() => api.crearEvaluacion(ctx.opA, ctx.opAId, { ronda_id: rondaDe.get(I(8))!, fecha: ctx.d(-30), estado: 'corregida', motivo_cambio: 'x', sin_muestra: true, brix: 15 }, randomUUID()));
    expect(e1?.code).toBe('42501');
    // Corregir/anular evaluaciones ya cerradas (propias o ajenas): la política de UPDATE las deja en 0 filas.
    const e2 = await api.falla(() => api.actualizarEvaluacion(ctx.opA, idI6, { estado: 'anulada', motivo_cambio: 'no me gusta' }));
    const e3 = await api.falla(() => api.actualizarEvaluacion(ctx.opA, idI3, { estado: 'corregida', motivo_cambio: 'x', brix: 14 }));
    const e4 = await api.falla(() => api.actualizarEvaluacion(ctx.opB, idI3, { estado: 'corregida', motivo_cambio: 'x', brix: 14 })); // incluso su propio autor
    expect([e2?.code, e3?.code, e4?.code]).toEqual(['PGRST116', 'PGRST116', 'PGRST116']);
    const { data } = await ctx.service.from('evaluaciones').select('id, estado, brix, motivo_cambio').in('id', [idI6, idI3]);
    expect(data!.find((e) => e.id === idI6)).toMatchObject({ estado: 'completa', motivo_cambio: null });
    expect(data!.find((e) => e.id === idI3)).toMatchObject({ estado: 'completa', brix: 140, motivo_cambio: null });
    expect(await auditDesde(ctx, marca)).toHaveLength(0);
  });
});

// ===========================================================================
// P6 · Corregir y anular (admin)
// ===========================================================================

describe('P6 · corregir y anular evaluaciones cerradas (solo admin, con motivo y rastro)', () => {
  it('corregir sin motivo se rechaza (23514) y la evaluación no cambia', async () => {
    const idI4 = evalsDe.get(I(4))![0].id;
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.actualizarEvaluacion(ctx.admin, idI4, { estado: 'corregida', calibre_mm: 22 }));
    expect(err?.code).toBe('23514');
    const { data } = await ctx.service.from('evaluaciones').select('estado, calibre_mm, requiere_revision').eq('id', idI4).single();
    expect(data).toMatchObject({ estado: 'completa', requiere_revision: true });
    expect(Number(data!.calibre_mm)).toBe(45);
    expect(await auditDesde(ctx, marca)).toHaveLength(0);
  });

  it('I4: el admin corrige el calibre 45 → 22 con motivo: se apaga requiere_revision, el individuo entra al ranking y audit_log guarda valor anterior y nuevo con su autor', async () => {
    const idI4 = evalsDe.get(I(4))![0].id;
    const marca = await maxAuditId(ctx);
    const fila = await api.actualizarEvaluacion(ctx.admin, idI4, { estado: 'corregida', motivo_cambio: 'Calibre tipeado como 45; la medición fue 22 mm', calibre_mm: 22 });
    expect(fila).toMatchObject({ estado: 'corregida', requiere_revision: false });
    const m = modelo.get(I(4))![0];
    m.captura = { ...m.captura, calibre_mm: 22 };
    // A1-105: corregir no reordena las visitas (desempate por capturada_at, inmutable).
    excluidos.delete(I(4));

    const edicion = (await auditDesde(ctx, marca, { accion: 'edicion_evaluacion' }))[0];
    expect(edicion.usuario_id).toBe(ctx.adminId);
    expect(edicion.planta_id).toBe(S.CA);
    expect(edicion.detalle.evaluacion_id).toBe(idI4);
    expect(edicion.detalle.cambios).toMatchObject({
      calibre_mm: { anterior: 45, nuevo: 22 },
      estado: { anterior: 'completa', nuevo: 'corregida' },
      requiere_revision: { anterior: true, nuevo: false },
      motivo_cambio: { anterior: null, nuevo: 'Calibre tipeado como 45; la medición fue 22 mm' },
    });
    const estado = (await auditDesde(ctx, marca, { accion: 'cambio_estado_evaluacion' }))[0];
    expect(estado.usuario_id).toBe(ctx.adminId);
    expect(estado.detalle).toMatchObject({ estado_anterior: 'completa', estado_nuevo: 'corregida', requiere_revision: false, motivo: 'Calibre tipeado como 45; la medición fue 22 mm' });

    const { filas } = await rankingEspecie();
    esperarFila(filas.get(I(4)), I(4));
    expect(filas.get(I(4))).toMatchObject({ elegible: true, estado_evaluacion: 'corregida', requiere_revision: false });
  });

  it('mala señal: reenviar la misma corrección no deja una segunda fila de edición ni de cambio de estado', async () => {
    const idI4 = evalsDe.get(I(4))![0].id;
    const marca = await maxAuditId(ctx);
    await api.actualizarEvaluacion(ctx.admin, idI4, { estado: 'corregida', motivo_cambio: 'Calibre tipeado como 45; la medición fue 22 mm', calibre_mm: 22 });
    expect(await auditDesde(ctx, marca, { accion: 'edicion_evaluacion' })).toHaveLength(0);
    expect(await auditDesde(ctx, marca, { accion: 'cambio_estado_evaluacion' })).toHaveLength(0);
    // A1-105: el UPDATE no-op mueve updated_at, pero ya no reordena las visitas.
  });

  it('I3: el admin corrige el Brix 140 → 14 de la primera visita: el Brix baja a 14 y se audita; el puntaje deja de estar inflado', async () => {
    const idA = evalsDe.get(I(3))![0].id;
    const marca = await maxAuditId(ctx);
    const antes = Number((await rankingEspecie()).filas.get(I(3))!.puntaje_ponderado);
    await api.actualizarEvaluacion(ctx.admin, idA, { estado: 'corregida', motivo_cambio: 'Brix tipeado como 140; la lectura fue 14', brix: 14 });
    const edicion = (await auditDesde(ctx, marca, { accion: 'edicion_evaluacion' }))[0];
    expect(edicion.usuario_id).toBe(ctx.adminId);
    expect(edicion.detalle.cambios).toMatchObject({ brix: { anterior: 140, nuevo: 14 }, estado: { anterior: 'completa', nuevo: 'corregida' } });

    const { filas } = await rankingEspecie();
    const det = filas.get(I(3))!.detalle_metricas;
    expect(det.brix).toMatchObject({ valor: 14, normalizado: 0.5 });
    expect(Number(filas.get(I(3))!.puntaje_ponderado)).toBeLessThan(antes);
  });

  // A1-G11-02 / A1-105: corregir una visita no la vuelve «la más reciente»; el desempate es capturada_at (inmutable).
  it('corregir el Brix de una visita no cambia la firmeza que aportó otra visita posterior del mismo día (A1-G11-02)', async () => {
    const { filas } = await rankingEspecie();
    // La segunda visita (firmeza 5) se cargó DESPUÉS de la primera; corregir el Brix de la primera no debería devolver su firmeza 3.
    expect(filas.get(I(3))!.detalle_metricas.firmeza.valor).toBe(5);
  });

  it('(el modelo anota la corrección del Brix sin reordenar las visitas, como la base desde A1-105)', async () => {
    const m = modelo.get(I(3))![0];
    m.captura = { ...m.captura, brix: 14 };
    const { filas } = await rankingEspecie();
    esperarFila(filas.get(I(3)), I(3));
    expect(filas.get(I(3))!.detalle_metricas.firmeza.valor).toBe(5);
  });

  it('I6: el admin anula su única evaluación con motivo: el individuo sale del ranking («sin evaluación completa en la ronda actual») y deja de contar en el resumen del cruce', async () => {
    const idI6 = evalsDe.get(I(6))![0].id;
    const marca = await maxAuditId(ctx);
    await api.actualizarEvaluacion(ctx.admin, idI6, { estado: 'anulada', motivo_cambio: 'Se evaluó el individuo equivocado' });
    modelo.delete(I(6));
    const estado = (await auditDesde(ctx, marca, { accion: 'cambio_estado_evaluacion' }))[0];
    expect(estado.usuario_id).toBe(ctx.adminId);
    expect(estado.detalle).toMatchObject({ estado_anterior: 'completa', estado_nuevo: 'anulada', motivo: 'Se evaluó el individuo equivocado' });
    const { filas } = await rankingEspecie();
    expect(filas.get(I(6))).toMatchObject({ elegible: false, puntaje_ponderado: null, motivo_exclusion: 'sin_evaluacion_completa_en_ronda_actual', evaluacion_id: null });
    const resumen = await api.resumenIndividuosDeCruce(ctx.opA, S.CA!);
    expect(resumen.find((r) => r.individuo_id === I(6))!.evaluaciones_count).toBe(0);
    // Mala señal: anular otra vez la misma evaluación no genera otra auditoría de estado.
    const marca2 = await maxAuditId(ctx);
    await api.actualizarEvaluacion(ctx.admin, idI6, { estado: 'anulada', motivo_cambio: 'Se evaluó el individuo equivocado' });
    expect(await auditDesde(ctx, marca2, { accion: 'cambio_estado_evaluacion' })).toHaveLength(0);
  });

  it('I7: el admin anula SOLO la segunda visita (la del Brix 17 que cerró el borrador): la unificación vuelve al Brix 12 de la primera y el puntaje baja con ella', async () => {
    const visitas = evalsDe.get(I(7))!;
    expect(visitas).toHaveLength(2);
    const { filas: antes } = await rankingEspecie();
    const puntajeAntes = Number(antes.get(I(7))!.puntaje_ponderado);
    expect(antes.get(I(7))!.detalle_metricas.brix.valor).toBe(17);

    await api.actualizarEvaluacion(ctx.admin, visitas[1].id, { estado: 'anulada', motivo_cambio: 'El Brix 17 era de otro individuo' });
    modelo.set(I(7), modelo.get(I(7))!.slice(0, 1));
    const { filas } = await rankingEspecie();
    esperarFila(filas.get(I(7)), I(7));
    expect(filas.get(I(7))!.detalle_metricas.brix.valor).toBe(12);
    expect(Number(filas.get(I(7))!.puntaje_ponderado)).toBeLessThan(puntajeAntes);
    expect(filas.get(I(7))!.fecha_evaluacion).toBe(ctx.d(-58)); // la visita representante vuelve a ser la primera
  });

  it('una evaluación anulada no puede resucitar al «completa» ni el autor puede reabrirla; el operario no puede reabrir lo cerrado (la política lo bloquea)', async () => {
    const idI6 = evalsDe.get(I(6))![0].id;
    const e1 = await api.falla(() => api.actualizarEvaluacion(ctx.opA, idI6, { estado: 'borrador' }));
    expect(e1?.code).toBe('PGRST116');
    const { data } = await ctx.service.from('evaluaciones').select('estado').eq('id', idI6).single();
    expect(data?.estado).toBe('anulada');
  });
});

// ===========================================================================
// P7 · Rankear
// ===========================================================================

/** Ranking esperado por el modelo: posiciones entre los elegibles, por puntaje desc y luego por número de código. */
function posicionesEsperadas(individuos: string[], cfg = CONFIG_V1): Map<string, number> {
  const elegibles = individuos
    .map((ind) => ({ ind, p: modelo.get(ind) ? puntajeIndependiente(unificarModelo(modelo.get(ind)!), cfg) : null, f: excluidos.get(ind) }))
    .filter((x) => x.p?.elegible && !x.f)
    .sort((a, b) => (b.p!.puntaje! - a.p!.puntaje!) || (numeroDeCodigo(codigoDe.get(a.ind)!) - numeroDeCodigo(codigoDe.get(b.ind)!)));
  return new Map(elegibles.map((x, i) => [x.ind, i + 1]));
}

/** Individuos dados de baja durante la temporada: salen del ranking vigente pero no de las series históricas. */
const muertos = new Set<string>();
const evaluadosTodos = () => [I(1), I(2), I(3), I(4), I(5), I(6), I(7), I(8), I(9), I(10), S4.idsCC[0], S4.idsCC[1]];
const evaluados = () => evaluadosTodos().filter((i) => !muertos.has(i));

async function vivosDe(plantaIds: string[]) {
  const { data: plantas } = await ctx.service.from('plantas').select('id').in('id', plantaIds).is('eliminado_at', null);
  const vivos = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).in('planta_id', (plantas ?? []).map((p) => p.id)).eq('estado_vital', 'vivo');
  return vivos.count ?? 0;
}

describe('P7 · rankear: obtener_ranking_operativo, obtener_scoring_planta, cruces analíticos y dashboard concuerdan con el cálculo a mano', () => {
  it('el ranking de la especie coincide, individuo por individuo, con el cálculo independiente: puntajes, elegibles, motivos y posiciones', async () => {
    const { r, filas } = await rankingEspecie();
    expect(r.scoring_version_id).toBe(S.v1);
    expect(r.total).toBe(await vivosDe([S.CA!, S.CC!, S.CD!]));
    for (const ind of evaluados()) {
      if (modelo.has(ind)) esperarFila(filas.get(ind), ind);
    }
    // Motivos de los que no puntúan.
    expect(filas.get(I(5))!.motivo_exclusion).toBe('evaluacion_parcial_en_curso');
    expect(filas.get(I(6))!.motivo_exclusion).toBe('sin_evaluacion_completa_en_ronda_actual');
    expect(filas.get(I(10))!.motivo_exclusion).toBe('sin_evaluacion_completa_en_ronda_actual');
    expect(filas.get(S4.idsCC[2])!.motivo_exclusion).toBe('sin_ronda');
    // El primer individuo de CD recibió rondas en el paso de mala señal; los demás nunca tuvieron ronda.
    expect(filas.get(S4.idsCD[0])!.motivo_exclusion).toBe('sin_evaluacion_completa_en_ronda_actual');
    for (const id of S4.idsCD.slice(1)) expect(filas.get(id)!.motivo_exclusion).toBe('sin_ronda');

    const esperadas = posicionesEsperadas(evaluados());
    expect(esperadas.size).toBe(9); // I1, I2, I3, I4, I7, I8, I9, C1, C2
    expect(r.poblacion_comparada).toBe(9);
    const puntajes = [...esperadas.keys()].map((ind) => Number(filas.get(ind)!.puntaje_ponderado));
    expect(noSeRepite(puntajes)).toBe(true); // sin empates: las posiciones no dependen del desempate
    for (const [ind, pos] of esperadas) expect(filas.get(ind)!.posicion, `posición de ${codigoDe.get(ind)}`).toBe(pos);
    // Orden de la página: los elegibles van primero, de mayor a menor.
    const primeros = r.items.slice(0, 9).map((it) => it.individuo_id);
    expect(primeros).toEqual([...esperadas.entries()].sort((a, b) => a[1] - b[1]).map(([ind]) => ind));
    // La estrella conserva su 0,573 a mano.
    expect(Number(filas.get(I(1))!.puntaje_ponderado)).toBe(0.573);
  });

  it('operario y admin ven exactamente el mismo ranking, y no incluye nada de linaje', async () => {
    const op = await api.obtenerRanking(ctx.opB, { especieId: ctx.especieId, limite: 100 });
    const ad = await api.obtenerRanking(ctx.admin, { especieId: ctx.especieId, limite: 100 });
    expect(op).toEqual(ad);
    registrarLectura('obtener_ranking_operativo (operario)', op);
  });

  it('paginar el ranking de a 5 no repite ni omite individuos, y el orden por código es numérico (P2 antes que P10)', async () => {
    const todos = await api.obtenerRanking(ctx.opA, { especieId: ctx.especieId, limite: 100 });
    const vistos: string[] = [];
    for (let offset = 0; offset < todos.total; offset += 5) {
      const pagina = await api.obtenerRanking(ctx.opA, { especieId: ctx.especieId, limite: 5, offset });
      expect(pagina.total).toBe(todos.total);
      vistos.push(...pagina.items.map((i) => i.individuo_id));
    }
    expect(vistos).toEqual(todos.items.map((i) => i.individuo_id));
    expect(noSeRepite(vistos)).toBe(true);

    const porCodigo = await api.obtenerRanking(ctx.opA, { plantaId: S.CA!, limite: 100, orden: 'codigo_asc' });
    const numeros = porCodigo.items.map((i) => numeroDeCodigo(i.codigo_display));
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
    expect(numeros).toHaveLength(10);
    expect(numeros.at(-1)).toBeGreaterThan(9); // hay un P10: con orden de texto iría antes que P2
    expect((await api.falla(() => api.obtenerRanking(ctx.opA, { especieId: ctx.especieId, limite: 101 })))?.code).toBe('22023');
  });

  it('obtener_scoring_planta y el ranking por cruce dan los mismos puntajes que el ranking de la especie; las posiciones se miden dentro del cruce', async () => {
    const { filas } = await rankingEspecie();
    const scoring = await api.listarScoringDePlanta(ctx.opB, S.CA!);
    registrarLectura('obtener_scoring_planta (operario)', scoring);
    expect(scoring).toHaveLength(10);
    const rankCA = await api.obtenerRanking(ctx.opB, { plantaId: S.CA!, limite: 100 });
    const individuosCA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(I);
    const posCA = posicionesEsperadas(individuosCA);
    for (const f of scoring) {
      expect(f.puntaje_ponderado === null ? null : Number(f.puntaje_ponderado)).toBe(filas.get(f.individuo_id)!.puntaje_ponderado === null ? null : Number(filas.get(f.individuo_id)!.puntaje_ponderado));
      expect(f.elegible).toBe(filas.get(f.individuo_id)!.elegible);
      expect(f.posicion === null ? null : Number(f.posicion)).toBe(posCA.get(f.individuo_id) ?? null);
    }
    expect(rankCA.total).toBe(10);
    expect(rankCA.poblacion_comparada).toBe(posCA.size);
    for (const it2 of rankCA.items) expect(it2.posicion).toBe(posCA.get(it2.individuo_id) ?? null);
  });

  it('el listado de cruces analíticos (Inicio) y el dashboard científico concuerdan con el ranking: mejor puntaje, vivos, elegibles, destacados y pendientes', async () => {
    const { filas } = await rankingEspecie();
    const lista = await comoReales(() => api.listarCrucesAnaliticos(ctx.opA, { especieId: ctx.especieId, limite: 50 }));
    registrarLectura('listar_cruces_analiticos (operario)', lista);
    const deCruce = (id: string) => lista.items.find((c) => c.id === id)!;
    const elegiblesDe = (ids: string[]) => ids.filter((i) => filas.get(i)!.elegible);
    const ca = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(I);
    expect(deCruce(S.CA!)).toMatchObject({ individuos_vivos: 10, individuos_elegibles: elegiblesDe(ca).length, scoring_version_id: S.v1 });
    expect(Number(deCruce(S.CA!).mejor_puntaje)).toBe(Math.max(...elegiblesDe(ca).map((i) => Number(filas.get(i)!.puntaje_ponderado))));
    expect(deCruce(S.CC!)).toMatchObject({ individuos_vivos: 3, individuos_elegibles: 2 });
    expect(deCruce(S.CD!).mejor_puntaje).toBeNull();

    const dash = await comoReales(() => api.obtenerDashboardCientifico(ctx.opA, ctx.especieId, 8));
    registrarLectura('obtener_dashboard_cientifico (operario)', dash);
    expect(dash.scoring_version_id).toBe(S.v1);
    const ranking = (await rankingEspecie()).r;
    expect(dash.destacados.map((d) => d.individuo_id)).toEqual(ranking.items.filter((i) => i.elegible).slice(0, 8).map((i) => i.individuo_id));
    const totalVisitas = [...modelo.values()].reduce((t, v) => t + v.length, 0);
    expect(dash.resumen.evaluaciones_ultimos_30_dias).toBe(totalVisitas);
    expect(dash.resumen.individuos_vivos).toBe(await vivosDe([S.CA!, S.CC!, S.CD!, ...await idsDeCrucesExtra()]));
    // Pendientes (v3 N26) = lo mismo que la planilla: individuos vivos sin evaluación cerrada en la última ronda.
    for (const id of [S.CA!, S.CC!, S.CD!]) {
      const { data, error } = await ctx.opA.rpc('obtener_planilla_ronda', { p_planta_id: id });
      expect(error).toBeNull();
      const sinCerrar = (data as { avance: { vivos: number; completa: number } }).avance;
      const esperado = sinCerrar.vivos - sinCerrar.completa;
      expect(dash.pendientes.find((p) => p.planta_id === id)?.individuos_pendientes, id).toBe(esperado > 0 ? esperado : undefined);
    }
  });
});

/** Cruces de la temporada fuera de CA/CC/CD (el de «fuera de fase» de P4). */
async function idsDeCrucesExtra(): Promise<string[]> {
  return limp.plantaIds.filter((id) => ![S.CA, S.CC, S.CD].includes(id));
}

// ===========================================================================
// P8 · Congelar el ranking
// ===========================================================================

const S8: { s1?: string; filasS1?: Array<Record<string, any>>; eligiblesS1: string[] } = { eligiblesS1: [] };

describe('P8 · congelar el ranking (snapshot)', () => {
  it('el operario no puede congelar: 42501, sin snapshot y sin rastro', async () => {
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.congelarRanking(ctx.opA, { nombre: 'intruso', especieId: ctx.especieId }));
    expect(err?.code).toBe('42501');
    const { count } = await ctx.service.from('ranking_snapshot').select('id', { count: 'exact', head: true }).eq('especie_id', ctx.especieId);
    expect(count).toBe(0);
    expect(await auditDesde(ctx, marca)).toHaveLength(0);
  });

  it('el admin congela el ranking de la especie: el snapshot guarda solo los 9 elegibles con posición y puntaje del ranking vivo, la versión y el autor', async () => {
    const marca = await maxAuditId(ctx);
    const { filas, r } = await rankingEspecie();
    S8.s1 = await api.congelarRanking(ctx.admin, { nombre: `AUD-G11 corte 1 ${ctx.R}`, especieId: ctx.especieId });
    limp.snapshotIds.push(S8.s1);
    const det = await api.obtenerDetalleSnapshot(ctx.opA, S8.s1);
    registrarLectura('obtener_detalle_snapshot (operario)', det);
    expect(det.snapshot).toMatchObject({ alcance: 'especie', scoring_version_id: S.v1, poblacion_comparada: 9, created_by: ctx.adminId });
    expect(det.resultados).toHaveLength(9);
    for (const res of det.resultados) {
      const vivo = filas.get(res.individuo_id)!;
      expect(res.posicion).toBe(vivo.posicion);
      expect(Number(res.puntaje)).toBe(Number(vivo.puntaje_ponderado));
      expect(res.evaluacion_id).toBe(vivo.evaluacion_id);
      expect(res.detalle.scoring_version_id).toBe(S.v1);
    }
    S8.eligiblesS1 = det.resultados.map((x) => x.individuo_id as string);
    S8.filasS1 = det.resultados;
    expect(r.poblacion_comparada).toBe(9);
    const aud = await auditDesde(ctx, marca, { accion: 'congelacion_ranking' });
    expect(aud).toHaveLength(1);
    expect(aud[0].usuario_id).toBe(ctx.adminId);
    expect(aud[0].detalle).toMatchObject({ snapshot_id: S8.s1, especie_id: ctx.especieId, poblacion: 9, scoring_version_id: S.v1 });
  });

  it('recién congelado, comparar con el vivo da delta 0 («estable») para todos y la versión no cambió', async () => {
    const cmp = await api.compararSnapshotVivo(ctx.opB, S8.s1!);
    expect(cmp.version_cambio).toBe(false);
    expect(cmp.individuos).toHaveLength(9);
    for (const it2 of cmp.individuos) {
      expect(it2).toMatchObject({ estaba_en_snapshot: true, esta_en_vivo: true, etiqueta: 'estable' });
      expect(Number(it2.delta)).toBe(0);
    }
    registrarLectura('comparar_snapshot_vivo (operario)', cmp);
  });

  // A1-147: nombre y alcance identifican un snapshot ya congelado.
  it('mala señal: congelar dos veces el mismo ranking con el mismo nombre no deja dos snapshots (A1-G6-11)', async () => {
    const segunda = await api.congelarRanking(ctx.admin, { nombre: `AUD-G11 corte 1 ${ctx.R}`, especieId: ctx.especieId });
    expect(segunda).toBe(S8.s1);
    limp.snapshotIds.push(segunda);
    const lista = await api.listarSnapshotsRanking(ctx.admin, { especieId: ctx.especieId });
    expect(lista.items.filter((s) => s.nombre === `AUD-G11 corte 1 ${ctx.R}`)).toHaveLength(1);
  });
});

// ===========================================================================
// P9 · Un cruce se archiva a mitad de temporada y se restaura
// ===========================================================================

describe('P9 · archivar CC a mitad de temporada y restaurarlo', () => {
  let eliminadoAt1: string | null = null;
  let rankingAntes: Array<Record<string, any>> = [];

  it('el operario no puede archivar ni restaurar: 42501 y sin rastro', async () => {
    const marca = await maxAuditId(ctx);
    expect((await api.falla(() => api.borrarCruzamiento(ctx.opB, S.CC!, 'soft')))?.code).toBe('42501');
    expect((await api.falla(() => api.borrarCruzamiento(ctx.opB, S.CC!, 'hard')))?.code).toBe('42501');
    expect((await api.falla(() => api.restaurarCruzamiento(ctx.opB, S.CC!)))?.code).toBe('42501');
    const { data } = await ctx.service.from('plantas').select('eliminado_at').eq('id', S.CC!).single();
    expect(data?.eliminado_at).toBeNull();
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opBId] })).toHaveLength(0);
  });

  it('el admin archiva CC (reversible): queda borrado_cruzamiento_soft con el resumen de lo que contiene y el cruce desaparece de ranking, ficha, scoring y analíticos', async () => {
    rankingAntes = (await rankingEspecie()).r.items;
    const marca = await maxAuditId(ctx);
    await api.borrarCruzamiento(ctx.admin, S.CC!, 'soft');
    const { data } = await ctx.service.from('plantas').select('eliminado_at').eq('id', S.CC!).single();
    eliminadoAt1 = data!.eliminado_at;
    expect(eliminadoAt1).not.toBeNull();

    const aud = await auditDesde(ctx, marca, { accion: 'borrado_cruzamiento_soft' });
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ usuario_id: ctx.adminId, planta_id: S.CC });
    expect(aud[0].detalle).toMatchObject({ codigo_sistema: S.codCC, tipo_borrado: 'soft', n_individuos: 3, n_evaluaciones: 2, n_rondas: 2, es_prueba: true });

    // Efectos en las demás pantallas.
    const { r, filas } = await rankingEspecie();
    for (const id of S4.idsCC) expect(filas.has(id)).toBe(false);
    expect(r.poblacion_comparada).toBe(7);
    expect(r.total).toBe(rankingAntes.length - 3);
    expect((await api.falla(() => api.listarScoringDePlanta(ctx.opA, S.CC!)))?.code).toBe('P0002');
    expect((await api.falla(() => api.obtenerFicha(ctx.opA, S.CC!)))?.code).toBe('P0002');
    expect((await api.falla(() => api.obtenerRanking(ctx.opA, { plantaId: S.CC!, limite: 10 })))?.code).toBe('P0002');
    const lista = await comoReales(() => api.listarCrucesAnaliticos(ctx.opA, { especieId: ctx.especieId, limite: 50 }));
    expect(lista.items.some((c) => c.id === S.CC)).toBe(false);
    const dash = await comoReales(() => api.obtenerDashboardCientifico(ctx.opA, ctx.especieId, 8));
    expect(dash.destacados.some((d) => S4.idsCC.includes(d.individuo_id))).toBe(false);
  });

  it('el snapshot ya congelado no cambia al archivar, y compararlo con el vivo marca a los de CC como «ya no está en vivo» (sin delta inventado)', async () => {
    const det = await api.obtenerDetalleSnapshot(ctx.opA, S8.s1!);
    expect(det.resultados).toHaveLength(9);
    expect(det.resultados.map((x) => x.individuo_id).sort()).toEqual([...S8.eligiblesS1].sort());
    const cmp = await api.compararSnapshotVivo(ctx.opA, S8.s1!);
    for (const id of S4.idsCC.slice(0, 2)) {
      const fila = cmp.individuos.find((x) => x.individuo_id === id)!;
      expect(fila).toMatchObject({ estaba_en_snapshot: true, esta_en_vivo: false, puntaje_vivo: null, delta: null, etiqueta: null });
      expect(fila.puntaje_snapshot).not.toBeNull();
    }
    for (const fila of cmp.individuos.filter((x) => !S4.idsCC.includes(x.individuo_id))) expect(Number(fila.delta)).toBe(0);
  });

  // A1-G3-16 (ya reportado): archivar dos veces pisa la fecha original del archivado.
  it.fails('mala señal: archivar un cruce que ya está archivado no cambia la fecha original del archivado ni agrega otra auditoría (A1-G3-16)', async () => {
    const marca = await maxAuditId(ctx);
    await api.borrarCruzamiento(ctx.admin, S.CC!, 'soft');
    const { data } = await ctx.service.from('plantas').select('eliminado_at').eq('id', S.CC!).single();
    expect(data!.eliminado_at).toBe(eliminadoAt1);
    expect(await auditDesde(ctx, marca, { accion: 'borrado_cruzamiento_soft' })).toHaveLength(0);
  });

  it('el admin restaura CC: vuelven individuos, evaluaciones y ranking tal como estaban, y queda restauracion_cruzamiento con la fecha anterior', async () => {
    const marca = await maxAuditId(ctx);
    const res = await api.restaurarCruzamiento(ctx.admin, S.CC!);
    expect(res).toMatchObject({ planta_id: S.CC, codigo_sistema: S.codCC, n_individuos: 3, n_evaluaciones: 2, n_emplazamientos: 0 });
    const { data } = await ctx.service.from('plantas').select('eliminado_at, estado').eq('id', S.CC!).single();
    expect(data).toEqual({ eliminado_at: null, estado: 'evaluacion_anual' });
    const aud = await auditDesde(ctx, marca, { accion: 'restauracion_cruzamiento' });
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ usuario_id: ctx.adminId, planta_id: S.CC });
    expect(aud[0].detalle.eliminado_at_anterior).toBeTruthy();

    const { r, filas } = await rankingEspecie();
    expect(r.poblacion_comparada).toBe(9);
    expect(r.total).toBe(rankingAntes.length);
    for (const ant of rankingAntes) {
      const ahora = filas.get(ant.individuo_id)!;
      expect(ahora.puntaje_ponderado).toEqual(ant.puntaje_ponderado);
      expect(ahora.posicion).toEqual(ant.posicion);
      expect(ahora.motivo_exclusion).toEqual(ant.motivo_exclusion);
    }
    const cmp = await api.compararSnapshotVivo(ctx.opA, S8.s1!);
    expect(cmp.individuos.every((x) => x.esta_en_vivo && Number(x.delta) === 0)).toBe(true);
  });

  it('mala señal: restaurar un cruce que ya está vigente falla con 23514 y no deja otra fila en audit_log', async () => {
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.restaurarCruzamiento(ctx.admin, S.CC!));
    expect(err?.code).toBe('23514');
    expect(await auditDesde(ctx, marca, { accion: 'restauracion_cruzamiento' })).toHaveLength(0);
  });
});

// ===========================================================================
// P10 · Ronda 2 antes del cambio; versión nueva de scoring: crear, activar, rankear de nuevo
// ===========================================================================

const S10: { rondaI2r2?: string; rondaI10?: string } = {};
const R2_I2 = completa({ firmeza: 5, brix: 17, calibre_mm: 22, bloom: 5, rend_kg_planta: 4 });

describe('P10 · ronda 2 de I2 (antes del cambio) y versión nueva de scoring (V2)', () => {
  it('A inicia la ronda 2 de I2: mientras no se evalúe, I2 SALE del ranking (el ranking mira solo la ronda más reciente); al evaluarla vuelve con el puntaje de la ronda 2', async () => {
    const r = await api.iniciarRonda(ctx.opA, I(2));
    expect(r.numero_ronda).toBe(2);
    S10.rondaI2r2 = r.ronda_id;
    let { filas } = await rankingEspecie();
    expect(filas.get(I(2))).toMatchObject({ elegible: false, puntaje_ponderado: null, motivo_exclusion: 'sin_evaluacion_completa_en_ronda_actual', numero_ronda: 2 });
    expect((await rankingEspecie()).r.poblacion_comparada).toBe(8);

    // Ronda 2 cerrada con fecha anterior a la V2 (aún no existe): queda ligada a V1.
    const visitasR1I2 = [...modelo.get(I(2))!]; // visitas de la ronda 1, antes de cerrar la de la ronda 2
    const id = await cerrar(ctx.opA, ctx.opAId, I(2), ctx.d(-20), R2_I2, { rondaId: S10.rondaI2r2 });
    // El modelo de I2 pasa a ser SOLO la ronda 2 (el ranking toma la ronda de mayor número).
    ronda1De.set(I(2), visitasR1I2);
    modelo.set(I(2), [{ fecha: ctx.d(-20), orden: ++tick, captura: R2_I2 }]);
    ({ filas } = await rankingEspecie());
    esperarFila(filas.get(I(2)), I(2));
    expect(filas.get(I(2))).toMatchObject({ numero_ronda: 2, elegible: true });
    const { data } = await ctx.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', S10.rondaI2r2).single();
    expect(data?.scoring_version_id).toBe(S.v1);
    expect(id).toBeTruthy();
  });

  it('el operario no puede crear, editar ni activar versiones de scoring (RPC y camino directo): todo falla y no deja rastro', async () => {
    const marca = await maxAuditId(ctx);
    expect((await api.falla(() => api.nuevaVersionScoring(ctx.opA, { baseId: S.v1!, nombre: `AUD-G11 intruso ${ctx.R}`, vigenteDesde: ctx.d(-10) })))?.code).toBe('42501');
    expect((await api.falla(() => api.activarVersionScoring(ctx.opB, S.v1!)))?.code).toBe('42501');
    const ins = await ctx.opA.from('scoring_version').insert({ nombre: `AUD-G11 directa ${ctx.R}`, especie_id: ctx.especieId, vigente_desde: ctx.d(-10), estado: 'activa' });
    expect(ins.error?.code).toBe('42501');
    const upd = await ctx.opA.from('scoring_categoria_peso').update({ peso: 0.5 }).eq('scoring_version_id', S.v1!).select();
    expect(upd.data ?? []).toHaveLength(0);
    const { count } = await ctx.service.from('scoring_version').select('id', { count: 'exact', head: true }).eq('especie_id', ctx.especieId);
    expect(count).toBe(1);
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opAId, ctx.opBId] })).toHaveLength(0);
  });

  it('el admin duplica V1 como borrador (20 métricas, 4 pesos de categoría) y deja `nueva_version_scoring` con autor; repetir el nombre se rechaza y no crea otro borrador', async () => {
    const marca = await maxAuditId(ctx);
    S.v2 = await api.nuevaVersionScoring(ctx.admin, { baseId: S.v1!, nombre: `AUD-G11 V2 ${ctx.R}`, vigenteDesde: ctx.d(-10), nota: 'Más peso al brix' });
    limp.versionIds.push(S.v2);
    const { data: v } = await ctx.service.from('scoring_version').select('estado, especie_id, fase, vigente_desde, vigente_hasta').eq('id', S.v2).single();
    expect(v).toEqual({ estado: 'borrador', especie_id: ctx.especieId, fase: 'evaluacion_anual', vigente_desde: ctx.d(-10), vigente_hasta: null });
    const { count: metricas } = await ctx.service.from('scoring_metrica').select('id', { count: 'exact', head: true }).eq('scoring_version_id', S.v2);
    const { count: pesos } = await ctx.service.from('scoring_categoria_peso').select('id', { count: 'exact', head: true }).eq('scoring_version_id', S.v2);
    expect([metricas, pesos]).toEqual([20, 4]);
    const aud = await auditDesde(ctx, marca, { accion: 'nueva_version_scoring' });
    expect(aud).toHaveLength(1);
    expect(aud[0].usuario_id).toBe(ctx.adminId);
    expect(aud[0].detalle).toMatchObject({ version_base_id: S.v1, version_nueva_id: S.v2 });

    const err = await api.falla(() => api.nuevaVersionScoring(ctx.admin, { baseId: S.v1!, nombre: `AUD-G11 V2 ${ctx.R}`, vigenteDesde: ctx.d(-10) }));
    expect(err?.code).toBe('23505');
    const { count } = await ctx.service.from('scoring_version').select('id', { count: 'exact', head: true }).eq('especie_id', ctx.especieId);
    expect(count).toBe(2);
  });

  it('el admin edita el borrador (firmeza 4 → 1, brix 2 → 5); un operario no puede tocar ni siquiera el borrador', async () => {
    const opUpd = await ctx.opB.from('scoring_metrica').update({ peso: 9 }).eq('scoring_version_id', S.v2!).eq('metrica', 'brix').select();
    expect(opUpd.data ?? []).toHaveLength(0);
    const r1 = await ctx.admin.from('scoring_metrica').update({ peso: 1 }).eq('scoring_version_id', S.v2!).eq('metrica', 'firmeza').select();
    const r2 = await ctx.admin.from('scoring_metrica').update({ peso: 5 }).eq('scoring_version_id', S.v2!).eq('metrica', 'brix').select();
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    const { data } = await ctx.service.from('scoring_metrica').select('metrica, peso').eq('scoring_version_id', S.v2!).in('metrica', ['firmeza', 'brix']);
    expect(Object.fromEntries(data!.map((m) => [m.metrica, Number(m.peso)]))).toEqual({ firmeza: 1, brix: 5 });
    // V1 sigue intacta y sellada: no se puede tocar.
    const sellada = await ctx.admin.from('scoring_metrica').update({ peso: 7 }).eq('scoring_version_id', S.v1!).eq('metrica', 'brix');
    expect(sellada.error?.code).toBe('55000');
  });

  it('activar V2: V1 queda inactiva con vigente_hasta = desde-1, V2 activa y aprobada, con auditoría de ambas ids; activar de nuevo es idempotente', async () => {
    const antes = await rankingEspecie();
    const marca = await maxAuditId(ctx);
    expect(await api.activarVersionScoring(ctx.admin, S.v2!)).toBe(S.v2);
    const { data: vs } = await ctx.service.from('scoring_version').select('id, estado, vigente_desde, vigente_hasta, aprobado_by').in('id', [S.v1!, S.v2!]);
    expect(vs!.find((v) => v.id === S.v1)).toMatchObject({ estado: 'inactiva', vigente_hasta: ctx.d(-11) });
    expect(vs!.find((v) => v.id === S.v2)).toMatchObject({ estado: 'activa', vigente_hasta: null, aprobado_by: ctx.adminId });
    const aud = await auditDesde(ctx, marca, { accion: 'activacion_version_scoring' });
    expect(aud).toHaveLength(1);
    expect(aud[0].detalle).toMatchObject({ version_activada_id: S.v2, version_retirada_id: S.v1 });

    const marca2 = await maxAuditId(ctx);
    expect(await api.activarVersionScoring(ctx.admin, S.v2!)).toBe(S.v2); // mala señal
    expect(await auditDesde(ctx, marca2, { accion: 'activacion_version_scoring' })).toHaveLength(0);
    expect(antes.r.scoring_version_id).toBe(S.v1);
  });

  it('rankear de nuevo: ahora mide TODO con V2 (una sola versión); los puntajes se recalculan a mano con los pesos nuevos y el orden cambia', async () => {
    const { r, filas } = await rankingEspecie();
    expect(r.scoring_version_id).toBe(S.v2);
    const individuos = evaluados();
    const posV1 = posicionesEsperadas(individuos, CONFIG_V1);
    const posV2 = posicionesEsperadas(individuos, CONFIG_V2);
    for (const ind of individuos) {
      if (!modelo.has(ind)) continue;
      esperarFila(filas.get(ind), ind, CONFIG_V2);
      expect(filas.get(ind)!.scoring_version_id).toBe(S.v2);
    }
    for (const [ind, pos] of posV2) expect(filas.get(ind)!.posicion, `posición V2 de ${codigoDe.get(ind)}`).toBe(pos);
    // El cambio de pesos tiene efecto científico visible: el orden entre elegibles no es el mismo.
    const ordenV1 = [...posV1.entries()].sort((a, b) => a[1] - b[1]).map(([i]) => i);
    const ordenV2 = [...posV2.entries()].sort((a, b) => a[1] - b[1]).map(([i]) => i);
    expect(ordenV2).not.toEqual(ordenV1);
    // La estrella ya no vale 0,573: firmeza 1 (0) pierde peso y brix 18 (1) lo gana.
    expect(Number(filas.get(I(1))!.puntaje_ponderado)).toBeGreaterThan(0.573);
    // El listado de Inicio usa la misma versión y el mismo mejor puntaje que el ranking.
    const lista = await comoReales(() => api.listarCrucesAnaliticos(ctx.opA, { especieId: ctx.especieId, limite: 50 }));
    const deCA = lista.items.find((c) => c.id === S.CA)!;
    expect(deCA.scoring_version_id).toBe(S.v2);
    const mejorCA = Math.max(...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(I).filter((i) => posV2.has(i)).map((i) => puntajeIndependiente(unificarModelo(modelo.get(i)!), CONFIG_V2).puntaje!));
    expect(casiIgual(deCA.mejor_puntaje, mejorCA)).toBe(true);
  });
});

// ===========================================================================
// P11 · Carga tardía, ronda 2 con V2, comparar snapshot y rondas, series, dashboard
// ===========================================================================

type VersionSellada = 'V1' | 'V2';
/** Versión con que quedó sellada la ronda más reciente de cada individuo (cfg para el modo «por ronda»). */
const selladaDe = new Map<string, VersionSellada>();
const cfgDe = (v: VersionSellada) => (v === 'V1' ? CONFIG_V1 : CONFIG_V2);

const R2_I1 = completa({ firmeza: 2, brix: 12, rend_kg_planta: 2 });
const LATE_I10 = completa({ firmeza: 5, calibre_mm: 24, brix: 18 });

const S11: { rondaI1r2?: string; selladaI10?: string | null; selladaI6?: string | null; serieAntesDeBajas?: Array<{ periodo: string; evaluaciones_elegibles: number; puntaje_promedio: number | null }> } = {};

function etiquetaEsperada(delta: number | null, u: { leve: number; marcado: number }) {
  if (delta === null) return null;
  const a = Math.abs(delta);
  if (a < u.leve) return 'estable';
  if (a < u.marcado) return delta > 0 ? 'mejoro_leve' : 'empeoro_leve';
  return delta > 0 ? 'mejoro_marcado' : 'empeoro_marcado';
}

describe('P11 · carga tardía, ronda 2 con la versión nueva y vistas históricas', () => {
  it('carga tardía: B cierra una evaluación de I10 con fecha ANTERIOR a la vigencia de V2; entra al ranking vigente con el puntaje de V2', async () => {
    const id = await cerrar(ctx.opB, ctx.opBId, I(10), ctx.d(-40), LATE_I10);
    expect(id).toBeTruthy();
    selladaDe.set(I(10), 'V1');
    const { filas } = await rankingEspecie();
    esperarFila(filas.get(I(10)), I(10), CONFIG_V2);
    expect(filas.get(I(10))).toMatchObject({ elegible: true, scoring_version_id: S.v2 });
    const { data } = await ctx.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', rondaDe.get(I(10))!).single();
    S11.selladaI10 = data?.scoring_version_id ?? null;
  });

  // A1-G5-11 / A1-G6-06 (ya reportados): la ronda no se sella con la versión que regía en la fecha de la evaluación.
  it.fails('la ronda de la carga tardía queda sellada con V1, la versión que regía en la fecha de la evaluación (A1-G5-11, A1-G6-06)', async () => {
    expect(S11.selladaI10).toBe(S.v1);
  });

  it('(documenta el estado actual) la ronda tardía queda sellada con la versión GLOBAL, ni V1 ni V2', async () => {
    expect(S11.selladaI10).not.toBeNull();
    expect(S11.selladaI10).not.toBe(S.v1);
    expect(S11.selladaI10).not.toBe(S.v2);
    const { data } = await ctx.service.from('scoring_version').select('especie_id, estado').eq('id', S11.selladaI10!).single();
    expect(data).toMatchObject({ especie_id: null, estado: 'activa' });
  });

  it('A inicia la ronda 2 de I1 y la evalúa con fecha de hoy: queda sellada con V2 y el ranking vuelve a recalcular a mano (la ronda 1 ya no cuenta)', async () => {
    const r = await api.iniciarRonda(ctx.opA, I(1));
    expect(r.numero_ronda).toBe(2);
    S11.rondaI1r2 = r.ronda_id;
    await cerrar(ctx.opA, ctx.opAId, I(1), ctx.hoy, R2_I1, { rondaId: r.ronda_id });
    ronda1De.set(I(1), modelo.get(I(1))!.slice(0, 1));
    modelo.set(I(1), [{ fecha: ctx.hoy, orden: ++tick, captura: R2_I1 }]);
    selladaDe.set(I(1), 'V2');
    selladaDe.set(I(2), 'V1');
    const { data } = await ctx.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', r.ronda_id).single();
    expect(data?.scoring_version_id).toBe(S.v2);

    const { filas } = await rankingEspecie();
    for (const ind of evaluados()) if (modelo.has(ind)) esperarFila(filas.get(ind), ind, CONFIG_V2);
    expect(filas.get(I(1))).toMatchObject({ numero_ronda: 2, elegible: true });
  });

  it('I6 (su evaluación se anuló en P6): se vuelve a evaluar con fecha de hoy, ya con V2 vigente; el individuo vuelve al ranking con el puntaje de V2', async () => {
    await cerrar(ctx.opA, ctx.opAId, I(6), ctx.hoy, completa({ firmeza: 3, brix: 13, rend_t_ha: 5 }));
    const { filas } = await rankingEspecie();
    esperarFila(filas.get(I(6)), I(6), CONFIG_V2);
    expect(filas.get(I(6))).toMatchObject({ elegible: true, scoring_version_id: S.v2 });
    const { data } = await ctx.service.from('ronda_evaluacion_anual').select('scoring_version_id').eq('id', rondaDe.get(I(6))!).single();
    S11.selladaI6 = data?.scoring_version_id ?? null;
    selladaDe.set(I(6), S11.selladaI6 === S.v2 ? 'V2' : 'V1'); // el modelo sigue lo que hizo la base para poder comparar el resto
  });

  // A1-G11-04 (nuevo): la ronda se sella con la primera evaluación que se cerró, aunque después se anule.
  it.fails('la ronda de I6 se sella con la versión vigente en la fecha de su única evaluación válida (V2), no con la de una evaluación anulada (A1-G11-04)', async () => {
    expect(S11.selladaI6).toBe(S.v2);
  });

  it('comparar el snapshot con el vivo: cada individuo se mide con la versión sellada de su ronda (modo por ronda); deltas y etiquetas coinciden con el cálculo a mano', async () => {
    const cmp = await api.compararSnapshotVivo(ctx.opB, S8.s1!);
    registrarLectura('comparar_snapshot_vivo tras V2 (operario)', cmp);
    expect(cmp.version_cambio).toBe(true);
    expect(cmp.scoring_version_snapshot_id).toBe(S.v1);
    expect(cmp.scoring_version_viva_id).toBe(S.v2);
    const snap = new Map(S8.filasS1!.map((x) => [x.individuo_id as string, Number(x.puntaje)]));
    for (const ind of evaluados()) {
      const fila = cmp.individuos.find((x) => x.individuo_id === ind);
      if (!snap.has(ind) && !(modelo.has(ind) && puntajeIndependiente(unificarModelo(modelo.get(ind)!), CONFIG_V1).elegible)) {
        expect(fila).toBeUndefined();
        continue;
      }
      const sellada = selladaDe.get(ind) ?? 'V1';
      const vivo = puntajeIndependiente(unificarModelo(modelo.get(ind)!), cfgDe(sellada));
      expect(fila, `comparación de ${codigoDe.get(ind)}`).toBeDefined();
      expect(fila!.estaba_en_snapshot).toBe(snap.has(ind));
      expect(fila!.esta_en_vivo).toBe(true);
      expect(casiIgual(fila!.puntaje_vivo, vivo.puntaje), `puntaje vivo de ${codigoDe.get(ind)} (${sellada}): ${fila!.puntaje_vivo} vs ${vivo.puntaje}`).toBe(true);
      if (snap.has(ind)) {
        expect(Number(fila!.puntaje_snapshot)).toBe(snap.get(ind));
        const delta = redondear(vivo.puntaje! - snap.get(ind)!);
        expect(casiIgual(fila!.delta, delta)).toBe(true);
        expect(fila!.etiqueta).toBe(etiquetaEsperada(delta, cmp.umbrales));
      } else {
        expect(fila).toMatchObject({ puntaje_snapshot: null, delta: null, etiqueta: null });
      }
    }
    // La ronda 2 de I2 y la de I1 cambian algo; el resto de los individuos de la ronda 1 sellada con V1 no se mueve (delta 0).
    expect(cmp.individuos.find((x) => x.individuo_id === I(7))!.etiqueta).toBe('estable');
    expect(cmp.individuos.find((x) => x.individuo_id === I(1))!.etiqueta).not.toBe('estable');
  });

  // A1-G6-12 (ya reportado, decisión B6 del 21-10): el «vivo» del snapshot no es el ranking vivo.
  it('(documenta A1-G6-12) el mismo individuo muestra dos puntajes: el del ranking vivo (V2) y el «vivo» de la comparación con el snapshot (versión sellada de su ronda)', async () => {
    const { filas } = await rankingEspecie();
    const cmp = await api.compararSnapshotVivo(ctx.opB, S8.s1!);
    const enRanking = Number(filas.get(I(7))!.puntaje_ponderado);
    const enComparacion = Number(cmp.individuos.find((x) => x.individuo_id === I(7))!.puntaje_vivo);
    expect(casiIgual(enRanking, enComparacion)).toBe(false);
    expect(casiIgual(enRanking, puntajeIndependiente(unificarModelo(modelo.get(I(7))!), CONFIG_V2).puntaje)).toBe(true);
    expect(casiIgual(enComparacion, puntajeIndependiente(unificarModelo(modelo.get(I(7))!), CONFIG_V1).puntaje)).toBe(true);
  });

  it('comparar rondas de I1 (ronda 1 → 2): deltas por categoría y por métrica calculados a mano con la versión vigente (V2) para ambas rondas, con sus etiquetas', async () => {
    const cmp = await api.obtenerComparacionRondas(ctx.opA, { individuoId: I(1) });
    registrarLectura('obtener_comparacion_rondas (operario)', cmp);
    expect(cmp.individuos).toHaveLength(1);
    const ind = cmp.individuos[0];
    expect(ind).toMatchObject({ individuo_id: I(1), tipo_ronda: 'anual', numero_anterior: 1, numero_actual: 2 });
    const r1 = puntajeIndependiente(unificarModelo(ronda1De.get(I(1))!), CONFIG_V2);
    const r2 = puntajeIndependiente(unificarModelo(modelo.get(I(1))!), CONFIG_V2);
    for (const cat of ['fenologia', 'fruto_calidad', 'produccion', 'estres'] as const) {
      const d = ind.deltas_categoria.find((x: any) => x.categoria === cat);
      const delta = (r2.subpuntajes[cat] as number) - (r1.subpuntajes[cat] as number);
      expect(casiIgual(d.delta, delta, 1e-9), `delta de ${cat}: ${d.delta} vs ${delta}`).toBe(true);
      expect(d.etiqueta).toBe(etiquetaEsperada(delta, cmp.umbrales!));
    }
    expect(ind.deltas_parametro).toHaveLength(20);
    const firmeza = ind.deltas_parametro.find((x: any) => x.metrica === 'firmeza');
    expect(firmeza).toMatchObject({ valor_anterior: 1, valor_actual: 2, normalizado_anterior: 0, normalizado_actual: 0.25 });
    expect(firmeza.etiqueta).toBe('mejoro_marcado');
    const brix = ind.deltas_parametro.find((x: any) => x.metrica === 'brix');
    expect(brix).toMatchObject({ valor_anterior: 18, valor_actual: 12 });
    expect(casiIgual(brix.delta, 0.25 - 1, 1e-9)).toBe(true);
    expect(brix.etiqueta).toBe('empeoro_marcado');
  });

  it('comparar rondas del cruce: solo aparecen los individuos con dos rondas cerradas y comparables (I1 e I2); I10 (una ronda) e I4 no', async () => {
    const cmp = await api.obtenerComparacionRondas(ctx.opA, { plantaId: S.CA! });
    expect(cmp.individuos.map((x) => x.individuo_id).sort()).toEqual([I(1), I(2)].sort());
    const i2 = cmp.individuos.find((x) => x.individuo_id === I(2))!;
    expect(i2).toMatchObject({ numero_anterior: 1, numero_actual: 2 });
    const r1 = puntajeIndependiente(unificarModelo(ronda1De.get(I(2))!), CONFIG_V2);
    const r2 = puntajeIndependiente(unificarModelo(modelo.get(I(2))!), CONFIG_V2);
    const dFruto = i2.deltas_categoria.find((x: any) => x.categoria === 'fruto_calidad');
    expect(casiIgual(dFruto.delta, (r2.subpuntajes.fruto_calidad as number) - (r1.subpuntajes.fruto_calidad as number), 1e-9)).toBe(true);
  });

  it('series históricas del cruce a mano: rondas elegibles y puntaje promedio por mes con la versión sellada de cada ronda; individuos vivos por mes', async () => {
    const desde = ctx.d(-100);
    const porMes = serieEsperada(desde);
    const series = await api.obtenerSeriesHistoricas(ctx.opB, { especieId: ctx.especieId, fechaDesde: desde, fechaHasta: ctx.hoy });
    registrarLectura('obtener_series_historicas_cientificas (operario)', series);
    expect(series.scoring.length).toBeGreaterThanOrEqual(3);
    verificarSerie(series.scoring, porMes);
    S11.serieAntesDeBajas = series.scoring;
    // Individuos vivos por mes: la base cuenta por created_at (hoy), así que el último mes trae a todos los vivos.
    const ultimo = series.individuos_vivos.at(-1)!;
    expect(ultimo.cantidad).toBe(await vivosDe([S.CA!, S.CC!, S.CD!, ...await idsDeCrucesExtra()]));
  });

  it('dashboard con V2: destacados = mejores del ranking vigente, con la versión y el recuento de evaluaciones recientes', async () => {
    const dash = await comoReales(() => api.obtenerDashboardCientifico(ctx.opB, ctx.especieId, 8));
    expect(dash.scoring_version_id).toBe(S.v2);
    const pos = posicionesEsperadas(evaluados(), CONFIG_V2);
    const top = [...pos.entries()].sort((a, b) => a[1] - b[1]).slice(0, 8).map(([i]) => i);
    expect(dash.destacados.map((d) => d.individuo_id)).toEqual(top);
    for (const d of dash.destacados) {
      expect(casiIgual(d.puntaje_ponderado, puntajeIndependiente(unificarModelo(modelo.get(d.individuo_id)!), CONFIG_V2).puntaje)).toBe(true);
    }
    const totalVisitas = [...modelo.values()].reduce((t, v) => t + v.length, 0) + [...ronda1De.values()].reduce((t, v) => t + v.length, 0);
    expect(dash.resumen.evaluaciones_ultimos_30_dias).toBe(totalVisitas);
  });
});

const redondear = (x: number) => Math.round(x * 10_000) / 10_000;

/** Serie mensual esperada (rondas elegibles y puntajes), con la versión sellada de cada ronda. Las bajas NO la alteran. */
function serieEsperada(desde: string): Map<string, number[]> {
  const rondas: Array<{ fecha: string; visitas: VisitaModelo[]; cfg: typeof CONFIG_V1 }> = [];
  const agregar = (visitas: VisitaModelo[] | undefined, sellada: VersionSellada) => {
    if (!visitas || visitas.length === 0) return;
    rondas.push({ fecha: visitas.map((v) => v.fecha).sort().at(-1)!, visitas, cfg: cfgDe(sellada) });
  };
  for (const ind of evaluadosTodos()) {
    if (ronda1De.has(ind)) agregar(ronda1De.get(ind), 'V1');
    agregar(modelo.get(ind), selladaDe.get(ind) ?? 'V1');
  }
  const porMes = new Map<string, number[]>();
  for (const r of rondas) {
    if (r.fecha < desde || r.fecha > ctx.hoy) continue;
    const p = puntajeIndependiente(unificarModelo(r.visitas), r.cfg);
    if (!p.elegible) continue;
    const mes = `${r.fecha.slice(0, 7)}-01`;
    porMes.set(mes, [...(porMes.get(mes) ?? []), p.puntaje!]);
  }
  return porMes;
}

function verificarSerie(scoring: Array<{ periodo: string; evaluaciones_elegibles: number; puntaje_promedio: number | null }>, porMes: Map<string, number[]>) {
  let totalRondas = 0;
  for (const punto of scoring) {
    const esperado = porMes.get(punto.periodo) ?? [];
    totalRondas += punto.evaluaciones_elegibles;
    expect(punto.evaluaciones_elegibles, `rondas elegibles de ${punto.periodo}`).toBe(esperado.length);
    if (esperado.length === 0) expect(punto.puntaje_promedio).toBeNull();
    else expect(casiIgual(punto.puntaje_promedio, redondear(esperado.reduce((a, b) => a + b, 0) / esperado.length)), `promedio de ${punto.periodo}`).toBe(true);
  }
  expect(totalRondas).toBe([...porMes.values()].reduce((t, v) => t + v.length, 0));
}

// ===========================================================================
// P12 · Traslado a un predio (crear predio)
// ===========================================================================

const S12: { predio?: string; sector?: string; nombrePredio?: string } = {};

describe('P12 · traslado a un predio: crear predio, trasladar individuos, mapa y resumen', () => {
  it('A avanza CA a traslado_destino; el operario no puede crear predios ni registrar traslados (42501) y no deja rastro', async () => {
    await api.actualizarEstado(ctx.admin, S.CA!, 'traslado_destino');
    const marca = await maxAuditId(ctx);
    expect((await api.falla(() => api.crearPredio(ctx.opA, { nombre: `AUD-G11 intruso ${ctx.R}` })))?.code).toBe('42501');
    // Sin predio propio todavía, el intento de traslado usa un sector cualquiera existente: no hace falta que exista, falla antes por rol.
    const err = await api.falla(() => api.registrarTraslado(ctx.opA, { individuoId: I(1), sectorId: randomUUID(), fechaInicio: ctx.hoy }));
    expect(err?.code).toBe('42501');
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opAId, ctx.opBId] })).toHaveLength(0);
    const { count } = await ctx.service.from('predio').select('id', { count: 'exact', head: true }).like('nombre', `AUD-G11 intruso%`);
    expect(count).toBe(0);
  });

  it('el admin crea el predio: se auto-provisiona un sector y el selector de destinos (`listarSectoresOperativos`) lo ofrece a cualquier usuario', async () => {
    S12.nombrePredio = `AUD-G11 Predio ${ctx.R}`;
    const predio = await api.crearPredio(ctx.admin, { nombre: S12.nombrePredio });
    S12.predio = predio.id;
    limp.predioIds.push(predio.id);
    expect(predio.activo).toBe(true);
    const sectores = (await api.listarSectoresOperativos(ctx.opB)).filter((s) => s.predio_id === predio.id);
    expect(sectores).toHaveLength(1);
    S12.sector = sectores[0].id;
    expect(sectores[0].predio.nombre).toBe(S12.nombrePredio);
  });

  // A1-G7-11 (ya reportado): sin unicidad de nombre, el doble toque en «Crear predio» deja dos predios idénticos en el selector de destinos.
  it.fails('mala señal: crear dos veces el mismo predio no deja dos predios con el mismo nombre (A1-G7-11)', async () => {
    let creado: { id: string } | null = null;
    const err = await api.falla(async () => { creado = await api.crearPredio(ctx.admin, { nombre: S12.nombrePredio! }); });
    if (creado) limp.predioIds.push((creado as { id: string }).id);
    expect(err?.code).toBe('23505');
  });

  it('datos incompletos y errores: fecha anterior al emplazamiento vigente (22007), predio inactivo (23514) y fecha vacía (23502) se rechazan sin dejar nada a medias', async () => {
    // Primero un traslado válido de I4, para tener un emplazamiento vigente al que anteceder.
    await api.registrarTraslado(ctx.admin, { individuoId: I(4), sectorId: S12.sector!, fechaInicio: ctx.hoy });
    const marca = await maxAuditId(ctx);
    expect((await api.falla(() => api.registrarTraslado(ctx.admin, { individuoId: I(4), sectorId: S12.sector!, fechaInicio: ctx.d(-5) })))?.code).toBe('22007');
    expect((await api.falla(() => api.registrarTraslado(ctx.admin, { individuoId: I(5), sectorId: S12.sector!, fechaInicio: null as unknown as string })))?.code).toBe('23502');
    await ctx.admin.from('predio').update({ activo: false }).eq('id', S12.predio!);
    const inactivo = await api.falla(() => api.registrarTraslado(ctx.admin, { individuoId: I(5), sectorId: S12.sector!, fechaInicio: ctx.hoy }));
    await ctx.admin.from('predio').update({ activo: true }).eq('id', S12.predio!);
    expect(inactivo?.code).toBe('23514');
    expect(inactivo?.message).toMatch(/predio está inactivo/);
    expect(await api.listarEmplazamientos(ctx.opA, I(4))).toHaveLength(1);
    expect(await api.listarEmplazamientos(ctx.opA, I(5))).toHaveLength(0);
    expect(await auditDesde(ctx, marca, { accion: 'traslado_individuo' })).toHaveLength(0);
  });

  it('el admin traslada I1, I2 e I3: un emplazamiento vigente cada uno y `registro_emplazamiento` con autor, sector y predio', async () => {
    const marca = await maxAuditId(ctx);
    for (const n of [1, 2, 3]) await api.registrarTraslado(ctx.admin, { individuoId: I(n), sectorId: S12.sector!, fechaInicio: ctx.hoy });
    for (const n of [1, 2, 3]) {
      const emp = await api.listarEmplazamientos(ctx.opB, I(n));
      expect(emp).toHaveLength(1);
      expect(emp[0]).toMatchObject({ sector_id: S12.sector, fecha_inicio: ctx.hoy, fecha_fin: null });
    }
    const aud = await auditDesde(ctx, marca, { accion: 'registro_emplazamiento' });
    expect(aud).toHaveLength(3);
    expect(aud.every((f) => f.usuario_id === ctx.adminId && f.planta_id === S.CA && f.detalle.sector_nuevo_id === S12.sector && f.detalle.predio_nuevo_id === S12.predio)).toBe(true);
  });

  // A1-G4-10 (ya reportado): sin clave de idempotencia ni comparación con el sector vigente.
  it.fails('mala señal: repetir el traslado al mismo sector no abre un segundo emplazamiento ni cierra el vigente (A1-G4-10)', async () => {
    await api.registrarTraslado(ctx.admin, { individuoId: I(3), sectorId: S12.sector!, fechaInicio: ctx.hoy });
    expect(await api.listarEmplazamientos(ctx.admin, I(3))).toHaveLength(1);
  });

  it('mapa del cruce y resumen territorial: 4 individuos emplazados en un solo predio (sin coordenadas, el operario no ve ninguna), y la ficha resumen muestra predio y sector', async () => {
    const mapa = await api.obtenerMapaCruce(ctx.opB, S.CA!);
    registrarLectura('obtener_mapa_cruce (operario)', mapa);
    expect(mapa.total_individuos_emplazados).toBe(4);
    expect(mapa.clusters).toHaveLength(1);
    expect(mapa.clusters[0]).toMatchObject({ predio_id: S12.predio, predio_nombre: S12.nombrePredio, individuos: 4, individuos_vivos: 4, tiene_coordenada: false, latitud: null, longitud: null });
    const agregado = await comoReales(() => api.obtenerMapaAgregado(ctx.opB, ctx.especieId));
    registrarLectura('obtener_resumen_mapa_territorial (operario)', agregado);
    const cluster = agregado.clusters.find((c: any) => c.predio_id === S12.predio);
    expect(cluster).toMatchObject({ individuos: 4, individuos_vivos: 4 });
    expect(cluster.cruces).toEqual([expect.objectContaining({ planta_id: S.CA, individuos: 4 })]);

    const resumen = await api.resumenIndividuosDeCruce(ctx.opA, S.CA!);
    const con = resumen.filter((r) => r.tiene_emplazamiento);
    expect(con.map((r) => r.individuo_id).sort()).toEqual([I(1), I(2), I(3), I(4)].sort());
    expect(con.every((r) => r.predio_nombre === S12.nombrePredio && typeof r.sector_nombre === 'string')).toBe(true);
  });
});

// ===========================================================================
// P13 · Bajas: individual y en lote
// ===========================================================================

describe('P13 · dar de baja (individual y en lote) y lo que arrastra al resto de la temporada', () => {
  const claveBaja = randomUUID();
  const claveLote = randomUUID();
  let rankingPrevio = 0;

  it('un operario que no es el autor del individuo no puede darlo de baja (42501, A1-G4-19) y el estado no cambia', async () => {
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.marcarBaja(ctx.opB, { individuo_id: I(8), estado_vital: 'muerto', fecha_baja: ctx.hoy, criterios: ['vigor'] }, randomUUID()));
    expect(err?.code).toBe('42501');
    const { data } = await ctx.service.from('individuos').select('estado_vital, fecha_baja').eq('id', I(8)).single();
    expect(data).toEqual({ estado_vital: 'vivo', fecha_baja: null });
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opBId] })).toHaveLength(0);
  });

  it('el autor (A) da de baja a I8 como muerto con dos criterios y una nota: individuo, motivos y auditoría con valores anterior y nuevo', async () => {
    rankingPrevio = (await rankingEspecie()).r.poblacion_comparada;
    const marca = await maxAuditId(ctx);
    const r = await api.marcarBaja(ctx.opA, { individuo_id: I(8), estado_vital: 'muerto', fecha_baja: ctx.hoy, criterios: ['vigor', 'sanidad'], nota: 'Se secó tras la helada' }, claveBaja);
    expect(r.repetido).toBe(false);
    muertos.add(I(8));
    const { data } = await ctx.service.from('individuos').select('estado_vital, fecha_baja').eq('id', I(8)).single();
    expect(data).toEqual({ estado_vital: 'muerto', fecha_baja: ctx.hoy });
    const { data: motivos } = await ctx.service.from('baja_motivo').select('criterio, nota, created_by').eq('individuo_id', I(8));
    expect(motivos!.map((m) => m.criterio).sort()).toEqual(['sanidad', 'vigor']);
    expect(motivos!.every((m) => m.nota === 'Se secó tras la helada' && m.created_by === ctx.opAId)).toBe(true);
    const edicion = await auditDesde(ctx, marca, { accion: 'edicion_individuo' });
    expect(edicion).toHaveLength(1);
    expect(edicion[0]).toMatchObject({ usuario_id: ctx.opAId, planta_id: S.CA });
    expect(edicion[0].detalle).toMatchObject({ individuo_id: I(8), anterior: { estado_vital: 'vivo', fecha_baja: null }, nuevo: { estado_vital: 'muerto', fecha_baja: ctx.hoy } });
    expect(await auditDesde(ctx, marca, { accion: 'creacion_baja_motivo' })).toHaveLength(2);
  });

  it('mala señal: reenviar la misma baja (misma clave) responde «repetido» y no duplica motivos ni auditoría; con otra clave se rechaza por «ya está de baja»', async () => {
    const marca = await maxAuditId(ctx);
    const r = await api.marcarBaja(ctx.opA, { individuo_id: I(8), estado_vital: 'muerto', fecha_baja: ctx.hoy, criterios: ['vigor', 'sanidad'], nota: 'Se secó tras la helada' }, claveBaja);
    expect(r.repetido).toBe(true);
    const { count } = await ctx.service.from('baja_motivo').select('id', { count: 'exact', head: true }).eq('individuo_id', I(8));
    expect(count).toBe(2);
    expect(await auditDesde(ctx, marca)).toHaveLength(0);
    const err = await api.falla(() => api.marcarBaja(ctx.opA, { individuo_id: I(8), estado_vital: 'descartado', fecha_baja: ctx.hoy, criterios: ['vigor'] }, randomUUID()));
    expect(err?.code).toBe('42501');
    expect(err?.message).toMatch(/ya fue dado de baja/);
  });

  it('efectos de la baja: sale del ranking, su QR sigue resolviendo (como muerto), no se le puede evaluar, iniciar ronda ni trasladar', async () => {
    const { r, filas } = await rankingEspecie();
    expect(filas.has(I(8))).toBe(false);
    expect(r.poblacion_comparada).toBe(rankingPrevio - 1);
    const resuelto = await api.resolverIndividuo(ctx.opB, I(8));
    expect(resuelto).toMatchObject({ id: I(8), estado_vital: 'muerto', planta_id: S.CA });
    expect(interpretarQR(contenidoQrIndividuo(I(8), true))).toEqual({ tipo: 'individuo', valor: I(8) });

    const marca = await maxAuditId(ctx);
    const e1 = await api.falla(() => api.crearEvaluacion(ctx.opB, ctx.opBId, { ronda_id: rondaDe.get(I(8))!, fecha: ctx.hoy, estado: 'completa', ...completa() }, randomUUID()));
    expect(e1?.code).toBe('42501');
    expect((await api.falla(() => api.iniciarRonda(ctx.opA, I(8))))?.code).toBe('42501');
    expect((await api.falla(() => api.registrarTraslado(ctx.admin, { individuoId: I(8), sectorId: S12.sector!, fechaInicio: ctx.hoy })))?.code).toBe('23514');
    expect(await auditDesde(ctx, marca)).toHaveLength(0);

    const cmp = await api.compararSnapshotVivo(ctx.opA, S8.s1!);
    expect(cmp.individuos.find((x) => x.individuo_id === I(8))).toMatchObject({ estaba_en_snapshot: true, esta_en_vivo: false, puntaje_vivo: null, delta: null });
    const resumen = await api.resumenIndividuosDeCruce(ctx.opA, S.CA!);
    const fila8 = resumen.find((x) => x.individuo_id === I(8))!;
    expect(fila8.estado_vital).toBe('muerto');
    expect(fila8.observaciones).toEqual(expect.arrayContaining([expect.objectContaining({ nota: 'Se secó tras la helada' })]));
  });

  it('baja en lote: el operario no puede (42501, sin rastro); el admin previsualiza [I9, I10, I8]: I8 se excluye por «ya está de baja»', async () => {
    const marca = await maxAuditId(ctx);
    expect((await api.falla(() => api.darBajaEnLote(ctx.opA, { ids: [I(9)], estado_vital: 'descartado', fecha_baja: ctx.hoy, criterios: ['uniformidad'] }, randomUUID())))?.code).toBe('42501');
    expect(await auditDesde(ctx, marca, { usuarioIds: [ctx.opAId] })).toHaveLength(0);
    const prev = await api.previsualizarBajaEnLote(ctx.admin, [I(9), I(10), I(8)]);
    expect(prev.procesables.map((p) => p.id).sort()).toEqual([I(9), I(10)].sort());
    expect(prev.excluidos).toEqual([expect.objectContaining({ id: I(8), motivo: 'ya_de_baja' })]);
  });

  it('un lote que incluye a uno ya de baja se rechaza ENTERO (23514): I9 e I10 siguen vivos y no queda auditoría de lote', async () => {
    const marca = await maxAuditId(ctx);
    const err = await api.falla(() => api.darBajaEnLote(ctx.admin, { ids: [I(9), I(10), I(8)], estado_vital: 'descartado', fecha_baja: ctx.hoy, criterios: ['uniformidad'], nota: 'Descarte' }, randomUUID()));
    expect(err?.code).toBe('23514');
    expect(err?.message).toMatch(/No se procesó ninguno/);
    const { data } = await ctx.service.from('individuos').select('id, estado_vital').in('id', [I(9), I(10)]);
    expect(data!.every((x) => x.estado_vital === 'vivo')).toBe(true);
    expect(await auditDesde(ctx, marca)).toHaveLength(0);
  });

  it('el admin da de baja a I9 e I10 en lote: dos descartados, un `baja_lote` con autor e ids, y los efectos llegan al ranking, al snapshot y al dashboard', async () => {
    const antes = await rankingEspecie();
    const marca = await maxAuditId(ctx);
    const r = await api.darBajaEnLote(ctx.admin, { ids: [I(9), I(10)], estado_vital: 'descartado', fecha_baja: ctx.hoy, criterios: ['uniformidad'], nota: 'Descarte por uniformidad' }, claveLote);
    expect(r).toEqual({ procesados: 2, repetido: false });
    muertos.add(I(9)); muertos.add(I(10));
    const lote = await auditDesde(ctx, marca, { accion: 'baja_lote' });
    expect(lote).toHaveLength(1);
    expect(lote[0]).toMatchObject({ usuario_id: ctx.adminId, planta_id: S.CA });
    expect(lote[0].detalle).toMatchObject({ procesados: 2, estado_vital: 'descartado', idempotency_key: claveLote });
    expect((lote[0].detalle.individuo_ids as string[]).sort()).toEqual([I(9), I(10)].sort());
    const ediciones = await auditDesde(ctx, marca, { accion: 'edicion_individuo' });
    expect(ediciones).toHaveLength(2);
    expect(ediciones.every((f) => f.usuario_id === ctx.adminId && f.detalle.nuevo.estado_vital === 'descartado')).toBe(true);

    const { r: rDespues, filas } = await rankingEspecie();
    expect(filas.has(I(9)) || filas.has(I(10))).toBe(false);
    expect(rDespues.poblacion_comparada).toBe(antes.r.poblacion_comparada - 2);
    expect(rDespues.total).toBe(antes.r.total - 2);
    const pos = posicionesEsperadas(evaluados(), CONFIG_V2);
    for (const [ind, p] of pos) expect(filas.get(ind)!.posicion, `posición de ${codigoDe.get(ind)}`).toBe(p);
    const dash = await comoReales(() => api.obtenerDashboardCientifico(ctx.opA, ctx.especieId, 8));
    expect(dash.destacados.some((d) => [I(8), I(9), I(10)].includes(d.individuo_id))).toBe(false);
    expect(dash.resumen.individuos_vivos).toBe(await vivosDe([S.CA!, S.CC!, S.CD!, ...await idsDeCrucesExtra()]));
  });

  it('mala señal: reenviar el lote con la misma clave responde «repetido» (procesados 2) y no deja otra auditoría ni cambia fechas', async () => {
    const marca = await maxAuditId(ctx);
    const r = await api.darBajaEnLote(ctx.admin, { ids: [I(9), I(10)], estado_vital: 'descartado', fecha_baja: ctx.hoy, criterios: ['uniformidad'], nota: 'Descarte por uniformidad' }, claveLote);
    expect(r).toEqual({ procesados: 2, repetido: true });
    expect(await auditDesde(ctx, marca)).toHaveLength(0);
    const { count } = await ctx.service.from('baja_motivo').select('id', { count: 'exact', head: true }).in('individuo_id', [I(9), I(10)]);
    expect(count).toBe(2);
  });

  it('baja de un individuo YA trasladado (I4): el mapa lo sigue contando como emplazado pero ya no como vivo, el emplazamiento vigente no se cierra y sale del ranking', async () => {
    const antes = await rankingEspecie();
    const marca = await maxAuditId(ctx);
    await api.marcarBaja(ctx.opA, { individuo_id: I(4), estado_vital: 'descartado', fecha_baja: ctx.hoy, criterios: ['arquitectura'], nota: 'Arquitectura inviable' }, randomUUID());
    muertos.add(I(4));
    const ed = await auditDesde(ctx, marca, { accion: 'edicion_individuo' });
    expect(ed).toHaveLength(1);
    expect(ed[0]).toMatchObject({ usuario_id: ctx.opAId, planta_id: S.CA });
    expect(ed[0].detalle.nuevo).toMatchObject({ estado_vital: 'descartado', fecha_baja: ctx.hoy });

    const mapa = await api.obtenerMapaCruce(ctx.opB, S.CA!);
    expect(mapa.clusters[0]).toMatchObject({ individuos: 4, individuos_vivos: 3 });
    const emp = await api.listarEmplazamientos(ctx.opB, I(4));
    expect(emp).toHaveLength(1);
    expect(emp[0].fecha_fin).toBeNull(); // la baja no cierra el emplazamiento (decisión de diseño: el historial territorial es append-only)
    const resumen = await api.resumenIndividuosDeCruce(ctx.opA, S.CA!);
    expect(resumen.find((r) => r.individuo_id === I(4))).toMatchObject({ estado_vital: 'descartado', tiene_emplazamiento: true });

    const { r, filas } = await rankingEspecie();
    expect(filas.has(I(4))).toBe(false);
    expect(r.poblacion_comparada).toBe(antes.r.poblacion_comparada - 1);
    const pos = posicionesEsperadas(evaluados(), CONFIG_V2);
    for (const [ind, p] of pos) expect(filas.get(ind)!.posicion, `posición de ${codigoDe.get(ind)}`).toBe(p);
  });

  it('la baja no reescribe la historia: la serie científica es la misma que antes de las bajas, y los individuos vivos del último mes bajan', async () => {
    const desde = ctx.d(-100);
    const series = await api.obtenerSeriesHistoricas(ctx.opB, { especieId: ctx.especieId, fechaDesde: desde, fechaHasta: ctx.hoy });
    expect(series.scoring).toEqual(S11.serieAntesDeBajas);
    verificarSerie(series.scoring, serieEsperada(desde));
    const ultimo = series.individuos_vivos.at(-1)!;
    expect(ultimo.cantidad).toBe(await vivosDe([S.CA!, S.CC!, S.CD!, ...await idsDeCrucesExtra()]));
  });

  it('el snapshot congelado al principio sigue exactamente igual (ni V2, ni cambios de ronda, ni bajas, ni archivo y restauración lo tocaron)', async () => {
    const det = await api.obtenerDetalleSnapshot(ctx.opA, S8.s1!);
    expect(det.resultados).toEqual(S8.filasS1);
    expect(det.snapshot).toMatchObject({ scoring_version_id: S.v1, poblacion_comparada: 9 });
  });
});

// ===========================================================================
// P14 · PCR
// ===========================================================================

describe('P14 · PCR: informe en PDF, fila idempotente y consulta', () => {
  const clavePcr = randomUUID();
  let pcrId: string;
  let pathPdf: string;

  it('A sube el informe al bucket privado y registra el PCR de I1 (ronda 2) con su clave: queda creacion_pcr con autor, ronda y fecha', async () => {
    pathPdf = `pcr/${codigoDe.get(I(1))}/${randomUUID()}/${Date.now()}-informe.pdf`;
    const { error } = await ctx.opA.storage.from('media-plantas').upload(pathPdf, Buffer.from('%PDF-1.4 informe de prueba G11'), { contentType: 'application/pdf' });
    expect(error).toBeNull();
    limp.storagePaths.push(pathPdf);
    const marca = await maxAuditId(ctx);
    const r = await api.crearPcr(ctx.opA, ctx.opAId, { ronda_id: S11.rondaI1r2!, realizado: true, fecha: ctx.hoy, informe_pdf_url: pathPdf }, clavePcr);
    pcrId = r.id;
    const aud = await auditDesde(ctx, marca, { accion: 'creacion_pcr' });
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ usuario_id: ctx.opAId, planta_id: S.CA });
    expect(aud[0].detalle).toMatchObject({ ronda_id: S11.rondaI1r2, individuo_id: I(1), realizado: true, fecha: ctx.hoy });
  });

  it('mala señal: reenviar el mismo PCR con la misma clave devuelve la misma fila y no duplica ni audita de nuevo', async () => {
    const marca = await maxAuditId(ctx);
    const otra = await api.crearPcr(ctx.opA, ctx.opAId, { ronda_id: S11.rondaI1r2!, realizado: true, fecha: ctx.hoy, informe_pdf_url: pathPdf }, clavePcr);
    expect(otra.id).toBe(pcrId);
    const { count } = await ctx.service.from('pcr_analisis').select('id', { count: 'exact', head: true }).eq('ronda_id', S11.rondaI1r2!);
    expect(count).toBe(1);
    expect(await auditDesde(ctx, marca, { accion: 'creacion_pcr' })).toHaveLength(0);
  });

  it('la URL firmada permite descargar el informe; el resumen del cruce cuenta 1 PCR para I1; un PCR «no realizado» guarda fecha y archivo en null', async () => {
    const { data, error } = await ctx.opA.storage.from('media-plantas').createSignedUrl(pathPdf, 3600);
    expect(error).toBeNull();
    const resp = await fetch(data!.signedUrl);
    expect(resp.status).toBe(200);
    expect((await resp.text()).startsWith('%PDF')).toBe(true);
    const resumen = await api.resumenIndividuosDeCruce(ctx.opB, S.CA!);
    expect(resumen.find((r) => r.individuo_id === I(1))!.pcr_count).toBe(1);

    const r = await api.crearPcr(ctx.opB, ctx.opBId, { ronda_id: S10.rondaI2r2!, realizado: false, fecha: ctx.hoy, informe_pdf_url: pathPdf }, randomUUID());
    const { data: fila } = await ctx.service.from('pcr_analisis').select('realizado, fecha, informe_pdf_url').eq('id', r.id).single();
    expect(fila).toEqual({ realizado: false, fecha: null, informe_pdf_url: null });
  });

  it('el operario no puede editar un PCR (0 filas) y un individuo de baja no admite PCR (42501): sin cambios ni rastro', async () => {
    const marca = await maxAuditId(ctx);
    const upd = await ctx.opA.from('pcr_analisis').update({ realizado: false }).eq('id', pcrId).select();
    expect(upd.data ?? []).toHaveLength(0);
    const { data } = await ctx.service.from('pcr_analisis').select('realizado').eq('id', pcrId).single();
    expect(data?.realizado).toBe(true);
    const err = await api.falla(() => api.crearPcr(ctx.opA, ctx.opAId, { ronda_id: rondaDe.get(I(8))!, realizado: true, fecha: ctx.hoy }, randomUUID()));
    expect(err?.code).toBe('42501');
    expect(await auditDesde(ctx, marca)).toHaveLength(0);
  });
});

// ===========================================================================
// P15 · Proceso finalizado y barrido final
// ===========================================================================

describe('P15 · proceso finalizado y barrido final de la temporada', () => {
  it('A cierra CA: «proceso_finalizado» (repetirlo no hace nada) y la cadena de cambio_estado de CA es continua, sin saltos, con autor en cada paso', async () => {
    await api.actualizarEstado(ctx.admin, S.CA!, 'proceso_finalizado');
    const marca = await maxAuditId(ctx);
    await api.actualizarEstado(ctx.admin, S.CA!, 'proceso_finalizado'); // mala señal
    expect(await auditDesde(ctx, marca, { accion: 'cambio_estado' })).toHaveLength(0);
    const cadena = await auditDeCruce(ctx, S.CA!, 'cambio_estado');
    expect(cadena.map((f) => f.detalle.estado_nuevo)).toEqual([
      'polinizacion', 'cosecha', 'siembra_semilla', 'germinacion', 'trasplante', 'crecimiento', 'evaluacion_anual', 'traslado_destino', 'proceso_finalizado',
    ]);
    cadena.forEach((f, i) => {
      expect(f.detalle.estado_anterior).toBe(i === 0 ? 'sin_empezar' : cadena[i - 1].detalle.estado_nuevo);
      expect(f.usuario_id).toBe(ctx.adminId); // U-03: solo el admin cambia la fase
    });
    // Un cruce finalizado deja de figurar en los pendientes del dashboard, pero sus individuos siguen en el ranking.
    const dash = await comoReales(() => api.obtenerDashboardCientifico(ctx.opA, ctx.especieId, 8));
    expect(dash.pendientes.some((p) => p.planta_id === S.CA)).toBe(false);
    const { filas } = await rankingEspecie();
    expect(filas.get(I(1))!.elegible).toBe(true);
  });

  it('ficha final de CA: el resumen por individuo cuadra con lo cargado durante la temporada (evaluaciones, PCR, bajas, emplazamientos)', async () => {
    const resumen = await api.resumenIndividuosDeCruce(ctx.opA, S.CA!);
    expect(resumen).toHaveLength(10);
    for (const fila of resumen) {
      const ind = fila.individuo_id as string;
      const visitas = (modelo.get(ind)?.length ?? 0) + (ronda1De.get(ind)?.length ?? 0);
      expect(fila.evaluaciones_count, `evaluaciones de ${fila.codigo_display}`).toBe(visitas);
    }
    expect(resumen.filter((r) => r.estado_vital === 'vivo')).toHaveLength(6);
    expect(resumen.filter((r) => r.estado_vital === 'muerto')).toHaveLength(1);
    expect(resumen.filter((r) => r.estado_vital === 'descartado')).toHaveLength(3);
    expect(resumen.reduce((t, r) => t + r.pcr_count, 0)).toBe(2); // el de I1 (realizado) y el «no realizado» de I2
  });

  it('lógica duplicada: las dos RPC que resumen a los individuos del cruce (tarjetas de la ficha y resumen final) cuentan lo mismo: rondas, última ronda, predio y sector', async () => {
    const tarjetas = await api.obtenerResumenIndividuos(ctx.opA, S.CA!);
    const finales = await api.resumenIndividuosDeCruce(ctx.opA, S.CA!);
    registrarLectura('resumen_individuos_cruce (operario)', finales);
    registrarLectura('obtener_resumen_individuos (operario)', tarjetas);
    expect(Object.keys(tarjetas)).toHaveLength(10);
    for (const f of finales) {
      const t = tarjetas[f.individuo_id as string];
      const esperadas = [I(1), I(2)].includes(f.individuo_id) ? 2 : 1;
      expect(t.rondas_count, `rondas de ${f.codigo_display}`).toBe(esperadas);
      expect(t.rondas_ultima).toBe(esperadas);
      expect(t.rondas_multisitio_count).toBe(0);
      expect(t.emplazamiento_predio_nombre).toBe(f.predio_nombre);
      expect(t.emplazamiento_sector_nombre).toBe(f.sector_nombre);
    }
    expect(finales.filter((f) => f.tiene_emplazamiento)).toHaveLength(4);
  });

  it('invariante de auditoría por tabla: cada fila que dejó la temporada tiene su fila de audit_log (altas, bajas y neto de eliminaciones), sin sobrantes ni faltantes', async () => {
    const plantas = limp.plantaIds;
    const n = async (tabla: string, col: string, ids: string[]) => {
      const { count, error } = await ctx.service.from(tabla).select('id', { count: 'exact', head: true }).in(col, ids);
      if (error) throw error;
      return count ?? 0;
    };
    const aud = async (...acciones: string[]) => {
      const { count, error } = await ctx.service.from('audit_log').select('id', { count: 'exact', head: true }).in('planta_id', plantas).in('accion', acciones);
      if (error) throw error;
      return count ?? 0;
    };
    const { data: inds } = await ctx.service.from('individuos').select('id').in('planta_id', plantas);
    const indIds = inds!.map((i) => i.id as string);
    const { data: rond } = await ctx.service.from('ronda_evaluacion_anual').select('id').in('individuo_id', indIds);
    const rondaIds = rond!.map((r) => r.id as string);

    expect(await aud('alta_cruce')).toBe(plantas.length);
    expect(await aud('creacion_individuo')).toBe(indIds.length);
    expect(await aud('creacion_ronda_evaluacion_anual')).toBe(rondaIds.length);
    expect(await aud('creacion_evaluacion')).toBe(await n('evaluaciones', 'ronda_id', rondaIds));
    expect(await aud('creacion_pcr')).toBe(await n('pcr_analisis', 'ronda_id', rondaIds));
    expect(await aud('creacion_baja_motivo')).toBe(await n('baja_motivo', 'individuo_id', indIds));
    expect(await aud('registro_emplazamiento', 'traslado_individuo')).toBe(await n('emplazamiento_individuo', 'individuo_id', indIds));
    expect(await aud('creacion_evento_germinacion')).toBe(await n('germinacion_evento', 'planta_id', plantas));
    expect((await aud('creacion_polinizacion_evento')) - (await aud('eliminacion_polinizacion_evento'))).toBe(await n('polinizacion_evento', 'planta_id', plantas));
    expect((await aud('creacion_cosecha_fruto')) - (await aud('eliminacion_cosecha_fruto'))).toBe(await n('cosecha_fruto', 'planta_id', plantas));
    const { count: snapshots } = await ctx.service.from('ranking_snapshot').select('id', { count: 'exact', head: true }).eq('especie_id', ctx.especieId);
    const { count: congelaciones } = await ctx.service.from('audit_log').select('id', { count: 'exact', head: true }).eq('accion', 'congelacion_ranking').in('usuario_id', usuarios());
    expect(congelaciones).toBe(snapshots);
    // Cada baja deja exactamente un `edicion_individuo`.
    const { count: dados } = await ctx.service.from('individuos').select('id', { count: 'exact', head: true }).in('planta_id', plantas).neq('estado_vital', 'vivo');
    expect(await aud('edicion_individuo')).toBe(dados);
  });

  // Escrituras de la temporada que NO dejan fila de auditoría (todas ya reportadas por otros grupos).
  it.fails('toda escritura de la temporada deja rastro: el alta de eventos de bitácora, de predios y de variedades no lo deja (A1-G3-05, A1-G7-12, y la nota de A1-G1 sobre variedades)', async () => {
    const { count: eventos } = await ctx.service.from('registros_evento').select('id', { count: 'exact', head: true }).in('planta_id', limp.plantaIds);
    const { count: altasDeEvento } = await ctx.service.from('audit_log').select('id', { count: 'exact', head: true }).in('planta_id', limp.plantaIds).like('accion', 'creacion_evento%');
    expect(altasDeEvento).toBe(eventos);
  });

  it('barrido de linaje: nada de lo que recibió un operario durante toda la temporada contiene el cruzamiento, mamá ni papá (ni sus ids), y el operario no lee audit_log', async () => {
    expect(recibidoPorOperario.length).toBeGreaterThanOrEqual(12);
    const prohibidos = [S.textoCruza!, S.nombreMama1!, S.nombrePapa1!, S.nombrePapa2!, S.mama1!, S.papa1!, S.papa2!, '"mama_id"', '"papa_id"', '"cruzamiento"', '"mama"', '"papa"', 'mama_nombre', 'papa_nombre'];
    for (const lectura of recibidoPorOperario) {
      for (const p of prohibidos) expect(lectura.json.includes(p), `«${lectura.etiqueta}» contiene «${p}»`).toBe(false);
    }
    const { data: vista, error } = await ctx.opA.from('plantas_operativas').select('*').eq('id', S.CA!).single();
    expect(error).toBeNull();
    for (const k of ['cruzamiento', 'mama', 'papa', 'mama_id', 'papa_id']) expect(vista).not.toHaveProperty(k);
    const { data: audit } = await ctx.opA.from('audit_log').select('id').limit(5);
    expect(audit ?? []).toHaveLength(0);
    const { data: perfiles } = await ctx.opA.from('perfiles').select('id');
    expect((perfiles ?? []).map((p) => p.id)).toEqual([ctx.opAId]);
  });

  it('barrido de autoría: toda fila de audit_log de los cruces de la temporada tiene autor de la temporada, y los operarios no dejaron ni una acción de administrador', async () => {
    const { data, error } = await ctx.service.from('audit_log').select('id, usuario_id, accion, planta_id').in('planta_id', limp.plantaIds).limit(5000);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(100);
    expect(data!.every((f) => usuarios().includes(f.usuario_id as string)), 'filas sin autor de la temporada').toBe(true);

    const accionesDeAdmin = [
      'alta_cruce', 'escritura_linaje', 'borrado_cruzamiento_soft', 'borrado_cruzamiento_hard', 'restauracion_cruzamiento', 'reinicio_cruzamiento',
      'congelacion_ranking', 'nueva_version_scoring', 'activacion_version_scoring', 'registro_emplazamiento', 'traslado_individuo', 'baja_lote',
      'cambio_estado', // U-03: solo el admin cambia la fase
    ];
    const { data: deOperarios } = await ctx.service.from('audit_log').select('accion').in('usuario_id', [ctx.opAId, ctx.opBId]).in('accion', accionesDeAdmin);
    expect(deOperarios ?? []).toHaveLength(0);

    // Inventario de acciones auditadas en la temporada (las que no pueden faltar).
    // Las acciones de alcance especie (congelar el ranking de la especie) se registran SIN cruce (planta_id nulo): se buscan por autor.
    const { data: deLosUsuarios } = await ctx.service.from('audit_log').select('accion').in('usuario_id', usuarios()).limit(5000);
    const vistas = new Set([...data!.map((f) => f.accion), ...(deLosUsuarios ?? []).map((f) => f.accion)]);
    for (const accion of [
      'alta_cruce', 'cambio_estado', 'creacion_polinizacion_evento', 'eliminacion_polinizacion_evento', 'escritura_fase', 'creacion_cosecha_fruto',
      'creacion_evento_germinacion', 'individualizacion', 'creacion_individuo', 'creacion_ronda_evaluacion_anual', 'creacion_evaluacion', 'edicion_evaluacion',
      'cambio_estado_evaluacion', 'congelacion_ranking', 'borrado_cruzamiento_soft', 'restauracion_cruzamiento', 'registro_emplazamiento', 'edicion_individuo',
      'creacion_baja_motivo', 'baja_lote', 'creacion_pcr', 'escritura_linaje', 'lectura_linaje', 'lectura_ficha',
    ]) expect(vistas.has(accion), `falta la acción auditada «${accion}»`).toBe(true);

    // Las acciones globales de scoring (sin cruce) también tienen autor.
    const { data: globales } = await ctx.service.from('audit_log').select('usuario_id, accion').in('accion', ['nueva_version_scoring', 'activacion_version_scoring']).in('usuario_id', usuarios());
    expect(globales!.map((g) => g.accion).sort()).toEqual(['activacion_version_scoring', 'nueva_version_scoring']);
  });

  it('el ranking vigente final cuadra con el modelo a mano (V2) después de todo lo que pasó: archivo, restauración, bajas, rondas y cambio de versión', async () => {
    const { r, filas } = await rankingEspecie();
    expect(r.scoring_version_id).toBe(S.v2);
    for (const ind of evaluados()) if (modelo.has(ind)) esperarFila(filas.get(ind), ind, CONFIG_V2);
    const pos = posicionesEsperadas(evaluados(), CONFIG_V2);
    for (const [ind, p] of pos) expect(filas.get(ind)!.posicion).toBe(p);
    expect(r.poblacion_comparada).toBe(pos.size);
    expect(r.total).toBe(await vivosDe([S.CA!, S.CC!, S.CD!, ...await idsDeCrucesExtra()]));
  });

  it('el ranking global filtrado (pestaña Ranking) coincide con el operativo para los vivos y, con «todos los estados», muestra a los de baja con su motivo y sin puntaje', async () => {
    const vivos = await api.obtenerRankingGlobal(ctx.opB, { especieId: ctx.especieId, limite: 100 });
    const { r, filas } = await rankingEspecie();
    expect(vivos.total).toBe(r.total);
    expect(vivos.poblacion_comparada).toBe(r.poblacion_comparada);
    expect(vivos.scoring_version_id).toBe(S.v2);
    for (const it2 of vivos.items) {
      expect(it2.puntaje_ponderado === null ? null : Number(it2.puntaje_ponderado)).toBe(filas.get(it2.individuo_id)!.puntaje_ponderado === null ? null : Number(filas.get(it2.individuo_id)!.puntaje_ponderado));
      expect(it2.posicion).toBe(filas.get(it2.individuo_id)!.posicion);
    }
    const todos = await api.obtenerRankingGlobal(ctx.opB, { especieId: ctx.especieId, estadoVital: null, limite: 100 });
    registrarLectura('obtener_ranking_global_filtrado (operario)', todos);
    expect(todos.total).toBe(r.total + 4); // I4, I8, I9 e I10
    const muertos4 = todos.items.filter((i) => [I(4), I(8), I(9), I(10)].includes(i.individuo_id));
    expect(muertos4).toHaveLength(4);
    expect(muertos4.every((i) => !i.elegible && i.puntaje_ponderado === null)).toBe(true);
    expect(muertos4.find((i) => i.individuo_id === I(8))!.motivo_exclusion).toBe('individuo_muerto');
    expect(muertos4.find((i) => i.individuo_id === I(9))!.motivo_exclusion).toBe('individuo_descartado');
  });
});

// ===========================================================================
// P16 · Coda: una versión nueva que agrega una métrica (la razón de ser de B6)
// ===========================================================================

describe('P16 · coda: V3 agrega una métrica que ninguna evaluación tiene', () => {
  it('el ranking vigente queda sin elegibles (decisión del 21-10: una sola versión), pero la serie, la comparación de rondas y la comparación con el snapshot NO cambian (rondas selladas)', async () => {
    const desde = ctx.d(-100);
    const serieAntes = await api.obtenerSeriesHistoricas(ctx.opB, { especieId: ctx.especieId, fechaDesde: desde, fechaHasta: ctx.hoy });
    const rondasAntes = await api.obtenerComparacionRondas(ctx.opA, { individuoId: I(1) });
    const snapAntes = await api.compararSnapshotVivo(ctx.opA, S8.s1!);

    const marca = await maxAuditId(ctx);
    S.v3 = await api.nuevaVersionScoring(ctx.admin, { baseId: S.v2!, nombre: `AUD-G11 V3 ${ctx.R}`, vigenteDesde: ctx.hoy, nota: 'Agrega color' });
    limp.versionIds.push(S.v3);
    const { error } = await ctx.admin.from('scoring_metrica').insert({
      scoring_version_id: S.v3, metrica: 'color', categoria: 'fruto_calidad', peso: 1, direccion_favorable: 'mayor',
      metodo_normalizacion: 'escala', minimo_normalizacion: 1, maximo_normalizacion: 5, orden: 21,
    });
    expect(error).toBeNull();
    await api.activarVersionScoring(ctx.admin, S.v3);
    const aud = await auditDesde(ctx, marca, { accion: 'activacion_version_scoring' });
    expect(aud[0].detalle).toMatchObject({ version_activada_id: S.v3, version_retirada_id: S.v2 });

    const { r, filas } = await rankingEspecie();
    expect(r.scoring_version_id).toBe(S.v3);
    expect(r.poblacion_comparada).toBe(0);
    for (const ind of evaluados()) {
      if (modelo.has(ind)) expect(filas.get(ind), codigoDe.get(ind)).toMatchObject({ elegible: false, motivo_exclusion: 'evaluacion_parcial_en_curso' });
    }
    const dash = await comoReales(() => api.obtenerDashboardCientifico(ctx.opA, ctx.especieId, 8));
    expect(dash.scoring_version_id).toBe(S.v3);
    expect(dash.destacados).toEqual([]);

    // Las vistas históricas siguen midiendo cada ronda con su versión sellada: nada cambia.
    const serieDespues = await api.obtenerSeriesHistoricas(ctx.opB, { especieId: ctx.especieId, fechaDesde: desde, fechaHasta: ctx.hoy });
    expect(serieDespues.scoring).toEqual(serieAntes.scoring);
    const rondasDespues = await api.obtenerComparacionRondas(ctx.opA, { individuoId: I(1) });
    expect(rondasDespues).toEqual(rondasAntes);
    const snapDespues = await api.compararSnapshotVivo(ctx.opA, S8.s1!);
    expect(snapDespues.scoring_version_viva_id).toBe(S.v3);
    expect(snapDespues.individuos).toEqual(snapAntes.individuos);
  });
});

// ===========================================================================
// Cierre: la versión global (la real) no se tocó
// ===========================================================================

describe('Cierre · lo que la temporada no debe haber tocado', () => {
  it('la versión de scoring global sigue activa y sin cambios de vigencia, y la temporada no dejó ninguna versión propia activa fuera de su especie', async () => {
    const { data } = await ctx.service.from('scoring_version').select('id, estado, vigente_desde, vigente_hasta').is('especie_id', null).eq('fase', 'evaluacion_anual').eq('estado', 'activa');
    expect(data).toHaveLength(1);
    expect(data![0].vigente_hasta).toBeNull();
    const { data: propias } = await ctx.service.from('scoring_version').select('id, estado').eq('especie_id', ctx.especieId);
    expect(propias!.map((v) => v.id).sort()).toEqual([S.v1, S.v2, S.v3].sort());
    expect(propias!.filter((v) => v.estado === 'activa').map((v) => v.id)).toEqual([S.v3]);
  });
});
