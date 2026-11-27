/**
 * Auditoría integral, Corrida 1, grupo G8: T01 (login, sesión, rutas),
 * T02 (mi perfil) y T03 (administración de usuarios).
 *
 * No repite lo que ya cubre tests/rls/rls.test.ts (operario no se asciende, no
 * se concede linaje, no borra su perfil, handle_new_user con signup). Busca lo
 * que falta: qué alcanza una cuenta de registro abierto, validación de
 * `perfiles.nombre`, cambio de contraseña, efecto inmediato de rol/permiso,
 * trazabilidad de los cambios de rol, y qué pasa al borrar un perfil.
 *
 * Las pruebas `it.fails` demuestran un hallazgo: se escriben con lo que
 * DEBERÍA pasar y quedan en verde mientras el bug exista (si el bug se corrige,
 * la prueba pasa a rojo y hay que quitarle el `.fails`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { destinoInterno, destinoLogin } from '../../../frontend/src/lib/destinoInterno';
import { ContextoG8, PASSWORD_G8, clienteSinSesion, type UsuarioG8 } from './g8-setup';

const ctx = new ContextoG8();
const { service } = ctx;

let admin: UsuarioG8;
let operario: UsuarioG8;
let especieId: string;
let cruceId: string;
let mamaId: string;
let papaId: string;
let individuoId: string;
let rondaId: string;
let snapshotId: string;

beforeAll(async () => {
  admin = await ctx.usuario('ses-admin', 'admin');
  operario = await ctx.usuario('ses-operario', 'operario');
  especieId = await ctx.especie('sesion');
  mamaId = await ctx.variedad(especieId, `AUD-G8 Madre ${ctx.sufijo}`);
  papaId = await ctx.variedad(especieId, `AUD-G8 Padre ${ctx.sufijo}`);
  cruceId = await ctx.cruce('SES', especieId, {
    mama_id: mamaId,
    papa_id: papaId,
    cruzamiento: `AUD-G8 Madre x AUD-G8 Padre ${ctx.sufijo}`,
    mama: 'AUD-G8 Madre',
    papa: 'AUD-G8 Padre',
  });

  // Datos propios para «una cuenta operario recién creada alcanza todo lo operativo»: esa prueba cuenta
  // filas de evaluaciones y de ranking_snapshot, que una base recién reiniciada no trae.
  const ind = await service
    .from('individuos')
    .insert({ planta_id: cruceId, codigo_display: '', created_by: admin.userId })
    .select('id')
    .single();
  if (ind.error || !ind.data) throw new Error(`setup individuo: ${ind.error?.message}`);
  individuoId = ind.data.id as string;
  const ronda = await service
    .from('ronda_evaluacion_anual')
    .insert({ individuo_id: individuoId, tipo_ronda: 'anual', numero_ronda: 1, anio: 2026, fecha_inicio: '2026-01-15', created_by: admin.userId })
    .select('id')
    .single();
  if (ronda.error || !ronda.data) throw new Error(`setup ronda: ${ronda.error?.message}`);
  rondaId = ronda.data.id as string;
  const evaluacion = await service
    .from('evaluaciones')
    .insert({ ronda_id: rondaId, fecha: '2026-10-01', created_by: admin.userId, estado: 'borrador' });
  if (evaluacion.error) throw new Error(`setup evaluación: ${evaluacion.error.message}`);
  const version = await service.from('scoring_version').select('id').eq('estado', 'activa').limit(1).single();
  if (version.error || !version.data) throw new Error(`setup versión de scoring: ${version.error?.message}`);
  const snapshot = await service
    .from('ranking_snapshot')
    .insert({
      nombre: `AUD-G8 snapshot ${ctx.sufijo}`, alcance: 'cruzamiento', scoring_version_id: version.data.id, especie_id: especieId,
      planta_id: cruceId, poblacion_comparada: 1, criterios: {}, created_by: admin.userId,
    })
    .select('id')
    .single();
  if (snapshot.error || !snapshot.data) throw new Error(`setup snapshot: ${snapshot.error?.message}`);
  snapshotId = snapshot.data.id as string;
});

afterAll(async () => {
  // Lo que cuelga del cruce por claves RESTRICT, antes de que ctx.limpiar() borre individuos y cruce.
  await service.from('ranking_snapshot').delete().eq('id', snapshotId);
  await service.from('evaluaciones').delete().eq('ronda_id', rondaId);
  await service.from('ronda_evaluacion_anual').delete().eq('id', rondaId);
  await ctx.limpiar();
});

async function auditoriaDe(usuarioId: string, accion: string, plantaId = cruceId) {
  const { data, error } = await service
    .from('audit_log')
    .select('id, usuario_id, accion, campos_expuestos')
    .eq('usuario_id', usuarioId)
    .eq('planta_id', plantaId)
    .eq('accion', accion)
    .order('id', { ascending: false });
  expect(error).toBeNull();
  return data ?? [];
}

// ───────────────────────────── T01 ─────────────────────────────
describe('T01 login, sesión y rutas', () => {
  it('una cuenta nueva nace como perfil operario sin linaje y no hereda rol de los metadatos', async () => {
    // Las cuentas las crea un admin (API admin); los metadatos privilegiados no deben escalar.
    const email = `aud-g8-alta-${ctx.sufijo}@test.local`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: 'Aud-g8-signup-1',
      email_confirm: true,
      user_metadata: { nombre: 'AUD G8 signup', rol: 'admin', puede_ver_linaje: true, role: 'service_role' },
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBeTruthy();
    ctx.registrarUsuario(data.user!.id);

    const { data: perfil } = await service
      .from('perfiles')
      .select('rol, puede_ver_linaje, nombre')
      .eq('id', data.user!.id)
      .single();
    expect(perfil).toMatchObject({ rol: 'operario', puede_ver_linaje: false, nombre: 'AUD G8 signup' });

    // La cuenta creada por el admin puede iniciar sesión con la clave anon.
    const cliente = clienteSinSesion(ctx.creds);
    const login = await cliente.auth.signInWithPassword({ email, password: 'Aud-g8-signup-1' });
    expect(login.error).toBeNull();
    expect(login.data.session).not.toBeNull();
  });

  it('una cuenta operario recién creada alcanza todo lo operativo pero no el linaje', async () => {
    const email = `aud-g8-alta2-${ctx.sufijo}@test.local`;
    const alta = await service.auth.admin.createUser({ email, password: 'Aud-g8-signup-2', email_confirm: true });
    expect(alta.error).toBeNull();
    ctx.registrarUsuario(alta.data.user!.id);
    const cliente = clienteSinSesion(ctx.creds);
    const { data, error } = await cliente.auth.signInWithPassword({ email, password: 'Aud-g8-signup-2' });
    expect(error).toBeNull();

    for (const tabla of ['plantas_operativas', 'individuos', 'evaluaciones', 'especies', 'variedades', 'ranking_snapshot']) {
      const r = await cliente.from(tabla).select('*', { count: 'exact', head: true });
      expect(r.error, tabla).toBeNull();
      expect(r.count, tabla).toBeGreaterThan(0);
    }
    // Perfiles: solo el propio. Auditoría: nada.
    const perfiles = await cliente.from('perfiles').select('id');
    expect(perfiles.data).toHaveLength(1);
    const audit = await cliente.from('audit_log').select('id', { count: 'exact', head: true });
    expect(audit.count).toBe(0);

    // Linaje: ni por columna ni por la RPC.
    const directo = await cliente.from('plantas').select('mama_id').limit(1);
    expect(directo.error?.code).toBe('42501');
    const ficha = await cliente.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(ficha.error).toBeNull();
    expect(ficha.data).not.toHaveProperty('mama_id');
    expect(ficha.data).not.toHaveProperty('cruzamiento');
    expect((await auditoriaDe(data.user!.id, 'lectura_ficha')).length).toBe(1);

    // Escritura operativa abierta a cualquier cuenta: puede crear variedades (T05).
    const v = await cliente.from('variedades')
      .insert({ especie_id: especieId, nombre: `AUD-G8 signup ${ctx.sufijo}`, created_by: data.user!.id })
      .select('id')
      .single();
    expect(v.error).toBeNull();
    await service.from('variedades').delete().eq('id', v.data!.id);
  });

  // A1-G8-01, mitigado el 22-10-2026: registro público cerrado en producción y en
  // supabase/config.toml (enable_signup = false). Si vuelve a abrirse, esta prueba falla.
  it('A1-G8-01: el registro público está cerrado (las cuentas las crea un admin)', async () => {
    const cliente = clienteSinSesion(ctx.creds);
    const { data, error } = await cliente.auth.signUp({
      email: `aud-g8-signup3-${ctx.sufijo}@test.local`,
      password: 'Aud-g8-signup-3',
    });
    if (data.user) ctx.registrarUsuario(data.user.id);
    expect(error).not.toBeNull();
  });

  it('destinoInterno rechaza redirecciones externas, con barras codificadas y bucles hacia /login', () => {
    const rechazados = [
      '//evil.com', '/\\evil.com', '/%2f%2fevil.com', '/%5cevil.com', '/..//evil.com', '/\t/evil.com',
      'javascript:alert(1)', 'https://evil.com', '/login', '/LOGIN', '/login/', '/login%2f', '/%6cogin',
      '/%256cogin', '/%252f%252fevil.com', '/..\\evil.com', '', null, undefined, 42,
    ];
    for (const valor of rechazados) expect(destinoInterno(valor), String(valor)).toBe('/');
    expect(destinoInterno('/planta/123?x=1#y')).toBe('/planta/123?x=1#y');
    expect(destinoLogin('//evil.com')).toBe('/login?next=%2F');
  });

  it('cerrar sesión revoca los refresh tokens de TODOS los dispositivos; el access token vive hasta vencer', async () => {
    const u = await ctx.usuario('ses-global', 'operario');
    const otro = clienteSinSesion(ctx.creds);
    await otro.auth.signInWithPassword({ email: u.email, password: PASSWORD_G8 });
    const { data: s2 } = await otro.auth.getSession();

    await u.client.auth.signOut(); // alcance global por defecto

    const refresco = await clienteSinSesion(ctx.creds).auth.refreshSession({ refresh_token: s2.session!.refresh_token });
    expect(refresco.error).not.toBeNull();
    // El JWT ya emitido sigue aceptado por PostgREST hasta su vencimiento (jwt_exp = 3600 s en local).
    const sigue = await otro.from('perfiles').select('id').eq('id', u.userId);
    expect(sigue.data).toHaveLength(1);
  });

  it('el cambio de contraseña revoca las otras sesiones y deja inservible la contraseña anterior', async () => {
    const u = await ctx.usuario('ses-pwd', 'operario');
    const otro = clienteSinSesion(ctx.creds);
    await otro.auth.signInWithPassword({ email: u.email, password: PASSWORD_G8 });
    const { data: s2 } = await otro.auth.getSession();

    const { error } = await u.client.auth.updateUser({ password: 'otra-clave-segura-1' });
    expect(error).toBeNull();

    const refresco = await clienteSinSesion(ctx.creds).auth.refreshSession({ refresh_token: s2.session!.refresh_token });
    expect(refresco.error).not.toBeNull();
    const viejo = await clienteSinSesion(ctx.creds).auth.signInWithPassword({ email: u.email, password: PASSWORD_G8 });
    expect(viejo.error).not.toBeNull();
    const nuevo = await clienteSinSesion(ctx.creds).auth.signInWithPassword({ email: u.email, password: 'otra-clave-segura-1' });
    expect(nuevo.error).toBeNull();
  });

  it('la CSP de vercel.json bloquea scripts externos, frames, objetos y base-uri ajenos', () => {
    const raiz = resolve(__dirname, '../../../frontend/vercel.json');
    const config = JSON.parse(readFileSync(raiz, 'utf8')) as {
      headers: { headers: { key: string; value: string }[] }[];
    };
    const cabeceras = Object.fromEntries(config.headers[0].headers.map((h) => [h.key, h.value]));
    const csp = cabeceras['Content-Security-Policy'];
    expect(csp).toBeTruthy();
    const directiva = (nombre: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${nombre} `)) ?? '';
    expect(directiva('script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(directiva('object-src')).toBe("object-src 'none'");
    expect(directiva('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directiva('base-uri')).toBe("base-uri 'self'");
    expect(directiva('form-action')).toBe("form-action 'self'");
    expect(directiva('connect-src')).not.toContain('*.sentry.io'); // ver informe: Sentry quedaría bloqueado si se activa
    expect(cabeceras['X-Frame-Options']).toBe('DENY');
    expect(cabeceras['X-Content-Type-Options']).toBe('nosniff');
    expect(cabeceras['Strict-Transport-Security']).toContain('max-age=');
  });
});

// ───────────────────────────── T02 ─────────────────────────────
describe('T02 mi perfil', () => {
  it('un operario no puede cambiar rol, puede_ver_linaje ni id, ni insertar perfiles, ni borrar el suyo', async () => {
    const u = await ctx.usuario('per-op', 'operario');
    const rol = await u.client.from('perfiles').update({ rol: 'admin' }).eq('id', u.userId);
    expect(rol.error?.code).toBe('42501');
    const linaje = await u.client.from('perfiles').update({ puede_ver_linaje: true }).eq('id', u.userId);
    expect(linaje.error?.code).toBe('42501');
    const id = await u.client.from('perfiles')
      .update({ id: '00000000-0000-0000-0000-0000000000a1' }).eq('id', u.userId).select('id');
    expect(id.error?.code).toBe('42501');
    const ins = await u.client.from('perfiles')
      .insert({ id: '00000000-0000-0000-0000-0000000000a2', nombre: 'fantasma' });
    expect(ins.error?.code).toBe('42501');
    const insPropio = await u.client.from('perfiles').insert({ id: u.userId, nombre: 'otra vez', rol: 'admin' });
    expect(insPropio.error?.code).toBe('42501');
    const del = await u.client.from('perfiles').delete().eq('id', u.userId).select('id');
    expect(del.data ?? []).toHaveLength(0);

    const { data } = await service.from('perfiles').select('rol, puede_ver_linaje').eq('id', u.userId).single();
    expect(data).toMatchObject({ rol: 'operario', puede_ver_linaje: false });
  });

  it('un operario cambia su nombre y un update que repite rol y permiso no dispara el bloqueo', async () => {
    const u = await ctx.usuario('per-nombre', 'operario');
    const r = await u.client.from('perfiles')
      .update({ nombre: 'Nombre válido', rol: 'operario', puede_ver_linaje: false })
      .eq('id', u.userId)
      .select('nombre');
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ nombre: 'Nombre válido' }]);
  });

  it('un operario no puede cambiar el nombre de otro usuario (0 filas) y un admin sí puede', async () => {
    const otro = await ctx.usuario('per-ajeno', 'operario');
    const r = await operario.client.from('perfiles').update({ nombre: 'Suplantado' }).eq('id', otro.userId).select('id');
    expect(r.data ?? []).toHaveLength(0);
    const { data } = await service.from('perfiles').select('nombre').eq('id', otro.userId).single();
    expect(data!.nombre).toBe(otro.email);
    const admin1 = await admin.client.from('perfiles').update({ nombre: 'Renombrado por admin' }).eq('id', otro.userId).select('nombre');
    expect(admin1.data).toEqual([{ nombre: 'Renombrado por admin' }]);
  });

  // A1-G8-06. La pantalla valida 2–80 caracteres; la base no valida nada.
  it.fails('A1-G8-06: la base debería rechazar un nombre vacío', async () => {
    const u = await ctx.usuario('per-vacio', 'operario');
    const r = await u.client.from('perfiles').update({ nombre: '' }).eq('id', u.userId).select('nombre');
    expect(r.error).not.toBeNull();
  });

  it.fails('A1-G8-06: la base debería rechazar un nombre de 10 000 caracteres (la pantalla permite 80)', async () => {
    const u = await ctx.usuario('per-largo', 'operario');
    const r = await u.client.from('perfiles').update({ nombre: 'N'.repeat(10_000) }).eq('id', u.userId).select('nombre');
    expect(r.error).not.toBeNull();
  });

  // A1-G8-07. updateUser({password}) solo exige la sesión; no pide la contraseña actual.
  it.fails('A1-G8-07: cambiar la contraseña debería exigir reautenticación (contraseña actual o nonce)', async () => {
    const u = await ctx.usuario('per-reauth', 'operario');
    const { error } = await u.client.auth.updateUser({ password: 'clave-nueva-segura-9' });
    expect(error).not.toBeNull();
  });

  it.fails('A1-G8-07: el servidor debería exigir al menos 8 caracteres (la pantalla lo exige, la API acepta 6)', async () => {
    const u = await ctx.usuario('per-minpwd', 'operario');
    const { error } = await u.client.auth.updateUser({ password: 'abc123' });
    expect(error).not.toBeNull();
  });
});

// ───────────────────────────── T03 ─────────────────────────────
describe('T03 administración de usuarios', () => {
  it('un operario ve solo su perfil; un admin los ve todos', async () => {
    const propios = await operario.client.from('perfiles').select('id');
    expect(propios.data).toEqual([{ id: operario.userId }]);
    // Acotado por id: la base local acumula miles de perfiles de pruebas y PostgREST corta en 1000 filas.
    const todos = await admin.client.from('perfiles').select('id').in('id', [admin.userId, operario.userId]);
    expect(todos.data!.map((p) => p.id).sort()).toEqual([admin.userId, operario.userId].sort());
  });

  it('conceder y quitar puede_ver_linaje tiene efecto inmediato y la lectura queda auditada con el usuario correcto', async () => {
    const objetivo = await ctx.usuario('usr-linaje', 'operario');
    const testigo = await ctx.usuario('usr-testigo', 'operario');

    const antes = await objetivo.client.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(antes.error).toBeNull();
    expect(antes.data).not.toHaveProperty('mama_id');

    const concede = await admin.client.from('perfiles')
      .update({ puede_ver_linaje: true }).eq('id', objetivo.userId).select('puede_ver_linaje');
    expect(concede.error).toBeNull();
    expect(concede.data).toEqual([{ puede_ver_linaje: true }]);

    const con = await objetivo.client.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(con.error).toBeNull();
    expect(con.data).toMatchObject({ mama_id: mamaId, papa_id: papaId });
    expect(con.data.mama_nombre).toBe(`AUD-G8 Madre ${ctx.sufijo}`);
    const lecturas = await auditoriaDe(objetivo.userId, 'lectura_linaje');
    expect(lecturas).toHaveLength(1);
    expect(lecturas[0].campos_expuestos).toEqual(expect.arrayContaining(['cruzamiento', 'mama_id', 'papa_id']));

    // Quien no recibió el permiso sigue sin linaje.
    const sin = await testigo.client.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(sin.data).not.toHaveProperty('mama_id');
    expect(await auditoriaDe(testigo.userId, 'lectura_linaje')).toHaveLength(0);

    const quita = await admin.client.from('perfiles')
      .update({ puede_ver_linaje: false }).eq('id', objetivo.userId).select('puede_ver_linaje');
    expect(quita.data).toEqual([{ puede_ver_linaje: false }]);
    const despues = await objetivo.client.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(despues.data).not.toHaveProperty('mama_id');
    expect(await auditoriaDe(objetivo.userId, 'lectura_linaje')).toHaveLength(1);
    // La columna sigue cerrada aunque tenga el permiso.
    await admin.client.from('perfiles').update({ puede_ver_linaje: true }).eq('id', objetivo.userId);
    const directo = await objetivo.client.from('plantas').select('mama_id').eq('id', cruceId);
    expect(directo.error?.code).toBe('42501');
  });

  it('el cambio de rol rige al instante en el servidor y un admin degradado no puede volver a ascenderse', async () => {
    const u = await ctx.usuario('usr-rol', 'operario');
    expect((await u.client.from('perfiles').select('id')).data).toHaveLength(1);

    expect((await u.client.rpc('obtener_planta', { p_planta_id: cruceId })).data).not.toHaveProperty('mama_id');

    const sube = await admin.client.from('perfiles').update({ rol: 'admin' }).eq('id', u.userId).select('rol');
    expect(sube.data).toEqual([{ rol: 'admin' }]);
    expect((await u.client.from('perfiles').select('id')).data!.length).toBeGreaterThan(1);
    // Mismo token de sesión: el rol no viaja en el JWT, se lee de perfiles en cada llamada.
    expect((await u.client.rpc('obtener_planta', { p_planta_id: cruceId })).data).toHaveProperty('mama_id');

    const baja = await admin.client.from('perfiles').update({ rol: 'operario' }).eq('id', u.userId).select('rol');
    expect(baja.data).toEqual([{ rol: 'operario' }]);
    expect((await u.client.from('perfiles').select('id')).data).toHaveLength(1);
    expect((await u.client.rpc('obtener_planta', { p_planta_id: cruceId })).data).not.toHaveProperty('mama_id');
    const vuelve = await u.client.from('perfiles').update({ rol: 'admin' }).eq('id', u.userId);
    expect(vuelve.error?.code).toBe('42501');
  });

  it('un admin puede insertar el perfil de una cuenta de Auth sin perfil, pero no de un id inexistente', async () => {
    const { data: creado, error } = await service.auth.admin.createUser({
      email: `aud-g8-sinperfil-${ctx.sufijo}@test.local`,
      password: PASSWORD_G8,
      email_confirm: true,
    });
    expect(error).toBeNull();
    ctx.registrarUsuario(creado.user!.id);
    // handle_new_user lo crea al registrar; se borra para simular un perfil faltante.
    await service.from('perfiles').delete().eq('id', creado.user!.id);

    const ok = await admin.client.from('perfiles')
      .insert({ id: creado.user!.id, nombre: 'Restaurado por admin', rol: 'operario' })
      .select('id');
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);

    const inexistente = await admin.client.from('perfiles')
      .insert({ id: '00000000-0000-0000-0000-0000000000b1', nombre: 'sin cuenta' });
    expect(inexistente.error?.code).toBe('23503');
  });

  it('borrar el perfil de un usuario que creó individuos se rechaza por permiso y la FK protege la baja administrativa', async () => {
    const u = await ctx.usuario('usr-con-individuos', 'operario');
    const { error: errInd } = await service.from('individuos')
      .insert({ planta_id: cruceId, created_by: u.userId, codigo_display: '' });
    expect(errInd).toBeNull();

    const del = await admin.client.from('perfiles').delete().eq('id', u.userId).select('id');
    expect(del.error?.code).toBe('42501');
    const privilegiado = await service.from('perfiles').delete().eq('id', u.userId);
    expect(privilegiado.error?.code).toBe('23503');
    const { data } = await service.from('perfiles').select('id').eq('id', u.userId);
    expect(data).toHaveLength(1);
  });

  it('un usuario sin perfil no puede usar el chat y obtener_planta falla (no hay lectura sin auditoría)', async () => {
    const u = await ctx.usuario('usr-sinperfil-chat', 'operario');
    await service.from('perfiles').delete().eq('id', u.userId);
    const chat = await u.client.rpc('obtener_canal_chat', { p_tipo: 'general' });
    expect(chat.error?.code).toBe('42501');
    const ficha = await u.client.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(ficha.error).not.toBeNull();
    expect(ficha.data).toBeNull();
    expect(await auditoriaDe(u.userId, 'lectura_ficha')).toHaveLength(0);
  });

  it('borrar un perfil borra sus membresías y lecturas de chat, deja created_by en NULL en lo que creó y conserva el nombre en sus mensajes', async () => {
    const v = await ctx.usuario('usr-cascada', 'operario');
    const variedad = await v.client.from('variedades')
      .insert({ especie_id: especieId, nombre: `AUD-G8 cascada ${ctx.sufijo}`, created_by: v.userId })
      .select('id')
      .single();
    expect(variedad.error).toBeNull();
    const canal = await admin.client.rpc('crear_canal_libre', { p_nombre: `AUD-G8 cascada ${ctx.sufijo}`, p_participantes: [v.userId] });
    expect(canal.error).toBeNull();
    ctx.registrarCanal(canal.data as string);
    const msg = await v.client.rpc('enviar_mensaje_chat', {
      p_canal_id: canal.data, p_contenido: 'antes de irme', p_clave_envio: crypto.randomUUID(),
    });
    expect(msg.error).toBeNull();
    expect((await v.client.rpc('marcar_chat_leido', { p_canal_id: canal.data, p_posicion: 1 })).error).toBeNull();

    const del = await admin.client.from('perfiles').delete().eq('id', v.userId).select('id');
    expect(del.error?.code).toBe('42501');
    // Comprobar además las cascadas de una baja administrativa legítima.
    const baja = await service.auth.admin.deleteUser(v.userId);
    expect(baja.error).toBeNull();

    const { data: var2 } = await service.from('variedades').select('created_by').eq('id', variedad.data!.id).single();
    expect(var2!.created_by).toBeNull(); // se pierde la autoría de la variedad
    expect((await service.from('chat_canal_participantes').select('usuario_id').eq('usuario_id', v.userId)).data).toHaveLength(0);
    expect((await service.from('chat_lecturas').select('usuario_id').eq('usuario_id', v.userId)).data).toHaveLength(0);
    const { data: m2 } = await service.from('chat_mensajes').select('autor_id, autor_nombre').eq('id', msg.data.id).single();
    expect(m2!.autor_id).toBeNull();
    expect(m2!.autor_nombre).toBe(v.email); // el helper de pruebas fija nombre = correo
  });

  // A1-G8-17. La pantalla de usuarios identifica a las personas solo por `nombre`, que cada usuario
  // edita libremente y no es único; no muestra el correo. Un operario puede llamarse como un admin.
  it.fails('A1-G8-17: dos perfiles no deberían poder tener el mismo nombre visible (o la pantalla debería mostrar el correo)', async () => {
    const a = await ctx.usuario('usr-homonimo-a', 'operario');
    const b = await ctx.usuario('usr-homonimo-b', 'operario');
    const nombre = `Efraín Homónimo ${ctx.sufijo}`;
    expect((await a.client.from('perfiles').update({ nombre }).eq('id', a.userId)).error).toBeNull();
    const r = await b.client.from('perfiles').update({ nombre }).eq('id', b.userId);
    expect(r.error).not.toBeNull();
  });

  // A1-G8-03. Nada deja rastro del cambio de rol o de permiso de linaje.
  it('A1-G8-03: un cambio de rol o de puede_ver_linaje queda en audit_log (autor, anterior, nuevo)', async () => {
    const u = await ctx.usuario('usr-auditoria', 'operario');
    const desde = new Date(Date.now() - 5000).toISOString();
    const r = await admin.client.from('perfiles')
      .update({ puede_ver_linaje: true, rol: 'admin' }).eq('id', u.userId).select('id');
    expect(r.error).toBeNull();
    const { data } = await service
      .from('audit_log')
      .select('id, usuario_id, accion, detalle')
      .gte('ocurrido_en', desde);
    const cambios = (data ?? []).filter(f => f.accion === 'cambio_perfil' &&
      f.usuario_id === admin.userId && f.detalle.perfil_id === u.userId && f.detalle.operacion === 'UPDATE');
    expect(cambios).toHaveLength(1);
    expect(cambios[0].detalle.anterior).toMatchObject({ rol: 'operario', puede_ver_linaje: false });
    expect(cambios[0].detalle.nuevo).toMatchObject({ rol: 'admin', puede_ver_linaje: true });
  });

  // A1-G8-04. La pantalla bloquea el auto-cambio; la API no.
  it.fails('A1-G8-04: un admin no debería poder degradarse a sí mismo por la API (la pantalla lo bloquea)', async () => {
    const a = await ctx.usuario('usr-autodegrada', 'admin');
    const r = await a.client.from('perfiles').update({ rol: 'operario' }).eq('id', a.userId).select('rol');
    expect(r.error).not.toBeNull();
  });

  // A1-G8-04 (variante concurrente, reproducida 2 de 12 pares en la exploración). Cada admin degrada al otro en el
  // mismo instante: ambas sentencias ven al otro como admin (es_admin() se evalúa con la foto de inicio de la
  // sentencia) y las dos tienen éxito, sin ningún admin restante. Solo se usan cuentas creadas por esta prueba.
  it.fails('A1-G8-04: dos admins que se degradan mutuamente a la vez no deberían quedar ambos como operario', async () => {
    let dobles = 0;
    for (let ronda = 0; ronda < 5 && dobles === 0; ronda++) {
      const pares = await Promise.all(Array.from({ length: 12 }, async (_, i) => ({
        x: await ctx.usuario(`carrera-x${ronda}-${i}`, 'admin'),
        y: await ctx.usuario(`carrera-y${ronda}-${i}`, 'admin'),
      })));
      const resultados = await Promise.all(pares.map(async ({ x, y }) => {
        const [a, b] = await Promise.all([
          x.client.from('perfiles').update({ rol: 'operario' }).eq('id', y.userId).select('rol'),
          y.client.from('perfiles').update({ rol: 'operario' }).eq('id', x.userId).select('rol'),
        ]);
        return (a.data?.length ?? 0) + (b.data?.length ?? 0);
      }));
      dobles += resultados.filter((n) => n === 2).length;
    }
    expect(dobles).toBe(0);
  }, 120_000);

  // A1-G8-02. Borrar un perfil anonimiza la autoría del audit_log (FK ON DELETE SET NULL).
  it('A1-G8-02: borrar el perfil conserva la identidad de sus lecturas en detalle.usuario_eliminado', async () => {
    const u = await ctx.usuario('usr-borrado-audit', 'operario');
    const lee = await u.client.rpc('obtener_planta', { p_planta_id: cruceId });
    expect(lee.error).toBeNull();
    const lecturas = await auditoriaDe(u.userId, 'lectura_ficha');
    expect(lecturas).toHaveLength(1);

    // A1-003 cerró DELETE authenticated; comprobar también la baja privilegiada.
    const del = await service.from('perfiles').delete().eq('id', u.userId).select('id');
    expect(del.error).toBeNull();
    expect(del.data).toHaveLength(1);

    const { data, error } = await service.from('audit_log').select('usuario_id, detalle')
      .in('id', lecturas.map(f => f.id));
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].usuario_id).toBeNull();
    expect(data![0].detalle.usuario_eliminado).toEqual({ id: u.userId, correo: u.email, nombre: u.email });
  });

  // A1-G8-05. Sin perfil la cuenta de Auth sigue siendo "autenticada" y conserva el acceso operativo.
  it.fails('A1-G8-05: una cuenta cuyo perfil fue borrado no debería conservar acceso a los datos', async () => {
    const u = await ctx.usuario('usr-sin-acceso', 'operario');
    // Preparación privilegiada de una cuenta sin perfil: no prueba permisos de borrado.
    const del = await service.from('perfiles').delete().eq('id', u.userId).select('id');
    expect(del.data).toHaveLength(1);
    const lee = await u.client.from('plantas_operativas').select('id', { count: 'exact', head: true });
    expect(lee.count ?? 0).toBe(0);
  });
});
