import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, especieArandano, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';

let ctx: Contexto;
let especie: string;
let admin: Awaited<ReturnType<typeof usuario>>;
const ids: string[] = [];

beforeAll(async () => {
  ctx = contexto();
  especie = await especieArandano(ctx);
  admin = await usuario(ctx, 'fix003', 'admin');
});

afterAll(async () => {
  if (ids.length) {
    const borrado = await ctx.service.from('plantas').delete().in('id', ids);
    expect(borrado.error).toBeNull();
    const restantes = await ctx.service.from('plantas').select('id').in('id', ids);
    expect(restantes.error).toBeNull();
    expect(restantes.data).toEqual([]);
  }
  const cuenta = await ctx.service.auth.admin.deleteUser(admin.id);
  expect(cuenta.error).toBeNull();
  const perfil = await ctx.service.from('perfiles').select('id').eq('id', admin.id);
  expect(perfil.error).toBeNull();
  expect(perfil.data).toEqual([]);
});

async function cruce(esPrueba: boolean) {
  const resultado = await ctx.service.from('plantas').insert({
    codigo_sistema: `FIX003-${ctx.R}-${ids.length}`,
    especie_id: especie,
    es_prueba: esPrueba,
  }).select('id').single();
  expect(resultado.error).toBeNull();
  ids.push(resultado.data!.id);
  return resultado.data!.id;
}

describe('A1-003: puertas de borrado', () => {
  it.each(['plantas', 'registros_evento', 'perfiles', 'especies'])('%s rechaza DELETE incluso para admin', async (tabla) => {
    const resultado = await admin.client.from(tabla).delete().eq('id', '00000000-0000-0000-0000-000000000000');
    expect(resultado.error?.code).toBe('42501');
  });

  it('hard conserva la guarda de cruce real, purga el de prueba y escribe auditoría', async () => {
    const real = await cruce(false);
    const rechazado = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: real, p_tipo: 'hard' });
    expect(rechazado.error?.code).toBe('42501');
    const prueba = await cruce(true);
    const purga = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: prueba, p_tipo: 'hard' });
    expect(purga.error).toBeNull();
    const restante = await ctx.service.from('plantas').select('id').eq('id', prueba);
    expect(restante.error).toBeNull();
    expect(restante.data).toEqual([]);
    const log = await ctx.service.from('audit_log').select('accion').eq('usuario_id', admin.id).eq('accion', 'borrado_cruzamiento_hard');
    expect(log.error).toBeNull();
    expect(log.data).toHaveLength(1);
  });

  it('soft archiva un cruce real y conserva su fila', async () => {
    const id = await cruce(false);
    const archivo = await admin.client.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'soft' });
    expect(archivo.error).toBeNull();
    const fila = await ctx.service.from('plantas').select('eliminado_at').eq('id', id).single();
    expect(fila.error).toBeNull();
    expect(fila.data!.eliminado_at).not.toBeNull();
  });
});
