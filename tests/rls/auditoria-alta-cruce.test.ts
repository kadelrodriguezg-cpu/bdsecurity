/**
 * Auditoría del alta de un cruce (brecha B3, migración 20261021120000).
 *
 * El linaje entra a la base en el mismo INSERT que crea el cruce. Se verifica
 * contra la base local que ese INSERT deja una fila `alta_cruce` en audit_log
 * con el linaje con que nació, que el camino de la app (`crearPlanta`, un
 * INSERT directo como admin) queda cubierto sin cambios, y que un operario no
 * puede leer esa fila.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearUsuarioDePrueba, getLocalCreds } from './helpers';

let service: SupabaseClient;
let admin: SupabaseClient;
let adminId: string;
let operario: SupabaseClient;
let especieId: string;
let variedadMamaId: string;
let variedadPapaId: string;
const plantasCreadas: string[] = [];

const R = Date.now();

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

  const { data: mama } = await service
    .from('variedades')
    .insert({ especie_id: especieId, nombre: `Mama alta (test ${R})`, created_by: adminId })
    .select('id')
    .single();
  const { data: papa } = await service
    .from('variedades')
    .insert({ especie_id: especieId, nombre: `Papa alta (test ${R})`, created_by: adminId })
    .select('id')
    .single();
  variedadMamaId = mama!.id;
  variedadPapaId = papa!.id;
}, 60_000);

afterAll(async () => {
  // Las filas de audit_log sobreviven (FK SET NULL); los cruces y variedades
  // de prueba no se acumulan entre corridas.
  if (plantasCreadas.length) await service.from('plantas').delete().in('id', plantasCreadas);
  await service.from('variedades').delete().in('id', [variedadMamaId, variedadPapaId].filter(Boolean));
});

async function auditoriaAlta(plantaId: string) {
  const { data, error } = await service
    .from('audit_log')
    .select('*')
    .eq('accion', 'alta_cruce')
    .eq('planta_id', plantaId);
  if (error) throw error;
  return data ?? [];
}

describe('alta de cruce auditada (B3)', () => {
  it('el alta como admin (mismo INSERT que crearPlanta) deja una fila alta_cruce con el linaje', async () => {
    const codigo = `ALTA-${R}`;
    const { data: planta, error } = await admin
      .from('plantas')
      .insert({
        codigo_sistema: codigo,
        especie_id: especieId,
        cruzamiento: 'SINT-ALTA x SINT-ALTA',
        mama_id: variedadMamaId,
        papa_id: variedadPapaId,
        es_prueba: true,
      })
      .select('id, codigo_sistema')
      .single();
    expect(error).toBeNull();
    plantasCreadas.push(planta!.id);

    const filas = await auditoriaAlta(planta!.id);
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila.usuario_id).toBe(adminId);
    expect(fila.campos_expuestos).toEqual(['cruzamiento', 'mama_id', 'papa_id']);
    expect(fila.detalle.codigo_sistema).toBe(codigo);
    expect(fila.detalle.especie_id).toBe(especieId);
    expect(fila.detalle.es_prueba).toBe(true);
    expect(fila.detalle.estado).toBe('sin_empezar');
    expect(fila.detalle.nuevo).toEqual({
      mama_id: variedadMamaId,
      papa_id: variedadPapaId,
    });
  });

  it('un alta sin linaje también queda auditada (el detalle simplemente no trae linaje)', async () => {
    const { data: planta, error } = await admin
      .from('plantas')
      .insert({ codigo_sistema: `ALTA-SIN-${R}`, especie_id: especieId, es_prueba: true })
      .select('id')
      .single();
    expect(error).toBeNull();
    plantasCreadas.push(planta!.id);

    const filas = await auditoriaAlta(planta!.id);
    expect(filas).toHaveLength(1);
    expect(filas[0].detalle.nuevo).toEqual({});
  });

  it('un alta administrativa (service_role, como haría un importador) también queda auditada', async () => {
    const { data: planta, error } = await service
      .from('plantas')
      .insert({ codigo_sistema: `ALTA-SVC-${R}`, especie_id: especieId, cruzamiento: 'SINT-SVC', es_prueba: true })
      .select('id')
      .single();
    expect(error).toBeNull();
    plantasCreadas.push(planta!.id);

    const filas = await auditoriaAlta(planta!.id);
    expect(filas).toHaveLength(1);
    expect(filas[0].usuario_id).toBeNull();
    expect(filas[0].detalle.nuevo).toEqual({});
  });

  it('el operario no puede crear cruces ni leer la auditoría del alta', async () => {
    const { error: errInsert } = await operario
      .from('plantas')
      .insert({ codigo_sistema: `ALTA-OP-${R}`, especie_id: especieId, es_prueba: true });
    expect(errInsert).not.toBeNull();

    const { data, error } = await operario.from('audit_log').select('id').eq('accion', 'alta_cruce');
    if (error) expect(error).toBeTruthy();
    else expect(data).toHaveLength(0);
  });
});
