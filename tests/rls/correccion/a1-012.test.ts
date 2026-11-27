import { guardarFichaEvecl } from '../envolturas';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ContextoG9, type UsuarioG9 } from '../auditoria/g9-setup';

const ctx = new ContextoG9();
let autor: UsuarioG9;
let ficha: number;
let descriptor: number;

beforeAll(async () => {
  autor = await ctx.usuario('fix012', 'operario');
  const ensayo = await ctx.ensayo(autor.client, 'FIX012');
  descriptor = await ctx.descriptorPropio('valor', 'FIX012');
  const r = await guardarFichaEvecl(autor.client, {
    p_ensayo_id: ensayo, p_variedad: ctx.codigo('FIX012'), p_numero_repeticion: 1,
    p_respuestas: [{ descriptor_id: descriptor, valor_numerico: 12 }],
  });
  expect(r.error).toBeNull();
  ficha = Number(r.data);
  expect((await ctx.service.from('evecl_descriptor').update({ activo: false }).eq('id', descriptor)).error).toBeNull();
});
afterAll(() => ctx.limpiar());

it('la defensa SQL ignora una baja explícita del descriptor inactivo y lo expone como retirado', async () => {
  const r = await autor.client.rpc('evecl_guardar_ficha_con_bajas', {
    p_entrada: { p_id: ficha, p_notas: 'Editado', p_respuestas: [{ descriptor_id: descriptor, valor_numerico: 99 }] }, p_descriptores_eliminar: [descriptor],
  });
  expect(r.error).toBeNull();
  const lectura = await autor.client.rpc('evecl_obtener_ficha', { p_ficha_id: ficha });
  expect(lectura.error).toBeNull();
  expect(lectura.data.respuestas).toEqual([expect.objectContaining({
    descriptor_id: descriptor, valor_numerico: 12, descriptor: expect.objectContaining({ activo: false }),
  })]);
});

it('la RPC anterior no borra respuestas ausentes del array', async () => {
  expect((await guardarFichaEvecl(autor.client, { p_id: ficha, p_respuestas: [] })).error).toBeNull();
  const lectura = await ctx.service.from('evecl_respuesta').select('valor_numerico').eq('ficha_id', ficha).eq('descriptor_id', descriptor).single();
  expect(lectura.error).toBeNull();
  expect(lectura.data!.valor_numerico).toBe(12);
});
