import { Hono } from 'hono'
import { createAuth } from './auth'
import { resendSender, type SendCode } from './email'
import type { Env } from './env'

// Collaborators tests can swap out.
export type AppDeps = { sendCode?: SendCode }

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<{ Bindings: Env }>().basePath('/api')
  app.get('/health', (c) => c.json({ ok: true }))
  app.on(['GET', 'POST'], '/auth/*', (c) =>
    createAuth(c.env, deps.sendCode ?? resendSender(c.env)).handler(c.req.raw),
  )
  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  return app
}
