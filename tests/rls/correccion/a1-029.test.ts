import { afterAll, beforeAll, expect, it } from 'vitest';
import { contexto, usuario, type Contexto } from '../auditoria/verificacion/v1-helpers';
import { psql } from '../auditoria/g4-helpers';
let ctx: Contexto;
let admin: Awaited<ReturnType<typeof usuario>>;
let op: Awaited<ReturnType<typeof usuario>>;
let especie: string;
let planta: string;
let sesion: string;
let insumo: string;
let sustrato: string;
beforeAll(async () => {
  ctx = contexto(); admin = await usuario(ctx, 'fix029admin', 'admin'); op = await usuario(ctx, 'fix029op', 'operario');
  const e = await ctx.service.from('especies').insert({ nombre: `FIX029-${ctx.R}` }).select('id').single();
  expect(e.error).toBeNull(); especie = e.data!.id;
  const p = await ctx.service.from('plantas').insert({ especie_id: especie, codigo_sistema: `FIX029-${ctx.R}`, estado: 'cosecha', es_prueba: true }).select('id').single();
  expect(p.error).toBeNull(); planta = p.data!.id;
  const s = await ctx.service.from('polinizacion_evento').insert({ planta_id: planta, fecha: '2026-10-01', n_flores_cruzadas: 5, created_by: op.id }).select('id').single();
  expect(s.error).toBeNull(); sesion = s.data!.id;
  const i = await ctx.service.from('insumo').insert({ nombre: `FIX029-${ctx.R}`, tipo: 'otro' }).select('id').single();
  expect(i.error).toBeNull(); insumo = i.data!.id;
  const su = await ctx.service.from('sustrato').insert({ nombre: `FIX029-${ctx.R}` }).select('id').single();
  expect(su.error).toBeNull(); sustrato = su.data!.id;
  expect((await ctx.service.from('registros_evento').insert({ planta_id: planta, tipo_evento: 'cosecha', fecha: '2026-10-01', datos: {}, created_by: op.id })).error).toBeNull();
  expect((await admin.client.rpc('borrar_cruzamiento', { p_planta_id: planta, p_tipo: 'soft' })).error).toBeNull();
});
afterAll(async () => {
  expect((await admin.client.rpc('borrar_cruzamiento', { p_planta_id: planta, p_tipo: 'hard' })).error).toBeNull();
  expect((await ctx.service.from('insumo').delete().eq('id', insumo)).error).toBeNull();
  expect((await ctx.service.from('sustrato').delete().eq('id', sustrato)).error).toBeNull();
  expect((await ctx.service.from('especies').delete().eq('id', especie)).error).toBeNull();
  for (const u of [op, admin]) expect((await ctx.service.auth.admin.deleteUser(u.id)).error).toBeNull();
});
it('la ficha archivada rechaza columnas y estado para operario y admin', async () => {
  for (const client of [op.client, admin.client]) {
    expect((await client.from('plantas').update({ estado: 'siembra_semilla' }).eq('id', planta)).error?.code).toBe('55000');
    expect((await client.from('plantas').update({ n_semillas: 10 }).eq('id', planta)).error?.code).toBe('55000');
  }
});
it('capturas nuevas y RPC de siembra/cosecha respetan archivado sin abrir una excepción DEFINER', async () => {
  for (const client of [op.client, admin.client]) {
    for (const [tabla, fila] of [
      ['polinizacion_evento', { planta_id: planta, fecha: '2026-10-02', n_flores_cruzadas: 3, created_by: op.id }],
      ['cosecha_fruto', { planta_id: planta, numero_fruto: 0, cantidad_semillas: 1, created_by: op.id }],
      ['germinacion_evento', { planta_id: planta, fecha: '2026-10-02', cantidad_nueva: 1, created_by: op.id }],
      ['plantas_insumo', { planta_id: planta, insumo_id: insumo }],
      ['plantas_sustrato', { planta_id: planta, sustrato_id: sustrato, porcentaje: 100 }],
      ['registros_evento', { planta_id: planta, fecha: '2026-10-02', tipo_evento: 'cosecha', datos: {}, created_by: op.id }],
    ] as const) expect((await client.from(tabla).insert(fila)).error?.code).toBe('55000');
    expect((await client.rpc('guardar_siembra', { p_planta_id: planta, p_cambios: { semillas_sembradas: 1 }, p_insumo_ids: [], p_sustratos: [], p_nota: '', p_fecha: '2026-10-02' })).error?.code).toBe('55000');
    expect((await client.rpc('guardar_cosecha', { p_planta_id: planta, p_cambios: { n_semillas: 1 }, p_fecha_historial: '2026-10-02' })).error?.code).toBe('55000');
  }
});
it('una captura archivada no se puede quitar desde una pestaña vieja, tampoco por admin directo', async () => {
  for (const client of [op.client, admin.client]) {
    expect((await client.from('polinizacion_evento').delete().eq('id', sesion)).error?.code).toBe('55000');
  }
  const fila = await ctx.service.from('polinizacion_evento').select('id').eq('id', sesion);
  expect(fila.error).toBeNull(); expect(fila.data).toHaveLength(1);
});
it('borrar perfil conserva el SET NULL de autoría archivada; ensayo transaccional reversible', async () => {
  const r = await psql(`BEGIN;
    SELECT set_config('request.jwt.claim.sub','${admin.id}',true);
    DELETE FROM public.perfiles WHERE id='${op.id}';
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM public.polinizacion_evento WHERE id='${sesion}' AND created_by IS NOT NULL) THEN RAISE EXCEPTION 'No se limpio autor'; END IF;
      BEGIN
        UPDATE public.plantas SET eliminado_at=NULL,n_semillas=10 WHERE id='${planta}';
        RAISE EXCEPTION 'Se combino restauracion y edicion';
      EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'GUARD029_RESTORE_OK'; END;
      RAISE NOTICE 'CHECK029_OK';
    END $$; ROLLBACK;`);
  expect(r.salida).not.toContain('ERROR:'); expect(r.salida).toContain('CHECK029_OK');
  expect(r.salida).toContain('GUARD029_RESTORE_OK');
  expect((await ctx.service.from('perfiles').select('id').eq('id', op.id)).data).toHaveLength(1);
});
it('la purga autorizada funciona sobre archivados y retira su contexto; un operario no lo puede falsificar', async () => {
  const r = await psql(`BEGIN;
    SELECT set_config('request.jwt.claim.sub','${admin.id}',true);
    SELECT set_config('bdsecurity.purga_cruce','sentinela',true);
    SELECT public.borrar_cruzamiento('${planta}','hard');
    DO $$ BEGIN
      IF current_setting('bdsecurity.purga_cruce',true) <> 'sentinela' THEN RAISE EXCEPTION 'Contexto filtrado'; END IF;
      IF EXISTS(SELECT 1 FROM public.plantas WHERE id='${planta}') THEN RAISE EXCEPTION 'No se purgo'; END IF;
      RAISE NOTICE 'CHECK029_PURGA_OK';
    END $$; ROLLBACK;
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','${op.id}',true);
    SELECT set_config('bdsecurity.purga_cruce','${planta}',true);
    DO $$ BEGIN
      BEGIN
        DELETE FROM public.polinizacion_evento WHERE id='${sesion}';
        RAISE EXCEPTION 'Operario falsifico contexto';
      EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'CHECK029_FORJA_DENEGADA'; END;
    END $$; ROLLBACK;`);
  expect(r.salida).not.toContain('ERROR:'); expect(r.salida).toContain('CHECK029_PURGA_OK');
  expect(r.salida).toContain('CHECK029_FORJA_DENEGADA');
});
it('solo restaurar primero permite continuar capturando', async () => {
  expect((await admin.client.from('plantas').update({ eliminado_at: null, n_semillas: 10 }).eq('id', planta)).error?.code).toBe('42501');
  expect((await admin.client.rpc('restaurar_cruzamiento', { p_planta_id: planta })).error).toBeNull();
  expect((await op.client.from('cosecha_fruto').insert({ planta_id: planta, numero_fruto: 0, cantidad_semillas: 2, created_by: op.id })).error).toBeNull();
});
