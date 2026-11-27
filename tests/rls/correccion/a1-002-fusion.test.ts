import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const script = readFileSync('scripts/fusionar_variedades_duplicadas.sql', 'utf8')
  .replace(/^BEGIN;\r?$/m, '').replace(/^COMMIT;\r?$/m, '');
const indice = readFileSync('supabase/migrations/20261022110000_a1_002_unicidad_clave_variedad.sql', 'utf8');
const fixture = `
BEGIN;
-- Solo esta transacción de prueba: ROLLBACK restaura el índice, si ya existe.
DROP INDEX IF EXISTS public.variedades_especie_clave_nombre_uniq;
CREATE TEMP TABLE _caso_fusion AS SELECT gen_random_uuid() especie,
  gen_random_uuid() a, gen_random_uuid() b, gen_random_uuid() c, gen_random_uuid() d,
  gen_random_uuid() p, gen_random_uuid() q;
INSERT INTO especies(id,nombre) SELECT especie, 'FIX002-' || especie FROM _caso_fusion;
INSERT INTO variedades(id,especie_id,nombre)
SELECT a,especie,'BCH 1' FROM _caso_fusion UNION ALL SELECT b,especie,'BCH-1' FROM _caso_fusion
UNION ALL SELECT c,especie,'BCH3' FROM _caso_fusion UNION ALL SELECT d,especie,'BCH-3' FROM _caso_fusion;
INSERT INTO plantas(id,codigo_sistema,especie_id,mama_id,papa_id,es_prueba)
SELECT p,'FIX002-' || p,especie,b,d,true FROM _caso_fusion
UNION ALL SELECT q,'FIX002-' || q,especie,d,b,true FROM _caso_fusion;
SELECT set_config('bdsecurity.fusiones_variedades', jsonb_build_array(
  jsonb_build_object('origen_id',b,'destino_id',a),
  jsonb_build_object('origen_id',d,'destino_id',c))::text, true) FROM _caso_fusion;
`;

function ejecutar(sql: string) {
  return spawnSync('docker', ['exec', '-i', 'supabase_db_dbsecurity-frutales',
    'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', timeout: 20_000 });
}

it('fusiona dos pares, conserva filas e historial y permite crear el índice; todo se revierte', () => {
  const result = ejecutar(fixture + script + indice + `
DO $$
DECLARE t record;
BEGIN
 SELECT * INTO t FROM _caso_fusion;
 IF (SELECT count(*) FROM variedades WHERE especie_id=t.especie) <> 4
    OR (SELECT count(*) FROM plantas WHERE especie_id=t.especie) <> 2
    OR (SELECT count(*) FROM variedades WHERE id IN (t.b,t.d) AND NOT activo) <> 2 THEN
   RAISE EXCEPTION 'Se perdieron filas o no se archivaron sobrantes'; END IF;
 IF NOT EXISTS(SELECT 1 FROM plantas WHERE id=t.p AND mama_id=t.a AND papa_id=t.c)
    OR NOT EXISTS(SELECT 1 FROM plantas WHERE id=t.q AND mama_id=t.c AND papa_id=t.a) THEN
   RAISE EXCEPTION 'Reasignación de ambos progenitores incorrecta'; END IF;
 IF (SELECT count(*) FROM audit_log WHERE planta_id IN (t.p,t.q) AND accion='fusion_variedades') <> 2
    OR (SELECT count(*) FROM audit_log WHERE accion='cambio_variedad' AND detalle->>'entidad_id' IN(t.b::text,t.d::text)) <> 2 THEN
   RAISE EXCEPTION 'Falta auditoría de plantas o nombres anteriores'; END IF;
 BEGIN
   INSERT INTO variedades(especie_id,nombre) VALUES(t.especie,'BCH-1');
   RAISE EXCEPTION 'Índice permitió duplicado';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
   INSERT INTO variedades(especie_id,nombre,activo) VALUES(t.especie,'BCH-1',false);
   RAISE EXCEPTION 'Índice permitió duplicado inactivo';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END;
$$;
ROLLBACK;
`);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain('PASS: referencias fusionadas');
});

it('rechaza cadenas/ciclos sin modificar los pares', () => {
  const result = ejecutar(fixture + `
SELECT set_config('bdsecurity.fusiones_variedades', jsonb_build_array(
 jsonb_build_object('origen_id',b,'destino_id',a),
 jsonb_build_object('origen_id',a,'destino_id',b))::text,true) FROM _caso_fusion;
` + script);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('No se admiten orígenes repetidos, cadenas ni ciclos');
});

it('rechaza fusionar claves diferentes y exige una lista explícita de pares', () => {
  const invalido = ejecutar(fixture + `SELECT set_config('bdsecurity.fusiones_variedades',
    jsonb_build_array(jsonb_build_object('origen_id',b,'destino_id',c))::text,true) FROM _caso_fusion;` + script);
  expect(invalido.status).not.toBe(0);
  expect(invalido.stderr).toContain('especies/claves distintas');
  const vacio = ejecutar("BEGIN; SET LOCAL bdsecurity.fusiones_variedades='[]';" + script);
  expect(vacio.status).not.toBe(0);
  expect(vacio.stderr).toContain('Sin pares revisados');
});
