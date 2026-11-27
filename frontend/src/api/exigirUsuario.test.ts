/** U-04: sin red, pedir el usuario no se confunde con una sesión expirada. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';
import { ErrorApi, exigirUsuario, MENSAJE_SIN_CONEXION_EVALUACION, supabase } from './client';

afterEach(() => { vi.restoreAllMocks(); });

describe('exigirUsuario', () => {
  it('devuelve el usuario cuando hay sesión', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'u1' } }, error: null } as never);
    await expect(exigirUsuario()).resolves.toMatchObject({ id: 'u1' });
  });

  it('sin red lanza un error de tipo red con el mensaje de la evaluación', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) } as never);
    const error = await exigirUsuario(MENSAJE_SIN_CONEXION_EVALUACION).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ tipo: 'red', message: 'Sin conexión: tu evaluación sigue aquí.' });
  });

  it('con el navegador fuera de línea también es un error de red', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: null }, error: new Error('cualquiera') } as never);
    await expect(exigirUsuario()).rejects.toMatchObject({ tipo: 'red', message: 'Sin conexión: lo que escribiste sigue aquí.' });
  });

  it('sin sesión (y con red) dice que la sesión expiró', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() } as never);
    await expect(exigirUsuario()).rejects.toMatchObject({ tipo: 'sin_sesion', message: 'Tu sesión expiró. Vuelve a iniciar sesión.' });
  });
});
