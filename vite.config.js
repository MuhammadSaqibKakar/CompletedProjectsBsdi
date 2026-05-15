import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'BSDI Completed Projects',
        short_name: 'BSDI',
        description: 'Offline dashboard for BSDI completed project records and media.',
        theme_color: '#f8fbf7',
        background_color: '#f8fbf7',
        display: 'standalone',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,webmanifest,json}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//, /^\/database\/media\//, /^\/synced-media\//, /^\/brand\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/media/') ||
              url.pathname.startsWith('/database/media/') ||
              url.pathname.startsWith('/synced-media/') ||
              url.pathname.startsWith('/brand/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'bsdi-media',
              expiration: {
                maxEntries: 1400,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
              rangeRequests: true,
              cacheableResponse: {
                statuses: [0, 200, 206],
              },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.pathname === '/api/state' ||
              url.pathname === '/data/projects.json' ||
              url.pathname === '/database/bsdi-db.json',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bsdi-data',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 8,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
})
