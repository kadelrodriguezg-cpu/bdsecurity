// Guardia común de los scripts de datos de demostración: solo corren contra la base LOCAL.
// Uso: `const URL = urlLocal();` como primera instrucción del script.
//
// La URL por defecto es la API local del CLI de Supabase (supabase/config.toml, puerto 54600). Se puede
// cambiar con DEMO_SUPABASE_URL, pero el host tiene que seguir siendo 127.0.0.1 o localhost: si no, el
// script se niega a correr y no toca nada.
const URL_POR_DEFECTO = 'http://127.0.0.1:54600';
const HOSTS_LOCALES = new Set(['127.0.0.1', 'localhost']);

export function urlLocal() {
  const crudo = process.env.DEMO_SUPABASE_URL ?? URL_POR_DEFECTO;
  let host;
  try {
    host = new URL(crudo).hostname;
  } catch {
    host = null;
  }
  if (!host || !HOSTS_LOCALES.has(host)) {
    console.error(
      `ERROR: los scripts de scripts/demo/ solo corren contra la base local (127.0.0.1 o localhost). ` +
      `Host recibido: ${host ?? `«${crudo}» (no es una URL)`}. No se hizo nada.`,
    );
    process.exit(1);
  }
  return crudo;
}

/**
 * Id de un usuario de Auth por su correo, recorriendo TODAS las páginas de `listUsers` (de 1000 en 1000).
 * La base local acumula usuarios de las pruebas automáticas: con más de 1000, la primera página ya no alcanza.
 */
export async function idDeUsuarioPorEmail(svc, email) {
  for (let pagina = 1; ; pagina += 1) {
    const { data, error } = await svc.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (error) throw new Error(`listUsers (página ${pagina}): ${error.message}`);
    const usuario = data.users.find((u) => u.email === email);
    if (usuario) return usuario.id;
    if (data.users.length < 1000) throw new Error(`No existe el usuario ${email}`);
  }
}
