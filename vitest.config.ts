import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Permite probar la API real del frontend contra Supabase local, sin réplicas.
  resolve: { alias: { '@': fileURLToPath(new URL('./frontend/src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Los tests de RLS comparten estado (usuarios, planta del seed, audit_log):
    // se corren en un solo hilo y en orden, no en paralelo.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Las pruebas anotan los usuarios de Auth que crean y, al terminar la
    // corrida, el teardown global los borra (ver tests/rls/README.md).
    globalSetup: ['tests/rls/global-setup.ts'],
    setupFiles: ['tests/rls/setup-registro-usuarios.ts'],
  },
});
