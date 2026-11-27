import { guardarFichaEvecl } from '../envolturas';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ContextoG9, type UsuarioG9 } from '../auditoria/g9-setup';

const ctx = new ContextoG9();
let autor: UsuarioG9;
let otro: UsuarioG9;
let ficha: number;
let descriptor: number;
const llave = crypto.randomUUID();

beforeAll(async () => {
  autor = await ctx.usuario('fix011autor', 'operario');
  otro = await ctx.usuario('fix011otro', 'operario');
  const ensayo = await ctx.ensayo(autor.client, 'FIX011');
  descriptor = await ctx.descriptorPropio('valor', 'FIX011');
  const inicial = await guardarFichaEvecl(autor.client, {
    p_ensayo_id: ensayo, p_variedad: ctx.codigo('FIX011'), p_numero_repeticion: 1,
    p_idempotency_key: llave, p_respuestas: [{ descriptor_id: descriptor, valor_numerico: 10 }],
  });
  expect(inicial.error).toBeNull();
  ficha = Number(inicial.data);
});
afterAll(() => ctx.limpiar());

async function respuestas() {
  const r = await ctx.service.from('evecl_respuesta').select('descriptor_id,valor_numerico').eq('ficha_id', ficha);
  expect(r.error).toBeNull();
  return r.data!;
}

it('un tercero no puede convertir un retorno por idempotencia en un borrado DEFINER', async () => {
  const r = await otro.client.rpc('evecl_guardar_ficha_con_bajas', {
    p_entrada: { p_idempotency_key: llave }, p_descriptores_eliminar: [descriptor],
  });
  expect(r.error?.code).toBe('42501');
  expect(await respuestas()).toEqual([{ descriptor_id: descriptor, valor_numerico: 10 }]);
});

it('un descriptor inválido revierte el encabezado, respuestas y bajas de la misma transacción', async () => {
  const r = await autor.client.rpc('evecl_guardar_ficha_con_bajas', {
    p_entrada: { p_id: ficha, p_notas: 'NO DEBE QUEDAR', p_respuestas: [{ descriptor_id: -1, valor_numerico: 3 }] },
    p_descriptores_eliminar: [descriptor],
  });
  expect(r.error).not.toBeNull();
  const cabecera = await ctx.service.from('evecl_ficha').select('notas').eq('id', ficha).single();
  expect(cabecera.error).toBeNull();
  expect(cabecera.data!.notas).toBeNull();
  expect(await respuestas()).toEqual([{ descriptor_id: descriptor, valor_numerico: 10 }]);
});

it('anon no puede ejecutar y el autor puede guardar y borrar atómicamente', async () => {
  const anon = await ctx.anon.rpc('evecl_guardar_ficha_con_bajas', { p_entrada: { p_id: ficha } });
  expect(anon.error).not.toBeNull();
  const r = await autor.client.rpc('evecl_guardar_ficha_con_bajas', {
    p_entrada: { p_id: ficha, p_notas: 'Guardado', p_respuestas: [] }, p_descriptores_eliminar: [descriptor],
  });
  expect(r.error).toBeNull();
  expect(Number(r.data)).toBe(ficha);
  expect(await respuestas()).toEqual([]);
  const cabecera = await ctx.service.from('evecl_ficha').select('notas').eq('id', ficha).single();
  expect(cabecera.data!.notas).toBe('Guardado');
});
