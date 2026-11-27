/**
 * Fase 5, segunda parte (decisión G16): orden natural de códigos. La tabla de Cruces ordena y pagina en el servidor
 * (listar_cruces_analiticos), así que el orden natural tiene que estar en la base: 02-2 antes que 02-10 y 02-100, con orden
 * «Código» y como desempate de los demás órdenes. El resto de las listas ordena en el cliente (lib/ordenNatural).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { crearCruce, iniciarContexto, limpiarContexto, type ContextoG6, type Fila } from '../auditoria/g6-helpers';

const CONTENEDOR = 'supabase_db_dbsecurity-frutales';
const psql = (sql: string) => execFileSync('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
  input: sql, encoding: 'utf8',
}).trim();

let ctx: ContextoG6;
const CODIGOS = ['10', '2', '100', '1000', '1', '09'];

beforeAll(async () => {
  ctx = await iniciarContexto('fase5-orden-natural');
  for (const n of CODIGOS) await crearCruce(ctx, { codigo: `ON${ctx.R}-${n}`, estado: 'polinizacion' });
}, 120_000);

afterAll(async () => {
  await limpiarContexto(ctx);
}, 60_000);

async function pagina(orden: string, limite: number, offset: number): Promise<string[]> {
  const { data, error } = await ctx.admin.rpc('listar_cruces_analiticos', {
    p_especie_id: ctx.especieId, p_busqueda: `ON${ctx.R}-`, p_orden: orden, p_limite: limite, p_offset: offset, p_incluir_pruebas: true,
  });
  expect(error).toBeNull();
  return ((data as Fila).items as Fila[]).map((c) => (c.codigo_sistema as string).split('-')[1]);
}

describe('listar_cruces_analiticos en orden natural', () => {
  it('con orden «Código»: 1, 2, 09, 10, 100, 1000 (no 1, 1000, 100, 10… como en el texto)', async () => {
    expect(await pagina('codigo_asc', 10, 0)).toEqual(['1', '2', '09', '10', '100', '1000']);
  });

  it('el orden se respeta entre páginas', async () => {
    expect([...await pagina('codigo_asc', 3, 0), ...await pagina('codigo_asc', 3, 3)]).toEqual(['1', '2', '09', '10', '100', '1000']);
  });

  it('el desempate de los demás órdenes también es natural (todos en la misma fase)', async () => {
    expect(await pagina('estado_asc', 10, 0)).toEqual(['1', '2', '09', '10', '100', '1000']);
  });

  it('codigo_natural: rellena los números para que el texto ordene como números', () => {
    expect(psql(`select string_agg(c, ',' order by public.codigo_natural(c)) from unnest(array['02-10','02-2','02-100','02-001-P10','02-001-P9','02-002-P1']) c`))
      // «02-2» y «02-002» valen lo mismo: el más corto va primero, como en la app (lib/ordenNatural).
      .toBe('02-001-P9,02-001-P10,02-2,02-002-P1,02-10,02-100');
  });
});
