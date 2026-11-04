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
    // randomUUID. Dev server only: never in build, preview or tests. The dev
    // server listens on localhost only; use `pnpm dev --host` for phone testing.
    ...(command === 'serve' && !isPreview ? [basicSsl()] : []),
  ],
}))
