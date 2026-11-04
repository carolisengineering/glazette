import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Phones testing over the LAN need a secure context for crypto.subtle and
    // randomUUID. Dev server only: never in build, preview or tests.
    ...(command === 'serve' && !isPreview ? [basicSsl()] : []),
  ],
  // Without this, `vite` listens on localhost only. Opt in with `pnpm dev --host`
  // when testing on a phone, rather than exposing the dev server by default.
}))
