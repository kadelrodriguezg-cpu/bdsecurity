/**
 * Verificación independiente de A1-G1-17 (parte de base de datos): la base acepta
 * un cruce sin mamá ni papá, así que no hay segunda línea de defensa cuando el
 * combobox deja el id en nulo. La parte de interfaz está en
 * frontend/src/features/plantas/SelectorVariedad.verificacion-v1.test.tsx.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contexto, especieArandano, usuario, type Contexto } from './v1-helpers';

let ctx: Contexto;
let especie: string;
let admin: Awaited<ReturnType<typeof usuario>>;
const plantas: string[] = [];

beforeAll(async () => {
  ctx = contexto();
  especie = await especieArandano(ctx);
  admin = await usuario(ctx, 'g117', 'admin');
}, 60_000);

afterAll(async () => {
  await ctx.service.from('plantas').delete().in('id', plantas);
});

describe('A1-G1-17 la base no exige progenitores', () => {
  it('el admin crea por la API (como NuevaPlantaPage con mamaId/papaId undefined) un cruce activo sin mamá ni papá', async () => {
    const { data, error } = await admin.client
      .from('plantas')
      .insert({ codigo_sistema: `AUD-V1-${ctx.R}-L17`, especie_id: especie, es_prueba: true, cruzamiento: 'AUD-V1 sin padres', mama_id: undefined, papa_id: undefined })
      .select('id')
      .single();
    expect(error).toBeNull();
    plantas.push(data!.id);
    const { data: fila } = await ctx.service.from('plantas').select('mama_id, papa_id, eliminado_at').eq('id', data!.id).single();
    expect(fila).toMatchObject({ mama_id: null, papa_id: null, eliminado_at: null });
  });
});
