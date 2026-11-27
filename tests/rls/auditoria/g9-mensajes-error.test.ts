/**
 * G9 / T07 — mensajes de error que ve el usuario de EVECL
 * (`traducirError` de `frontend/src/api/client.ts` aplicado a los errores reales
 * que devuelve la base local).
 *
 * Hallazgo (el `it.fails` está escrito con lo que DEBERÍA pasar):
 *  - A1-G9-20  los duplicados y los errores del trigger de coherencia llegan al usuario con mensajes
 *              del núcleo genético («¿código de sistema duplicado?») o con un código opaco (P0001)
 */
import { guardarFichaEvecl } from '../envolturas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextoG9, type DescriptorG9, type UsuarioG9 } from './g9-setup';

vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54600');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_prueba_sin_uso');

const ctx = new ContextoG9();
let autor: UsuarioG9;
let otro: UsuarioG9;
let cat: DescriptorG9[];
let traducirError: (e: { code?: string; message?: string } | null) => Error;

beforeAll(async () => {
  ({ traducirError } = await import('../../../frontend/src/api/client'));
  autor = await ctx.usuario('msg-autor', 'operario');
  otro = await ctx.usuario('msg-otro', 'operario');
  cat = await ctx.catalogo(autor.client);
}, 60_000);

afterAll(async () => {
  await ctx.limpiar();
}, 60_000);

describe('T07 — mensajes que ve el usuario', () => {
  it('rechazos con texto propio de la RPC (permiso, no encontrado, parámetros) se muestran tal cual', async () => {
    const e = await ctx.ensayo(autor.client, 'MSG-NEGOCIO');
    const { data: f } = await guardarFichaEvecl(autor.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1 });
    const ajeno = await guardarFichaEvecl(otro.client, { p_id: f, p_notas: 'x' });
    expect(traducirError(ajeno.error).message).toBe('Solo el autor de la ficha o un admin puede editarla');
    const noExiste = await autor.client.rpc('evecl_obtener_ficha', { p_ficha_id: 99999999 });
    expect(traducirError(noExiste.error).message).toBe('Ficha 99999999 no encontrada');
    const modo = await autor.client.rpc('evecl_comparar', { p_modo: 'x' });
    expect(traducirError(modo.error).message).toMatch(/Modo inválido/);
  });

  it('los CHECK de EVECL tienen mensaje propio (repetición, fecha futura, valor negativo)', async () => {
    const e = await ctx.ensayo(autor.client, 'MSG-CHECK');
    const rep = await guardarFichaEvecl(autor.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 21 });
    expect(traducirError(rep.error).message).toBe('La repetición debe estar entre 1 y 20.');
    const fecha = await guardarFichaEvecl(autor.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1, p_fecha_evaluacion: '2099-01-01' });
    expect(traducirError(fecha.error).message).toBe('La fecha de evaluación no puede ser futura.');
  });

  it.fails('A1-G9-20 — repetir variedad y repetición debería explicar que esa planta ya existe en el ensayo (hoy: «¿código de sistema duplicado?», vocabulario del núcleo genético)', async () => {
    const e = await ctx.ensayo(autor.client, 'MSG-DUP');
    await guardarFichaEvecl(autor.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1 });
    const dup = await guardarFichaEvecl(autor.client, { p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1 });
    expect(traducirError(dup.error).message).not.toMatch(/código de sistema/);
  });

  it.fails('A1-G9-20 — un estado sin nota o una nota inválida debería producir un mensaje comprensible (hoy: «No se pudo completar la operación (código P0001)»)', async () => {
    const e = await ctx.ensayo(autor.client, 'MSG-TRIGGER');
    const vigor = cat.find((d) => d.codigo_upov === 1)!;
    const r = await guardarFichaEvecl(autor.client, {
      p_ensayo_id: e, p_variedad: 'AUD-G9-A', p_numero_repeticion: 1, p_respuestas: [{ descriptor_id: vigor.id, nota: 4 }],
    });
    expect(traducirError(r.error).message).not.toMatch(/código P0001/);
  });

  it.fails('A1-G9-20 — repetir el código de parcela de un ensayo debería decir que el código ya está en uso (hoy: «¿código de sistema duplicado?»)', async () => {
    const e = await ctx.ensayo(autor.client, 'MSG-PARCELA');
    expect(e).toBeGreaterThan(0);
    const dup = await otro.client.rpc('evecl_guardar_ensayo', { p_codigo_parcela: ctx.codigo('MSG-PARCELA') });
    expect(traducirError(dup.error).message).not.toMatch(/código de sistema/);
  });
});
