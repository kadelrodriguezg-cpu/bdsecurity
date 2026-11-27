// Datos de DEMOSTRACIÓN de la fase 4 (especies como espacio de trabajo y catálogos). SOLO BASE LOCAL. Correr después de datos.mjs.
// Todo es ficticio. Crea:
//   - la especie «Frutilla» con cuatro cruces en fases distintas (uno en Evaluación anual con ronda, cerradas y pendientes);
//   - dos cruces de «Frambuesa» (Mora queda sin cruces: tarjeta «Sin cruces todavía» en el panorama);
//   - catálogos como los de producción: contenedores con la capacidad repetida en el nombre («Maceteros (10 L)» con 10 L),
//     insumos y sustratos.
// Idempotente: lo que ya existe no se vuelve a crear.
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { idDeUsuarioPorEmail, urlLocal } from './_local.mjs';

const URL = urlLocal();
const kong = execFileSync('docker', ['exec', 'supabase_kong_dbsecurity-frutales', 'cat', '/home/kong/kong.yml'], { encoding: 'utf8' });
const clave = (p) => kong.match(new RegExp(`${p}[A-Za-z0-9_-]+`))[0];
const svc = createClient(URL, clave('sb_secret_'), { auth: { persistSession: false } });
const ok = ({ data, error }, que) => { if (error) throw new Error(`${que}: ${error.message}`); return data; };

const admin = await idDeUsuarioPorEmail(svc, 'demo-admin@test.local');
const operarios = [await idDeUsuarioPorEmail(svc, 'demo-maria@test.local'), await idDeUsuarioPorEmail(svc, 'demo-jorge@test.local')];

async function especie(nombre, cientifico) {
  const e = ok(await svc.from('especies').select('id').eq('nombre', nombre).maybeSingle(), 'especie ' + nombre);
  if (e) return e.id;
  return ok(await svc.from('especies').insert({ nombre, nombre_cientifico: cientifico }).select('id').single(), 'alta especie').id;
}

async function cruce(especieId, codigo, estado, vivos) {
  const p = ok(await svc.from('plantas').select('id').eq('codigo_sistema', codigo).maybeSingle(), 'busca ' + codigo);
  if (p) return { id: p.id, nuevo: false };
  const nuevo = ok(await svc.from('plantas').insert({ codigo_sistema: codigo, especie_id: especieId, estado }).select('id').single(), 'alta ' + codigo);
  for (let i = 1; i <= vivos; i += 1) {
    ok(await svc.from('individuos').insert({ planta_id: nuevo.id, codigo_display: `${codigo}-P${i}`, created_by: admin }), 'individuo');
  }
  return { id: nuevo.id, nuevo: true };
}

const frutilla = await especie('Frutilla', 'Fragaria × ananassa');
const frambuesa = await especie('Frambuesa', 'Rubus idaeus');

await cruce(frutilla, '05-101', 'polinizacion', 0);
await cruce(frutilla, '05-102', 'germinacion', 0);
await cruce(frutilla, '05-103', 'crecimiento', 8);
const evaluado = await cruce(frutilla, '05-110', 'evaluacion_anual', 24);
if (evaluado.nuevo) {
  const inds = ok(await svc.from('individuos').select('id').eq('planta_id', evaluado.id).order('codigo_display'), 'individuos 05-110');
  for (const [n, ind] of inds.entries()) {
    const ronda = ok(await svc.from('ronda_evaluacion_anual').insert({ individuo_id: ind.id, numero_ronda: 1, anio: 2026, fecha_inicio: '2026-10-01', tipo_ronda: 'anual', created_by: admin }).select('id').single(), 'ronda');
    if (n < 15) {
      ok(await svc.from('evaluaciones').insert({
        ronda_id: ronda.id, fecha: '2026-10-27', estado: 'completa', created_by: operarios[n % 2], evaluador: n % 2 ? 'J. Pérez' : 'M. Soto',
        brotacion: 3 + (n % 3), floracion: 2 + (n % 4), precocidad: 1 + (n % 5), firmeza: 2 + (n % 4), color: 3 + (n % 3), brix: 7 + (n % 5),
        calibre_mm: 24 + (n % 9), cantidad_frutos: 10, peso_total_g: 180 + n * 3, rend_kg_planta: 0.4 + (n % 6) / 10,
        pct_buen_estado_15d: 92 - (n % 7), pct_buen_estado_30d: 81 - (n % 9), pct_buen_estado_45d: n % 6 === 0 ? null : 64 - (n % 11),
      }), 'evaluación');
    }
  }
}
await cruce(frambuesa, '07-201', 'siembra_semilla', 0);
await cruce(frambuesa, '07-202', 'trasplante', 12);
console.log('especies y cruces ok');

// ---------- catálogos como los de producción ----------
async function filas(tabla, lista) {
  for (const fila of lista) {
    const existe = ok(await svc.from(tabla).select('id').eq('nombre', fila.nombre).maybeSingle(), 'busca ' + fila.nombre);
    if (!existe) ok(await svc.from(tabla).insert(fila), 'alta ' + fila.nombre);
  }
}
await filas('contenedor', [
  { nombre: 'Bandeja 288 (0,005 L)', capacidad_litros: null },
  { nombre: 'Bolsas GrowinBag (11 l)', capacidad_litros: 11 },
  { nombre: 'Bolsas GrowinBag (15l)', capacidad_litros: 15 },
  { nombre: 'Macetero 1L', capacidad_litros: 1 },
  { nombre: 'Macetero 25 lts.', capacidad_litros: 25 },
  { nombre: 'Maceteros  (10 L)', capacidad_litros: 10 },
  { nombre: 'Maceteros  5 L', capacidad_litros: 5 },
  { nombre: 'Macetero', capacidad_litros: 0.5 },
  { nombre: 'ULTRASOL INI', capacidad_litros: null, activo: false },
]);
await filas('insumo', [
  { nombre: 'Sulfato de cobre', tipo: 'fungicida' },
  { nombre: 'ULTRASOL CREC.', tipo: 'otro' },
  { nombre: 'ULTRASOL INI.', tipo: 'otro' },
  { nombre: 'Ácido sulfúrico', tipo: 'otro' },
  { nombre: 'Fungicida 1 prueba', tipo: 'fungicida', activo: false },
]);
await filas('sustrato', [{ nombre: 'Turba' }, { nombre: 'Cocomix' }, { nombre: 'Arena' }, { nombre: 'Reciclado' }]);
console.log('catálogos ok');
console.log('listo');
