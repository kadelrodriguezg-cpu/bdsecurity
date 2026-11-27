// Datos de DEMOSTRACIÓN para las capturas de la presentación. SOLO BASE LOCAL.
// Todo es ficticio: usuarios @test.local con nombres inventados, variedades «Variedad A–D»,
// predio «Predio Demo Las Lomas», ensayo EVECL «PARCELA-DEMO-01».
// Idempotente en lo posible: si un cruce de demo ya existe, no lo vuelve a crear.
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { idDeUsuarioPorEmail, urlLocal } from './_local.mjs';

const URL = urlLocal(); // se niega a correr si el host no es 127.0.0.1 o localhost
const kong = execFileSync('docker', ['exec', 'supabase_kong_dbsecurity-frutales', 'cat', '/home/kong/kong.yml'], { encoding: 'utf8' });
const clave = (p) => kong.match(new RegExp(`${p}[A-Za-z0-9_-]+`))[0];
const svc = createClient(URL, clave('sb_secret_'), { auth: { persistSession: false } });
const PASS = 'test-password-123';
const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_dbsecurity-frutales', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA'], { input: sql, encoding: 'utf8' }).trim();
const ok = ({ data, error }, que) => { if (error) throw new Error(`${que}: ${error.message}`); return data; };

// ---------- usuarios ficticios ----------
async function usuario(email, nombre, rol, linaje) {
  const creado = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  const id = creado.data.user?.id ?? (await idDeUsuarioPorEmail(svc, email));
  ok(await svc.from('perfiles').upsert({ id, nombre, rol, puede_ver_linaje: linaje }), 'perfil');
  return id;
}
async function sesion(email) {
  const c = createClient(URL, clave('sb_publishable_'), { auth: { persistSession: false } });
  ok(await c.auth.signInWithPassword({ email, password: PASS }), 'login ' + email);
  return c;
}
const U = {
  admin: { email: 'demo-admin@test.local', nombre: 'Ana Rojas', corto: 'A. Rojas' },
  maria: { email: 'demo-maria@test.local', nombre: 'María Soto', corto: 'M. Soto' },
  jorge: { email: 'demo-jorge@test.local', nombre: 'Jorge Pérez', corto: 'J. Pérez' },
  carla: { email: 'demo-carla@test.local', nombre: 'Carla Muñoz', corto: 'C. Muñoz' },
};
U.admin.id = await usuario(U.admin.email, U.admin.nombre, 'admin', true);
for (const k of ['maria', 'jorge', 'carla']) U[k].id = await usuario(U[k].email, U[k].nombre, 'operario', false);
const EVAL = [U.maria, U.jorge, U.carla];
const cAdmin = await sesion(U.admin.email);
console.log('usuarios ok');

const esp = ok(await svc.from('especies').select('id').eq('nombre', 'Arándano').single(), 'especie');

// ---------- variedades ficticias ----------
const variedad = {};
for (const nombre of ['Variedad A', 'Variedad B', 'Variedad C', 'Variedad D']) {
  let v = ok(await svc.from('variedades').select('id').eq('especie_id', esp.id).eq('nombre', nombre).maybeSingle(), 'variedad');
  if (!v) v = ok(await svc.from('variedades').insert({ especie_id: esp.id, nombre, created_by: U.admin.id }).select('id').single(), 'alta variedad');
  variedad[nombre] = v.id;
}
console.log('variedades ok');

// ---------- utilidades de cruces ----------
async function cruce(codigo, estado, linaje, nIndividuos) {
  let p = ok(await svc.from('plantas').select('id').eq('codigo_sistema', codigo).maybeSingle(), 'busca ' + codigo);
  if (p) return { id: p.id, nuevo: false };
  p = ok(await svc.from('plantas').insert({
    codigo_sistema: codigo, especie_id: esp.id, estado,
    cruzamiento: `${linaje[0]} × ${linaje[1]}`, mama: linaje[0], papa: linaje[1], mama_id: variedad[linaje[0]], papa_id: variedad[linaje[1]],
  }).select('id').single(), 'alta ' + codigo);
  for (let i = 0; i < nIndividuos; i += 1) {
    ok(await svc.from('individuos').insert({ planta_id: p.id, codigo_display: 'GENERADO-POR-TRIGGER', fecha_individualizacion: '2025-11-03', created_by: U.admin.id }), 'individuo');
  }
  return { id: p.id, nuevo: true };
}
const numero = (codigo) => Number(codigo.split('-P').pop());
async function individuosDe(plantaId) {
  const filas = ok(await svc.from('individuos').select('id, codigo_display').eq('planta_id', plantaId), 'individuos');
  return filas.sort((a, b) => numero(a.codigo_display) - numero(b.codigo_display));
}
// Pseudoaleatorio estable por individuo.
const rnd = (semilla) => { let x = Math.sin(semilla * 9301 + 49297) * 233280; return x - Math.floor(x); };
const entre = (s, a, b) => a + Math.floor(rnd(s) * (b - a + 1));
const dec = (s, a, b, d = 1) => Number((a + rnd(s) * (b - a)).toFixed(d));

function valores(i, sesgo = 0) {
  const e = (k, a = 1, b = 5) => Math.max(a, Math.min(b, entre(i * 31 + k, a, b) + sesgo));
  const varas = entre(i * 7 + 1, 5, 11);
  const flores = entre(i * 7 + 2, 30, 90);
  const cantidad = entre(i * 7 + 5, 20, 30);
  return {
    brotacion: e(1), presencia_yemas_florales: e(2, 0, 5), floracion: e(3), fecha_inicio_floracion: `2026-09-${String(entre(i, 2, 24)).padStart(2, '0')}`,
    precocidad: e(4), cuaja: e(5), concentracion_cosecha: e(6),
    n_varas_basales: varas, n_varas_con_flor: entre(i * 7 + 3, 2, varas), n_flores_varas_basales: flores, n_frutos_varas_basales: entre(i * 7 + 4, 10, flores),
    altura_brote_mm: entre(i * 7 + 6, 220, 520), diametro_brote_mm: dec(i * 7 + 8, 5, 10), vigor_vegetativo: e(7), color_follaje: e(8),
    calibre_mm: dec(i * 3 + 11, 13, 21), firmeza: e(9), color: e(10), bloom: e(11), brix: dec(i * 3 + 12, 10, 16),
    cantidad_frutos: cantidad, peso_total_g: dec(i * 3 + 13, 1.4, 3.1, 2) * cantidad,
    rend_kg_planta: dec(i * 5 + 14, 1.2, 4.8), rend_t_ha: dec(i * 5 + 15, 6, 22), pct_buen_estado_15d: dec(i * 5 + 16, 90, 99), pct_buen_estado_30d: dec(i * 5 + 17, 78, 95), pct_buen_estado_45d: dec(i * 5 + 18, 62, 90),
    dano_calor: e(12), golpe_sol: e(13), caida_fruto: e(14),
  };
}
const fechaDia = (dia) => `2026-10-${String(dia).padStart(2, '0')}`;

// ---------- 02-502: ronda 1 con protocolo, completas, borradores y pendientes ----------
{
  const p = ok(await svc.from('plantas').select('id').eq('codigo_sistema', '02-502').single(), '02-502');
  ok(await svc.from('plantas').update({ mama_id: variedad['Variedad A'], papa_id: variedad['Variedad B'], cruzamiento: 'Variedad A × Variedad B', mama: 'Variedad A', papa: 'Variedad B' }).eq('id', p.id), 'linaje 02-502');
  const inds = await individuosDe(p.id);
  let rondas = ok(await svc.from('ronda_evaluacion_anual').select('id, individuo_id, individuo:individuos!inner(planta_id)').eq('individuo.planta_id', p.id).eq('numero_ronda', 1), 'rondas');
  // Tras un db reset, fixture-0201 solo abre 54 rondas: el resto de la ronda 1 se abre aquí (noche 23-10-2026).
  const conRonda = new Set(rondas.map((r) => r.individuo_id));
  const faltan = inds.filter((x) => !conRonda.has(x.id));
  for (let k = 0; k < faltan.length; k += 100) {
    ok(await svc.from('ronda_evaluacion_anual').insert(faltan.slice(k, k + 100).map((x) => ({ individuo_id: x.id, numero_ronda: 1, anio: 2026, fecha_inicio: '2026-10-01', tipo_ronda: 'anual', created_by: U.admin.id }))), 'rondas faltantes 02-502');
  }
  if (faltan.length) rondas = ok(await svc.from('ronda_evaluacion_anual').select('id, individuo_id, individuo:individuos!inner(planta_id)').eq('individuo.planta_id', p.id).eq('numero_ronda', 1), 'rondas');
  const rondaDe = new Map(rondas.map((r) => [r.individuo_id, r.id]));
  // Reinicio de las evaluaciones de prueba anteriores (tenían un evaluador real): solo local, sin disparar triggers.
  psql(`set session_replication_role = replica;
    delete from evaluaciones e using ronda_evaluacion_anual r, individuos i where e.ronda_id = r.id and r.individuo_id = i.id and i.planta_id = '${p.id}';
    delete from protocolo_ronda where planta_id = '${p.id}';`);
  const obligatorios = ['brotacion', 'presencia_yemas_florales', 'floracion', 'fecha_inicio_floracion', 'precocidad', 'cuaja', 'concentracion_cosecha',
    'n_varas_basales', 'n_varas_con_flor', 'n_flores_varas_basales', 'n_frutos_varas_basales', 'altura_brote_mm', 'diametro_brote_mm', 'vigor_vegetativo', 'color_follaje'];
  const opcionales = ['calibre_mm', 'firmeza', 'color', 'bloom', 'brix', 'cantidad_frutos', 'peso_total_g', 'rend_kg_planta', 'pct_buen_estado_15d', 'pct_buen_estado_30d', 'pct_buen_estado_45d', 'dano_calor', 'golpe_sol', 'caida_fruto'];
  const descriptores = Object.fromEntries([...obligatorios.map((k) => [k, 'obligatorio']), ...opcionales.map((k) => [k, 'opcional'])]);
  ok(await cAdmin.rpc('definir_protocolo_ronda', { p_planta_id: p.id, p_tipo_ronda: 'anual', p_numero_ronda: 1, p_nombre: 'Temporada 2026 · fenología, brotes y varas', p_descriptores: descriptores }), 'protocolo');
  // Recorrido realista: completas, borradores y pendientes intercalados (~37 % / ~8 % / resto).
  // Tres completas con calibre ≥ 40 mm quedan marcadas para revisar (rango de referencia local).
  const filas = [];
  const marcadas = new Set([9, 63, 101]);
  for (let n = 1; n <= inds.length; n += 1) {
    const r = rnd(n * 13 + 7);
    const quien = EVAL[n % 3];
    const ronda = rondaDe.get(inds[n - 1].id);
    if (marcadas.has(n) || r < 0.37) {
      filas.push({ ronda_id: ronda, anio: 2026, fecha: fechaDia(8 + (n % 14)), evaluador: quien.corto, created_by: quien.id, estado: 'completa',
        ...valores(n), ...(marcadas.has(n) ? { calibre_mm: 42 } : {}) });
    } else if (r < 0.45) {
      const parcial = Object.fromEntries(Object.entries(valores(n)).filter(([k]) => obligatorios.slice(0, 7 + (n % 6)).includes(k)));
      filas.push({ ronda_id: ronda, anio: 2026, fecha: fechaDia(22), evaluador: quien.corto, created_by: quien.id, estado: 'borrador', ...parcial });
    }
  }
  for (let k = 0; k < filas.length; k += 50) ok(await svc.from('evaluaciones').insert(filas.slice(k, k + 50)), 'evaluaciones 02-502');
  console.log('02-502 ok', p.id);
}

// ---------- 02-504: dos rondas completas para la comparación histórica ----------
{
  const { id, nuevo } = await cruce('02-504', 'evaluacion_anual', ['Variedad C', 'Variedad D'], 40);
  if (nuevo) {
    const inds = await individuosDe(id);
    for (const [num, anio, inicio, dia, sesgo] of [[1, 2025, '2025-10-06', 14, 0], [2, 2026, '2026-10-05', 16, 1]]) {
      const rondas = ok(await svc.from('ronda_evaluacion_anual').insert(inds.map((x) => ({ individuo_id: x.id, numero_ronda: num, anio, fecha_inicio: inicio, tipo_ronda: 'anual', created_by: U.admin.id }))).select('id, individuo_id'), 'rondas 02-504');
      const rondaDe = new Map(rondas.map((r) => [r.individuo_id, r.id]));
      const filas = inds.map((x, i) => {
        const quien = EVAL[i % 3];
        const v = valores(500 + i, i % 4 === 0 ? sesgo : 0);
        return { ronda_id: rondaDe.get(x.id), anio, fecha: `${anio}-10-${String(dia + (i % 6)).padStart(2, '0')}`, evaluador: quien.corto, created_by: quien.id, estado: 'completa', ...v,
          fecha_inicio_floracion: `${anio}-09-${String(entre(500 + i, 2, 24)).padStart(2, '0')}` };
      });
      ok(await svc.from('evaluaciones').insert(filas), 'evaluaciones 02-504');
    }
  }
  console.log('02-504 ok', id);
}

// ---------- 02-905: cruce en polinización con sesiones ----------
{
  const { id, nuevo } = await cruce('02-905', 'polinizacion', ['Variedad C', 'Variedad B'], 0);
  if (nuevo) {
    ok(await svc.from('polinizacion_evento').insert([
      { planta_id: id, fecha: '2026-10-14', n_flores_cruzadas: 42, created_by: U.maria.id },
      { planta_id: id, fecha: '2026-10-17', n_flores_cruzadas: 55, created_by: U.jorge.id },
      { planta_id: id, fecha: '2026-10-21', n_flores_cruzadas: 38, created_by: U.maria.id },
    ]), 'polinización');
  }
  // Igual que agregarPolinizacionEvento (frontend/src/api/fases.ts): cada sesión lleva su evento en la bitácora
  // (registros_evento, tipo 'polinizacion', mismo shape de `datos`) y las columnas legacy de `plantas` quedan con la última
  // sesión. Sin el evento, `scripts/limpieza/informe_sesiones_sin_bitacora.sql` marca la sesión como inconsistente.
  const sesiones = ok(await svc.from('polinizacion_evento').select('fecha, n_flores_cruzadas, created_by').eq('planta_id', id).order('fecha').order('created_at'), 'sesiones 02-905');
  const conEvento = new Set(ok(await svc.from('registros_evento').select('fecha').eq('planta_id', id).eq('tipo_evento', 'polinizacion').is('eliminado_at', null), 'bitácora 02-905').map((r) => r.fecha));
  for (const s of sesiones.filter((x) => !conEvento.has(x.fecha))) {
    ok(await svc.from('registros_evento').insert({
      planta_id: id, tipo_evento: 'polinizacion', fecha: s.fecha, created_by: s.created_by, notas: null,
      datos: { fecha_polinizacion: s.fecha, n_flores_cruzadas: s.n_flores_cruzadas },
    }), 'bitácora de polinización');
  }
  const ultima = sesiones[sesiones.length - 1];
  if (ultima) ok(await svc.from('plantas').update({ fecha_polinizacion: ultima.fecha, n_flores_cruzadas: ultima.n_flores_cruzadas }).eq('id', id), 'columnas legacy 02-905');
  console.log('02-905 ok', id);
}

// ---------- 02-610: ensayo multisitio en un predio ficticio, con coordenadas y clima ----------
{
  let predio = ok(await svc.from('predio').select('id').eq('nombre', 'Predio Demo Las Lomas').maybeSingle(), 'predio');
  if (!predio) predio = ok(await svc.from('predio').insert({ nombre: 'Predio Demo Las Lomas', latitud: -35.512, longitud: -71.585, region: 'Maule' }).select('id').single(), 'alta predio');
  const sectores = [];
  for (const nombre of ['Sector Norte', 'Sector Sur']) {
    let s = ok(await svc.from('sector').select('id').eq('predio_id', predio.id).eq('nombre', nombre).maybeSingle(), 'sector');
    if (!s) s = ok(await svc.from('sector').insert({ predio_id: predio.id, nombre, created_by: U.admin.id }).select('id').single(), 'alta sector');
    sectores.push(s.id);
  }
  const clima = [];
  for (let m = 0; m < 12; m += 1) {
    const fecha = new Date(Date.UTC(2025, 10 + m, 1));
    const mes = fecha.getUTCMonth() + 1;
    const verano = Math.cos(((mes - 1) / 12) * 2 * Math.PI); // 1 en enero
    clima.push({ predio_id: predio.id, anio: fecha.getUTCFullYear(), mes, temp_max_promedio: Number((21 + 9 * verano).toFixed(1)), temp_min_promedio: Number((7 + 5 * verano).toFixed(1)),
      horas_sol_acumuladas: Math.round(200 + 120 * verano), precipitacion_mm: Math.round(Math.max(2, 70 - 65 * verano)), dias_helada: Math.max(0, Math.round(-4 * verano + 1)), fuente: 'demostración', sincronizado_at: new Date().toISOString() });
  }
  psql(`delete from predio_clima_mensual where predio_id = '${predio.id}';`);
  ok(await svc.from('predio_clima_mensual').insert(clima), 'clima');
  const { id, nuevo } = await cruce('02-610', 'traslado_destino', ['Variedad A', 'Variedad D'], 12);
  if (nuevo) {
    const inds = await individuosDe(id);
    for (const [i, x] of inds.entries()) {
      ok(await cAdmin.rpc('registrar_traslado_individuo', { p_individuo_id: x.id, p_sector_id: sectores[i % 2], p_fecha_inicio: '2026-09-15', p_referencia_operativa: `Hilera ${1 + Math.floor(i / 4)}`,
        p_latitud: -35.512 + (i % 4) * 0.0009 + (i % 2 ? 0.0021 : 0), p_longitud: -71.585 + Math.floor(i / 4) * 0.0011, p_precision_metros: 5, p_ubicacion_exacta: `Hilera ${1 + Math.floor(i / 4)}, posición ${1 + (i % 4)}` }), 'traslado');
    }
  }
  console.log('02-610 ok', id, 'predio', predio.id);
}

// ---------- EVECL: un ensayo con variedades foráneas ficticias ----------
{
  const ensayos = ok(await cAdmin.rpc('evecl_obtener_ensayos'), 'ensayos');
  const lista = Array.isArray(ensayos) ? ensayos : (ensayos?.ensayos ?? []);
  if (!lista.some((e) => e.codigo_parcela === 'PARCELA-DEMO-01')) {
    const ensayo = ok(await cAdmin.rpc('evecl_guardar_ensayo', { p_id: null, p_codigo_parcela: 'PARCELA-DEMO-01', p_nombre_productor: 'Productor de demostración', p_empresa: 'Empresa Demo Ltda.',
      p_encargado_predio: 'Encargado Demo', p_localidad: 'Localidad Demo', p_direccion: 'Camino Demo km 3', p_latitud: -35.6, p_longitud: -71.7, p_area_evaluada: '0,5 ha', p_notas: 'Ensayo ficticio para la presentación.' }), 'ensayo');
    const desc = ok(await svc.from('evecl_descriptor').select('id, tipo').eq('activo', true).order('orden'), 'descriptores');
    const notas = ok(await svc.from('evecl_descriptor_estado').select('descriptor_id, nota'), 'estados');
    const notasDe = (id) => notas.filter((n) => n.descriptor_id === id).map((n) => n.nota).sort((a, b) => a - b);
    const numerico = { 21: [55, 85], 22: [10, 16], 23: [0.4, 1.2], 24: [1, 4], 25: [1.5, 5], 26: [40, 90], 27: [20, 60] };
    let s = 0;
    for (const [variedadNombre, tipo] of [['Foránea Demo 1', 'evaluacion'], ['Foránea Demo 2', 'evaluacion'], ['Foránea Demo 3', 'evaluacion'], ['Testigo Demo', 'testigo']]) {
      for (const rep of [1, 2]) {
        s += 1;
        const respuestas = desc.map((d) => {
          if (d.tipo === 'estado') { const ns = notasDe(d.id); return { descriptor_id: d.id, nota: ns[entre(s * 50 + d.id, 0, ns.length - 1)] }; }
          const [a, b] = numerico[d.id] ?? [1, 10];
          return { descriptor_id: d.id, valor_numerico: dec(s * 50 + d.id, a, b, 1) };
        });
        ok(await cAdmin.rpc('evecl_guardar_ficha_con_bajas', { p_entrada: { p_id: null, p_ensayo_id: ensayo, p_variedad: variedadNombre, p_codigo_genotipo: null, p_origen_cruza: null, p_tipo: tipo,
          p_numero_repeticion: rep, p_codigo_planta: `DEMO-${s}`, p_encargado: 'Encargado Demo', p_fecha_siembra: '2024-07-15', p_fecha_evaluacion: '2026-10-20', p_notas: null,
          p_respuestas: respuestas, p_idempotency_key: null }, p_descriptores_eliminar: [] }), 'ficha EVECL');
      }
    }
  }
  console.log('EVECL ok');
}

// ---------- chat del cruce 02-502 ----------
{
  const p = ok(await svc.from('plantas').select('id').eq('codigo_sistema', '02-502').single(), '02-502');
  const canal = ok(await cAdmin.rpc('obtener_canal_chat', { p_tipo: 'cruce', p_entidad_id: p.id }), 'canal');
  const canalId = typeof canal === 'string' ? canal : canal?.id ?? canal?.canal_id;
  const previos = ok(await svc.from('chat_mensajes').select('id', { count: 'exact', head: true }).eq('canal_id', canalId), 'previos');
  const { count } = await svc.from('chat_mensajes').select('id', { count: 'exact', head: true }).eq('canal_id', canalId);
  if (!count) {
    const clientes = { admin: cAdmin, maria: await sesion(U.maria.email), jorge: await sesion(U.jorge.email), carla: await sesion(U.carla.email) };
    const mensajes = [
      ['admin', 'Buenos días. Dejé definido el protocolo de la ronda 1: fenología, brotes y varas obligatorios; frutos opcional.'],
      ['maria', 'Perfecto. Hoy parto por la hilera 1, desde P1 hasta P60.'],
      ['jorge', 'Yo sigo desde P61. Ojo que en P63 las varas con flor parecen más que las basales, lo dejé para revisar.'],
      ['admin', 'Gracias, Jorge. Lo reviso en la tarde con la foto.'],
      ['carla', 'Terminé P101 a P140. Quedan algunos borradores de la hilera 4 por la lluvia de ayer.'],
      ['maria', 'Mañana temprano cierro los borradores que quedaron abiertos.'],
    ];
    for (const [quien, texto] of mensajes) {
      ok(await clientes[quien].rpc('enviar_mensaje_chat', { p_canal_id: canalId, p_contenido: texto, p_clave_envio: crypto.randomUUID(), p_mencionados: [], p_mencionar_todos: false }), 'mensaje');
    }
  }
  void previos;
  console.log('chat ok', canalId);
}

// ---------- 02-620 (Crecimiento), 02-630 (Proceso finalizado) y 02-640 (Trasplante, v3 paso 5): lista única de individuos en esas fases (v3 paso 4) ----------
// Cruces ficticios, sin linaje, con 6 individuos vivos cada uno. Se insertan como el resto de los fixtures de demo
// (service_role); si ya existen, no se vuelven a crear.
for (const [codigo, estado] of [['02-620', 'crecimiento'], ['02-630', 'proceso_finalizado'], ['02-640', 'trasplante']]) {
  const previo = ok(await svc.from('plantas').select('id').eq('codigo_sistema', codigo).maybeSingle(), codigo);
  if (previo) { console.log(codigo, 'ya existe', previo.id); continue; }
  const cruce = ok(await svc.from('plantas').insert({ codigo_sistema: codigo, especie_id: esp.id, estado, es_prueba: false }).select('id').single(), codigo);
  const individuos = Array.from({ length: 6 }, (_, i) => ({ planta_id: cruce.id, codigo_display: `${codigo}-P${i + 1}`, created_by: U.admin.id }));
  ok(await svc.from('individuos').insert(individuos), `individuos ${codigo}`);
  console.log(codigo, 'ok', cruce.id);
}

// ---------- Inicio: los cruces de demo quedan como los de cambio de fase más reciente ----------
psql(`update plantas set fecha_cambio_estado = now() - (case codigo_sistema when '02-502' then 0 when '02-905' then 1 when '02-610' then 2 when '02-504' then 3 else 4 end) * interval '1 hour'
  where codigo_sistema in ('02-502', '02-905', '02-610', '02-504', '02-801');`);
console.log('listo');
