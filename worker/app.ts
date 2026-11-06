import { Hono } from 'hono'
import type { Env } from './env'

// Collaborators tests can swap out. Empty for now; later tasks add to it.
export type AppDeps = Record<string, never>

export function createApp(_deps: AppDeps = {}) {
  const app = new Hono<{ Bindings: Env }>().basePath('/api')
  app.get('/health', (c) => c.json({ ok: true }))
  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  return app
}
