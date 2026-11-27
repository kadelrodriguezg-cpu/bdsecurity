import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginVersion } from './vite-plugin-version';

// __dirname no existe en módulos ESM; se reconstruye desde import.meta.url.
const dirname = path.dirname(fileURLToPath(import.meta.url));

// PWA: los operarios de campo instalan la app en el celular (modo standalone)
// para escanear QR con la cámara sin fricción de navegador.
export default defineConfig({
  plugins: [
    react(),
    // dist/version.json + constante __BUILD_ID__: base de la actualización automática de la app.
    pluginVersion(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // version.json NUNCA entra al precache: la app lo pide siempre a la red para saber si hay versión nueva.
        globIgnores: ['version.json'],
        navigateFallbackDenylist: [/^\/version\.json$/],
        // Notificaciones push de menciones: se suma al worker generado, no lo reemplaza.
        importScripts: ['sw-push.js'],
      },
      manifest: {
        name: 'BDSecurity',
        short_name: 'BDSecurity',
        description: 'Trazabilidad genética de frutales',
        theme_color: '#4338ca',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          // Maskable dedicado con zona segura (el ícono "any" se recortaría en
          // launchers que aplican máscara circular/redondeada).
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(dirname, './src') },
  },
});
