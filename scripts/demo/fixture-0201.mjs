// Fixture SOLO LOCAL (Sprint 1.1): cruce «02-501» parecido a 02-001 al de producción.
// 379 vivos; 54 con ronda 1 (51 borradores del admin, 1 completa, 2 solo con anulada); 325 sin ronda.
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { idDeUsuarioPorEmail, urlLocal } from './_local.mjs';

const url = urlLocal(); // se niega a correr si el host no es 127.0.0.1 o localhost
const kong = execFileSync('docker', ['exec', 'supabase_kong_dbsecurity-frutales', 'cat', '/home/kong/kong.yml'], { encoding: 'utf8' });
const clave = (p) => kong.match(new RegExp(`${p}[A-Za-z0-9_-]+`))[0];
const svc = createClient(url, clave('sb_secret_'), { auth: { persistSession: false } });
const CODIGO = process.argv[2] ?? '02-501';
const PASS = 'test-password-123'; // misma contraseña de prueba que tests/rls/helpers.ts

async function usuario(email, nombre, rol, linaje) {
  const creado = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  const id = creado.data.user?.id ?? (await idDeUsuarioPorEmail(svc, email));
  const { error } = await svc.from('perfiles').upsert({ id, nombre, rol, puede_ver_linaje: linaje });
  if (error) throw error;
  return id;
}
const admin = await usuario('capturas-admin@test.local', 'Admin de capturas', 'admin', true);
await usuario('capturas-sprint0-operario@test.local', 'Operario de capturas', 'operario', false);

const { data: ya } = await svc.from('plantas').select('id').eq('codigo_sistema', CODIGO).maybeSingle();
if (ya) { console.log('ya existe', ya.id); process.exit(0); }
const { data: esp } = await svc.from('especies').select('id').eq('nombre', 'Arándano').single();
const { data: planta, error: e0 } = await svc.from('plantas')
  .insert({ codigo_sistema: CODIGO, especie_id: esp.id, estado: 'evaluacion_anual', cruzamiento: 'Variedad A × Variedad B', mama: 'Variedad A', papa: 'Variedad B' })
  .select('id').single();
if (e0) throw e0;
const filas = Array.from({ length: 379 }, (_, i) => ({ planta_id: planta.id, codigo_display: 'GENERADO-POR-TRIGGER', fecha_individualizacion: '2025-11-03', created_by: admin }));
const ids = [];
for (const fila of filas) { // una a una: el trigger numera P1..P379 en orden
  const { data, error } = await svc.from('individuos').insert(fila).select('id').single();
  if (error) throw error;
  ids.push(data.id);
}
const rondas = [];
for (const id of ids.slice(0, 54)) {
  const { data, error } = await svc.from('ronda_evaluacion_anual')
    .insert({ individuo_id: id, numero_ronda: 1, anio: 2026, fecha_inicio: '2026-10-06', tipo_ronda: 'anual', created_by: admin }).select('id').single();
  if (error) throw error;
  rondas.push(data.id);
}
const base = (r, i) => ({ ronda_id: r, fecha: '2026-10-22', created_by: admin, evaluador: 'E. Rodríguez',
  brotacion: 1 + (i % 5), presencia_yemas_florales: (i % 6), floracion: 1 + ((i + 1) % 5), precocidad: 1 + ((i + 2) % 5), cuaja: 1 + ((i + 3) % 5),
  concentracion_cosecha: 1 + (i % 4), n_varas_basales: 6 + (i % 5), n_varas_con_flor: 3 + (i % 3), n_flores_varas_basales: 40 + i, n_frutos_varas_basales: 20 + i,
  altura_brote_mm: 300 + i, diametro_brote_mm: 7 + (i % 3), vigor_vegetativo: 1 + (i % 5), color_follaje: 1 + ((i + 1) % 5), dano_calor: 1 + (i % 3) });
for (let i = 0; i < 51; i += 1) {
  const { error } = await svc.from('evaluaciones').insert({ ...base(rondas[i], i), estado: 'borrador' });
  if (error) throw error;
}
{ const { error } = await svc.from('evaluaciones').insert({ ...base(rondas[51], 51), estado: 'completa' }); if (error) throw error; }
for (const r of rondas.slice(52, 54)) {
  const { data, error } = await svc.from('evaluaciones').insert({ ...base(r, 0), estado: 'borrador' }).select('id').single();
  if (error) throw error;
  const { error: e2 } = await svc.from('evaluaciones').update({ estado: 'anulada', motivo_cambio: 'Se evaluó el individuo equivocado' }).eq('id', data.id);
  if (e2) throw e2;
}
console.log('ok', planta.id, ids.length, 'individuos;', rondas.length, 'rondas');
