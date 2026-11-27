/**
 * Verificación independiente de A1-G8-01, A1-G8-02, A1-G8-03 y A1-G8-08.
 *
 * - G8-01: el registro público con la clave anon creaba una cuenta operativa.
 *   Mitigado el 22-10-2026 (producción y config.toml con el registro cerrado):
 *   ahora se comprueba que signUp se rechaza y, con una cuenta creada por un
 *   admin, qué alcanza un operario nuevo (lo que decidió la severidad).
 * - G8-02: borrar un perfil (o la cuenta) anonimiza las lecturas de linaje en audit_log.
 * - G8-03: cambiar rol / puede_ver_linaje de un perfil no deja rastro en audit_log.
 * - G8-08: renombrar una variedad reescribe el linaje mostrado de los cruces y no queda rastro.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextoV2, psql } from './v2-comun';

const ctx = new ContextoV2('g8');
let admin: Awaited<ReturnType<ContextoV2['usuario']>>;
let especieId: string;
let cruceId: string;
let variedadMama: string;
let variedadPapa: string;
const cuentasRegistradas: string[] = [];
const inicio = new Date().toISOString();

beforeAll(async () => {
  admin = await ctx.usuario('admin');
  const e = await ctx.service.from('especies').insert({ nombre: `AUD-V2 g8 ${ctx.sufijo}` }).select('id').single();
  if (e.error) throw new Error(e.error.message);
  especieId = e.data.id as string;
  const vm = await ctx.service.from('variedades').insert({ especie_id: especieId, nombre: `AUD-V2 mama ${ctx.sufijo}` }).select('id').single();
  const vp = await ctx.service.from('variedades').insert({ especie_id: especieId, nombre: `AUD-V2 papa ${ctx.sufijo}` }).select('id').single();
  if (vm.error || vp.error) throw new Error('variedades');
  variedadMama = vm.data.id as string;
  variedadPapa = vp.data.id as string;
  const c = await ctx.service.from('plantas').insert({
    codigo_sistema: `AUD-V2-G8-${ctx.sufijo}`, especie_id: especieId, estado: 'sin_empezar', es_prueba: true,
    mama_id: variedadMama, papa_id: variedadPapa,
  }).select('id').single();
  if (c.error) throw new Error(c.error.message);
  cruceId = c.data.id as string;
  // Un individuo propio: la prueba de la cuenta operario cuenta individuos y una base recién reiniciada no trae ninguno.
  const ind = await ctx.service.from('individuos').insert({ planta_id: cruceId, codigo_display: '', created_by: admin.userId });
  if (ind.error) throw new Error(ind.error.message);
}, 90_000);

afterAll(async () => {
  for (const id of cuentasRegistradas) await ctx.service.auth.admin.deleteUser(id);
  psql(`
    delete from individuos where planta_id = '${cruceId}';
    delete from plantas where id = '${cruceId}';
    delete from variedades where especie_id = '${especieId}' or nombre like 'AUD-V2 g8-signup %${ctx.sufijo}';
    delete from especies where id = '${especieId}';
  `);
  const fallos = await ctx.borrarUsuarios();
  expect(fallos).toEqual([]);
}, 90_000);

describe('A1-G8-01 — registro público', () => {
  it('con solo la clave anon ya NO se obtiene una cuenta: el registro público está cerrado (mitigado el 22-10-2026)', async () => {
    const cliente = createClient(ctx.creds.url, ctx.creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await cliente.auth.signUp({ email: `aud-v2-g8-signup0-${ctx.sufijo}@test.local`, password: 'test-password-123' });
    if (data.user?.id) cuentasRegistradas.push(data.user.id);
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });

  it('una cuenta operario nueva (creada por un admin) alcanza lo operativo pero no el linaje', async () => {
    const email = `aud-v2-g8-signup-${ctx.sufijo}@test.local`;
    const alta = await ctx.service.auth.admin.createUser({ email, password: 'test-password-123', email_confirm: true });
    expect(alta.error).toBeNull();
    cuentasRegistradas.push(alta.data.user!.id);
    const cliente = createClient(ctx.creds.url, ctx.creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await cliente.auth.signInWithPassword({ email, password: 'test-password-123' });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();

    const perfil = psql(`select rol, puede_ver_linaje from perfiles where id='${data.user!.id}'`);
    expect(perfil).toBe('operario|f');

    // Alcance de la cuenta: lee datos operativos y escribe en el catálogo...
    const ind = await cliente.from('individuos').select('id', { count: 'exact', head: true });
    expect(ind.error).toBeNull();
    expect(ind.count ?? 0).toBeGreaterThan(0);
    const ev = await cliente.from('evaluaciones').select('id', { count: 'exact', head: true });
    expect(ev.error).toBeNull();
    const plantas = await cliente.from('plantas_operativas').select('id,codigo_sistema').limit(1);
    expect(plantas.error).toBeNull();
    expect((plantas.data ?? []).length).toBe(1);
    const nueva = await cliente.from('variedades').insert({ especie_id: especieId, nombre: `AUD-V2 g8-signup ${ctx.sufijo}`, created_by: data.user!.id }).select('id').single();
    expect(nueva.error).toBeNull();
    // ...pero NO obtiene el linaje (control: la regla central de CLAUDE.md se sostiene).
    const linaje = await cliente.from('plantas').select('mama_id,papa_id,cruzamiento,mama,papa').limit(1);
    expect(linaje.error).not.toBeNull();
    const ficha = await cliente.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(ficha.error).toBeNull();
    expect(JSON.stringify(ficha.data)).not.toContain(`AUD-V2 mama ${ctx.sufijo}`);
  });
});

describe('A1-G8-01 (alcance de escritura de la cuenta registrada)', () => {
  it('una cuenta operario nueva NO cambia la fase de un cruce (U-03) y sí registra una polinización', async () => {
    const email = `aud-v2-g8-signup2-${ctx.sufijo}@test.local`;
    const alta = await ctx.service.auth.admin.createUser({ email, password: 'test-password-123', email_confirm: true });
    expect(alta.error).toBeNull();
    const cliente = createClient(ctx.creds.url, ctx.creds.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await cliente.auth.signInWithPassword({ email, password: 'test-password-123' });
    expect(error).toBeNull();
    cuentasRegistradas.push(data.user!.id);
    const up =await cliente.from('plantas').update({ estado: 'polinizacion' }).eq('id', cruceId).select('estado');
    expect(up.error?.code).toBe('42501'); // U-03: solo un admin cambia la fase
    psql(`update plantas set estado='polinizacion' where id='${cruceId}'`);
    const pol = await cliente.from('polinizacion_evento').insert({ planta_id: cruceId, fecha: '2026-03-01', n_flores_cruzadas: 5, created_by: data.user!.id }).select('id');
    expect(pol.error).toBeNull();
    psql(`delete from polinizacion_evento where planta_id='${cruceId}'`);
  });
});

describe('A1-G8-02 — borrar un perfil anonimiza audit_log', () => {
  it('A1-003 rechaza DELETE del admin; la baja privilegiada conserva identidad de lecturas (A1-008)', async () => {
    const lector = await ctx.usuario('operario', 'lector1');
    const lectura = await lector.client.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(lectura.error).toBeNull();
    const antes = psql(`select count(*) from audit_log where usuario_id='${lector.userId}' and planta_id='${cruceId}'`);
    expect(Number(antes)).toBeGreaterThan(0);

    const del = await admin.client.from('perfiles').delete().eq('id', lector.userId).select('id');
    expect(del.error?.code).toBe('42501');
    expect(del.data).toBeNull();
    const baja = await ctx.service.from('perfiles').delete().eq('id', lector.userId);
    expect(baja.error).toBeNull();

    const despues = psql(`select count(*) from audit_log where usuario_id='${lector.userId}'`);
    expect(despues).toBe('0');
    const conservadas = psql(`select count(*) from audit_log where planta_id='${cruceId}' and usuario_id is null and accion like 'lectura%' and detalle->'usuario_eliminado'->>'id'='${lector.userId}' and detalle->'usuario_eliminado'->>'correo'='${lector.email}' and detalle->'usuario_eliminado'->>'nombre'='${lector.email}'`);
    expect(Number(conservadas)).toBe(Number(antes));
  });

  it('lo mismo al borrar la cuenta en Auth (cascada auth.users -> perfiles -> audit_log)', async () => {
    const lector = await ctx.usuario('operario', 'lector2');
    await lector.client.rpc('obtener_planta', { p_planta_id: cruceId });
    const antes = Number(psql(`select count(*) from audit_log where planta_id='${cruceId}' and usuario_id is null and accion like 'lectura%'`));
    const { error } = await ctx.service.auth.admin.deleteUser(lector.userId);
    expect(error).toBeNull();
    ctx.usuarios.splice(ctx.usuarios.indexOf(lector.userId), 1); // la baja ya es parte del caso probado
    const despues = Number(psql(`select count(*) from audit_log where planta_id='${cruceId}' and usuario_id is null and accion like 'lectura%'`));
    expect(despues).toBe(antes + 1);
    const identidad = psql(`select detalle->'usuario_eliminado' from audit_log where planta_id='${cruceId}' and accion like 'lectura%' and detalle->'usuario_eliminado'->>'id'='${lector.userId}'`);
    expect(JSON.parse(identidad)).toEqual({ id: lector.userId, correo: lector.email, nombre: lector.email });
    expect(psql(`select confdeltype from pg_constraint where conrelid='public.audit_log'::regclass and contype='f' and conkey = (select array_agg(attnum) from pg_attribute where attrelid='public.audit_log'::regclass and attname='usuario_id')`)).toBe('n');
  });
});

describe('A1-G8-03 — cambios de rol y permiso auditados', () => {
  it('admin asciende a un operario y le da linaje: queda autor y valores anteriores/nuevos', async () => {
    const objetivo = await ctx.usuario('operario', 'objetivo');
    // Control: audit_log sí registra una lectura hecha por el admin en este mismo lapso.
    await admin.client.rpc('obtener_planta', { p_planta_id: cruceId });
    const control = psql(`select count(*) from audit_log where usuario_id='${admin.userId}' and ocurrido_en >= '${inicio}'`);
    expect(Number(control)).toBeGreaterThan(0);

    const marca = new Date().toISOString();
    const upd = await admin.client.from('perfiles').update({ rol: 'admin', puede_ver_linaje: true }).eq('id', objetivo.userId).select('rol,puede_ver_linaje').single();
    expect(upd.error).toBeNull();
    expect(upd.data).toEqual({ rol: 'admin', puede_ver_linaje: true });

    // Solo filas de este admin o de este perfil: audit_log es global y cualquier otro proceso que cambie
    // un perfil en el mismo lapso (otra corrida contra la misma base) sumaba filas ajenas («2 en vez de 1»).
    const rastro = psql(`
      select count(*) from audit_log
      where ocurrido_en >= '${marca}'
        and (usuario_id in ('${admin.userId}', '${objetivo.userId}') or detalle::text ilike '%${objetivo.userId}%')
        and (accion ilike '%perfil%' or accion ilike '%rol%' or detalle::text ilike '%${objetivo.userId}%' or usuario_id = '${objetivo.userId}')`);
    expect(rastro).toBe('1');
    const cambio = await ctx.service.from('audit_log').select('usuario_id, detalle').eq('accion', 'cambio_perfil')
      .eq('detalle->>perfil_id', objetivo.userId).gte('ocurrido_en', marca).single();
    expect(cambio.error).toBeNull();
    expect(cambio.data!.usuario_id).toBe(admin.userId);
    expect(cambio.data!.detalle.anterior).toMatchObject({ rol: 'operario', puede_ver_linaje: false });
    expect(cambio.data!.detalle.nuevo).toMatchObject({ rol: 'admin', puede_ver_linaje: true });
    // Guardias existentes y auditoría/colector de identidad de la corrida.
    expect(psql(`select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid='public.perfiles'::regclass and not tgisinternal`))
      .toBe('perfiles_auditar_cambios,perfiles_conservar_identidad_baja,trg_perfiles_anti_autoascenso,trg_perfiles_updated_at');
  });
});

describe('A1-G8-08 — renombrar una variedad conserva el rastro', () => {
  it('el nombre mostrado cambia sin tocar mama_id y queda auditoría del catálogo', async () => {
    const adminLinaje = await ctx.usuario('admin', 'linaje', true);
    const leer = async () => {
      const { data, error } = await adminLinaje.client.rpc('obtener_planta', { p_planta_id: cruceId });
      expect(error).toBeNull();
      return data as Record<string, unknown>;
    };
    const antes = await leer();
    expect(JSON.stringify(antes)).toContain(`AUD-V2 mama ${ctx.sufijo}`);
    const mamaIdAntes = psql(`select mama_id from plantas where id='${cruceId}'`);

    const marca = new Date().toISOString();
    const upd = await adminLinaje.client.from('variedades').update({ nombre: `AUD-V2 renombrada ${ctx.sufijo}` }).eq('id', variedadMama).select('id');
    expect(upd.error).toBeNull();
    expect(upd.data).toHaveLength(1);

    const despues = await leer();
    expect(JSON.stringify(despues)).toContain(`AUD-V2 renombrada ${ctx.sufijo}`);
    expect(JSON.stringify(despues)).not.toContain(`AUD-V2 mama ${ctx.sufijo}`);
    expect(psql(`select mama_id from plantas where id='${cruceId}'`)).toBe(mamaIdAntes);

    // Las lecturas se registran por cruce; el cambio de catálogo por entidad.
    const acciones = psql(`select coalesce(string_agg(distinct accion, ','), '') from audit_log where ocurrido_en >= '${marca}' and detalle::text not like '%nonexistent%' and planta_id='${cruceId}'`);
    expect(acciones).toBe('lectura_linaje');
    const filasVariedad = psql(`select count(*) from audit_log where ocurrido_en >= '${marca}' and (detalle::text ilike '%${variedadMama}%' or accion ilike '%variedad%')`);
    expect(filasVariedad).toBe('1');
    const cambio = await ctx.service.from('audit_log').select('usuario_id, detalle').eq('accion', 'cambio_variedad')
      .eq('detalle->>entidad_id', variedadMama).gte('ocurrido_en', marca).single();
    expect(cambio.error).toBeNull();
    expect(cambio.data!.usuario_id).toBe(adminLinaje.userId);
    expect(cambio.data!.detalle).toMatchObject({ nombre_anterior: `AUD-V2 mama ${ctx.sufijo}`,
      nombre_nuevo: `AUD-V2 renombrada ${ctx.sufijo}`, cruces_afectados: 1 });
  });
});
