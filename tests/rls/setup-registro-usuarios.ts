/**
 * Setup de cada archivo de prueba: anota los usuarios de Auth que se crean.
 *
 * Envuelve `createClient` de supabase-js para que los clientes devueltos anoten
 * en el registro de la corrida el id de todo usuario creado con
 * `auth.admin.createUser` o `auth.signUp`. Así cubre a la vez a
 * `crearUsuarioDePrueba` y a los helpers propios de cada grupo de pruebas, sin
 * tocar cada sitio de alta. El borrado final está en `global-setup.ts`.
 */
import { vi } from 'vitest';
import { anotarUsuarioCreado } from './registro-usuarios';

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@supabase/supabase-js')>();

  type RespuestaConUsuario = { data?: { user?: { id?: string | null } | null } | null };
  const anotarSiCreo = <R extends RespuestaConUsuario>(respuesta: R): R => {
    anotarUsuarioCreado(respuesta?.data?.user?.id);
    return respuesta;
  };

  const createClient: typeof original.createClient = ((...args: Parameters<typeof original.createClient>) => {
    const cliente = original.createClient(...args);
    const admin = cliente.auth.admin;
    const crearOriginal = admin.createUser.bind(admin);
    admin.createUser = async (...a: Parameters<typeof crearOriginal>) => anotarSiCreo(await crearOriginal(...a));
    const signUpOriginal = cliente.auth.signUp.bind(cliente.auth);
    cliente.auth.signUp = (async (...a: Parameters<typeof signUpOriginal>) => anotarSiCreo(await signUpOriginal(...a))) as typeof cliente.auth.signUp;
    return cliente;
  }) as typeof original.createClient;

  return { ...original, createClient };
});
