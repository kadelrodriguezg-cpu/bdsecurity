/**
 * Helpers de los tests de RLS.
 *
 * Obtiene las credenciales del contenedor Kong LOCAL, sin invocar la CLI de
 * Supabase (un proyecto vinculado nunca puede redirigir esta lectura), y crea
 * los usuarios de prueba con la API admin de Supabase Auth.
 */
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface LocalCreds {
  url: string;
  anonKey: string;
  serviceKey: string;
}

/** Lee las claves del contenedor local; falla si el stack Docker no está arriba. */
export function getLocalCreds(): LocalCreds {
  const contenedor = process.env.SUPABASE_KONG_CONTAINER ?? 'supabase_kong_dbsecurity-frutales';
  const out = execFileSync('docker', ['exec', contenedor, 'cat', '/home/kong/kong.yml'], { encoding: 'utf8' });
  const get = (prefijo: 'sb_publishable_' | 'sb_secret_'): string => {
    const m = out.match(new RegExp(`${prefijo}[A-Za-z0-9_-]+`));
    if (!m) throw new Error(`No encontré una clave ${prefijo} en ${contenedor}. ¿Está corriendo el stack local?`);
    return m[0];
  };
  return {
    // config.toml reserva 54600:54603 para este proyecto; 54321 pertenece al
    // rango default de otro stack local y haría que los tests apunten a la API
    // equivocada cuando SUPABASE_LOCAL_URL no está definido.
    url: process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54600',
    anonKey: get('sb_publishable_'),
    serviceKey: get('sb_secret_'),
  };
}

/**
 * Crea (o recupera, si ya existe de una corrida anterior) un usuario de prueba
 * y su perfil, y devuelve un cliente YA LOGUEADO como ese usuario.
 * Usa el cliente service_role SOLO para el alta; el cliente devuelto usa la
 * anon key y por lo tanto está sujeto al RLS, que es lo que queremos testear.
 */
export async function crearUsuarioDePrueba(
  creds: LocalCreds,
  admin: SupabaseClient,
  opts: { email: string; rol: 'admin' | 'operario'; puedeVerLinaje?: boolean },
): Promise<{ client: SupabaseClient; userId: string }> {
  const password = 'test-password-123';

  let userId: string | undefined;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: opts.email,
    password,
    email_confirm: true,
  });
  if (createErr) {
    // Ya existía de una corrida anterior: lo buscamos, recorriendo todas las
    // páginas (las suites dejan usuarios y el fijo puede quedar más allá de 1000).
    for (let page = 1; !userId; page += 1) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (listErr) throw listErr;
      userId = list.users.find((u) => u.email === opts.email)?.id;
      if (list.users.length < 1000) break;
    }
    if (!userId) throw new Error(`No pude crear ni encontrar al usuario ${opts.email}: ${createErr.message}`);
  } else {
    userId = created.user.id;
  }

  // Perfil (upsert con service_role: bypassa RLS, es el alta administrativa).
  const { error: perfilErr } = await admin.from('perfiles').upsert({
    id: userId,
    nombre: opts.email,
    rol: opts.rol,
    puede_ver_linaje: opts.puedeVerLinaje ?? false,
  });
  if (perfilErr) throw new Error(`No pude crear el perfil de ${opts.email}: ${perfilErr.message}`);

  // Cliente logueado con la ANON key (sujeto a RLS).
  const client = createClient(creds.url, creds.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginErr } = await client.auth.signInWithPassword({ email: opts.email, password });
  if (loginErr) throw new Error(`Login de ${opts.email} falló: ${loginErr.message}`);

  return { client, userId };
}
