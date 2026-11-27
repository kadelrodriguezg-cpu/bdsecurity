import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { claveNombreVariedad } from '../../../frontend/src/lib/claveNombreVariedad';

it('la clave del selector coincide empíricamente con la función del importador local', () => {
  const nombres = ['BCH-1', 'BCH 1', "O’Néàl", "O'Neal", 'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛ', 'çå', 'A\u0301', '', 'İ'];
  const sql = `BEGIN READ ONLY; SELECT jsonb_agg(public.clave_nombre_variedad(n) ORDER BY ord)
    FROM jsonb_array_elements_text('${JSON.stringify(nombres).replace(/'/g, "''")}') WITH ORDINALITY t(n,ord); ROLLBACK;`;
  const resultado = spawnSync('docker', ['exec', '-i', 'supabase_db_dbsecurity-frutales', 'psql',
    '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', timeout: 10_000 });
  expect(resultado.status, resultado.stderr).toBe(0);
  expect(JSON.parse(resultado.stdout.trim())).toEqual(nombres.map(claveNombreVariedad));
});
