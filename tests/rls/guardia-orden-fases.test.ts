/**
 * Guardia del orden de fases en la base (brecha B4, migración 20261021122000).
 *
 * Desde U-03 (migración 20261024070000) solo un admin cambia la fase. Se
 * verifica contra la base local que un operario no puede avanzar, retroceder ni
 * saltar (42501, «Solo un admin puede cambiar la fase de un cruce.») pero sí
 * escribir las demás columnas; que el admin avanza, retrocede y salta (y queda
 * auditado), y que reiniciar_cruzamiento y los contextos service_role siguen
 * funcionando.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';

let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let especieId: string;
const plantasCreadas: string[] = [];

const R = Date.now();
let n = 0;

beforeAll(async () => {
  const creds = getLocalCreds();
  service = createClient(creds.url, creds.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ad = await crearUsuarioDePrueba(creds, service, { email: 'admin@test.local', rol: 'admin' });
  admin = ad.client;
  adminId = ad.userId;
  operario = (await crearUsuarioDePrueba(creds, service, { email: 'operario@test.local', rol: 'operario' })).client;

  const { data: esp, error } = await service.from('especies').select('id').eq('nombre', 'Arándano').single();
  if (error || !esp) throw new Error(`setup especie: ${error?.message}`);
  especieId = esp.id;
}, 60_000);

afterAll(async () => {
  for (const id of plantasCreadas) {
    await admin.rpc('borrar_cruzamiento', { p_planta_id: id, p_tipo: 'hard' });
  }
});

/** Cruce de prueba creado por service_role en la fase pedida, opcionalmente con un individuo. */
async function crearCruce(estado: string, conIndividuo = false): Promise<string> {
  const { data: planta, error } = await service
    .from('plantas')
    .insert({ codigo_sistema: `FASES-${R}-${++n}`, especie_id: especieId, estado, es_prueba: true })
    .select('id')
    .single();
  if (error || !planta) throw new Error(`setup planta: ${error?.message}`);
  plantasCreadas.push(planta.id);
  if (conIndividuo) {
    const { error: errInd } = await service
      .from('individuos')
      .insert({ planta_id: planta.id, codigo_display: `FASES-${R}-${n}-P01`, created_by: adminId });
    if (errInd) throw new Error(`setup individuo: ${errInd.message}`);
  }
  return planta.id;
}

async function mover(cliente: SupabaseClient, plantaId: string, estado: string) {
  return cliente.from('plantas').update({ estado }).eq('id', plantaId).select('id, estado');
}

async function estadoDe(plantaId: string) {
  const { data } = await service.from('plantas').select('estado').eq('id', plantaId).single();
  return data!.estado as string;
}

describe('operario: no cambia la fase (U-03, migración 20261024070000)', () => {
  it.each([
    ['avanzar una fase', 'polinizacion', 'cosecha', false],
    ['retroceder una fase sin individuos', 'cosecha', 'polinizacion', false],
    ['retroceder una fase con individuos', 'crecimiento', 'trasplante', true],
    ['saltar fases hacia adelante', 'polinizacion', 'siembra_semilla', false],
    ['saltar fases hacia atrás', 'germinacion', 'sin_empezar', false],
  ])('NO puede %s: la base lo rechaza con un mensaje claro', async (_caso, desde, hacia, conIndividuo) => {
    const id = await crearCruce(desde, conIndividuo);
    const { error } = await mover(operario, id, hacia);
    expect(error?.code).toBe('42501');
    expect(error?.message).toBe('Solo un admin puede cambiar la fase de un cruce.');
    expect(await estadoDe(id)).toBe(desde);
  });

  it('el rechazo no deja un cambio_estado en el audit_log', async () => {
    const id = await crearCruce('polinizacion');
    await mover(operario, id, 'cosecha');
    const { data } = await service.from('audit_log').select('id').eq('planta_id', id).eq('accion', 'cambio_estado');
    expect(data).toEqual([]);
  });

  it('sigue pudiendo escribir las demás columnas del cruce (la policy de UPDATE no cambió)', async () => {
    const id = await crearCruce('polinizacion');
    const { data, error } = await operario.from('plantas').update({ fecha_polinizacion: '2026-10-01' }).eq('id', id).select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await estadoDe(id)).toBe('polinizacion');
  });

  it('reenviar la misma fase no es un cambio y no se rechaza', async () => {
    const id = await crearCruce('polinizacion');
    const { error } = await mover(operario, id, 'polinizacion');
    expect(error).toBeNull();
  });

  it('reiniciar_cruzamiento sigue siendo solo de admin', async () => {
    const id = await crearCruce('cosecha');
    const { error } = await operario.rpc('reiniciar_cruzamiento', { p_planta_id: id });
    expect(error?.code).toBe('42501');
    expect(await estadoDe(id)).toBe('cosecha');
  });
});

describe('admin: avanza, retrocede y salta, siempre auditado (B4, U-03)', () => {
  it('avanza una fase', async () => {
    const id = await crearCruce('polinizacion');
    const { error } = await mover(admin, id, 'cosecha');
    expect(error).toBeNull();
    expect(await estadoDe(id)).toBe('cosecha');
  });

  it('retrocede una fase sin individuos', async () => {
    const id = await crearCruce('cosecha');
    const { error } = await mover(admin, id, 'polinizacion');
    expect(error).toBeNull();
    expect(await estadoDe(id)).toBe('polinizacion');
  });

  it('recorre trasplante → crecimiento → evaluacion_anual → traslado_destino → proceso_finalizado (orden del enum = ESTADOS_ORDEN)', async () => {
    const id = await crearCruce('trasplante', true);
    for (const destino of ['crecimiento', 'evaluacion_anual', 'traslado_destino', 'proceso_finalizado']) {
      const { error } = await mover(admin, id, destino);
      expect(error, `paso a ${destino}`).toBeNull();
    }
    expect(await estadoDe(id)).toBe('proceso_finalizado');
  });

  it('salta fases y el cambio queda auditado como cambio_estado', async () => {
    const id = await crearCruce('sin_empezar');
    const { error } = await mover(admin, id, 'germinacion');
    expect(error).toBeNull();
    expect(await estadoDe(id)).toBe('germinacion');

    const { data: audit } = await service
      .from('audit_log')
      .select('usuario_id, detalle')
      .eq('planta_id', id)
      .eq('accion', 'cambio_estado');
    expect(audit).toContainEqual({
      usuario_id: adminId,
      detalle: { estado_anterior: 'sin_empezar', estado_nuevo: 'germinacion' },
    });
  });

  it('retrocede aunque el cruce tenga individuos', async () => {
    const id = await crearCruce('evaluacion_anual', true);
    const { error } = await mover(admin, id, 'crecimiento');
    expect(error).toBeNull();
    expect(await estadoDe(id)).toBe('crecimiento');
  });

  it('reiniciar_cruzamiento sigue volviendo a sin_empezar desde cualquier fase', async () => {
    const id = await crearCruce('traslado_destino');
    const { error } = await admin.rpc('reiniciar_cruzamiento', { p_planta_id: id });
    expect(error).toBeNull();
    expect(await estadoDe(id)).toBe('sin_empezar');
  });

  it('service_role (contexto administrativo) no queda restringido', async () => {
    const id = await crearCruce('sin_empezar');
    const { error } = await mover(service, id, 'evaluacion_anual');
    expect(error).toBeNull();
    expect(await estadoDe(id)).toBe('evaluacion_anual');
  });
});
