import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(dirname, './src') } },
  test: {
    environment: 'jsdom',
    // Las pruebas mockean Supabase, pero el cliente exige estas variables al
    // importarse: valores fijos para que corran en un clon sin .env.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54600',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_prueba_sin_uso',
    },
    // .vercel/output guarda copias compiladas de api/*.test.ts de builds
    // locales de Vercel; no son parte del repo y duplicaban tests.
    exclude: [...configDefaults.exclude, '.vercel/**'],
  },
});
