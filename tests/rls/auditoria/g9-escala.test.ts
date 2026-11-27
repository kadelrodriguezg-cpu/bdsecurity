/**
 * G9 / T07 — qué pasa con diez veces más datos.
 *
 * Referencia del Maestro (9.10): ~40 fichas por temporada. «Diez veces más» son
 * 400 fichas; acá se prueba con 500 fichas repartidas en 25 ensayos (unas 7.000
 * respuestas) y, aparte, con 1.100 fichas en UN ensayo para mirar el corte
 * silencioso de `max_rows` (1000 en local).
 *
 * Las fichas y respuestas se insertan con service_role (preparación); las
 * lecturas se hacen con un usuario logueado con la clave anon.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoG9, type DescriptorG9, type UsuarioG9 } from './g9-setup';

const ctx = new ContextoG9();
let autor: UsuarioG9;
let cat: DescriptorG9[];
const ensayosGrandes: number[] = [];
let ensayoMuchasFichas = 0;

async function insertarPorLotes(tabla: string, filas: Record<string, unknown>[], lote = 400): Promise<void> {
  for (let i = 0; i < filas.length; i += lote) {
    const { error } = await ctx.service.from(tabla).insert(filas.slice(i, i + lote));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

beforeAll(async () => {
  autor = await ctx.usuario('esc-autor', 'operario');
  cat = await ctx.catalogo(autor.client);

  // 25 ensayos × (4 variedades × 5 repeticiones) = 500 fichas.
  for (let e = 0; e < 25; e++) {
    const id = await ctx.ensayo(autor.client, `ESC-${e}`);
    ensayosGrandes.push(id);
  }
  const fichas: Record<string, unknown>[] = [];
  for (const ensayoId of ensayosGrandes) {
    for (let v = 0; v < 4; v++) {
      for (let r = 1; r <= 5; r++) {
        fichas.push({ ensayo_id: ensayoId, variedad: `AUD-G9-ESC-V${v}`, numero_repeticion: r, created_by: autor.userId, tipo: r === 5 ? 'testigo' : 'evaluacion' });
      }
    }
  }
  await insertarPorLotes('evecl_ficha', fichas);
  const { data: ids } = await ctx.service.from('evecl_ficha').select('id').in('ensayo_id', ensayosGrandes);
  const valor = cat.filter((d) => d.tipo === 'valor' && d.codigo_upov !== null || d.nombre.startsWith('Rendimiento') || d.nombre.startsWith('Días') || d.nombre.startsWith('Tamaño de la cicatriz'));
  const estado = cat.filter((d) => d.tipo === 'estado').slice(0, 8);
  const respuestas: Record<string, unknown>[] = [];
  let k = 0;
  for (const { id } of ids ?? []) {
    k++;
    for (const d of valor) if (d.tipo === 'valor' && !d.nombre.includes('%')) respuestas.push({ ficha_id: id, descriptor_id: d.id, valor_numerico: 5 + ((k * 7 + d.id) % 40) });
    for (const d of estado) respuestas.push({ ficha_id: id, descriptor_id: d.id, nota: d.estados[(k + d.id) % d.estados.length].nota });
  }
  await insertarPorLotes('evecl_respuesta', respuestas, 1000);

  // Un ensayo con 1.100 fichas: 55 variedades × 20 repeticiones.
  ensayoMuchasFichas = await ctx.ensayo(autor.client, 'ESC-MUCHAS');
  const muchas: Record<string, unknown>[] = [];
  for (let v = 0; v < 55; v++) for (let r = 1; r <= 20; r++) muchas.push({ ensayo_id: ensayoMuchasFichas, variedad: `AUD-G9-MUCHAS-V${v}`, numero_repeticion: r, created_by: autor.userId });
  await insertarPorLotes('evecl_ficha', muchas);
}, 240_000);

afterAll(async () => {
  await ctx.limpiar();
}, 240_000);

describe('T07 — escala de evecl_comparar y las RPC de consulta (500 fichas)', () => {
  it('evecl_comparar entre_grupos sobre 500 fichas responde en menos de 5 s y devuelve un grupo por variedad × ensayo (y por tipo en evaluacion_vs_testigo)', async () => {
    const t0 = Date.now();
    const { data, error } = await autor.client.rpc('evecl_comparar', { p_modo: 'entre_grupos', p_conjunto: 'todos' });
    const ms = Date.now() - t0;
    expect(error).toBeNull();
    const calidad = (data.ranking_calidad as { grupo_key: string; puntaje: number }[]).filter((g) => g.grupo_key.startsWith('aud-g9-esc-'));
    expect(calidad).toHaveLength(100);
    for (const g of calidad) expect(g.puntaje).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(5_000);

    const t1 = Date.now();
    const sep = await autor.client.rpc('evecl_comparar', { p_modo: 'entre_grupos', p_conjunto: 'evaluacion_vs_testigo' });
    expect(sep.error).toBeNull();
    expect((sep.data.ranking_calidad as { grupo_key: string }[]).filter((g) => g.grupo_key.startsWith('aud-g9-esc-'))).toHaveLength(200);
    expect(Date.now() - t1).toBeLessThan(5_000);
  });

  it('evecl_obtener_ensayos lista todos los ensayos con sus conteos correctos', async () => {
    const { data, error } = await autor.client.rpc('evecl_obtener_ensayos');
    expect(error).toBeNull();
    const propios = (data as { id: number; total_fichas: number; total_variedades: number }[]).filter((e) => ensayosGrandes.includes(Number(e.id)));
    expect(propios).toHaveLength(25);
    for (const e of propios) {
      expect(Number(e.total_fichas)).toBe(20);
      expect(Number(e.total_variedades)).toBe(4);
    }
  });

  it('evecl_obtener_fichas de un ensayo normal devuelve sus 20 fichas con la completitud calculada', async () => {
    const { data, error } = await autor.client.rpc('evecl_obtener_fichas', { p_ensayo_id: ensayosGrandes[0] });
    expect(error).toBeNull();
    expect(data).toHaveLength(20);
    for (const f of data as { respondidos: number; total_descriptores: number }[]) {
      expect(Number(f.respondidos)).toBeGreaterThan(0);
      expect(Number(f.total_descriptores)).toBe(cat.length);
    }
  });
});

describe('T07 — corte silencioso de max_rows', () => {
  it.fails('A1-G9-13 — evecl_obtener_fichas de un ensayo con 1.100 fichas debería devolverlas todas (hoy PostgREST corta en 1000 sin avisar)', async () => {
    const { count } = await ctx.service.from('evecl_ficha').select('id', { count: 'exact', head: true }).eq('ensayo_id', ensayoMuchasFichas);
    expect(count).toBe(1100);
    const { data, error } = await autor.client.rpc('evecl_obtener_fichas', { p_ensayo_id: ensayoMuchasFichas });
    expect(error).toBeNull();
    // Hoy: 1000 filas; la pantalla del ensayo mostraría 1000 fichas y el resumen del ensayo diría 1100.
    expect((data as unknown[]).length).toBe(1100);
  });
});
