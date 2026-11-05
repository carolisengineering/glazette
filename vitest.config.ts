import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwa-register-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
