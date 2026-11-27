/**
 * Auditoría integral, Corrida 1, grupo G8: T05 catálogos (especies, variedades,
 * contenedores, insumos, sustratos). No cubre predios (R01) ni variedades casi
 * duplicadas (G1).
 *
 * Las pruebas `it.fails` demuestran un hallazgo: se escriben con lo que
 * DEBERÍA pasar y quedan en verde mientras el bug exista.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoG8, type UsuarioG8 } from './g8-setup';

const ctx = new ContextoG8();
const { service } = ctx;

let admin: UsuarioG8;
let operario: UsuarioG8;
let especieId: string;
let mamaId: string;
let cruceId: string;

beforeAll(async () => {
  admin = await ctx.usuario('cat-admin', 'admin');
  operario = await ctx.usuario('cat-operario', 'operario');
  especieId = await ctx.especie('catalogos');
  mamaId = await ctx.variedad(especieId, `AUD-G8 Madre cat ${ctx.sufijo}`);
  const papaId = await ctx.variedad(especieId, `AUD-G8 Padre cat ${ctx.sufijo}`);
  cruceId = await ctx.cruce('CAT', especieId, { mama_id: mamaId, papa_id: papaId });
});

afterAll(async () => {
  await ctx.limpiar();
});

/** Fila de catálogo creada por el admin vía API (queda registrada para limpiar). */
async function crearComoAdmin(tabla: 'contenedor' | 'insumo' | 'sustrato' | 'especies', fila: Record<string, unknown>) {
  const r = await admin.client.from(tabla).insert(fila).select('id').single();
  if (r.data) ctx.registrarFila(tabla, r.data.id as string);
  return r;
}

describe('T05 permisos de los catálogos', () => {
  it('un operario no puede crear, editar ni borrar especies, contenedores, insumos ni sustratos', async () => {
    const c = await crearComoAdmin('contenedor', { nombre: `AUD-G8 cont perm ${ctx.sufijo}`, capacidad_litros: 5 });
    const i = await crearComoAdmin('insumo', { nombre: `AUD-G8 ins perm ${ctx.sufijo}`, tipo: 'otro' });
    const s = await crearComoAdmin('sustrato', { nombre: `AUD-G8 sus perm ${ctx.sufijo}` });
    expect(c.error ?? i.error ?? s.error).toBeNull();

    for (const [tabla, fila] of [
      ['especies', { nombre: `AUD-G8 op ${ctx.sufijo}` }],
      ['contenedor', { nombre: 'x' }],
      ['insumo', { nombre: 'x', tipo: 'otro' }],
      ['sustrato', { nombre: 'x' }],
    ] as const) {
      const r = await operario.client.from(tabla).insert(fila);
      expect(r.error?.code, `insert ${tabla}`).toBe('42501');
    }
    for (const [tabla, id] of [['contenedor', c.data!.id], ['insumo', i.data!.id], ['sustrato', s.data!.id]] as const) {
      const up = await operario.client.from(tabla).update({ activo: false }).eq('id', id).select('id');
      expect(up.data ?? [], `update ${tabla}`).toHaveLength(0);
      const del = await operario.client.from(tabla).delete().eq('id', id).select('id');
      expect(del.data ?? [], `delete ${tabla}`).toHaveLength(0);
    }
    const esp = await operario.client.from('especies').update({ nombre: 'hack' }).eq('id', especieId).select('id');
    expect(esp.data ?? []).toHaveLength(0);
    const espDel = await operario.client.from('especies').delete().eq('id', especieId).select('id');
    expect(espDel.data ?? []).toHaveLength(0);
  });

  it('un operario crea variedades a su nombre; no puede falsear created_by, editarlas ni borrarlas', async () => {
    const ok = await operario.client.from('variedades')
      .insert({ especie_id: especieId, nombre: `AUD-G8 op var ${ctx.sufijo}`, created_by: operario.userId })
      .select('id, created_by, activo')
      .single();
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ created_by: operario.userId, activo: true });

    const ajeno = await operario.client.from('variedades')
      .insert({ especie_id: especieId, nombre: `AUD-G8 suplanta ${ctx.sufijo}`, created_by: admin.userId });
    expect(ajeno.error?.code).toBe('42501');
    const sinAutor = await operario.client.from('variedades')
      .insert({ especie_id: especieId, nombre: `AUD-G8 sin autor ${ctx.sufijo}` });
    expect(sinAutor.error?.code).toBe('42501');

    const edita = await operario.client.from('variedades').update({ activo: false }).eq('id', ok.data!.id).select('id');
    expect(edita.data ?? []).toHaveLength(0);
    const borra = await operario.client.from('variedades').delete().eq('id', ok.data!.id);
    expect(borra.error?.code).toBe('42501'); // DELETE no está concedido a nadie
    const adminBorra = await admin.client.from('variedades').delete().eq('id', ok.data!.id);
    expect(adminBorra.error?.code).toBe('42501');
  });

  it('una variedad duplicada por mayúsculas o espacios alrededor se rechaza (índice lower(btrim))', async () => {
    const base = `AUD-G8 Dup ${ctx.sufijo}`;
    const primera = await operario.client.from('variedades')
      .insert({ especie_id: especieId, nombre: base, created_by: operario.userId });
    expect(primera.error).toBeNull();
    for (const variante of [base.toLowerCase(), `  ${base}  `, base.toUpperCase()]) {
      const r = await operario.client.from('variedades')
        .insert({ especie_id: especieId, nombre: variante, created_by: operario.userId });
      expect(r.error?.code, variante).toBe('23505');
    }
    const vacia = await operario.client.from('variedades')
      .insert({ especie_id: especieId, nombre: '   ', created_by: operario.userId });
    expect(vacia.error?.code).toBe('23514');
  });
});

describe('T05 borrado físico y uso de los catálogos (camino sin pantalla)', () => {
  it('A1-003 rechaza DELETE de especies y las FK siguen protegiendo catálogos en uso', async () => {
    const delEspecie = await admin.client.from('especies').delete().eq('id', especieId);
    expect(delEspecie.error?.code).toBe('42501');
    const privilegiado = await service.from('especies').delete().eq('id', especieId);
    expect(privilegiado.error?.code).toBe('23503');

    const c = await crearComoAdmin('contenedor', { nombre: `AUD-G8 cont uso ${ctx.sufijo}` });
    const i = await crearComoAdmin('insumo', { nombre: `AUD-G8 ins uso ${ctx.sufijo}`, tipo: 'fungicida' });
    const s = await crearComoAdmin('sustrato', { nombre: `AUD-G8 sus uso ${ctx.sufijo}` });
    expect((await service.from('plantas').update({ contenedor_id: c.data!.id }).eq('id', cruceId)).error).toBeNull();
    expect((await service.from('plantas_insumo').insert({ planta_id: cruceId, insumo_id: i.data!.id })).error).toBeNull();
    expect((await service.from('plantas_sustrato')
      .insert({ planta_id: cruceId, sustrato_id: s.data!.id, porcentaje: 40 })).error).toBeNull();

    for (const [tabla, id] of [['contenedor', c.data!.id], ['insumo', i.data!.id], ['sustrato', s.data!.id]] as const) {
      const r = await admin.client.from(tabla).delete().eq('id', id);
      expect(r.error?.code, tabla).toBe('23503');
    }
  });

  it('desactivar un insumo o sustrato en uso se permite y la relación histórica se conserva', async () => {
    const i = await crearComoAdmin('insumo', { nombre: `AUD-G8 ins baja ${ctx.sufijo}`, tipo: 'otro' });
    const s = await crearComoAdmin('sustrato', { nombre: `AUD-G8 sus baja ${ctx.sufijo}` });
    await service.from('plantas_insumo').insert({ planta_id: cruceId, insumo_id: i.data!.id });
    await service.from('plantas_sustrato').insert({ planta_id: cruceId, sustrato_id: s.data!.id, porcentaje: 10 });

    const bajaI = await admin.client.from('insumo').update({ activo: false }).eq('id', i.data!.id).select('activo');
    const bajaS = await admin.client.from('sustrato').update({ activo: false }).eq('id', s.data!.id).select('activo');
    expect(bajaI.data).toEqual([{ activo: false }]);
    expect(bajaS.data).toEqual([{ activo: false }]);

    // El listado de formularios (solo activos) ya no los ofrece; la relación sigue ahí.
    const activos = await operario.client.from('insumo').select('id').eq('activo', true).eq('id', i.data!.id);
    expect(activos.data).toHaveLength(0);
    const rel = await operario.client.from('plantas_insumo').select('insumo_id').eq('planta_id', cruceId).eq('insumo_id', i.data!.id);
    expect(rel.data).toHaveLength(1);
  });

  it('un admin borra un contenedor sin uso; A1-003 rechaza DELETE directo de especies', async () => {
    const c = await admin.client.from('contenedor').insert({ nombre: `AUD-G8 cont borrable ${ctx.sufijo}` }).select('id').single();
    expect(c.error).toBeNull();
    const del = await admin.client.from('contenedor').delete().eq('id', c.data!.id).select('id');
    expect(del.error).toBeNull();
    expect(del.data).toHaveLength(1);
    const e = await admin.client.from('especies').insert({ nombre: `AUD-G8 esp borrable ${ctx.sufijo}` }).select('id').single();
    const borrado = await admin.client.from('especies').delete().eq('id', e.data!.id).select('id');
    expect(borrado.error?.code).toBe('42501');
    const conservada = await service.from('especies').select('id').eq('id', e.data!.id);
    expect(conservada.error).toBeNull();
    expect(conservada.data).toHaveLength(1);
  });

  // A1-G8-10. Borrar o renombrar un catálogo no deja ninguna fila de auditoría.
  it.fails('A1-G8-10: borrar un contenedor/insumo/sustrato/especie sin uso debería quedar en audit_log', async () => {
    const desde = new Date(Date.now() - 5000).toISOString();
    const nombre = `AUD-G8 cont auditado ${ctx.sufijo}`;
    const c = await admin.client.from('contenedor').insert({ nombre }).select('id').single();
    await admin.client.from('contenedor').delete().eq('id', c.data!.id);
    const { data } = await service.from('audit_log').select('id, detalle, usuario_id').gte('ocurrido_en', desde);
    expect((data ?? []).filter((f) => JSON.stringify(f).includes(c.data!.id) || JSON.stringify(f).includes(nombre)))
      .not.toHaveLength(0);
  });
});

describe('T05 renombrar una variedad reescribe el linaje mostrado', () => {
  it('obtener_planta resuelve mama_nombre en vivo: renombrar la variedad cambia el linaje de todos sus cruces', async () => {
    const antes = await admin.client.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(antes.data.mama_nombre).toBe(`AUD-G8 Madre cat ${ctx.sufijo}`);

    const nuevo = `AUD-G8 Renombrada ${ctx.sufijo}`;
    const r = await admin.client.from('variedades').update({ nombre: nuevo }).eq('id', mamaId).select('nombre');
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ nombre: nuevo }]);

    const despues = await admin.client.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(despues.data.mama_nombre).toBe(nuevo);
    expect(despues.data.mama_id).toBe(mamaId); // la FK no cambió: solo el nombre mostrado
  });

  // A1-G8-08. A diferencia de actualizar_linaje (RPC auditada, 10/min), el UPDATE directo no deja rastro.
  it('A1-G8-08: renombrar o desactivar una variedad queda auditado (autor, nombre anterior y nuevo)', async () => {
    const desde = new Date(Date.now() - 5000).toISOString();
    const nombre = `AUD-G8 Auditada ${ctx.sufijo}`;
    const v = await ctx.variedad(especieId, `AUD-G8 Origen audit ${ctx.sufijo}`);
    const r = await admin.client.from('variedades').update({ nombre }).eq('id', v).select('id');
    expect(r.error).toBeNull();
    const { data } = await service.from('audit_log').select('id, detalle, usuario_id').gte('ocurrido_en', desde);
    expect((data ?? []).filter((f) => JSON.stringify(f).includes(v))).not.toHaveLength(0);
  });
});

describe('T05 validación en el servidor frente a la del cliente', () => {
  // A1-G8-11. La pantalla exige `required`, recorta con trim() y limita; la base no valida nada.
  it.fails('A1-G8-11: una especie con nombre vacío o solo espacios debería rechazarse', async () => {
    const r = await crearComoAdmin('especies', { nombre: '   ' });
    expect(r.error).not.toBeNull();
  });

  it.fails('A1-G8-11: dos especies que solo difieren en mayúsculas ("Mora" y "mora") deberían rechazarse', async () => {
    const base = `AUD-G8 Mora ${ctx.sufijo}`;
    expect((await crearComoAdmin('especies', { nombre: base })).error).toBeNull();
    const r = await crearComoAdmin('especies', { nombre: base.toLowerCase() });
    expect(r.error).not.toBeNull();
  });

  it.fails('A1-G8-11: un contenedor con capacidad negativa debería rechazarse', async () => {
    const r = await crearComoAdmin('contenedor', { nombre: `AUD-G8 cont neg ${ctx.sufijo}`, capacidad_litros: -5 });
    expect(r.error).not.toBeNull();
  });

  it.fails('A1-G8-11: un contenedor con nombre vacío o solo espacios debería rechazarse', async () => {
    const r = await crearComoAdmin('contenedor', { nombre: '   ' });
    expect(r.error).not.toBeNull();
  });

  it.fails('A1-G8-11: un insumo o sustrato con el mismo nombre que otro debería rechazarse', async () => {
    const nombre = `AUD-G8 sus dup ${ctx.sufijo}`;
    expect((await crearComoAdmin('sustrato', { nombre })).error).toBeNull();
    const r = await crearComoAdmin('sustrato', { nombre });
    expect(r.error).not.toBeNull();
  });

  it('un valor fuera del enum de tipo de insumo se rechaza con 22P02', async () => {
    const r = await admin.client.from('insumo').insert({ nombre: `AUD-G8 ins enum ${ctx.sufijo}`, tipo: 'veneno' });
    expect(r.error?.code).toBe('22P02');
  });

  it.fails('A1-G8-09: una variedad con nombre de 200 000 caracteres debería rechazarse (cualquier cuenta puede crearla)', async () => {
    const r = await operario.client.from('variedades')
      .insert({ especie_id: especieId, nombre: 'V'.repeat(200_000), created_by: operario.userId });
    expect(r.error).not.toBeNull();
  });

  it.fails('A1-G8-09: la API debería recortar los espacios al borde del nombre de una variedad (la pantalla sí los recorta)', async () => {
    const r = await operario.client.from('variedades')
      .insert({ especie_id: especieId, nombre: `  AUD-G8 espacios ${ctx.sufijo}  `, created_by: operario.userId })
      .select('nombre')
      .single();
    expect(r.error).toBeNull();
    expect(r.data!.nombre).toBe(r.data!.nombre.trim());
  });
});

describe('T05 volumen: el selector de variedades se corta en silencio a 1000', () => {
  // A1-G8-09. Cualquier cuenta inserta cientos de variedades en una llamada; el listado del
  // selector (listarVariedades: eq especie, eq activo, order nombre, sin paginar) devuelve 1000
  // como máximo y las que quedan después en orden alfabético desaparecen sin aviso.
  it.fails('A1-G8-09: tras la inserción masiva el selector debería seguir mostrando TODAS las variedades de la especie', async () => {
    const esp = await ctx.especie('volumen');
    const legitima = await ctx.variedad(esp, 'ZZZ legítima');
    const lote = Array.from({ length: 1005 }, (_, i) => ({
      especie_id: esp,
      nombre: `AAA relleno ${String(i).padStart(5, '0')}`,
      created_by: operario.userId,
    }));
    const insercion = await operario.client.from('variedades').insert(lote);
    expect(insercion.error).toBeNull(); // sin límite de volumen ni de frecuencia

    const listado = await operario.client
      .from('variedades')
      .select('id, especie_id, nombre, activo')
      .eq('especie_id', esp)
      .eq('activo', true)
      .order('nombre');
    expect(listado.error).toBeNull();
    expect(listado.data!.map((v) => v.id)).toContain(legitima);
  });
});
