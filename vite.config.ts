import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'generateSW',
      injectRegister: false,
      manifest: {
        name: 'Glazette',
        short_name: 'Glazette',
        start_url: '/',
        display: 'standalone',
        background_color: '#EEF1F4',
        theme_color: '#EEF1F4',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
    // Phones testing over the LAN need a secure context for crypto.subtle and
    // randomUUID. Dev server only: never in build, preview or tests. The dev
    // server listens on localhost only; use `pnpm dev --host` for phone testing.
    ...(command === 'serve' && !isPreview ? [basicSsl()] : []),
  ],
  server: { proxy: { '/api': 'http://localhost:8787' } },
}))
