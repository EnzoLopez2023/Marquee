import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { manifestIcons, pwaIncludeAssets } from './scripts/icon-config.mjs'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: pwaIncludeAssets,
      manifest: {
        name: 'Marquee',
        short_name: 'Marquee',
        description: 'Independent Plex, Tautulli, and Sonarr operations and analytics.',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: manifestIcons,
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/marquee-icon-1024.png'],
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/oauth2/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
})
