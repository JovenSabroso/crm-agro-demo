import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'CRM-Agro', short_name: 'CRM-Agro', description: 'Gestión modular agrícola, del campo a la nube',
        lang: 'es', theme_color: '#1c4a2e', background_color: '#f6f3ea', display: 'standalone', start_url: '/', scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          // Lecturas de la API: red primero, con respaldo en caché para consultar datos recientes sin señal.
          { urlPattern: ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'GET' && !url.pathname.startsWith('/api/public'), handler: 'NetworkFirst', options: { cacheName: 'api-lecturas', networkTimeoutSeconds: 4, expiration: { maxEntries: 120, maxAgeSeconds: 86400 }, cacheableResponse: { statuses: [200] } } },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true } } },
  test: { environment: 'jsdom', include: ['tests/**/*.test.js'], testTimeout: 30000 },
});
